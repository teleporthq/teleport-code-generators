import { projectUIDLDecoder } from '../../src/decoders/project-decoder'
import projectSample from '../../../../examples/test-samples/project-sample.json'

/**
 * ⛔ THE DECODER IS THE SCHEMA: the generator only ever sees the decoded UIDL.
 * An internal tool's staff-only tables travel as
 * `authentication.restrictedTables`; were they dropped here, every tool table
 * would be served to anyone who asked, with nothing logged.
 */
const decode = (extra: Record<string, unknown>) =>
  projectUIDLDecoder.runWithException({ ...projectSample, ...extra }) as unknown as Record<
    string,
    any
  >

const AUTHENTICATION = {
  enabled: true,
  dataSourceId: 'ds-1',
  dataSourceType: 'teleport',
  passwordAuthEnabled: true,
  providers: [] as unknown[],
  roles: ['admin', 'staff', 'user'],
  tables: {},
  pageProtection: {},
  folderProtection: {},
  authPages: {},
  callbackBaseUrl: '/api/auth/callback',
  envKeys: {},
  customUserProperties: [] as unknown[],
}

describe('project decoder — restricted tables', () => {
  it('keeps the staff-only tables and the roles each admits', () => {
    const restrictedTables = { tasks: ['admin', 'staff'], projects: ['admin'] }
    const decoded = decode({ authentication: { ...AUTHENTICATION, restrictedTables } })
    expect(decoded.authentication.restrictedTables).toEqual(restrictedTables)
  })

  it('leaves a project without them as it was', () => {
    const decoded = decode({ authentication: AUTHENTICATION })
    expect(decoded.authentication).toEqual(AUTHENTICATION)
    expect(decoded.authentication).not.toHaveProperty('restrictedTables')
  })
})
