export function queueStatusBadgeClass(status: string): string {
  if (status === 'pending') return 'text-amber-700 dark:text-amber-400'
  if (status === 'scheduled') return 'text-cyan-700 dark:text-cyan-400'
  if (status === 'on_hold') return 'text-violet-700 dark:text-violet-400'
  if (status === 'in_progress') return 'text-blue-700 dark:text-blue-400'
  if (status === 'completed') return 'text-green-700 dark:text-green-400'
  if (status === 'failed') return 'text-red-700 dark:text-red-400'
  if (status === 'rejected') return 'text-red-700 dark:text-red-400'
  if (status === 'claimed') return 'text-blue-700 dark:text-blue-400'
  return 'text-gray-500 dark:text-gray-500'
}

export type ObservatoryStatus =
  | 'loading'
  | 'ready'
  | 'busy_in_use'
  | 'disconnected'
  | 'closed_weather_not_permitted'
  | 'closed_daytime'
  | 'closed_observatory_maintenance'

export function statusLabel(status: ObservatoryStatus): string {
  if (status === 'loading') return '...'
  if (status === 'ready') return 'Ready'
  if (status === 'busy_in_use') return 'Busy -- In Use'
  if (status === 'disconnected') return 'Disconnected'
  if (status === 'closed_weather_not_permitted') return 'Closed -- Weather Not Permitted'
  if (status === 'closed_daytime') return 'Closed -- Daytime'
  return 'Closed -- Observatory Maintenance'
}
