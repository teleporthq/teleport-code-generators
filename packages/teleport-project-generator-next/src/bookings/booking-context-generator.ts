import type { UIDLBookingSettings } from '@teleporthq/teleport-types'

/**
 * The generated `@/booking-context` module: the booking items' category
 * taxonomy, baked as one static JSON blob and exposed as the `Booking
 * Categories` global — the blog's `@/blog-context` twin (a memoized hook, no
 * provider).
 *
 * Names resolve to `router.locale` client-side against each node's
 * `translations`, so a locale switch costs no re-fetch. When the settings name
 * the items table's data source, each node also carries `itemCount` — how many
 * active items it holds — read once per page load from
 * `/api/bookings/category-counts` (the store's `productCount` twin) and
 * `undefined` until that answers, so a text bound to it keeps its drawn
 * number. Without a data source the module is exactly the static one.
 */
export const generateBookingContextFileContent = (
  bookingSettings?: UIDLBookingSettings
): string => {
  const categoriesJson = JSON.stringify(bookingSettings?.categories || [])
  const withCounts = !!bookingSettings?.dataSourceId

  if (withCounts) {
    return `import { useEffect, useMemo, useState } from 'react'
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

// Stamps each node with how many active items it holds, from the route's
// answer: \`undefined\` while \`counts\` is null (nothing has answered yet), 0 for
// a category the answer has no entry for. Recurses into \`children\`.
function withItemCounts(categories, counts) {
  if (!Array.isArray(categories) || !categories.length) return categories
  return categories.map(function (category) {
    return Object.assign({}, category, {
      itemCount: counts ? counts[category.id] || 0 : undefined,
      children: withItemCounts(category.children, counts),
    })
  })
}

// One request per page load, shared by every component that reads the
// categories: the answer is kept at module level and handed to each hook.
var itemCounts = null
var itemCountsRequest = null
var itemCountListeners = []
function loadItemCounts() {
  if (itemCountsRequest) return itemCountsRequest
  itemCountsRequest = fetch('/api/bookings/category-counts')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      itemCounts = data && data.counts ? data.counts : null
      itemCountListeners.forEach((listener) => listener(itemCounts))
    })
    .catch(() => {
      itemCounts = null
    })
  return itemCountsRequest
}

export const useBookingCategories = () => {
  const router = useRouter()
  const [counts, setCounts] = useState(itemCounts)
  useEffect(() => {
    if (itemCounts) {
      setCounts(itemCounts)
      return undefined
    }
    itemCountListeners.push(setCounts)
    loadItemCounts()
    return () => {
      itemCountListeners = itemCountListeners.filter((listener) => listener !== setCounts)
    }
  }, [])
  return useMemo(
    () => withItemCounts(resolveCategoryTranslations(BOOKING_CATEGORIES, router.locale), counts),
    [router.locale, counts]
  )
}
`
  }

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
