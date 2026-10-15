import type { UIDLEcommerceCategory } from '@teleporthq/teleport-types'
import { generateCategoryTaxonomyCode } from './category-taxonomy'

export interface BookingItemTransformOptions {
  /** The booking items' category taxonomy — see `bookingSettings.categories`. */
  categories?: UIDLEcommerceCategory[]
}

/**
 * Generates JavaScript code for the `teleport_booking_items` row
 * transformation — the things a Bookings site lets people book.
 *
 * The row is kept whole (every column, snake_case: the booking pages bind
 * them as stored) and its translatable texts — `name`, `description` (rich
 * text) and `location` — are the page's language when the row has them there
 * (`es_name`, …), the main language otherwise. Its `category` is the name its
 * first category has in the page's language, read off the taxonomy baked in
 * here (the row's stored main name while none of its ids is a category). That
 * is all a booking page needs to show an item in the visitor's language; the
 * booking statements localise what they read on their own.
 *
 * MUST mirror `localizeBookingItem` in the editor
 * (teleport-gui features/bookings/utils/localize-booking-item.ts), which is
 * what the canvas renders from.
 */
export const generateBookingItemTransformationCode = (
  options: BookingItemTransformOptions = {}
): string => {
  return `
// ============================================================
// Booking Item Transformation
// ============================================================

var BOOKING_ITEM_TRANSLATABLE_COLUMNS = ['name', 'description', 'location']
${generateCategoryTaxonomyCode('BOOKING_CATEGORIES_BY_ID', options.categories)}

function buildBookingItem(record, options) {
  if (!record || typeof record !== 'object') return record
  options = options || {}
  var currentLang = options.currentLanguage || null
  var mainLang = options.mainLanguage || null

  var out = {}
  for (var key in record) {
    if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key]
  }
  for (var i = 0; i < BOOKING_ITEM_TRANSLATABLE_COLUMNS.length; i++) {
    var column = BOOKING_ITEM_TRANSLATABLE_COLUMNS[i]
    var value = resolveI18nField(record, column, column, currentLang, mainLang)
    out[column] = value === null || value === undefined ? record[column] : value
  }
  if ('category' in record || 'category_ids' in record) {
    var stored = typeof record.category === 'string' ? record.category : ''
    var assigned = resolveAssignedCategories(
      record.category_ids,
      BOOKING_CATEGORIES_BY_ID,
      currentLang,
      mainLang,
      stored
    )
    out.category = assigned.length > 0 ? assigned[0].name : stored
  }
  return out
}

function transformBookingItems(records, options) {
  if (!Array.isArray(records)) return []
  return records.map(function(record) { return buildBookingItem(record, options) })
}
`
}
