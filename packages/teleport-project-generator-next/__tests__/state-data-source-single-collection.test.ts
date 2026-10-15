import generator from '@babel/generator'
import * as types from '@babel/types'
import { ProjectPluginStructure, ProjectUIDL } from '@teleporthq/teleport-types'
import { generateSafeFileName } from '@teleporthq/teleport-plugin-next-data-source'
import { createStateDataSourcePlugin } from '../src/state-data-source-plugin'
import { NextGlobalStateProjectPlugin } from '../src/global-state/project-plugin'

// States bound to a REST API / JavaScript / CSV / Google Sheets source carry a
// refPath of ['data', ...pathIntoThePayload]: 'data' names the source's single
// collection and the rest walks the payload its fetcher returns untouched. A
// CSV fetcher keys rows by column id while the editor shows them by label, so
// the generated state must hand the label-keyed rows the bindings expect.

const REST_ID = 'a1b2c3d4-rest'
const CSV_ID = 'e5f6a7b8-csv'

const DATA_SOURCES = {
  [REST_ID]: {
    id: REST_ID,
    name: 'Products API',
    type: 'rest-api',
    config: { url: 'https://api.example.com/products', method: 'GET' },
  },
  [CSV_ID]: {
    id: CSV_ID,
    name: 'Team CSV',
    type: 'csv-file',
    config: {
      parsedData: [{ col_0: 'Ada', col_1: 'Engineer' }],
      columns: [
        { id: 'col_0', label: 'Full name', type: 'string' },
        { id: 'col_1', label: 'Role', type: 'string' },
      ],
    },
  },
}

const stubFetchers = () => {
  const resources: Record<string, unknown> = {}
  for (const dataSource of Object.values(DATA_SOURCES)) {
    const fileName = generateSafeFileName(dataSource.type, 'data', dataSource.id)
    resources[`utils/${fileName}`] = {
      fileName,
      fileType: 'js',
      path: ['utils', 'data-sources'],
      content: '// stub',
    }
  }
  return resources
}

const runStatePlugin = async (stateDefinitions: Record<string, unknown>): Promise<string> => {
  const structure = {
    uidl: {
      name: 'Catalogue',
      stateDefinitions,
      node: { type: 'element', content: { elementType: 'container' } },
      outputOptions: { folderPath: [] as string[] },
    },
    chunks: [] as any[],
    dependencies: {} as Record<string, unknown>,
    options: { dataSources: DATA_SOURCES, extractedResources: stubFetchers() },
  }
  const result = await createStateDataSourcePlugin()(structure as any)
  const chunk = result.chunks.find((c: any) => c.name === 'getStaticProps')
  expect(chunk).toBeDefined()
  return generator(chunk!.content as types.Node).code
}

describe('state-data-source-plugin — single-collection sources', () => {
  it('reads a nested REST list off the payload the fetcher returns', async () => {
    const code = await runStatePlugin({
      products: {
        type: 'array',
        defaultValue: [],
        dataSourceBinding: { dataSourceId: REST_ID, refPath: ['data', 'items'] },
      },
      productsMeta: {
        type: 'object',
        defaultValue: {},
        dataSourceBinding: { dataSourceId: REST_ID, refPath: ['data'] },
      },
    })

    // Both states share ONE fetch of the source…
    const fetches = code.match(/restApiDataA1b2c3d4\.fetchData\(/g) || []
    expect(fetches).toHaveLength(1)
    // …the list walks into the payload, the whole-response state takes it —
    // unless the fetch failed and left the shared list fallback behind.
    expect(code).toMatch(/products: __stateDs_\w+_raw\?\.items \?\? \[\]/)
    expect(code).toMatch(/productsMeta: Array\.isArray\((__stateDs_\w+_raw)\) \? \{\} : \1,/)
    // A REST payload is never re-keyed.
    expect(code).not.toContain('__rows')
  })

  it('hands a CSV-bound state its rows keyed by column label, as the editor showed them', async () => {
    const code = await runStatePlugin({
      team: {
        type: 'array',
        defaultValue: [],
        dataSourceBinding: { dataSourceId: CSV_ID, refPath: ['data'] },
      },
    })

    expect(code).toContain('.then(__rows => Array.isArray(__rows) ? __rows.map(__row => ({')
    expect(code).toContain('"Full name": __row?.["col_0"]')
    expect(code).toContain('"Role": __row?.["col_1"]')
  })
})

const runGlobalStatePlugin = async (
  globalStateDefinitions: ProjectUIDL['globalStateDefinitions']
): Promise<string> => {
  const uidl = {
    name: 'fixture',
    globals: {
      settings: { language: 'en', title: 'fixture' },
      meta: [],
      assets: [],
      manifest: { icons: [] },
    },
    root: {
      name: 'App',
      node: { type: 'element', content: { elementType: 'div' } },
      stateDefinitions: { route: { type: 'string', defaultValue: '/' } },
    },
    dataSources: DATA_SOURCES,
    globalStateDefinitions,
  } as unknown as ProjectUIDL

  const structure: ProjectPluginStructure = {
    uidl,
    files: new Map<string, any>(),
    dependencies: {},
    devDependencies: {},
    template: { name: '', files: [], subFolders: [] },
    rootFolder: { name: '', files: [], subFolders: [] },
    strategy: {} as any,
  }
  const result = await new NextGlobalStateProjectPlugin().runAfter(structure)
  return result.files.get('global-state-context')?.files?.[0]?.content ?? ''
}

describe('NextGlobalStateProjectPlugin — single-collection sources', () => {
  it('re-keys a CSV-bound global state by column label before reading its path', async () => {
    const content = await runGlobalStatePlugin({
      teamLead: {
        id: 'team-lead-id',
        name: 'teamLead',
        type: 'object',
        defaultValue: {},
        dataSourceBinding: { dataSourceId: CSV_ID, refPath: ['data', 0] },
      },
    })

    expect(content).toContain(
      'const __rows = Array.isArray(__result.data) ? __result.data.map((__row) => ({ "Full name": __row?.["col_0"], "Role": __row?.["col_1"] })) : __result.data'
    )
    expect(content).toContain('let __extracted = (__rows?.[0] ?? {})')
  })

  it('reads a nested REST path straight off the response', async () => {
    const content = await runGlobalStatePlugin({
      categories: {
        id: 'categories-id',
        name: 'categories',
        type: 'array',
        defaultValue: [],
        dataSourceBinding: { dataSourceId: REST_ID, refPath: ['data', 'categories'] },
      },
    })

    expect(content).toContain('let __extracted = (__result.data?.categories ?? [])')
    expect(content).not.toContain('__rows')
  })
})
