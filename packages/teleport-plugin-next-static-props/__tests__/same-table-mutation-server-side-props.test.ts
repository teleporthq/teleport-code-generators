import generator from '@babel/generator'
import * as types from '@babel/types'
import { ComponentStructure, UIDLWorkflows } from '@teleporthq/teleport-types'
import { createStaticPropsPlugin } from '../src/index'

// Regression guard for the "Edit Press Item" ISR-staleness bug: a page that
// both reads one specific row (`detailsPageInfo.tableName`) AND has a
// same-page workflow writing to that SAME table must render with
// getServerSideProps, not getStaticProps + ISR — otherwise a real DB write
// can look "unsaved" for up to `cache.revalidate` seconds. This is decided
// per-page by table/workflow correlation, NOT by the project's visual nav
// layout (`pageLayoutMode`) — a `standard`-layout marketplace "Edit Listing"
// page carries the identical risk, and a `dashboard`-layout read-only report
// page carries none of it.

const RESOURCE_ID = 'fetch-press-item'
const TABLE_NAME = 'press_items'
const PAGE_ID = 'page-edit-press-item'

const makeWorkflows = (params: {
  tableName?: string
  scope?: 'page' | 'element' | 'global'
  scopedToPageId?: string | null
  nodeType?: string
}): UIDLWorkflows => {
  const {
    tableName = TABLE_NAME,
    scope = 'element',
    scopedToPageId = PAGE_ID,
    nodeType = 'data-update-item',
  } = params
  return {
    workflows: {
      'update-press-item': {
        id: 'update-press-item',
        name: 'Update press item',
        trigger: {
          nodeId: 'trigger-1',
          type: 'event-click',
          scope,
          config:
            scope === 'element'
              ? {
                  selectedPages: scopedToPageId
                    ? [{ id: scopedToPageId, name: 'Edit Press Item' }]
                    : [],
                }
              : scope === 'page'
              ? { pageId: scopedToPageId || undefined }
              : {},
        },
        nodes: [
          {
            id: 'mutate-1',
            type: nodeType,
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
  } as unknown as UIDLWorkflows
}

const makeStructure = (params: {
  folderPath: string[]
  fileName: string
  tableName?: string
  workflows?: UIDLWorkflows
  globalRevalidate?: number
}): ComponentStructure => {
  const { folderPath, fileName, tableName, workflows, globalRevalidate } = params
  return {
    uidl: {
      name: 'EditPressItem',
      node: { type: 'element', content: { elementType: 'container' } },
      outputOptions: {
        pageId: PAGE_ID,
        folderPath,
        fileName,
        initialPropsData: {
          exposeAs: { name: 'pressItem', valuePath: [] },
          resource: { id: RESOURCE_ID, params: {} },
        },
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
    chunks: [],
    dependencies: {},
    options: {
      workflows,
      resources: {
        items: {
          [RESOURCE_ID]: { id: RESOURCE_ID, name: 'press-item' },
        },
        path: ['utils', 'data-sources'],
        cache: globalRevalidate ? { revalidate: globalRevalidate } : undefined,
      },
    },
  } as unknown as ComponentStructure
}

const getStaticPropsChunk = (structure: ComponentStructure) =>
  structure.chunks.find((chunk) => chunk.name === 'getStaticProps')

describe('teleport-plugin-next-static-props: same-table-mutation getServerSideProps branch', () => {
  const plugin = createStaticPropsPlugin()

  it('emits getServerSideProps when the page reads and a same-page workflow writes the same table', async () => {
    const structure = makeStructure({
      folderPath: ['edit-press-item'],
      fileName: '[id]',
      tableName: TABLE_NAME,
      workflows: makeWorkflows({}),
      globalRevalidate: 60,
    })

    const result = await plugin(structure)
    const chunk = getStaticPropsChunk(result)
    expect(chunk).toBeDefined()
    expect(chunk?.meta?.useServerSideProps).toBe(true)

    const code = generator(chunk?.content as types.Node).code
    expect(code).toContain('export async function getServerSideProps(context)')
    expect(code).not.toContain('revalidate')
  })

  it('keeps getStaticProps + revalidate when the page has detailsPageInfo but NO mutation workflow targets its table', async () => {
    const structure = makeStructure({
      folderPath: ['view-press-item'],
      fileName: '[id]',
      tableName: TABLE_NAME,
      workflows: undefined,
      globalRevalidate: 60,
    })

    const result = await plugin(structure)
    const chunk = getStaticPropsChunk(result)
    expect(chunk?.meta?.useServerSideProps).toBeUndefined()

    const code = generator(chunk?.content as types.Node).code
    expect(code).toContain('export async function getStaticProps(context)')
    expect(code).toContain('revalidate: 60')
  })

  it('keeps getStaticProps + revalidate when a mutation workflow exists but targets a DIFFERENT table', async () => {
    const structure = makeStructure({
      folderPath: ['view-press-item'],
      fileName: '[id]',
      tableName: TABLE_NAME,
      workflows: makeWorkflows({ tableName: 'other_table' }),
      globalRevalidate: 60,
    })

    const result = await plugin(structure)
    const chunk = getStaticPropsChunk(result)
    expect(chunk?.meta?.useServerSideProps).toBeUndefined()
  })

  it('keeps getStaticProps + revalidate when the matching-table workflow is scoped to a DIFFERENT page', async () => {
    const structure = makeStructure({
      folderPath: ['view-press-item'],
      fileName: '[id]',
      tableName: TABLE_NAME,
      workflows: makeWorkflows({ scopedToPageId: 'some-other-page' }),
      globalRevalidate: 60,
    })

    const result = await plugin(structure)
    const chunk = getStaticPropsChunk(result)
    expect(chunk?.meta?.useServerSideProps).toBeUndefined()
  })

  it('matches when the workflow trigger has no selectedPages restriction (fires on every page it is attached to)', async () => {
    const structure = makeStructure({
      folderPath: ['edit-press-item'],
      fileName: '[id]',
      tableName: TABLE_NAME,
      workflows: makeWorkflows({ scopedToPageId: null }),
      globalRevalidate: 60,
    })

    const result = await plugin(structure)
    const chunk = getStaticPropsChunk(result)
    expect(chunk?.meta?.useServerSideProps).toBe(true)
  })

  it('matches for a page-scoped trigger with a matching pageId', async () => {
    const structure = makeStructure({
      folderPath: ['edit-press-item'],
      fileName: '[id]',
      tableName: TABLE_NAME,
      workflows: makeWorkflows({ scope: 'page', scopedToPageId: PAGE_ID }),
      globalRevalidate: 60,
    })

    const result = await plugin(structure)
    const chunk = getStaticPropsChunk(result)
    expect(chunk?.meta?.useServerSideProps).toBe(true)
  })

  it('keeps getStaticProps for a non-dynamic page even with a matching-table mutation workflow (e.g. a static "Add Item" form with no initialPropsData)', async () => {
    const structure = makeStructure({
      folderPath: ['add-press-item'],
      fileName: 'index',
      tableName: undefined,
      workflows: makeWorkflows({ scopedToPageId: null }),
    })
    // No initialPropsData on a create-only page — plugin exits before the
    // SSR decision even runs.
    delete (structure.uidl.outputOptions as { initialPropsData?: unknown }).initialPropsData

    const result = await plugin(structure)
    expect(getStaticPropsChunk(result)).toBeUndefined()
  })

  it('keeps getStaticProps + revalidate for a genuinely public dynamic page with no detailsPageInfo at all', async () => {
    const structure = makeStructure({
      folderPath: ['blog-post'],
      fileName: '[id]',
      tableName: undefined,
      workflows: undefined,
      globalRevalidate: 60,
    })

    const result = await plugin(structure)
    const chunk = getStaticPropsChunk(result)
    expect(chunk?.meta?.useServerSideProps).toBeUndefined()

    const code = generator(chunk?.content as types.Node).code
    expect(code).toContain('export async function getStaticProps(context)')
    expect(code).toContain('revalidate: 60')
  })
})
