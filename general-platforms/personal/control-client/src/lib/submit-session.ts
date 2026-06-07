import { getHubBaseUrl, normalizeHubBaseUrl } from './settings'
import type { SessionOutputMode } from '@shared/output-mode'

export type SubmitSessionInput = {
  target: string
  outputMode: SessionOutputMode
  raHours?: number | null
  decDeg?: number | null
  filter?: string | null
  exposureSeconds?: number | null
  count?: number | null
}

export type SubmitSessionResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

export async function submitSession(
  input: SubmitSessionInput,
  baseUrl = getHubBaseUrl()
): Promise<SubmitSessionResult> {
  const url = `${normalizeHubBaseUrl(baseUrl)}/api/imaging/queue`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(input),
    })
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      error?: string
      request?: { id?: string }
    }
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` }
    }
    const id = data.request?.id
    if (!id) return { ok: false, error: 'Hub did not return session id' }
    return { ok: true, id }
  } catch (ex) {
    return { ok: false, error: ex instanceof Error ? ex.message : 'Submit failed' }
  }
}
