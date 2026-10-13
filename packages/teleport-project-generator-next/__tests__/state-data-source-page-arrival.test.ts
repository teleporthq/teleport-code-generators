import generator from '@babel/generator'
import * as types from '@babel/types'
import { ChunkType } from '@teleporthq/teleport-types'
import { createStateDataSourcePlugin } from '../src/state-data-source-plugin'
import { createEntityMutationSsrFinalizerPlugin } from '../src/entity-mutation-ssr-finalize-plugin'

// A page state bound to a data source must hold the values computed for THIS
// arrival. Seeded from getStaticProps it did not: a client-side navigation got
// the JSON Next.js had cached in the browser (or prefetched with the link), ISR
// served the copy rendered before the last write, and a navigation to the page
// already on screen kept the old `useState` value whatever the new props said.
// Such a page now renders per request and remounts on every arrival.

const DS_ID = 'a784e6dd-ddc9-4d12-b9d2-137d285e313a'
const FETCHER_FILE_NAME = 'teleport-customers-a784e6dd'

const boundState = (query?: string) => ({
  type: 'array',
  defaultValue: [] as unknown[],
  dataSourceBinding: { dataSourceId: DS_ID, refPath: ['customers'] },
  ...(query ? { query } : {}),
})

const makeStructure = (stateDefinitions: Record<string, unknown>) => ({
  uidl: {
    name: 'Customers',
    stateDefinitions,
    node: { type: 'element', content: { elementType: 'container' } },
    outputOptions: { folderPath: [] as string[] },
  },
  chunks: [
    {
      type: 'AST',
      fileType: 'js',
      name: 'jsx-component',
      linkAfter: [] as string[],
      content: types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('Customers'),
          types.arrowFunctionExpression(
            [types.identifier('props')],
            types.blockStatement([types.returnStatement(types.nullLiteral())])
          )
        ),
      ]),
    },
    {
      type: 'AST',
      fileType: 'js',
      name: 'export',
      linkAfter: ['jsx-component'],
      content: types.exportDefaultDeclaration(types.identifier('Customers')),
    },
  ] as any[],
  dependencies: {} as Record<string, unknown>,
  options: {
    pagesPath: ['pages'],
    auth: { provider: 'teleport' },
    dataSources: { [DS_ID]: { id: DS_ID, type: 'teleport', config: {} } },
    // Pre-extracted fetcher, so the test does not depend on its generation.
    extractedResources: {
      [`utils/${FETCHER_FILE_NAME}`]: {
        fileName: FETCHER_FILE_NAME,
        fileType: 'js',
        path: ['utils', 'data-sources'],
        content: '// stub',
      },
    } as Record<string, any>,
  },
})

const runPagePipeline = async (stateDefinitions: Record<string, unknown>) => {
  const structure = makeStructure(stateDefinitions)
  await createStateDataSourcePlugin()(structure as any)
  await createEntityMutationSsrFinalizerPlugin()(structure as any)
  const chunkCode = (name: string) => {
    const chunk = structure.chunks.find((candidate) => candidate.name === name)
    return chunk ? generator(chunk.content as types.Node).code : null
  }
  return { structure, chunkCode }
}

describe('page states seeded from a data source', () => {
  it('render per request and remount the page on every arrival', async () => {
    const { structure, chunkCode } = await runPagePipeline({
      customersRows: boundState('SELECT * FROM customers ORDER BY created_at DESC LIMIT 20'),
    })

    expect(chunkCode('getStaticProps')).toBeNull()
    const serverProps = chunkCode('getServerSideProps')
    expect(serverProps).toContain('export async function getServerSideProps(context)')
    expect(serverProps).toContain('customersRows:')
    expect(serverProps).not.toContain('revalidate')

    expect(chunkCode('export')).toBe('export default remountOnPageArrival(Customers);')
    expect(structure.dependencies.remountOnPageArrival).toEqual({
      type: 'local',
      path: '../utils/page-arrival',
    })
    expect(structure.options.extractedResources['utils/page-arrival']).toBeDefined()
  })

  it('remount the page for states fetched in the browser, which stays statically generated', async () => {
    const { structure, chunkCode } = await runPagePipeline({
      invoicesRows: boundState(
        "SELECT * FROM app_invoices WHERE customer_id = '{{Current User.id}}' LIMIT 20"
      ),
    })

    expect(chunkCode('getServerSideProps')).toBeNull()
    expect(chunkCode('jsx-component')).toContain('/api/page-state/')
    expect(chunkCode('export')).toBe('export default remountOnPageArrival(Customers);')
    expect(structure.options.extractedResources['utils/page-arrival']).toBeDefined()
  })

  it('leave the page alone when no state can be seeded', async () => {
    const { structure, chunkCode } = await runPagePipeline({
      customerRow: boundState("SELECT * FROM customers WHERE id = '{{urlDifferentiator}}'"),
    })

    expect(chunkCode('getStaticProps')).toBeNull()
    expect(chunkCode('getServerSideProps')).toBeNull()
    expect(chunkCode('export')).toBe('export default Customers;')
    expect(structure.dependencies.remountOnPageArrival).toBeUndefined()
    expect(structure.options.extractedResources['utils/page-arrival']).toBeUndefined()
  })
})

describe('getServerSideProps finalizer — data-source states', () => {
  const getStaticPropsChunk = () => {
    const fn = types.functionDeclaration(
      types.identifier('getStaticProps'),
      [types.identifier('context')],
      types.blockStatement([
        types.returnStatement(
          types.objectExpression([
            types.objectProperty(types.identifier('props'), types.objectExpression([])),
            types.objectProperty(types.identifier('revalidate'), types.numericLiteral(1)),
          ])
        ),
      ]),
      false,
      true
    )
    return {
      name: 'getStaticProps',
      type: ChunkType.AST,
      content: types.exportNamedDeclaration(fn),
    }
  }

  const finalize = async (
    stateDefinitions: Record<string, unknown>,
    projectDataSources: object
  ) => {
    const structure: any = {
      uidl: { name: 'Customers', node: { type: 'element', content: {} }, stateDefinitions },
      chunks: [getStaticPropsChunk()],
      dependencies: {},
      options: { dataSources: projectDataSources },
    }
    await createEntityMutationSsrFinalizerPlugin()(structure)
    return structure.chunks[0].name as string
  }

  const dataSources = { [DS_ID]: { id: DS_ID, type: 'teleport', config: {} } }

  it('converts a page that seeds a state from a data source', async () => {
    expect(await finalize({ rows: boundState('SELECT 1 AS value') }, dataSources)).toBe(
      'getServerSideProps'
    )
    expect(await finalize({ rows: boundState() }, dataSources)).toBe('getServerSideProps')
  })

  it('keeps static generation when the bound state is only resolved in the browser', async () => {
    expect(
      await finalize(
        { rows: boundState("SELECT * FROM t WHERE user_id = '{{Current User.id}}'") },
        dataSources
      )
    ).toBe('getStaticProps')
  })

  it('keeps static generation when the bound data source is not in the project', async () => {
    expect(await finalize({ rows: boundState('SELECT 1 AS value') }, {})).toBe('getStaticProps')
  })
})
