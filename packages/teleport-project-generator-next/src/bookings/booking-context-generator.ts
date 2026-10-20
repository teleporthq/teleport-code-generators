import type { UIDLBookingSettings } from '@teleporthq/teleport-types'

/**
 * The generated `@/booking-context` module: the booking items' category
 * taxonomy, baked as one static JSON blob and exposed as the `Booking
 * Categories` global — the blog's `@/blog-context` twin (a memoized hook, no
 * provider: nothing here changes or is fetched).
 *
 * Names resolve to `router.locale` client-side against each node's
 * `translations`, so a locale switch costs no re-fetch.
 */
export const generateBookingContextFileContent = (
  bookingSettings?: UIDLBookingSettings
): string => {
  const categoriesJson = JSON.stringify(bookingSettings?.categories || [])

  return `import { useMemo } from 'react'
import { useRouter } from 'next/router'

// Nested booking-item category tree, baked at export time from the project's
// \`bookingCategories\` taxonomy — it lives only in the project document. Each
// node carries its \`translations\` map keyed by locale.
const BOOKING_CATEGORIES = ${categoriesJson}

// Each category's name/description in \`locale\`, else the main-language ones;
// recursing into \`children\`. MUST mirror \`resolveCategoryTranslations\` in the
// e-commerce and blog contexts.
function resolveCategoryTranslations(categories, locale) {
  if (!Array.isArray(categories) || !categories.length) return categories
  return categories.map(function (category) {
    var override = locale && category.translations ? category.translations[locale] : null
    return Object.assign({}, category, {
      name: (override && override.name) || category.name,
      description: (override && override.description) || category.description,
      children: resolveCategoryTranslations(category.children, locale),
    })
  })
}

export const useBookingCategories = () => {
  const router = useRouter()
  return useMemo(
    () => resolveCategoryTranslations(BOOKING_CATEGORIES, router.locale),
    [router.locale]
  )
}
`
}
