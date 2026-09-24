import * as types from '@babel/types'
import generator from '@babel/generator'
import {
  ChunkType,
  FileType,
  ComponentStructure,
  ChunkDefinition,
  GeneratorOptions,
  UIDLDataSource,
  UIDLDependency,
} from '@teleporthq/teleport-types'
import { createNextPagesDataSourcePlugin, createNextComponentDataSourcePlugin } from '../src/index'

/**
 * A page in a multi-language project renders rows in ITS language: every
 * data-source fetch — the build-time prefetch in getStaticProps and the
 * client-side refetch behind pagination, search and filters — says which
 * locale it is for, and a locale switch (a client-side transition on the same
 * page instance) refetches. A single-language project generates exactly what
 * it generated before: no locale, no router.
 */

const DS_ID = 'ds1'
const TABLE = 'teleport_products'
/** A page writes the fetcher to `utils/`, a component straight into `api/`. */
const FETCHER_KEYS = ['utils/teleport-teleport_products-ds1', 'api/teleport-teleport_products-ds1']

const I18N: GeneratorOptions['internationalization'] = {
  main: { name: 'English', locale: 'en' },
  languages: { en: 'English', es: 'Spanish' },
}

const dataSource: UIDLDataSource = {
  id: DS_ID,
  name: 'TeleportHQ database',
  type: 'teleport',
  config: {
    selectedTables: {
      [TABLE]: {
        columns: [{ name: 'id' }, { name: 'name' }, { name: 'slug' }, { name: 'es_name' }],
      },
    },
  },
}

const jsx = (name: string, attrs: types.JSXAttribute[], children: types.JSXElement[] = []) =>
  types.jsxElement(
    types.jsxOpeningElement(types.jsxIdentifier(name), attrs, children.length === 0),
    children.length === 0 ? null : types.jsxClosingElement(types.jsxIdentifier(name)),
    children,
    children.length === 0
  )

const resourceDefinitionAttr = () =>
  types.jsxAttribute(
    types.jsxIdentifier('resourceDefinition'),
    types.jsxExpressionContainer(
      types.objectExpression([
        types.objectProperty(types.stringLiteral('dataSourceId'), types.stringLiteral(DS_ID)),
        types.objectProperty(types.stringLiteral('tableName'), types.stringLiteral(TABLE)),
        types.objectProperty(
          types.stringLiteral('dataSourceType'),
          types.stringLiteral('teleport')
        ),
      ])
    )
  )

/** `<DataProvider name={'items'} resourceDefinition={…} renderSuccess={(items) => <Repeater …/>} />` */
const makeListProvider = (): types.JSXElement => {
  const repeater = jsx('Repeater', [
    types.jsxAttribute(
      types.jsxIdentifier('items'),
      types.jsxExpressionContainer(types.identifier('items'))
    ),
    types.jsxAttribute(
      types.jsxIdentifier('renderItem'),
      types.jsxExpressionContainer(
        types.arrowFunctionExpression([types.identifier('product')], jsx('div', []))
      )
    ),
  ])
  return jsx('DataProvider', [
    types.jsxAttribute(
      types.jsxIdentifier('name'),
      types.jsxExpressionContainer(types.stringLiteral('items'))
    ),
    resourceDefinitionAttr(),
    types.jsxAttribute(
      types.jsxIdentifier('renderSuccess'),
      types.jsxExpressionContainer(
        types.arrowFunctionExpression([types.identifier('items')], repeater)
      )
    ),
  ])
}

/** `<DataProvider name={'item'} resourceDefinition={…} renderSuccess={(item) => <div/>} />` */
const makeItemProvider = (): types.JSXElement =>
  jsx('DataProvider', [
    types.jsxAttribute(
      types.jsxIdentifier('name'),
      types.jsxExpressionContainer(types.stringLiteral('item'))
    ),
    resourceDefinitionAttr(),
    types.jsxAttribute(
      types.jsxIdentifier('renderSuccess'),
      types.jsxExpressionContainer(
        types.arrowFunctionExpression([types.identifier('item')], jsx('div', []))
      )
    ),
  ])

const makeComponentChunk = (provider: types.JSXElement): ChunkDefinition => ({
  name: 'jsx-component',
  type: ChunkType.AST,
  fileType: FileType.JS,
  linkAfter: [],
  content: types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('ProductsList'),
      types.arrowFunctionExpression(
        [types.identifier('props')],
        types.blockStatement([types.returnStatement(jsx('div', [], [provider]))])
      )
    ),
  ]),
  meta: { nodesLookup: { provider } },
})

// tslint:disable-next-line:no-any
const makeListNode = (paginated: boolean): any => ({
  type: 'data-source-list',
  content: {
    renderPropIdentifier: 'items',
    resourceDefinition: { dataSourceId: DS_ID, tableName: TABLE, dataSourceType: 'teleport' },
    resource: {
      id: 'TQ_products',
      params: { queryColumns: { type: 'static', content: ['name', 'es_name'] } },
    },
    nodes: {
      success: {
        type: 'cms-list-repeater',
        content: {
          renderPropIdentifier: 'product',
          paginated,
          perPage: 20,
          searchEnabled: false,
          nodes: { list: { type: 'element', content: { elementType: 'div' } } },
        },
      },
    },
  },
})

/** An item whose params cannot be resolved at build time, so it fetches client-side. */
// tslint:disable-next-line:no-any
const makeDynamicItemNode = (withParams: boolean): any => ({
  type: 'data-source-item',
  content: {
    renderPropIdentifier: 'item',
    resourceDefinition: { dataSourceId: DS_ID, tableName: TABLE, dataSourceType: 'teleport' },
    resource: {
      params: withParams
        ? { limit: { type: 'dynamic', content: { referenceType: 'prop', id: 'limit' } } }
        : {},
    },
    children: [{ type: 'element', content: { elementType: 'div' } }],
  },
})

const run = async (
  plugin: ReturnType<typeof createNextPagesDataSourcePlugin>,
  // tslint:disable-next-line:no-any
  node: any,
  provider: types.JSXElement,
  localized: boolean
) => {
  const chunk = makeComponentChunk(provider)
  const dependencies: Record<string, UIDLDependency> = {}
  // tslint:disable-next-line:no-any
  const extractedResources: Record<string, any> = {}
  const structure: ComponentStructure = {
    uidl: { name: 'ProductsList', node, outputOptions: { folderPath: [] } },
    chunks: [chunk],
    dependencies,
    options: {
      dataSources: { [DS_ID]: dataSource },
      extractedResources,
      ...(localized ? { internationalization: I18N } : {}),
    },
  } as never
  await plugin(structure)
  const getStaticProps = structure.chunks.find((c) => c.name === 'getStaticProps')
  return {
    code: generator(chunk.content as types.Node).code,
    staticProps: getStaticProps ? generator(getStaticProps.content as types.Node).code : '',
    dependencies,
    fetcher: FETCHER_KEYS.map((key) => extractedResources[key]?.content).find(Boolean) as string,
  }
}

const collapse = (code: string): string => code.replace(/\s+/g, ' ')

describe('data-source fetches in a multi-language project', () => {
  const pagesPlugin = createNextPagesDataSourcePlugin()
  const componentPlugin = createNextComponentDataSourcePlugin()

  describe('a paginated list page', () => {
    it('fetches the first page for the language getStaticProps runs for', async () => {
      const { staticProps } = await run(pagesPlugin, makeListNode(true), makeListProvider(), true)
      expect(collapse(staticProps)).toContain(
        'fetchData({ page: 1, perPage: 20, queryColumns: JSON.stringify(["name", "es_name"]), locale: context.locale })'
      )
      // The count is the same in every language.
      expect(collapse(staticProps)).toContain('fetchCount().catch')
    })

    it('sends the client locale with every refetch and refetches when it changes', async () => {
      const { code, dependencies } = await run(
        pagesPlugin,
        makeListNode(true),
        makeListProvider(),
        true
      )
      const flat = collapse(code)
      expect(flat).toContain(
        'params={useMemo(() => ({ page: ds_0_page, perPage: 20, locale: router?.locale }), [ds_0_page, router?.locale])}'
      )
      expect(code).toContain('const router = useRouter()')
      expect(dependencies.useRouter).toMatchObject({ type: 'library', path: 'next/router' })
    })

    it('bakes the per-language columns into the fetcher it emits', async () => {
      const { fetcher } = await run(pagesPlugin, makeListNode(true), makeListProvider(), true)
      expect(fetcher).toContain('var LOCALIZED_COLUMNS = {"name":{"es":"es_name"}}')
      expect(fetcher).toContain('mainLanguage: "en"')
    })
  })

  describe('a plain list page', () => {
    it('prefetches and refetches in the page language', async () => {
      const { code, staticProps } = await run(
        pagesPlugin,
        makeListNode(false),
        makeListProvider(),
        true
      )
      expect(collapse(staticProps)).toContain(
        'fetchData({ "queryColumns": JSON.stringify(["name", "es_name"]), locale: context.locale })'
      )
      expect(collapse(code)).toContain(
        'params={useMemo(() => ({ locale: router?.locale }), [router?.locale])}'
      )
      expect(code).toContain('const router = useRouter()')
    })
  })

  describe('a component item that fetches client-side', () => {
    it('adds the locale to the params it already sends', async () => {
      const { code, dependencies } = await run(
        componentPlugin,
        makeDynamicItemNode(true),
        makeItemProvider(),
        true
      )
      const flat = collapse(code)
      expect(flat).toContain('locale: router?.locale')
      // The route is a template literal that interpolates the params.
      expect(flat).toContain(
        'fetch(`/api/teleport-teleport_products-ds1?$' + '{new URLSearchParams(params)}`'
      )
      expect(code).toContain('const router = useRouter()')
      expect(dependencies.useRouter).toBeDefined()
    })

    it('creates the params when the node declared none', async () => {
      const { code } = await run(
        componentPlugin,
        makeDynamicItemNode(false),
        makeItemProvider(),
        true
      )
      const flat = collapse(code)
      expect(flat).toContain('params={{ locale: router?.locale }}')
      expect(flat).toContain('new URLSearchParams(params)')
    })
  })

  describe('a single-language project', () => {
    it.each([
      ['a paginated list page', pagesPlugin, makeListNode(true), makeListProvider],
      ['a plain list page', pagesPlugin, makeListNode(false), makeListProvider],
      ['a component item', componentPlugin, makeDynamicItemNode(true), makeItemProvider],
    ])(
      'generates %s exactly as before — no locale, no router',
      async (_, plugin, node, provider) => {
        const { code, staticProps, dependencies, fetcher } = await run(
          plugin,
          node,
          provider(),
          false
        )
        expect(code).not.toContain('locale')
        expect(code).not.toContain('useRouter')
        expect(staticProps).not.toContain('locale')
        expect(dependencies.useRouter).toBeUndefined()
        expect(fetcher).toContain('var LOCALIZED_COLUMNS = {}')
        expect(fetcher).toContain('mainLanguage: null')
      }
    )
  })
})
