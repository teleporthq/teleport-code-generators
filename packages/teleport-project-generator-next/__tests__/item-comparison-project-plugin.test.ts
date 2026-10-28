import { parse } from '@babel/parser'
import { FileType, ProjectPluginStructure, UIDLPluginRecord } from '@teleporthq/teleport-types'
import { NextItemComparisonProjectPlugin } from '../src/item-comparison/project-plugin'
import { resolveItemComparisonConfig } from '../src/item-comparison/settings'

const APP_CONTENT = `const MyApp = ({ Component, pageProps }) => {
  return (
    <Component {...pageProps} />
  )
}

export default MyApp
`

const routeValue = (navLink: string, tableName?: string) => ({
  value: navLink,
  pageOptions: {
    navLink,
    ...(tableName
      ? {
          dynamicRouteAttribute: 'slug',
          detailsPageInfo: {
            dataSourceId: 'ds',
            dataSourceName: 'Teleport',
            dataSourceType: 'teleport',
            tableName,
            differentiatorColumn: 'slug',
            featureIdentifier: '',
          },
        }
      : {}),
  },
})

function makeStructure(
  record: Partial<UIDLPluginRecord> | null,
  features: { store?: boolean; bookings?: boolean } = {}
) {
  const files = new Map()
  files.set('_app', {
    path: ['pages'],
    files: [{ name: '_app', fileType: FileType.JS, content: APP_CONTENT }],
  })
  return {
    uidl: {
      name: 'p',
      globals: { settings: { title: 'P', language: 'en' }, assets: [] },
      dataSources: { ds: { id: 'ds', name: 'Teleport', type: 'teleport', config: {} } },
      ...(features.store ? { ecommerceSettings: { paymentProviders: [] } } : {}),
      ...(features.bookings ? { bookingSettings: {} } : {}),
      ...(record ? { plugins: { itemComparison: { settings: {}, ...record } } } : {}),
      root: {
        name: 'App',
        stateDefinitions: {
          route: {
            type: 'string',
            values: [
              routeValue('/'),
              ...(features.store ? [routeValue('/products/[slug]', 'teleport_products')] : []),
              ...(features.bookings ? [routeValue('/book/[slug]', 'teleport_booking_items')] : []),
            ],
          },
        },
      },
    },
    files,
    dependencies: {},
    devDependencies: {},
    template: { files: [], subFolders: [] },
  } as unknown as ProjectPluginStructure
}

const parses = (source: string) => parse(source, { sourceType: 'module', plugins: ['jsx'] })

describe('NextItemComparisonProjectPlugin', () => {
  it('leaves a project without the plugin exactly as it was', async () => {
    const structure = makeStructure(null, { store: true })
    await new NextItemComparisonProjectPlugin().runAfter(structure)
    expect(structure.files.get('item-comparison-component')).toBeUndefined()
    expect(structure.files.get('item-comparison-route')).toBeUndefined()
    expect(structure.files.get('_app').files[0].content).toBe(APP_CONTENT)
  })

  it('emits the comparison runtime and a compare route per comparable kind, with the chosen attributes', async () => {
    const structure = makeStructure(
      {
        settings: {
          kinds: ['products', 'bookingItems'],
          maxItems: 9,
          productAttributes: ['price', 'stock', 'nonsense'],
          onlyDifferences: true,
        },
        pages: { compare: '/compare' },
      },
      { store: true, bookings: true }
    )
    await new NextItemComparisonProjectPlugin().runAfter(structure)

    const component = structure.files.get('item-comparison-component').files[0].content as string
    expect(component).toContain('"maxItems":6')
    // The controls, the tray and the page are the project's own; the runtime answers their workflows.
    expect(component).toContain('"workflow:custom:"')
    expect(component).toContain('"tq-compare-items"')
    expect(component).toContain('"tq-compare-request"')
    expect(component).toContain('"tq-compare-toggle:"')
    expect(component).not.toContain('createPortal')
    expect(component).toContain('"onlyDifferences":true')
    expect(component).toContain('"compareRoute":"/compare"')
    expect(component).toContain('[data-tq-compare-toggle]')
    // The page and the tray learn whether the rows are still on their way.
    expect(component).toContain("loading: loading ? 'true' : 'false'")
    expect(() => parses(component)).not.toThrow()
    expect(structure.files.get('_app').files[0].content).toContain('<TeleportItemComparison />')

    const route = structure.files.get('item-comparison-route')
    expect(route.path).toEqual(['pages', 'api', 'plugins'])
    expect(route.files[0].name).toBe('compare')
    const source = route.files[0].content as string
    expect(source).toContain('"products": {')
    expect(source).toContain('"bookingItems": {')
    expect(source).toContain(
      '{"key":"price","label":"Price","better":"low"},{"key":"stock","label":"In stock","better":"high"}'
    )
    expect(source).not.toContain('nonsense')
    expect(source).toContain('"staticBase":"/book","column":"slug"')
    expect(source).not.toContain('/admin/booking-items')
    expect(source).toContain('activeColumn: "is_active"')
    // Read as a visitor: the table route's own row policy decides what is public.
    expect(source).toContain('fetch: (params) => readAsVisitor(fetcher0, params)')
    expect(source).toContain('async function readAsVisitor(fetcher, params)')
    expect(source).not.toContain('.fetchData')
    expect(source).toContain('Object.prototype.hasOwnProperty.call(KINDS, kind)')
    expect(source).toContain('const MAX_ITEMS = 6')
    expect(() => parses(source)).not.toThrow()
    expect(
      [...structure.files.keys()].filter((key) => key.startsWith('resource-utils/')).length
    ).toBe(2)
    expect(structure.dependencies.pg).toBeDefined()
  })

  it('reads the kinds from the record and the defaults for the rest', () => {
    const structure = makeStructure(
      { settings: { kinds: ['products', 'bookingItems'] } },
      { bookings: true }
    )
    const config = resolveItemComparisonConfig(structure.uidl)!
    expect(config.kinds).toEqual(['products', 'bookingItems'])
    expect(config.maxItems).toBe(4)
    expect(config.bookingAttributes).toEqual(['price', 'unit', 'capacity', 'duration', 'category'])
    expect(config.compareRoute).toBeNull()
    // Every custom property makes a row unless the owner says otherwise.
    expect(config.productPropertyRows).toBe('all')
    expect(config.bookingPropertyRows).toBe('all')
    expect(config.productProperties).toEqual([])
  })

  it('keeps the picked custom property names, each once, and refuses an unknown row mode', () => {
    const structure = makeStructure(
      {
        settings: {
          productPropertyRows: 'chosen',
          productProperties: [' Material ', 'material', 'Color', 7 as unknown as string, ''],
          bookingPropertyRows: 'sometimes',
        },
      },
      { store: true }
    )
    const config = resolveItemComparisonConfig(structure.uidl)!
    expect(config.productPropertyRows).toBe('chosen')
    expect(config.productProperties).toEqual(['Material', 'Color'])
    expect(config.bookingPropertyRows).toBe('all')
  })

  it('answers each item’s shown custom properties and lays them out as rows, the tray folding on phones', async () => {
    const structure = makeStructure(
      {
        settings: {
          kinds: ['products', 'bookingItems'],
          bookingPropertyRows: 'chosen',
          bookingProperties: ['Size'],
          onlyDifferences: true,
        },
      },
      { store: true, bookings: true }
    )
    await new NextItemComparisonProjectPlugin().runAfter(structure)
    const route = structure.files.get('item-comparison-route').files[0].content as string
    const routeHelpers = route.slice(
      route.indexOf('function text(value)'),
      route.indexOf('function itemUrl(')
    )
    // eslint-disable-next-line no-new-func
    const shownProperties = new Function(`${routeHelpers}; return shownProperties`)()
    expect(
      shownProperties('products', {
        metadata: JSON.stringify({
          Material: 'Cotton',
          Color: 'Navy',
          Secret: 'x',
          sku: 'A-1',
          Empty: ' ',
          _tqPropVisibility: JSON.stringify({ Secret: false }),
        }),
      })
    ).toEqual([
      { key: 'Material', value: 'Cotton' },
      { key: 'Color', value: 'Navy' },
    ])
    expect(
      shownProperties('bookingItems', {
        properties: JSON.stringify([
          { key: 'Size', value: '30 m²', visible: true },
          { key: 'Code', value: 'R1', visible: false },
          { key: '', value: 'nameless' },
        ]),
      })
    ).toEqual([{ key: 'Size', value: '30 m²' }])
    expect(shownProperties('bookingItems', { properties: 'not json' })).toEqual([])

    const component = structure.files.get('item-comparison-component').files[0].content as string
    const settings = component.slice(
      component.indexOf('const SETTINGS = '),
      component.indexOf('\n', component.indexOf('const SETTINGS = '))
    )
    const rowsSource = component.slice(
      component.indexOf('function customRowsOf('),
      component.indexOf('function Toast(')
    )
    // eslint-disable-next-line no-new-func
    const customRowsOf = new Function(
      `${settings}; const MAX_CUSTOM_ROWS = 30; ${rowsSource}; return customRowsOf`
    )()
    const products = {
      kind: 'products',
      items: [
        {
          properties: [
            { key: 'Material', value: 'Cotton' },
            { key: 'Fit', value: 'Slim' },
          ],
        },
        {
          properties: [
            { key: 'material', value: 'Wool' },
            { key: 'Fit', value: 'Slim' },
          ],
        },
      ],
    }
    // Every name, once whatever its case; the row every item agrees on is left out.
    expect(customRowsOf(products)).toEqual([
      { key: 'material', label: 'Material', cells: [{ text: 'Cotton' }, { text: 'Wool' }] },
    ])
    // Picked names only, in their order; an item without one leaves its cell empty.
    expect(
      customRowsOf({
        kind: 'bookingItems',
        items: [{ properties: [{ key: 'Size', value: '30 m²' }] }, { properties: [] }],
      })
    ).toEqual([{ key: 'size', label: 'Size', cells: [{ text: '30 m²' }, { text: '' }] }])

    expect(component).toContain('"tq-compare-fold"')
    expect(component).toContain('"tq-compare-unfold"')
    expect(component).toContain('"(max-width: 767px)"')
    expect(component).toContain('trayOpen: trayOpen()')
    expect(() => parses(component)).not.toThrow()
  })

  it('links a booking item to the public page when the admin editor is listed first', async () => {
    const structure = makeStructure({ settings: { kinds: ['bookingItems'] } }, { bookings: true })
    const values = (
      structure.uidl as { root: { stateDefinitions: { route: { values: object[] } } } }
    ).root.stateDefinitions.route.values
    values.unshift({
      value: '/admin/booking-items/update/[id]',
      pageOptions: {
        navLink: '/admin/booking-items/update/[id]',
        dynamicRouteAttribute: 'id',
        detailsPageInfo: {
          dataSourceId: 'ds',
          dataSourceName: 'Teleport',
          dataSourceType: 'teleport',
          tableName: 'teleport_booking_items',
          differentiatorColumn: 'id',
          featureIdentifier: 'teleportBookingItem',
        },
      },
    })
    await new NextItemComparisonProjectPlugin().runAfter(structure)
    const source = structure.files.get('item-comparison-route').files[0].content as string
    expect(source).toContain('"staticBase":"/book","column":"slug"')
    expect(source).not.toContain('/admin/booking-items')
  })
})
