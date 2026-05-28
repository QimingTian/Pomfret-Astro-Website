import { boardRemove } from '@/lib/imaging-session-board'
import {
  deleteProjectById,
  listProjects,
  type ImagingProject,
} from '@/lib/imaging-project-store'
import { removePreviewImage } from '@/lib/imaging-preview-store'
import { deleteR2ObjectForQueueId } from '@/lib/r2-session-download'
import { deleteProjectCascade } from '@/lib/imaging-project-delete'

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

    const cascade = await deleteProjectCascade(project.id)
    purged.push(...cascade.touchedIds)
  }

  return purged
}
