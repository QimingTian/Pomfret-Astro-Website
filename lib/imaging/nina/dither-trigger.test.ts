import assert from 'node:assert/strict'
import test from 'node:test'
import '@/lib/observatory-site-als'
import { buildNinaSequenceJson, type NinaSequenceParams } from '@/lib/imaging/nina/sequence-json'
import { sequenceParamsFromQueueRequest, sequenceParamsFromProjectNight } from '@/lib/imaging/nina/agent-job'
import type { ImagingRequest } from '@/lib/imaging-queue-store'
import type { ImagingProject, ProjectNight } from '@/lib/imaging-project-store'

const base: NinaSequenceParams = {
  raHoursDecimal: 20.9,
  decDegDecimal: 44.3,
  filterName: 'L',
  exposureSeconds: 180,
  exposureCount: 6,
  pomfretQueueId: 'dither-test',
}

const cases: Array<{ name: string; params: Partial<NinaSequenceParams> }> = [
  { name: 'single-filter DSO', params: { templateKind: 'dso' } },
  {
    name: 'multi-filter DSO',
    params: {
      templateKind: 'dso',
      filterPlans: [
        { filterName: 'L', exposureSeconds: 180, exposureCount: 6 },
        { filterName: 'R', exposureSeconds: 120, exposureCount: 6 },
      ],
    },
  },
  { name: 'variable star', params: { templateKind: 'variable_star' } },
  { name: 'occultation', params: { templateKind: 'asteroid_occultation' } },
]

for (const { name, params } of cases) {
  test(`dither switch is DSO-only for ${name}`, () => {
    const off = JSON.parse(buildNinaSequenceJson({ ...base, ...params, ditherEnabled: false }))
    const on = JSON.parse(buildNinaSequenceJson({ ...base, ...params, ditherEnabled: true }))
    const target = (root: any) => root.Items.$values[1].Items.$values[0]
    const triggerOwner = (root: any): any => {
      if (name !== 'variable star') return target(root)
      const findSmartExposure = (node: any): any => {
        if (!node || typeof node !== 'object') return null
        if (node.$type?.startsWith('NINA.Sequencer.SequenceItem.Imaging.SmartExposure')) return node
        for (const child of Object.values(node)) {
          const found = findSmartExposure(child)
          if (found) return found
        }
        return null
      }
      return findSmartExposure(target(root))
    }
    const dithers = (root: any) =>
      triggerOwner(root).Triggers.$values.filter((item: any) =>
        item.$type.startsWith('NINA.Sequencer.Trigger.Guider.DitherAfterExposures')
      )
    assert.equal(dithers(off).length, 0)
    if (name === 'variable star' || name === 'occultation') {
      assert.equal(dithers(on).length, 0)
      return
    }
    assert.equal(dithers(on).length, 1)
    const trigger = dithers(on)[0]
    assert.equal(trigger.AfterExposures, 3)
    assert.deepEqual(trigger.Parent, { $ref: triggerOwner(on).$id })
    const runner = trigger.TriggerRunner
    assert.equal(runner.Items.$values.length, 1)
    assert.match(runner.Items.$values[0].$type, /NINA\.Sequencer\.SequenceItem\.Guider\.Dither/)
    assert.deepEqual(runner.Items.$values[0].Parent, { $ref: runner.$id })

    const ids = new Set<string>()
    const refs: string[] = []
    const visit = (value: any) => {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) return value.forEach(visit)
      if (value.$id) {
        assert.equal(ids.has(value.$id), false, `duplicate NINA $id ${value.$id}`)
        ids.add(value.$id)
      }
      if (value.$ref) refs.push(value.$ref)
      Object.values(value).forEach(visit)
    }
    visit(on)
    for (const ref of refs) assert.ok(ids.has(ref), `missing NINA $ref ${ref}`)
  })
}

test('queue and project jobs preserve the selected dither setting', () => {
  const queue = {
    id: 'q1',
    raHours: 20.9,
    decDeg: 44.3,
    filter: 'G',
    exposureSeconds: 60,
    count: 6,
    sequenceTemplate: 'dso',
    ditherEnabled: true,
  } as ImagingRequest
  assert.equal(sequenceParamsFromQueueRequest(queue)?.ditherEnabled, true)
  assert.equal(sequenceParamsFromQueueRequest({ ...queue, ditherEnabled: false })?.ditherEnabled, false)
  assert.equal(sequenceParamsFromQueueRequest({ ...queue, sequenceTemplate: 'variable_star' })?.ditherEnabled, false)

  const project = {
    id: 'p1',
    target: 'NGC 7822',
    raHours: 0.1,
    decDeg: 66,
    outputMode: 'raw_zip',
    ditherEnabled: true,
  } as ImagingProject
  const night = {
    id: 'p1::night-1',
    filterPlansTonight: [{ filterName: 'Ha', exposureSeconds: 300, count: 6 }],
  } as ProjectNight
  assert.equal(sequenceParamsFromProjectNight(project, night)?.ditherEnabled, true)
})
