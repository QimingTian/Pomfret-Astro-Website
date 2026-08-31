import { appendSessionProgressLine } from '@/lib/imaging/core/session-progress-store'

export async function appendSessionApprovalTerminalLine(
  queueId: string,
  message: string
): Promise<void> {
  const id = queueId.trim()
  if (!id) return
  await appendSessionProgressLine(id, {
    at: new Date().toISOString(),
    text: message,
  })
}

export const SESSION_APPROVAL_TERMINAL = {
  pending:
    'Pending administrator approval. This session will not run until an observatory admin approves it.',
  approved: 'Administrator approved this session. It will be scheduled when the observatory is ready.',
  rejected: 'Administrator rejected this session.',
} as const
