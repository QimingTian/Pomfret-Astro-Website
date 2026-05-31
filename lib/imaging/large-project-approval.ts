/** Total project duration above this requires non-admin admin approval before scheduling. */
export const LARGE_PROJECT_ADMIN_APPROVAL_SECONDS = 30 * 3600

export function projectTotalDurationNeedsAdminApproval(
  estimatedDurationSeconds: number | undefined | null
): boolean {
  return (
    typeof estimatedDurationSeconds === 'number' &&
    Number.isFinite(estimatedDurationSeconds) &&
    estimatedDurationSeconds > LARGE_PROJECT_ADMIN_APPROVAL_SECONDS
  )
}

export function formatImagingDurationHours(estimatedDurationSeconds: number): string {
  const hours = estimatedDurationSeconds / 3600
  return `${hours.toFixed(1)} h`
}
