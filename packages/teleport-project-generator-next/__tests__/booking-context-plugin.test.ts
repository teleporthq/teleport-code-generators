import { FileType, ProjectPluginStructure, UIDLBookingSettings } from '@teleporthq/teleport-types'
import { NextBookingProjectPlugin } from '../src/bookings/project-plugin'

/**
 * The booking items' category taxonomy is baked into `booking-context.js` and
 * read through `useBookingCategories()` — the booking page's category filter is
 * an array mapper over it, as the products' and the blog's are over theirs.
 */

const PAGE_WITHOUT_HOOK = 'export default function Book() { return null }'
const PAGE_WITH_HOOK = [
  "import { useBookingCategories } from '@/booking-context'",
  'export default function Book() { return null }',
].join('\n')

const DATA_SOURCE_ID = 'ds-bookings'

const buildStructure = (params: {
  pageContent: string
  bookingSettings?: UIDLBookingSettings
  /** The project's data sources; the items table lives in `DATA_SOURCE_ID`. */
  withDataSource?: boolean
}): ProjectPluginStructure => {
  const files = new Map<string, { path: string[]; files: Array<Record<string, unknown>> }>()
  files.set('book', {
    path: ['pages'],
    files: [{ name: 'book', fileType: FileType.JS, content: params.pageContent }],
  })
  return {
    uidl: {
      globals: { env: {} },
      ...(params.bookingSettings ? { bookingSettings: params.bookingSettings } : {}),
      ...(params.withDataSource
        ? {
            dataSources: {
              [DATA_SOURCE_ID]: {
                id: DATA_SOURCE_ID,
                type: 'teleport',
                name: 'Bookings',
                config: { selectedTables: { teleport_booking_items: { columns: [] } } },
              },
            },
          }
        : {}),
    },
    files,
    dependencies: {},
    devDependencies: {},
  } as unknown as ProjectPluginStructure
}

const findContext = (structure: ProjectPluginStructure) =>
  structure.files.get('booking-context')?.files?.[0] as { content: string } | undefined

describe('NextBookingProjectPlugin', () => {
  it('bakes the taxonomy behind a memoized, locale-aware hook', async () => {
    const structure = buildStructure({
      pageContent: PAGE_WITHOUT_HOOK,
      bookingSettings: {
        categories: [
          {
            id: 'rooms',
            name: 'Rooms',
            slug: 'rooms',
            parentId: null,
            order: 0,
            children: [],
            translations: { es: { name: 'Habitaciones' } },
          },
        ],
      },
    })

    await new NextBookingProjectPlugin().runAfter(structure)

    const context = findContext(structure)
    expect(context).toBeDefined()
    expect(context!.content).toContain('export const useBookingCategories')
    expect(context!.content).toContain(
      'resolveCategoryTranslations(BOOKING_CATEGORIES, router.locale)'
    )
    expect(context!.content).toContain('"Habitaciones"')
    expect(context!.content).not.toContain('createContext')
  })

  it('emits an EMPTY taxonomy for bookings that have no categories yet', async () => {
    const structure = buildStructure({
      pageContent: PAGE_WITHOUT_HOOK,
      bookingSettings: { categories: [] },
    })

    await new NextBookingProjectPlugin().runAfter(structure)

    expect(findContext(structure)!.content).toContain('const BOOKING_CATEGORIES = []')
  })

  it('backstops a dangling import when the project carries no bookingSettings', async () => {
    const structure = buildStructure({ pageContent: PAGE_WITH_HOOK })

    await new NextBookingProjectPlugin().runAfter(structure)

    expect(findContext(structure)!.content).toContain('const BOOKING_CATEGORIES = []')
  })

  it('counts the items per category live when the settings name their data source', async () => {
    const structure = buildStructure({
      pageContent: PAGE_WITHOUT_HOOK,
      bookingSettings: { categories: [], dataSourceId: DATA_SOURCE_ID },
      withDataSource: true,
    })

    await new NextBookingProjectPlugin().runAfter(structure)

    const context = findContext(structure)!.content
    expect(context).toContain("fetch('/api/bookings/category-counts')")
    expect(context).toContain('itemCount: counts ? counts[category.id] || 0 : undefined')
    expect(context).toContain('children: withItemCounts(category.children, counts)')
    expect(context).toContain(
      'withItemCounts(resolveCategoryTranslations(BOOKING_CATEGORIES, router.locale), counts)'
    )

    const route = structure.files.get('booking-api-category-counts')
    expect(route?.path).toEqual(['pages', 'api', 'bookings'])
    expect(route?.files[0].name).toBe('category-counts')
    const content = String(route?.files[0].content)
    expect(content).toContain(
      "SELECT elem AS id, COUNT(*)::int AS count FROM teleport_booking_items i, jsonb_array_elements_text(COALESCE(NULLIF(i.category_filter_ids, '')::jsonb, '[]'::jsonb)) AS elem WHERE i.is_active = TRUE GROUP BY elem"
    )
    expect(content).toContain(
      'SELECT category_filter_ids FROM teleport_booking_items WHERE is_active = TRUE'
    )
    expect(content).toContain(
      'SELECT COUNT(*) AS total FROM teleport_booking_items WHERE is_active = TRUE'
    )
  })

  it('bakes the categories without counts, and no route, when the named data source is gone or none is named', async () => {
    const gone = buildStructure({
      pageContent: PAGE_WITHOUT_HOOK,
      bookingSettings: { categories: [], dataSourceId: 'ds-removed' },
      withDataSource: true,
    })
    const unnamed = buildStructure({
      pageContent: PAGE_WITHOUT_HOOK,
      bookingSettings: { categories: [] },
    })

    await new NextBookingProjectPlugin().runAfter(gone)
    await new NextBookingProjectPlugin().runAfter(unnamed)

    for (const structure of [gone, unnamed]) {
      const context = findContext(structure)!.content
      expect(context).not.toContain('category-counts')
      expect(context).not.toContain('itemCount')
      expect(context).toContain('resolveCategoryTranslations(BOOKING_CATEGORIES, router.locale)')
      expect(structure.files.get('booking-api-category-counts')).toBeUndefined()
    }
    expect(findContext(gone)!.content).toBe(findContext(unnamed)!.content)
  })

  it('leaves a project that never references the hook untouched', async () => {
    const structure = buildStructure({ pageContent: PAGE_WITHOUT_HOOK })

    await new NextBookingProjectPlugin().runAfter(structure)

    expect(findContext(structure)).toBeUndefined()
  })
})
