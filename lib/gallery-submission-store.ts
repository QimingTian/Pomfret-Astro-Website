import crypto from 'crypto'

import {
  createGallerySubmissionPresignedPut,
  deleteGallerySubmissionObject,
  extensionForContentType,
  gallerySubmissionR2Enabled,
  getGallerySubmissionObjectBuffer,
  GALLERY_SUBMISSION_MAX_BYTES,
  GALLERY_SUBMISSION_SERVER_UPLOAD_MAX_BYTES,
  headGallerySubmissionObject,
  inferGallerySubmissionContentType,
  pendingSubmissionStorageKey,
  putGallerySubmissionObject,
} from '@/lib/gallery-submission-r2'
import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'
import type { MemberUser } from '@/lib/member-store'

export type GallerySubmissionStatus = 'pending' | 'downloaded' | 'dismissed'

export type GallerySubmission = {
  id: string
  userId: string
  submitterLabel: string
  description: string
  fileName: string
  storageKey: string
  contentType: string
  status: GallerySubmissionStatus
  uploadComplete: boolean
  createdAt: string
  resolvedAt?: string
  resolvedByUserId?: string
}

const SUBMISSIONS_KEY = 'gallery-submissions'
const MAX_SUBMISSIONS = 500
const RESOLVED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

type Payload = { submissions: GallerySubmission[] }

type GlobalStore = typeof globalThis & {
  __pomfret_gallery_submissions__?: GallerySubmission[]
}

function memorySubmissions(): GallerySubmission[] {
  const g = globalThis as GlobalStore
  if (!g.__pomfret_gallery_submissions__) g.__pomfret_gallery_submissions__ = []
  return g.__pomfret_gallery_submissions__
}

async function readSubmissions(): Promise<GallerySubmission[]> {
  if (kvEnabled()) {
    const remote = await kvGetJson<Payload>(SUBMISSIONS_KEY)
    return Array.isArray(remote?.submissions) ? remote.submissions : []
  }
  return [...memorySubmissions()]
}

async function writeSubmissions(submissions: GallerySubmission[]): Promise<void> {
  const nowMs = Date.now()
  const trimmed = submissions
    .filter((s) => {
      if (s.status === 'pending') return true
      const at = Date.parse(s.resolvedAt ?? s.createdAt)
      return !Number.isFinite(at) || nowMs - at <= RESOLVED_RETENTION_MS
    })
    .slice(0, MAX_SUBMISSIONS)
  if (kvEnabled()) {
    await kvSetJson(SUBMISSIONS_KEY, { submissions: trimmed })
    return
  }
  const g = globalThis as GlobalStore
  g.__pomfret_gallery_submissions__ = trimmed
}

export function submitterLabelForUser(user: MemberUser): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  return name || user.username || user.email
}

export async function listPendingGallerySubmissions(): Promise<GallerySubmission[]> {
  const all = await readSubmissions()
  return all
    .filter((s) => s.status === 'pending' && s.uploadComplete)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getGallerySubmissionById(id: string): Promise<GallerySubmission | null> {
  const all = await readSubmissions()
  return all.find((s) => s.id === id) ?? null
}

export async function createGallerySubmission(input: {
  user: MemberUser
  description: string
  fileName: string
  contentType: string
  fileSize: number
}): Promise<
  | {
      ok: true
      submission: GallerySubmission
      uploadMethod: 'server' | 'presigned'
      contentType: string
      uploadUrl?: string
    }
  | { ok: false; error: string }
> {
  const description = input.description.trim()
  if (!description) return { ok: false, error: 'Description is required.' }
  if (description.length > 500) return { ok: false, error: 'Description is too long.' }

  const fileName = input.fileName.trim() || 'submission.png'
  const contentType = inferGallerySubmissionContentType(input.contentType, fileName)
  if (!contentType) return { ok: false, error: 'Unsupported image type. Use PNG, JPEG, or WebP.' }

  if (!Number.isFinite(input.fileSize) || input.fileSize < 1) {
    return { ok: false, error: 'Invalid file size.' }
  }
  if (!gallerySubmissionR2Enabled()) {
    return { ok: false, error: 'Gallery submission storage is not configured.' }
  }
  if (input.fileSize > GALLERY_SUBMISSION_MAX_BYTES) {
    return { ok: false, error: 'File is too large (max 50 MB).' }
  }

  const useServerUpload = input.fileSize <= GALLERY_SUBMISSION_SERVER_UPLOAD_MAX_BYTES
  const id = crypto.randomUUID()
  const ext = extensionForContentType(contentType)
  const storageKey = pendingSubmissionStorageKey(id, ext)
  let uploadUrl: string | undefined
  if (!useServerUpload) {
    const presigned = await createGallerySubmissionPresignedPut(storageKey, contentType, input.fileSize)
    if (!presigned) return { ok: false, error: 'Could not prepare upload.' }
    uploadUrl = presigned
  }

  const submission: GallerySubmission = {
    id,
    userId: input.user.id,
    submitterLabel: submitterLabelForUser(input.user),
    description,
    fileName,
    storageKey,
    contentType,
    status: 'pending',
    uploadComplete: false,
    createdAt: new Date().toISOString(),
  }

  const prev = await readSubmissions()
  await writeSubmissions([submission, ...prev])
  return {
    ok: true,
    submission,
    uploadMethod: useServerUpload ? 'server' : 'presigned',
    contentType,
    uploadUrl,
  }
}

export async function uploadGallerySubmissionBytes(
  submissionId: string,
  userId: string,
  body: Buffer
): Promise<{ ok: true; submission: GallerySubmission } | { ok: false; error: string }> {
  const prev = await readSubmissions()
  const idx = prev.findIndex((s) => s.id === submissionId)
  if (idx === -1) return { ok: false, error: 'Submission not found.' }
  const current = prev[idx]
  if (current.userId !== userId) return { ok: false, error: 'Not allowed.' }
  if (current.status !== 'pending') return { ok: false, error: 'Submission is not pending.' }
  if (current.uploadComplete) return { ok: true, submission: current }
  if (body.length < 1) return { ok: false, error: 'Empty upload.' }
  if (body.length > GALLERY_SUBMISSION_SERVER_UPLOAD_MAX_BYTES) {
    return { ok: false, error: 'File is too large for direct upload (max 4 MB). Export a smaller JPG.' }
  }

  const stored = await putGallerySubmissionObject(current.storageKey, current.contentType ?? 'image/png', body)
  if (!stored) return { ok: false, error: 'Could not store upload.' }

  return completeGallerySubmissionUpload(submissionId, userId)
}

export async function completeGallerySubmissionUpload(
  submissionId: string,
  userId: string
): Promise<{ ok: true; submission: GallerySubmission } | { ok: false; error: string }> {
  const prev = await readSubmissions()
  const idx = prev.findIndex((s) => s.id === submissionId)
  if (idx === -1) return { ok: false, error: 'Submission not found.' }
  const current = prev[idx]
  if (current.userId !== userId) return { ok: false, error: 'Not allowed.' }
  if (current.status !== 'pending') return { ok: false, error: 'Submission is not pending.' }

  const head = await headGallerySubmissionObject(current.storageKey)
  if (!head) return { ok: false, error: 'Upload not found. Try uploading again.' }

  const next = [...prev]
  next[idx] = { ...current, uploadComplete: true }
  await writeSubmissions(next)
  return { ok: true, submission: next[idx] }
}

export async function downloadGallerySubmission(
  submissionId: string,
  adminUserId: string
): Promise<
  | { ok: true; body: Buffer; contentType: string; fileName: string }
  | { ok: false; error: string }
> {
  const prev = await readSubmissions()
  const idx = prev.findIndex((s) => s.id === submissionId)
  if (idx === -1) return { ok: false, error: 'Submission not found.' }
  const current = prev[idx]
  if (current.status !== 'pending' || !current.uploadComplete) {
    return { ok: false, error: 'Submission is not available.' }
  }

  const obj = await getGallerySubmissionObjectBuffer(current.storageKey)
  if (!obj) return { ok: false, error: 'File not found in storage.' }

  await deleteGallerySubmissionObject(current.storageKey)

  const next = [...prev]
  next[idx] = {
    ...current,
    status: 'downloaded',
    resolvedAt: new Date().toISOString(),
    resolvedByUserId: adminUserId,
  }
  await writeSubmissions(next)

  return {
    ok: true,
    body: obj.body,
    contentType: current.contentType || obj.contentType,
    fileName: current.fileName,
  }
}

export async function dismissGallerySubmission(
  submissionId: string,
  adminUserId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const prev = await readSubmissions()
  const idx = prev.findIndex((s) => s.id === submissionId)
  if (idx === -1) return { ok: false, error: 'Submission not found.' }
  const current = prev[idx]
  if (current.status !== 'pending') return { ok: false, error: 'Submission is not pending.' }

  await deleteGallerySubmissionObject(current.storageKey)

  const next = [...prev]
  next[idx] = {
    ...current,
    status: 'dismissed',
    resolvedAt: new Date().toISOString(),
    resolvedByUserId: adminUserId,
  }
  await writeSubmissions(next)
  return { ok: true }
}

export async function getGallerySubmissionPreviewBuffer(
  submissionId: string
): Promise<{ body: Buffer; contentType: string } | null> {
  const submission = await getGallerySubmissionById(submissionId)
  if (!submission || submission.status !== 'pending' || !submission.uploadComplete) return null
  const obj = await getGallerySubmissionObjectBuffer(submission.storageKey)
  if (!obj) return null
  return { body: obj.body, contentType: submission.contentType || obj.contentType }
}
