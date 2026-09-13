import type { UIDLBlogSettings } from '@teleporthq/teleport-types'

/**
 * The generated `@/blog-context` module: the blog's post-category taxonomy,
 * baked as one static JSON blob and exposed as the `Blog Categories` global.
 *
 * Deliberately NOT a React context/provider (unlike `@/ecommerce-context`):
 * there is no mutable state here, nothing to share between components and
 * nothing to fetch. A memoized hook is all the data needs, which also means
 * `_app` needs no extra wrapper — one fewer thing that can go wrong for a
 * project whose pages the user has reshaped.
 *
 * `router.locale` resolution happens client-side against the SAME
 * `translations` map every category surface reads, so the whole tree (every
 * language) ships once and a locale switch costs no re-fetch.
 */
export const generateBlogContextFileContent = (blogSettings?: UIDLBlogSettings): string => {
  const categoriesJson = JSON.stringify(blogSettings?.categories || [])

  return `import { useMemo } from 'react'
import { useRouter } from 'next/router'

// Nested blog category tree, baked at export time from the project's
// \`blogCategories\` taxonomy — it lives only in the project document, there is
// no database table for it. Each node carries a resolved public \`imageUrl\` /
// \`iconUrl\`, the derived \`subtreeIds\` / \`prefixIds\` the post breadcrumbs gate
// on, and a \`translations\` map keyed by locale.
const BLOG_CATEGORIES = ${categoriesJson}

// Resolve each category's name/description to \`locale\` from its
// \`translations\` map, falling back to the main-language (top-level) fields
// when there's no override yet, or no locale is active. Recurses into
// \`children\` — every node in the tree carries its own translations.
// MUST mirror \`resolveCategoryTranslations\` in the e-commerce context.
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

export const useBlogCategories = () => {
  const router = useRouter()
  return useMemo(() => resolveCategoryTranslations(BLOG_CATEGORIES, router.locale), [router.locale])
}
`
}
