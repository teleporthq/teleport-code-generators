import { FileType, InMemoryFileRecord, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { generateSafeFileName } from '@teleporthq/teleport-plugin-next-data-source'
import { NextDataSourceUtilityPlugin } from '../src/data-source-utility-plugin'

/**
 * A resource that reads a local data source imports its utility module from
 * `utils/data-sources/`; the plugin emits that module when no page did, and
 * never a second copy when one did.
 */

const DATA_SOURCE_ID = 'ds-users-1234567890'
const MODULE = generateSafeFileName('teleport', 'users', DATA_SOURCE_ID)

const makeStructure = (pageEmittedModule: boolean): ProjectPluginStructure => {
  const files = new Map<string, InMemoryFileRecord>()
  if (pageEmittedModule) {
    files.set(`resource-utils/data-sources/${MODULE}`, {
      path: ['utils', 'data-sources'],
      files: [{ name: MODULE, fileType: FileType.JS, content: '// emitted by a page' }],
    })
  }
  return {
    uidl: {
      name: 'project',
      globals: { settings: { title: 'Project', language: 'en' }, assets: [] },
      root: {},
      dataSources: {
        [DATA_SOURCE_ID]: { id: DATA_SOURCE_ID, type: 'teleport', name: 'Users', config: {} },
      },
      resources: {
        items: {
          users: {
            path: {
              baseUrl: { type: 'static', content: '/api/data-source' },
              route: { type: 'static', content: `/${DATA_SOURCE_ID}/users` },
            },
            params: {
              dataSourceId: { type: 'static', content: DATA_SOURCE_ID },
              dataSourceType: { type: 'static', content: 'teleport' },
              tableName: { type: 'static', content: 'users' },
            },
          },
        },
      },
    },
    files,
    dependencies: {},
    devDependencies: {},
  } as unknown as ProjectPluginStructure
}

const modulesNamed = (structure: ProjectPluginStructure, name: string) =>
  Array.from(structure.files.values()).filter(
    (record) =>
      record.path.join('/') === 'utils/data-sources' &&
      record.files.some((file) => file.name === name)
  )

describe('NextDataSourceUtilityPlugin', () => {
  it('emits the module a resource imports when no page emitted it', async () => {
    const structure = makeStructure(false)
    await new NextDataSourceUtilityPlugin().runAfter(structure)

    const modules = modulesNamed(structure, MODULE)
    expect(modules).toHaveLength(1)
    expect(modules[0].files[0].content).toContain('async function fetchData')
  })

  it('keeps the module a page emitted, without a second copy', async () => {
    const structure = makeStructure(true)
    await new NextDataSourceUtilityPlugin().runAfter(structure)

    const modules = modulesNamed(structure, MODULE)
    expect(modules).toHaveLength(1)
    expect(modules[0].files[0].content).toBe('// emitted by a page')
  })
})
