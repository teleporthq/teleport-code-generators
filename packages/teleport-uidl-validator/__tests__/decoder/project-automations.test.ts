import { projectUIDLDecoder } from '../../src/decoders/project-decoder'
import projectSample from '../../../../examples/test-samples/project-sample.json'

/**
 * ⛔ THE DECODER IS THE SCHEMA: a top-level field it does not name is dropped,
 * and the generator only ever sees the decoded UIDL. The automations' event
 * bus opens the database `automations` names, and is not generated without it.
 */
const decode = (extra: Record<string, unknown>) =>
  projectUIDLDecoder.runWithException({ ...projectSample, ...extra }) as unknown as Record<
    string,
    unknown
  >

describe('project decoder — automations', () => {
  it('keeps the TeleportHQ database the automation tables live in', () => {
    const automations = { dataSourceId: 'ds-1', dataSourceType: 'teleport' }
    expect(decode({ automations }).automations).toEqual(automations)
  })

  it('drops keys the schema does not name', () => {
    expect(
      decode({ automations: { dataSourceId: 'ds-1', dataSourceType: 'teleport', extra: true } })
        .automations
    ).toEqual({ dataSourceId: 'ds-1', dataSourceType: 'teleport' })
  })

  it('rejects every other data source: automations run on the TeleportHQ database only', () => {
    for (const dataSourceType of ['postgresql', 'cockroachdb', 'mysql']) {
      expect(() => decode({ automations: { dataSourceId: 'ds-1', dataSourceType } })).toThrow()
    }
    expect(() => decode({ automations: { dataSourceType: 'teleport' } })).toThrow()
  })

  it('leaves a project without automations untouched', () => {
    expect(decode({}).automations).toBeUndefined()
  })
})
