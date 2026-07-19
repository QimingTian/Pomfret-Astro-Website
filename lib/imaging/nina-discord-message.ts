/** Walk a NINA sequence tree and set Discord Alert instruction text. */
export function patchNinaDiscordMessageText(root: Record<string, unknown>, text: string): void {
  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    const rec = node as Record<string, unknown>
    const type = rec.$type
    if (typeof type === 'string' && type.includes('DiscordMessageInstruction')) {
      rec.Text = text
    }
    for (const value of Object.values(rec)) walk(value)
  }
  walk(root)
}

export const END_NIGHT_DISCORD_AFTER_SESSIONS = "Tonight's Session Completed."
export const END_NIGHT_DISCORD_DAWN = 'End Night - Dawn'
export const ESTOP_DISCORD_MANUAL = 'ESTOPPED'
export const ESTOP_DISCORD_WEATHER_SAFETY = 'Weather Safety System Triggered -- Observatory Locked.'
