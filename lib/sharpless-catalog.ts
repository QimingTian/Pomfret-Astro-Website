import catalog from './sharpless-j2000.json'

const positions = new Map<number, { raHours: number; decDeg: number }>(
  catalog.entries.map(([number, raHours, decDeg]) => [number, { raHours, decDeg }]),
)

export function resolveSharplessTarget(query: string) {
  const value = query.trim()
  const match = value.match(/^sh\s*2\s*[- ]?\s*(\d{1,3})$/i) ??
    value.match(/^sharpless(?:\s+2\s*[- ]\s*|\s+)(\d{1,3})$/i)
  if (!match) return null
  const number = Number(match[1])
  const position = positions.get(number)
  if (!position) return null
  return {
    canonicalName: `Sh2-${number}`,
    aliases: [`Sh 2-${number}`, `Sharpless ${number}`],
    ...position,
  }
}
