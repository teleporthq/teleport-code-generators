import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { generateBookingContextFileContent } from './booking-context-generator'

/** The import specifier the generated booking pages resolve `useBookingCategories` from. */
const BOOKING_CONTEXT_MODULE = '@/booking-context'

/**
 * Emits the generated `booking-context.js` module — the booking items' baked
 * category taxonomy behind `useBookingCategories()` — when the project carries
 * `bookingSettings`, and also (with an empty taxonomy) whenever a generated file
 * imports the module without it, so the import never dangles and `next build`
 * never fails on it. Projects that never reference it are untouched. The blog's
 * `NextBlogProjectPlugin` twin.
 */
export class NextBookingProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files } = structure
    const bookingSettings = uidl.bookingSettings

    if (!bookingSettings && !projectReferencesBookingContext(files)) {
      return structure
    }

    files.set('booking-context', {
      path: [],
      files: [
        {
          name: 'booking-context',
          fileType: FileType.JS,
          content: generateBookingContextFileContent(bookingSettings),
        },
      ],
    })

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
