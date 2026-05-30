type CompletionEmailInput = {
  queueId: string
  target: string
  email?: string | null
  firstName?: string | null
  completedAtIso: string
}

function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/**
 * Sends completion notification email via Resend REST API.
 * No-op when env vars are missing or recipient email is invalid.
 */
export async function sendCompletionEmail(input: CompletionEmailInput): Promise<{ sent: boolean; reason?: string }> {
  const recipient = (input.email ?? '').trim()
  if (!recipient || !isLikelyEmail(recipient)) {
    return { sent: false, reason: 'No valid recipient email' }
  }

  const apiKey = env('RESEND_API_KEY')
  const from = env('IMAGING_MAIL_FROM')
  if (!apiKey || !from) {
    return { sent: false, reason: 'Mail env not configured' }
  }

  const first = (input.firstName ?? '').trim()
  const greet = first ? `Hi ${first},` : 'Hi,'
  const completedLocal = new Date(input.completedAtIso).toLocaleString('en-US', { timeZone: 'America/New_York' })
  const targetSafe = escapeHtml(input.target)
  const queueIdSafe = escapeHtml(input.queueId)
  const subject = `Pomfret Astro session completed: ${input.target}`
  const text = [
    greet,
    '',
    `Your imaging session has completed.`,
    `Target: ${input.target}`,
    `Session ID: ${input.queueId}`,
    `Completed: ${completedLocal} (America/New_York)`,
    '',
    'You can return to the Remote dashboard to check/download results.',
    '',
    'Clear skies,',
    'Pomfret Astro',
  ].join('\n')

  const html = `
    <p>${greet}</p>
    <p>Your imaging session has completed.</p>
    <ul>
      <li><strong>Target:</strong> ${targetSafe}</li>
      <li><strong>Session ID:</strong> ${queueIdSafe}</li>
      <li><strong>Completed:</strong> ${completedLocal} (America/New_York)</li>
    </ul>
    <p>You can return to the Remote dashboard to check/download results.</p>
    <p>Clear skies,<br/>Pomfret Astro</p>
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
        to: [recipient],
        subject,
        text,
        html,
      }),
      cache: 'no-store',
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { sent: false, reason: `Provider rejected request (${res.status}): ${detail.slice(0, 200)}` }
    }
    return { sent: true }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown mail error'
    return { sent: false, reason }
  }
}

type SessionStartedEmailInput = {
  queueId: string
  target: string
  email?: string | null
  firstName?: string | null
  startedAtIso: string
}

/**
 * Notifies the participant when NINA has pulled the sequence (session on the board → in progress).
 */
export async function sendSessionStartedEmail(
  input: SessionStartedEmailInput
): Promise<{ sent: boolean; reason?: string }> {
  const recipient = (input.email ?? '').trim()
  if (!recipient || !isLikelyEmail(recipient)) {
    return { sent: false, reason: 'No valid recipient email' }
  }

  const apiKey = env('RESEND_API_KEY')
  const from = env('IMAGING_MAIL_FROM')
  if (!apiKey || !from) {
    return { sent: false, reason: 'Mail env not configured' }
  }

  const first = (input.firstName ?? '').trim()
  const greet = first ? `Hi ${first},` : 'Hi,'
  const startedLocal = new Date(input.startedAtIso).toLocaleString('en-US', { timeZone: 'America/New_York' })
  const targetSafe = escapeHtml(input.target)
  const queueIdSafe = escapeHtml(input.queueId)
  const subject = `Pomfret Astro session started: ${input.target}`
  const text = [
    greet,
    '',
    `Your imaging session has started at the observatory (NINA sequence delivered).`,
    `Target: ${input.target}`,
    `Session ID: ${input.queueId}`,
    `Started: ${startedLocal} (America/New_York)`,
    '',
    'You can return to the Remote dashboard to follow progress.',
    '',
    'Clear skies,',
    'Pomfret Astro',
  ].join('\n')

  const html = `
    <p>${greet}</p>
    <p>Your imaging session has started at the observatory (NINA sequence delivered).</p>
    <ul>
      <li><strong>Target:</strong> ${targetSafe}</li>
      <li><strong>Session ID:</strong> ${queueIdSafe}</li>
      <li><strong>Started:</strong> ${startedLocal} (America/New_York)</li>
    </ul>
    <p>You can return to the Remote dashboard to follow progress.</p>
    <p>Clear skies,<br/>Pomfret Astro</p>
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
        to: [recipient],
        subject,
        text,
        html,
      }),
      cache: 'no-store',
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { sent: false, reason: `Provider rejected request (${res.status}): ${detail.slice(0, 200)}` }
    }
    return { sent: true }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown mail error'
    return { sent: false, reason }
  }
}

type SessionFailedEmailInput = {
  queueId: string
  target: string
  email?: string | null
  firstName?: string | null
  failedAtIso: string
}

/**
 * Notifies the participant when a session is marked failed (abort / observatory ready without completion).
 */
export async function sendSessionFailedEmail(
  input: SessionFailedEmailInput
): Promise<{ sent: boolean; reason?: string }> {
  const recipient = (input.email ?? '').trim()
  if (!recipient || !isLikelyEmail(recipient)) {
    return { sent: false, reason: 'No valid recipient email' }
  }

  const apiKey = env('RESEND_API_KEY')
  const from = env('IMAGING_MAIL_FROM')
  if (!apiKey || !from) {
    return { sent: false, reason: 'Mail env not configured' }
  }

  const first = (input.firstName ?? '').trim()
  const greet = first ? `Hi ${first},` : 'Hi,'
  const failedLocal = new Date(input.failedAtIso).toLocaleString('en-US', { timeZone: 'America/New_York' })
  const targetSafe = escapeHtml(input.target)
  const queueIdSafe = escapeHtml(input.queueId)
  const subject = `Pomfret Astro session failed: ${input.target}`
  const text = [
    greet,
    '',
    `Your imaging session did not complete successfully at the observatory.`,
    `Target: ${input.target}`,
    `Session ID: ${input.queueId}`,
    `Failed: ${failedLocal} (America/New_York)`,
    '',
    'Please open the Remote dashboard for details, or contact support if you need help.',
    '',
    'Clear skies,',
    'Pomfret Astro',
  ].join('\n')

  const html = `
    <p>${greet}</p>
    <p>Your imaging session did not complete successfully at the observatory.</p>
    <ul>
      <li><strong>Target:</strong> ${targetSafe}</li>
      <li><strong>Session ID:</strong> ${queueIdSafe}</li>
      <li><strong>Failed:</strong> ${failedLocal} (America/New_York)</li>
    </ul>
    <p>Please open the Remote dashboard for details, or contact support if you need help.</p>
    <p>Clear skies,<br/>Pomfret Astro</p>
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
        to: [recipient],
        subject,
        text,
        html,
      }),
      cache: 'no-store',
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { sent: false, reason: `Provider rejected request (${res.status}): ${detail.slice(0, 200)}` }
    }
    return { sent: true }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown mail error'
    return { sent: false, reason }
  }
}

