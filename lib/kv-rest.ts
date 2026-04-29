const KV_URL = process.env.KV_REST_API_URL
const KV_TOKEN = process.env.KV_REST_API_TOKEN

function enabled(): boolean {
  return Boolean(KV_URL && KV_TOKEN)
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  if (!KV_URL || !KV_TOKEN) throw new Error('KV REST env not configured')
  return fetch(`${KV_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })
}

export async function kvGetJson<T>(key: string): Promise<T | undefined> {
  if (!enabled()) return undefined
  try {
    const res = await request(`/get/${encodeURIComponent(key)}`)
    if (!res.ok) return undefined
    const body = (await res.json()) as { result?: unknown }
    if (typeof body.result !== 'string') return undefined
    return JSON.parse(body.result) as T
  } catch {
    return undefined
  }
}

export async function kvSetJson(key: string, value: unknown): Promise<boolean> {
  if (!enabled()) return false
  try {
    const payload = encodeURIComponent(JSON.stringify(value))
    const res = await request(`/set/${encodeURIComponent(key)}/${payload}`, { method: 'POST' })
    return res.ok
  } catch {
    return false
  }
}

export function kvEnabled(): boolean {
  return enabled()
}
