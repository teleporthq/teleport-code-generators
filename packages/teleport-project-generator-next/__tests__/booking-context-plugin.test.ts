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

const buildStructure = (params: {
  pageContent: string
  bookingSettings?: UIDLBookingSettings
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

  it('leaves a project that never references the hook untouched', async () => {
    const structure = buildStructure({ pageContent: PAGE_WITHOUT_HOOK })

    await new NextBookingProjectPlugin().runAfter(structure)

    expect(findContext(structure)).toBeUndefined()
  })
})
