export const SESSION_FAILED_TERMINAL_MESSAGE = 'Session failed.'

export function queueStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pending'
    case 'scheduled':
      return 'Scheduled'
    case 'on_hold':
      return 'On hold'
    case 'in_progress':
      return 'In progress'
    case 'completed':
      return 'Completed'
    case 'claimed':
      return 'In progress'
    case 'failed':
      return 'Failed'
    case 'rejected':
      return 'Rejected'
    default:
      return status
  }
}

export function isSessionFailedTerminalLine(text: string): boolean {
  const t = text.trim()
  return t === SESSION_FAILED_TERMINAL_MESSAGE || t === 'Session failed -- contact support.'
}
