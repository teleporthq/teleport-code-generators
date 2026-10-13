import { generateBookingItemTransformationCode } from '../src/transformations/booking-item'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'
import {
  detectTransformationType,
  getTransformExpression,
  getTransformWrapperCode,
} from '../src/transformations'

// A booking page binds an item's columns as stored; the transform only puts
// its texts in the page's language. These evaluate the EMITTED code, the way
// the runtime does.

type Build = (record: unknown, options?: Record<string, unknown>) => Record<string, unknown>

const builderFor = (code: string): Build =>
  new Function(
    generateSharedTransformationCode() + '\n' + code + '\nreturn buildBookingItem;'
  )() as Build

const buildBookingItem = builderFor(generateBookingItemTransformationCode())

const buildWithCategories = builderFor(
  generateBookingItemTransformationCode({
    categories: [
      {
        id: 'rooms',
        name: 'Rooms',
        slug: 'rooms',
        parentId: null,
        order: 0,
        translations: { es: { name: 'Habitaciones' } },
        children: [
          {
            id: 'suites',
            name: 'Suites',
            slug: 'suites',
            parentId: 'rooms',
            order: 0,
            children: [],
          },
        ],
      },
    ],
  })
)

const item = {
  id: 'i1',
  slug: 'double-room',
  name: 'Double room',
  es_name: 'Habitación doble',
  description: '<p>Sea view.</p>',
  es_description: '<p>Vista al mar.</p>',
  location: 'Main street',
  es_location: '',
  price: '120.00',
  booking_unit: 'night',
}

describe('the booking item transform', () => {
  it('is applied to the booking items table only', () => {
    expect(detectTransformationType('teleport_booking_items')).toBe('booking-item')
    expect(detectTransformationType('public.TELEPORT_BOOKING_ITEMS')).toBe('booking-item')
    expect(detectTransformationType('booking_items')).toBeNull()
    expect(getTransformExpression('teleport_booking_items')).toContain('transformRecords')
    expect(getTransformWrapperCode('teleport_booking_items')).toContain('transformBookingItems')
  })

  it('shows the texts in the page’s language, every column kept as stored', () => {
    const row = buildBookingItem(item, { currentLanguage: 'es', mainLanguage: 'en' })
    expect(row).toMatchObject({
      name: 'Habitación doble',
      description: '<p>Vista al mar.</p>',
      // Not translated yet: the main language's.
      location: 'Main street',
      slug: 'double-room',
      price: '120.00',
      booking_unit: 'night',
      es_name: 'Habitación doble',
    })
  })

  it('names its category the way the taxonomy names its first one in the page’s language', () => {
    const filed = { ...item, category: 'Rooms', category_ids: '["rooms","suites"]' }
    expect(buildWithCategories(filed, { currentLanguage: 'es', mainLanguage: 'en' }).category).toBe(
      'Habitaciones'
    )
    expect(buildWithCategories(filed, { currentLanguage: 'en', mainLanguage: 'en' }).category).toBe(
      'Rooms'
    )
    // No translation: the main name; a nested category resolves too.
    expect(
      buildWithCategories(
        { ...filed, category: 'Suites', category_ids: '["suites"]' },
        { currentLanguage: 'es', mainLanguage: 'en' }
      ).category
    ).toBe('Suites')
  })

  it('keeps the stored category while none of its ids is a category', () => {
    const legacy = { ...item, category: 'Rooms', category_ids: '["gone"]' }
    expect(
      buildWithCategories(legacy, { currentLanguage: 'es', mainLanguage: 'en' }).category
    ).toBe('Rooms')
    expect(buildBookingItem(legacy, { currentLanguage: 'es', mainLanguage: 'en' }).category).toBe(
      'Rooms'
    )
    // A row without category columns gains none.
    expect(
      'category' in buildWithCategories(item, { currentLanguage: 'es', mainLanguage: 'en' })
    ).toBe(false)
  })

  it('keeps the main language on its own pages and without a localization', () => {
    expect(buildBookingItem(item, { currentLanguage: 'en', mainLanguage: 'en' }).name).toBe(
      'Double room'
    )
    expect(buildBookingItem(item, {}).name).toBe('Double room')
  })
})
