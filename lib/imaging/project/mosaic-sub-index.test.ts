import assert from 'node:assert/strict'
import test from 'node:test'
import { mosaicSubBaseForPanel } from './planner'
import type { ImagingProject, ProjectNight } from './store'

function baseProject(nights: ProjectNight[]): ImagingProject {
  return {
    id: 'proj-mosaic',
    projectMode: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'pending',
    target: 'Mosaic',
    raHours: 20,
    decDeg: 45,
    outputMode: 'raw_zip',
    filterPlansTotal: [{ filterName: 'O', exposureSeconds: 300, count: 40 }],
    remainingByFilter: [{ filterName: 'O', exposureSeconds: 300, countRemaining: 40 }],
    nights,
    onBoard: false,
    mosaicMode: true,
    mosaicPanels: [
      { id: 1, raHours: 20, decDeg: 45, positionAngleDeg: 0, name: 'Panel 1' },
      { id: 2, raHours: 20.1, decDeg: 44.9, positionAngleDeg: 0, name: 'Panel 2' },
    ],
  }
}

function night(partial: Partial<ProjectNight> & Pick<ProjectNight, 'id' | 'status'>): ProjectNight {
  return {
    nightKey: '2026-07-12',
    nightIndex: 1,
    filterPlansTonight: [{ filterName: 'O', exposureSeconds: 300, count: 10 }],
    plannedStartIso: '2026-07-13T04:00:00.000Z',
    ninaSequenceJson: '{}',
    mosaicPanelIndex: 1,
    mosaicSubIndex: 1,
    ...partial,
  }
}

test('mosaicSubBaseForPanel starts at 1 when nothing durable exists', () => {
  assert.equal(mosaicSubBaseForPanel(baseProject([]), 1), 1)
})

test('mosaicSubBaseForPanel ignores scheduled rows that reconcile will replace', () => {
  const project = baseProject([
    night({
      id: 'n1',
      status: 'scheduled',
      mosaicPanelIndex: 1,
      mosaicSubIndex: 1,
    }),
  ])
  assert.equal(mosaicSubBaseForPanel(project, 1), 1)
})

test('mosaicSubBaseForPanel advances after a completed panel sub', () => {
  const project = baseProject([
    night({
      id: 'n1',
      status: 'completed',
      mosaicPanelIndex: 1,
      mosaicSubIndex: 1,
    }),
  ])
  assert.equal(mosaicSubBaseForPanel(project, 1), 2)
})
