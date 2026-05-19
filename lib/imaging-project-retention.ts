import { boardRemove } from '@/lib/imaging-session-board'
import {
  deleteProjectById,
  listProjects,
  type ImagingProject,
} from '@/lib/imaging-project-store'
import { removePreviewImage } from '@/lib/imaging-preview-store'
import { deleteR2ObjectForQueueId } from '@/lib/r2-session-download'

function projectRetentionBasisMs(project: ImagingProject): number | null {
  const at = Date.parse(project.completedAt ?? '')
  return Number.isFinite(at) ? at : null
}

/** After the whole project is completed/failed, wait `maxAgeMs`, then remove all sub-session assets. */
export async function purgeExpiredProjectAssets(maxAgeMs: number): Promise<string[]> {
  const now = Date.now()
  const purged: string[] = []

  for (const project of await listProjects()) {
    if (project.status !== 'completed' && project.status !== 'failed') continue
    const basisMs = projectRetentionBasisMs(project)
    if (basisMs == null || now - basisMs < maxAgeMs) continue

    if (project.outputMode !== 'none') {
      for (const night of project.nights) {
        purged.push(night.id)
        await deleteR2ObjectForQueueId(night.id)
        await removePreviewImage(night.id)
      }
    }

    purged.push(project.id)
    await deleteR2ObjectForQueueId(project.id)
    await removePreviewImage(project.id)
    await boardRemove(project.id)
    await deleteProjectById(project.id)
  }

  return purged
}
