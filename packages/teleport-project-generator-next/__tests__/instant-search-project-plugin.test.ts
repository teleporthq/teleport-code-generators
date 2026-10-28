import { parse } from '@babel/parser'
import { FileType, ProjectPluginStructure, UIDLPluginRecord } from '@teleporthq/teleport-types'
import { NextInstantSearchProjectPlugin } from '../src/instant-search/project-plugin'
import {
  resolveDbSearchSections,
  resolveDetailsRouteForTable,
} from '../src/instant-search/sections'
import { resolveInstantSearchConfig } from '../src/instant-search/settings'

const APP_CONTENT = `import { GlobalProvider } from '../global-context'

const MyApp = ({ Component, pageProps }) => {
  return (
    <GlobalProvider>
      <Component {...pageProps} />
    </GlobalProvider>
  )
}

export default MyApp
`

const TELEPORT_DATA_SOURCE = {
  id: 'ds-teleport',
  name: 'Teleport',
  type: 'teleport',
  config: { tables: ['teleport_products', 'teleport_blog_posts', 'teleport_booking_items'] },
}

const routeValue = (navLink: string, tableName?: string, column = 'slug') => ({
  value: navLink.slice(1) || 'home',
  pageOptions: {
    navLink,
    ...(tableName
      ? {
          dynamicRouteAttribute: column,
          detailsPageInfo: {
            dataSourceId: 'ds-teleport',
            dataSourceName: 'Teleport',
            dataSourceType: 'teleport',
            tableName,
            differentiatorColumn: column,
            featureIdentifier: '',
          },
        }
      : {}),
  },
})

function makeStructure(options: {
  record?: Partial<UIDLPluginRecord> | null
  features?: { store?: boolean; blog?: boolean; bookings?: boolean }
}): ProjectPluginStructure {
  const files = new Map()
  files.set('_app', {
    path: ['pages'],
    files: [{ name: '_app', fileType: FileType.JS, content: APP_CONTENT }],
  })
  const features = options.features ?? {}
  const routes = [
    routeValue('/'),
    ...(features.store ? [routeValue('/products/[slug]', 'teleport_products')] : []),
    ...(features.blog ? [routeValue('/blog/[slug]', 'teleport_blog_posts')] : []),
    ...(features.bookings ? [routeValue('/book/[slug]', 'teleport_booking_items')] : []),
  ]
  return {
    uidl: {
      name: 'test-project',
      globals: { settings: { title: 'Test', language: 'en' }, assets: [] },
      dataSources: { 'ds-teleport': TELEPORT_DATA_SOURCE },
      ...(features.store ? { ecommerceSettings: { paymentProviders: [] } } : {}),
      ...(features.blog ? { blogSettings: {} } : {}),
      ...(features.bookings ? { bookingSettings: {} } : {}),
      ...(options.record === null
        ? {}
        : { plugins: { instantSearch: { settings: {}, ...(options.record ?? {}) } } }),
      root: { name: 'App', stateDefinitions: { route: { type: 'string', values: routes } } },
    },
    files,
    dependencies: {},
    devDependencies: {},
    template: { files: [], subFolders: [] },
  } as unknown as ProjectPluginStructure
}

const parses = (source: string) => parse(source, { sourceType: 'module', plugins: ['jsx'] })

describe('NextInstantSearchProjectPlugin', () => {
  it('leaves a project without the plugin exactly as it was', async () => {
    const structure = makeStructure({ record: null })
    await new NextInstantSearchProjectPlugin().runAfter(structure)

    expect(structure.files.get('instant-search-component')).toBeUndefined()
    expect(structure.files.get('instant-search-route')).toBeUndefined()
    expect(structure.files.get('_app').files[0].content).toBe(APP_CONTENT)
  })

  it('emits the modal, the words index, the route that scans it, and a fetcher per searchable table', async () => {
    const structure = makeStructure({
      record: {
        settings: {
          placeholder: 'Find anything',
          minCharacters: 3,
          debounceMs: 400,
          resultsPerSection: 8,
          hotkeys: false,
        },
        data: {
          pages: [
            {
              title: 'About',
              route: '/about',
              text: 'Our story, since 1999.',
              description: '  Who we are. ',
            },
            { title: '', route: '/broken', text: '' },
            { title: 'Relative', route: 'about', text: '' },
          ],
        },
      },
      features: { store: true, blog: true, bookings: true },
    })
    await new NextInstantSearchProjectPlugin().runAfter(structure)

    const component = structure.files.get('instant-search-component').files[0].content as string
    expect(component).toContain('"hotkeys":false')
    expect(component).toContain('"minCharacters":3')
    expect(component).toContain('"debounceMs":400')
    expect(component).toContain('setTimeout(() => {')
    expect(component).toContain('}, SETTINGS.debounceMs)')
    expect(component).toContain('"limit":8')
    // The sections the route answers, asked for one by one: pages, then every table with a page.
    expect(component).toContain('"sections":["pages","products","posts","bookingItems"]')
    // The modal is the project's own component: the runtime draws nothing and answers its workflows.
    expect(component).not.toContain('createPortal')
    expect(component).not.toContain('<div')
    expect(component).toContain('"tq-search-query"')
    expect(component).toContain('"tq-search-open"')
    // The field's clear button: the runtime empties the field and starts over.
    expect(component).toContain('"tq-search-clear"')
    expect(component).toContain('"tq-search-close"')
    expect(component).toContain('"tq-search-state"')
    expect(component).toContain('"tq-search-results:"')
    expect(component).toContain("'&section=' +")
    expect(() => parses(component)).not.toThrow()

    const app = structure.files.get('_app').files[0].content as string
    expect(app).toContain(
      "import TeleportInstantSearch from '../components/teleport-instant-search';"
    )
    expect(app).toContain('<TeleportInstantSearch />')

    const route = structure.files.get('instant-search-route')
    expect(route.path).toEqual(['pages', 'api', 'plugins'])
    expect(route.files[0].name).toBe('search')
    const source = route.files[0].content as string
    // The pages' words are a JSON module beside the utilities; only a well-formed entry is kept.
    expect(source).toContain('import PAGES_INDEX from "../../../utils/search-pages-index.json"')
    expect(source).toContain('const FOLDED_PAGES = PAGES.map(')
    expect(source).toContain('json({ success: true, query, items })')
    expect(source).toContain("only === 'pages'")
    const index = structure.files.get('instant-search-index')
    expect(index.path).toEqual(['utils'])
    expect(index.files[0].name).toBe('search-pages-index')
    expect(index.files[0].fileType).toBe(FileType.JSON)
    expect(JSON.parse(index.files[0].content as string)).toEqual({
      pages: [
        {
          title: 'About',
          route: '/about',
          text: 'Our story, since 1999.',
          description: 'Who we are.',
        },
      ],
    })
    // A page found by its title says its own description.
    expect(source).toContain('titleAt >= 0 && page.description ? page.description')
    expect(source).toContain('const MIN_CHARACTERS = 3')
    expect(source).toContain('const DEFAULT_LIMIT = 8')
    expect(source).toContain('key: "products"')
    expect(source).toContain('"staticBase":"/products","column":"slug"')
    expect(source).toContain('"staticBase":"/blog","column":"slug"')
    expect(source).toContain('"staticBase":"/book","column":"slug"')
    expect(source).toContain('activeColumn: "is_active"')
    expect(source).toMatch(/import fetcher0 from "\.\.\/\.\.\/\.\.\/utils\/data-sources\//)
    expect(() => parses(source)).not.toThrow()

    // One fetcher module per table, and the database driver with them.
    const fetchers = [...structure.files.keys()].filter((key) =>
      key.startsWith('resource-utils/data-sources/')
    )
    expect(fetchers.length).toBe(3)
    expect(structure.dependencies.pg).toBeDefined()
  })

  it('searches only the sections asked for, and drops a section whose rows have no page', async () => {
    const structure = makeStructure({
      record: { settings: { sections: ['pages', 'posts', 'bookingItems'] } },
      features: { store: true, blog: true },
    })
    await new NextInstantSearchProjectPlugin().runAfter(structure)

    const source = structure.files.get('instant-search-route').files[0].content as string
    expect(structure.files.get('instant-search-component').files[0].content).toContain(
      '"debounceMs":300'
    )
    expect(source).toContain('"staticBase":"/blog"')
    expect(source).not.toContain('"staticBase":"/products"')
    expect(source).not.toContain('bookingItems')
    expect(source).toContain('const PAGES = []')
    expect(source).not.toContain('PAGES_INDEX')
    expect(structure.files.get('instant-search-index')).toBeUndefined()
    expect(
      [...structure.files.keys()].filter((key) => key.startsWith('resource-utils/')).length
    ).toBe(1)
  })
})

describe('resolveInstantSearchConfig', () => {
  it('waits 300ms after typing by default, and keeps a wait inside 0–1000', () => {
    const structure = makeStructure({ record: { settings: {} } })
    expect(resolveInstantSearchConfig(structure.uidl)!.settings.debounceMs).toBe(300)
    expect(resolveInstantSearchConfig(structure.uidl)!.settings.minCharacters).toBe(2)

    const high = makeStructure({ record: { settings: { debounceMs: 4000 } } })
    expect(resolveInstantSearchConfig(high.uidl)!.settings.debounceMs).toBe(1000)

    const off = makeStructure({ record: { settings: { debounceMs: 0 } } })
    expect(resolveInstantSearchConfig(off.uidl)!.settings.debounceMs).toBe(0)
  })
})

describe('resolveDbSearchSections', () => {
  it('reads a content preset’s post page from its site index when no route binds the table', () => {
    const structure = makeStructure({ record: {}, features: {} })
    ;(structure.uidl as { helpCenterSettings?: unknown }).helpCenterSettings = {
      siteIndex: {
        dataSourceId: 'ds-teleport',
        postPath: '/help/',
        postUrlField: 'slug',
        title: 'Help',
      },
    }
    const config = resolveInstantSearchConfig(structure.uidl)!
    const sections = resolveDbSearchSections(structure.uidl, config)
    expect(sections.map((section) => section.key)).toEqual(['articles'])
    expect(sections[0].route).toEqual({ staticBase: '/help', column: 'slug' })
    expect(resolveDetailsRouteForTable(structure.uidl, 'teleport_products')).toBeNull()
  })

  it('prefers the public details page when an admin editor for the same table is listed first', () => {
    const uidl = {
      root: {
        stateDefinitions: {
          route: {
            values: [
              routeValue('/admin/booking-items/update/[id]', 'teleport_booking_items', 'id'),
              routeValue('/book/[slug]', 'teleport_booking_items', 'slug'),
            ],
          },
        },
      },
    }
    expect(resolveDetailsRouteForTable(uidl as never, 'teleport_booking_items')).toEqual({
      staticBase: '/book',
      column: 'slug',
    })
    expect(
      resolveDetailsRouteForTable(
        {
          root: {
            stateDefinitions: {
              route: {
                values: [
                  routeValue('/admin/booking-items/update/[id]', 'teleport_booking_items', 'id'),
                ],
              },
            },
          },
        } as never,
        'teleport_booking_items'
      )
    ).toEqual({ staticBase: '/admin/booking-items/update', column: 'id' })
  })
})
