import crypto from 'crypto'

import { kvDel, kvGetJson, kvSetJson, kvEnabled } from '@/lib/kv-rest'
import { publicSiteOrigin } from '@/lib/site-url'

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000
const KEY_PREFIX = 'email-verify:'

type VerifyPayload = {
  userId: string
  email: string
  expiresAt: string
}

type GlobalVerify = typeof globalThis & {
  __pomfret_email_verify__?: Record<string, VerifyPayload>
}

function memoryVerify(): Record<string, VerifyPayload> {
  const g = globalThis as GlobalVerify
  if (!g.__pomfret_email_verify__) g.__pomfret_email_verify__ = {}
  return g.__pomfret_email_verify__
}

function verifyKey(token: string): string {
  return `${KEY_PREFIX}${token}`
}

export function generateEmailVerificationToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export async function storeEmailVerificationToken(
  token: string,
  payload: { userId: string; email: string }
): Promise<void> {
  const record: VerifyPayload = {
    userId: payload.userId,
    email: payload.email,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  }
  if (kvEnabled()) {
    await kvSetJson(verifyKey(token), record)
    return
  }
  memoryVerify()[token] = record
}

export async function consumeEmailVerificationToken(
  token: string
): Promise<{ userId: string; email: string } | null> {
  const trimmed = token.trim()
  if (!trimmed) return null

  let record: VerifyPayload | undefined
  if (kvEnabled()) {
    record = await kvGetJson<VerifyPayload>(verifyKey(trimmed))
    if (record) await kvDel(verifyKey(trimmed))
  } else {
    record = memoryVerify()[trimmed]
    delete memoryVerify()[trimmed]
  }

  if (!record?.userId || !record.email || !record.expiresAt) return null
  if (Date.parse(record.expiresAt) <= Date.now()) return null
  return { userId: record.userId, email: record.email }
}

function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

export async function sendEmailVerificationEmail(input: {
  email: string
  firstName: string
  token: string
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = env('RESEND_API_KEY')
  const from = env('IMAGING_MAIL_FROM')
  if (!apiKey || !from) {
    return { sent: false, reason: 'Mail env not configured' }
  }

  const link = `${publicSiteOrigin()}/api/auth/verify-email?token=${encodeURIComponent(input.token)}`
  const greet = input.firstName.trim() ? `Hi ${input.firstName},` : 'Hi,'
  const subject = 'Verify your Pomfret Astro account'
  const text = [
    greet,
    '',
    'Please verify your email address to use Pomfret Astro imaging features.',
    '',
    link,
    '',
    'This link expires in 24 hours.',
    '',
    'Clear skies,',
    'Pomfret Astro',
  ].join('\n')

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.email],
        subject,
        text,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { sent: false, reason: body || `Resend HTTP ${res.status}` }
    }
    return { sent: true }
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : 'Send failed' }
  }
}
