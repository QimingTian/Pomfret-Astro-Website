/** Default total project duration above which members need admin approval (30 h). */
export const LARGE_PROJECT_ADMIN_APPROVAL_SECONDS = 30 * 3600

export function projectTotalDurationNeedsAdminApproval(
  estimatedDurationSeconds: number | undefined | null,
  limitSeconds: number = LARGE_PROJECT_ADMIN_APPROVAL_SECONDS
): boolean {
  return (
    typeof estimatedDurationSeconds === 'number' &&
    Number.isFinite(estimatedDurationSeconds) &&
    Number.isFinite(limitSeconds) &&
    limitSeconds > 0 &&
    estimatedDurationSeconds > limitSeconds
  )
}

export function formatImagingDurationHours(estimatedDurationSeconds: number): string {
  const hours = estimatedDurationSeconds / 3600
  return `${hours.toFixed(1)} h`
}
