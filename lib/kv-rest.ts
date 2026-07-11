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

/** Run one Redis command via Upstash REST (value in POST body — no URL size limit). */
async function redisCommand(command: string, ...args: (string | number)[]): Promise<unknown> {
  const res = await request('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([command, ...args]),
  })
  if (!res.ok) return undefined
  const body = (await res.json()) as { result?: unknown }
  return body.result
}

export async function kvGetString(key: string): Promise<string | undefined> {
  if (!enabled()) return undefined
  try {
    const raw = await redisCommand('GET', key)
    return typeof raw === 'string' ? raw : undefined
  } catch {
    return undefined
  }
}

export async function kvGetJson<T>(key: string): Promise<T | undefined> {
  const raw = await kvGetString(key)
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

export async function kvSetJson(key: string, value: unknown): Promise<boolean> {
  if (!enabled()) return false
  try {
    const json = JSON.stringify(value)
    const result = await redisCommand('SET', key, json)
    return result === 'OK'
  } catch {
    return false
  }
}

export async function kvDel(key: string): Promise<boolean> {
  if (!enabled()) return false
  try {
    const result = await redisCommand('DEL', key)
    return result === 1 || result === '1'
  } catch {
    return false
  }
}

/** SET key only when current value equals `expected` (use '' when key is missing). */
export async function kvCompareAndSet(key: string, expected: string, next: string): Promise<boolean> {
  if (!enabled()) return false
  const script = `
local cur = redis.call('GET', KEYS[1])
if cur == false then cur = '' end
if cur ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1`
  try {
    const result = await redisCommand('EVAL', script, 1, key, expected, next)
    return result === 1
  } catch {
    return false
  }
}

export function kvEnabled(): boolean {
  return enabled()
}

function parseIncrResult(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number.parseInt(value, 10)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/** Atomic INCR. Returns new count. */
export async function kvIncr(key: string): Promise<number | undefined> {
  if (!enabled()) return undefined
  try {
    return parseIncrResult(await redisCommand('INCR', key))
  } catch {
    return undefined
  }
}

/**
 * Atomic INCR; when key is missing, initializes to seedIfMissing + 1.
 * Used for preview frame counters so a failed preview blob write cannot roll back the count.
 */
export async function kvIncrFromSeed(key: string, seedIfMissing: number): Promise<number | undefined> {
  if (!enabled()) return undefined
  const seed = Number.isFinite(seedIfMissing) && seedIfMissing >= 0 ? Math.floor(seedIfMissing) : 0
  const script = `
local cur = redis.call('GET', KEYS[1])
if cur then
  return redis.call('INCR', KEYS[1])
end
local next = tonumber(ARGV[1]) + 1
redis.call('SET', KEYS[1], next)
return next`
  try {
    return parseIncrResult(await redisCommand('EVAL', script, 1, key, seed))
  } catch {
    return undefined
  }
}

/** Increment a counter with TTL (sliding window rate limit). Returns new count. */
export async function kvIncrWithExpire(key: string, windowSec: number): Promise<number | undefined> {
  if (!enabled()) return undefined
  try {
    const count = await redisCommand('INCR', key)
    if (count === 1) {
      await redisCommand('EXPIRE', key, windowSec)
    }
    return parseIncrResult(count)
  } catch {
    return undefined
  }
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/** LPUSH + LTRIM for bounded live-event buffers. Returns new list length. */
export async function kvListPush(key: string, value: string, maxLen: number): Promise<number | undefined> {
  if (!enabled()) return undefined
  const cap = Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : 100
  try {
    const len = await redisCommand('LPUSH', key, value)
    await redisCommand('LTRIM', key, 0, cap - 1)
    return parseIncrResult(len)
  } catch {
    return undefined
  }
}

/** LRANGE start stop (inclusive). */
export async function kvListRange(key: string, start: number, stop: number): Promise<string[]> {
  if (!enabled()) return []
  try {
    return parseStringArray(await redisCommand('LRANGE', key, start, stop))
  } catch {
    return []
  }
}

/** EXPIRE key seconds. */
export async function kvExpire(key: string, seconds: number): Promise<boolean> {
  if (!enabled()) return false
  try {
    const result = await redisCommand('EXPIRE', key, seconds)
    return result === 1 || result === '1'
  } catch {
    return false
  }
}
