import { boardRemove } from '@/lib/imaging-session-board'
import { getProjectById, deleteProjectById } from '@/lib/imaging-project-store'
import { deleteRequestById } from '@/lib/imaging-queue-store'
import { removePreviewImage } from '@/lib/imaging-preview-store'
import { deleteR2ObjectForQueueId } from '@/lib/r2-session-download'

export type ProjectDeleteCascadeResult = {
  projectId: string
  deletedProjectRecord: boolean
  touchedIds: string[]
}

/**
 * Remove a project from all storage lanes:
 * - queue row (project id)
 * - board row (project id)
 * - project record itself
 * - R2/preview artifacts for project id and every project sub-session id
 */
export async function deleteProjectCascade(projectId: string): Promise<ProjectDeleteCascadeResult> {
  const project = await getProjectById(projectId)
  const nightIds = project?.nights.map((n) => n.id) ?? []
  const touchedIds = [projectId, ...nightIds]

  // Remove project-level queue/board presence first, then project row.
  await deleteRequestById(projectId)
  await boardRemove(projectId)
  const deletedProjectRecord = await deleteProjectById(projectId)

  // Remove artifacts for both project id and every sub-session id.
  for (const id of touchedIds) {
    await deleteR2ObjectForQueueId(id)
    await removePreviewImage(id)
    // Defensive cleanup in case a sub-session board row exists.
    await boardRemove(id)
  }

  return { projectId, deletedProjectRecord, touchedIds }
}

