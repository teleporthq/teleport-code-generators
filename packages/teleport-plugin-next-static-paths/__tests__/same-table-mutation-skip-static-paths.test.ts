import { ComponentStructure, UIDLWorkflows } from '@teleporthq/teleport-types'
import { createStaticPathsPlugin } from '../src/index'

// Regression guard: a page that reads one specific row AND has a same-page
// workflow writing to that SAME table renders with getServerSideProps (see
// teleport-plugin-next-static-props), which resolves params per-request.
// Next.js does not allow getStaticPaths alongside getServerSideProps, so
// this plugin must be a no-op for those pages — even when the page has no
// initialPathsData and would otherwise fall back to emitting a stub
// getStaticPaths/getStaticProps pair. This is decided by table/workflow
// correlation, not by the project's visual nav layout.

const TABLE_NAME = 'press_items'
const PAGE_ID = 'page-edit-press-item'

const makeWorkflows = (tableName: string, scopedToPageId: string | null = PAGE_ID): UIDLWorkflows =>
  ({
    workflows: {
      'update-press-item': {
        id: 'update-press-item',
        name: 'Update press item',
        trigger: {
          nodeId: 'trigger-1',
          type: 'event-click',
          scope: 'element',
          config: {
            selectedPages: scopedToPageId ? [{ id: scopedToPageId, name: 'Edit Press Item' }] : [],
          },
        },
        nodes: [
          {
            id: 'mutate-1',
            type: 'data-update-item',
            label: 'Update item',
            config: { tableName },
            executionEnv: 'server',
            stepNumber: 1,
          },
        ],
        edges: [],
        usedInNodes: {},
      },
    },
  } as unknown as UIDLWorkflows)

const makeStructure = (params: {
  folderPath: string[]
  fileName: string
  tableName?: string
  workflows?: UIDLWorkflows
}): ComponentStructure => {
  const { folderPath, fileName, tableName, workflows } = params
  return {
    uidl: {
      name: 'EditPressItem',
      node: { type: 'element', content: { elementType: 'container' } },
      outputOptions: {
        pageId: PAGE_ID,
        folderPath,
        fileName,
        ...(tableName && {
          detailsPageInfo: {
            dataSourceId: 'ds-1',
            dataSourceName: 'TeleportHQ database',
            dataSourceType: 'teleport',
            tableName,
            differentiatorColumn: 'id',
            featureIdentifier: 'pressItem',
          },
        }),
      },
    },
    chunks: [{ name: 'jsx-component' }],
    dependencies: {},
    options: { workflows, resources: { items: {}, path: ['utils', 'data-sources'] } },
  } as unknown as ComponentStructure
}

describe('teleport-plugin-next-static-paths: same-table-mutation getServerSideProps skip', () => {
  const plugin = createStaticPathsPlugin()

  it('emits no getStaticPaths/getStaticProps chunks when the page reads and a same-page workflow writes the same table', async () => {
    const structure = makeStructure({
      folderPath: ['edit-press-item'],
      fileName: '[id]',
      tableName: TABLE_NAME,
      workflows: makeWorkflows(TABLE_NAME),
    })

    const result = await plugin(structure)
    expect(result.chunks.find((chunk) => chunk.name === 'getStaticPaths')).toBeUndefined()
    expect(result.chunks.find((chunk) => chunk.name === 'getStaticProps')).toBeUndefined()
  })

  it('still emits a fallback getStaticPaths when detailsPageInfo is present but no mutation workflow targets its table', async () => {
    const structure = makeStructure({
      folderPath: ['view-press-item'],
      fileName: '[id]',
      tableName: TABLE_NAME,
      workflows: undefined,
    })

    const result = await plugin(structure)
    expect(result.chunks.find((chunk) => chunk.name === 'getStaticPaths')).toBeDefined()
    expect(result.chunks.find((chunk) => chunk.name === 'getStaticProps')).toBeDefined()
  })

  it('still emits a fallback getStaticPaths when the matching-table workflow is scoped to a different page', async () => {
    const structure = makeStructure({
      folderPath: ['view-press-item'],
      fileName: '[id]',
      tableName: TABLE_NAME,
      workflows: makeWorkflows(TABLE_NAME, 'some-other-page'),
    })

    const result = await plugin(structure)
    expect(result.chunks.find((chunk) => chunk.name === 'getStaticPaths')).toBeDefined()
  })

  it('still emits a fallback getStaticPaths for a dynamic page with no detailsPageInfo at all (e.g. public blog-post/[id])', async () => {
    const structure = makeStructure({
      folderPath: ['blog-post'],
      fileName: '[id]',
      tableName: undefined,
      workflows: undefined,
    })

    const result = await plugin(structure)
    expect(result.chunks.find((chunk) => chunk.name === 'getStaticPaths')).toBeDefined()
    expect(result.chunks.find((chunk) => chunk.name === 'getStaticProps')).toBeDefined()
  })

  it('is a no-op for a non-dynamic page regardless of workflows (no route param to worry about)', async () => {
    const structure = makeStructure({
      folderPath: ['add-press-item'],
      fileName: 'index',
      tableName: undefined,
      workflows: makeWorkflows(TABLE_NAME),
    })

    const result = await plugin(structure)
    expect(result.chunks.find((chunk) => chunk.name === 'getStaticPaths')).toBeUndefined()
    expect(result.chunks.find((chunk) => chunk.name === 'getStaticProps')).toBeUndefined()
  })
})
