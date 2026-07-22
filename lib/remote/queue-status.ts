export const SESSION_FAILED_TERMINAL_MESSAGE = 'Session failed -- contact support.'

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
  return text.trim() === SESSION_FAILED_TERMINAL_MESSAGE
}
