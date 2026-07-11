'use client'

import {
  glassPillDangerSm,
  glassPillLg,
  glassPillLgWide,
  glassPillMd,
  glassPillSm,
  glassPillSuccessSm,
  glassPillXs,
} from '@/lib/glass-ui'
import { useEffect, useRef, useState } from 'react'
import { DashboardPanel } from '@/app/dashboard/account/dashboard-panel'

export function GallerySubmissionSection({ className = '' }: { className?: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !description.trim()) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const createRes = await fetch('/api/member/gallery-submissions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          fileName: file.name,
          contentType: file.type,
          fileSize: file.size,
        }),
      })
      const createData = await createRes.json().catch(() => ({}))
      if (!createRes.ok || createData?.ok !== true || typeof createData.submissionId !== 'string') {
        throw new Error(typeof createData.error === 'string' ? createData.error : 'Could not start upload.')
      }

      const uploadContentType =
        typeof createData.contentType === 'string' && createData.contentType
          ? createData.contentType
          : file.type

      if (createData.uploadMethod === 'server') {
        const uploadRes = await fetch(
          `/api/member/gallery-submissions/${encodeURIComponent(createData.submissionId)}/upload`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': uploadContentType || 'application/octet-stream' },
            body: file,
          }
        )
        const uploadData = await uploadRes.json().catch(() => ({}))
        if (!uploadRes.ok || uploadData?.ok !== true) {
          throw new Error(typeof uploadData.error === 'string' ? uploadData.error : 'Image upload failed.')
        }
      } else {
        if (typeof createData.uploadUrl !== 'string') {
           throw new Error('Could not prepare upload.')
        }
        let putRes: Response
        try {
          putRes = await fetch(createData.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': uploadContentType },
            body: file,
          })
        } catch {
          throw new Error(
            'Image upload blocked by the browser. Try a file under 4 MB, or ask an admin to configure R2 CORS.'
          )
        }
        if (!putRes.ok) {
          throw new Error('Image upload failed. Try a smaller JPG or PNG under 4 MB.')
        }

        const completeRes = await fetch(
          `/api/member/gallery-submissions/${encodeURIComponent(createData.submissionId)}/complete`,
          { method: 'POST', credentials: 'include' }
        )
        const completeData = await completeRes.json().catch(() => ({}))
        if (!completeRes.ok || completeData?.ok !== true) {
          throw new Error(
            typeof completeData.error === 'string' ? completeData.error : 'Could not finalize upload.'
          )
        }
      }

      setDescription('')
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setSuccess('Submitted. An admin will review your work.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed.'
      setError(message === 'Load failed' ? 'Image upload failed. Try a file under 4 MB.' : message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DashboardPanel title="Submit Gallery Work" className={className}>
      <form className="boxed-fields space-y-3 max-w-xl" onSubmit={(e) => void handleSubmit(e)}>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className={`${glassPillMd} disabled:opacity-50`}
          >
            Choose file
          </button>
          {previewUrl ? (
            <img
              src={previewUrl}
              alt=""
              className="mt-2 max-h-48 w-auto max-w-full rounded-lg border border-white/10 object-contain"
            />
          ) : null}
        </div>
        <div>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            maxLength={500}
            placeholder="Description"
            className="w-full rounded-lg border border-gray-600 bg-transparent px-3 py-2 text-sm text-white placeholder:text-gray-500"
          />
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {success ? <p className="text-sm text-green-400">{success}</p> : null}
        <button
          type="submit"
          disabled={busy || !file || !description.trim()}
          className={`${glassPillMd} disabled:opacity-50`}
        >
          {busy ? 'Uploading…' : 'Submit'}
        </button>
      </form>
    </DashboardPanel>
  )
}
