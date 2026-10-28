import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { generateBookingContextFileContent } from './booking-context-generator'
import { generateBookingCategoryCountsApiRoute } from './booking-api-routes-generator'
import { injectBookingKeyKeeper } from './manage-key-snippet'

/** The import specifier the generated booking pages resolve `useBookingCategories` from. */
const BOOKING_CONTEXT_MODULE = '@/booking-context'

/**
 * Emits the generated `booking-context.js` module — the booking items' baked
 * category taxonomy behind `useBookingCategories()` — when the project carries
 * `bookingSettings`, and also (with an empty taxonomy) whenever a generated file
 * imports the module without it, so the import never dangles and `next build`
 * never fails on it. Projects that never reference it are untouched. The blog's
 * `NextBlogProjectPlugin` twin.
 *
 * When the settings name the data source the items table lives in, the
 * context also counts: `/api/bookings/category-counts` is emitted and each
 * category carries a live `itemCount` (the store's `productCount` twin).
 */
export class NextBookingProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    // In `runBefore`: `_document` reads the global assets during generation.
    // The booking link's manage key, a reset link's token and a newsletter
    // link's token leave the address first thing: the site's one keeper (see
    // ../address-key-keeper.ts).
    injectBookingKeyKeeper(structure.uidl)
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files } = structure
    const bookingSettings = uidl.bookingSettings

    if (!bookingSettings && !projectReferencesBookingContext(files)) {
      return structure
    }

    // The route exists only where it can read: a settings block naming a data
    // source the project no longer carries bakes the categories without counts.
    const dataSource = bookingSettings?.dataSourceId
      ? uidl.dataSources?.[bookingSettings.dataSourceId]
      : undefined
    const settings = dataSource
      ? bookingSettings
      : bookingSettings && { ...bookingSettings, dataSourceId: undefined }

    files.set('booking-context', {
      path: [],
      files: [
        {
          name: 'booking-context',
          fileType: FileType.JS,
          content: generateBookingContextFileContent(settings),
        },
      ],
    })

    if (dataSource) {
      files.set('booking-api-category-counts', {
        path: ['pages', 'api', 'bookings'],
        files: [
          {
            name: 'category-counts',
            fileType: FileType.JS,
            content: generateBookingCategoryCountsApiRoute(dataSource.type, dataSource.config),
          },
        ],
      })
    }

    return structure
  }
}

// tslint:disable-next-line:no-any
function projectReferencesBookingContext(files: Map<string, any>): boolean {
  for (const [, record] of Array.from(files.entries())) {
    for (const file of record.files || []) {
      if (typeof file.content === 'string' && file.content.includes(BOOKING_CONTEXT_MODULE)) {
        return true
      }
    }
  }
  return false
}
