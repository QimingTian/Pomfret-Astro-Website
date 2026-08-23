import { listMembersForAdminDirectory } from '@/lib/member-store'
import { POMFRET_SITE } from '@/lib/observatory-sites'

function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function uniqueValidEmails(values: string[]): string[] {
  const seen = new Set<string>()
  for (const raw of values) {
    const email = raw.trim().toLowerCase()
    if (!isLikelyEmail(email)) continue
    seen.add(email)
  }
  return Array.from(seen)
}

async function listAdminAlertRecipients(): Promise<string[]> {
  const members = await listMembersForAdminDirectory()
  const fromMembers = members.filter((m) => m.role === 'admin').map((m) => m.email)
  const fallback = (process.env.BOOTSTRAP_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
  return uniqueValidEmails([...fromMembers, ...fallback])
}

/**
 * Sends observatory disconnected alert to all admins once per transition.
 */
export async function sendObservatoryDisconnectedAlertEmail(): Promise<{
  sent: boolean
  reason?: string
  recipients?: string[]
}> {
  const recipients = await listAdminAlertRecipients()
  if (recipients.length === 0) {
    return { sent: false, reason: 'No admin recipients configured' }
  }

  const apiKey = env('RESEND_API_KEY')
  const from = env('IMAGING_MAIL_FROM')
  if (!apiKey || !from) {
    return { sent: false, reason: 'Mail env not configured' }
  }

  const detectedLocal = new Date().toLocaleString('en-US', { timeZone: POMFRET_SITE.timezone })
  const subject = 'Pomfret Observatory Alert: Observatory Disconnected'
  const greet = 'Hi Observatory Admin,'
  const text = [
    greet,
    '',
    'Observatory Disconnected',
    '',
    `Detected: ${detectedLocal} (${POMFRET_SITE.timezone})`,
    '',
    'You are receiving this email because you are an administrator of the Pomfret Olmsted Observatory.',
    'The website has stopped receiving heartbeats from the observatory agent.',
    '',
    'Please check observatory condition, system power, and network/agent health to make sure everything is safe.',
    '',
    'Clear skies,',
    'Pomfret Astro',
  ].join('\n')

  const html = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #111111;">
      <p>${greet}</p>
      <p><strong>Observatory Disconnected</strong></p>
      <p><strong>Detected:</strong> ${detectedLocal} (${POMFRET_SITE.timezone})</p>
      <p>
        You are receiving this email because you are an administrator of the Pomfret Olmsted Observatory.
        The website has stopped receiving heartbeats from the observatory agent.
      </p>
      <p>
        Please check observatory condition, system power, and network/agent health to make sure everything is safe.
      </p>
      <p>Clear skies,<br/>Pomfret Astro</p>
    </div>
  `

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        text,
        html,
      }),
      cache: 'no-store',
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return {
        sent: false,
        reason: `Provider rejected request (${res.status}): ${detail.slice(0, 200)}`,
        recipients,
      }
    }
    return { sent: true, recipients }
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? error.message : 'Unknown mail error',
      recipients,
    }
  }
}
