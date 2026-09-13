import type { UIDLEcommerceCategory } from '@teleporthq/teleport-types'

/**
 * The category-taxonomy half of the entity transforms, shared by products and
 * blog posts.
 *
 * A taxonomy has no DB table — it lives only in the UIDL
 * (`ecommerceSettings.categories` / `blogSettings.categories`, baked at export
 * time), so each generated fetcher carries its own flattened copy and resolves
 * the row's `category_ids` against it with no runtime lookup.
 */

/** What the runtime map holds per category id. */
export interface BakedCategoryInfo {
  name: string
  slug: string
  translations?: UIDLEcommerceCategory['translations']
}

/**
 * Flattens the nested category tree into an `id -> {name, slug, translations}`
 * lookup map. `translations` is carried through UNRESOLVED (a per-language
 * `{name, description}` map) so the transform can resolve it against the SAME
 * per-request `currentLanguage`/`mainLanguage` used for every other i18n field —
 * `slug` is never localized (it is the language-neutral join key). Tolerant of a
 * missing/malformed tree.
 */
export const flattenCategoriesById = (
  categories: UIDLEcommerceCategory[] | undefined
): Record<string, BakedCategoryInfo> => {
  const byId: Record<string, BakedCategoryInfo> = {}
  const visit = (nodes: UIDLEcommerceCategory[] | undefined): void => {
    if (!Array.isArray(nodes)) {
      return
    }
    for (const node of nodes) {
      if (node && typeof node.id === 'string') {
        byId[node.id] = {
          name: node.name || '',
          slug: node.slug || '',
          translations: node.translations,
        }
        visit(node.children)
      }
    }
  }
  visit(categories)
  return byId
}

/**
 * The baked map plus the `resolveCategoryName` helper the transforms call.
 * Emitted once per fetcher file — the two entity transforms are never
 * concatenated into the same file (`getTransformationCode` picks one per table),
 * so the helper name is unambiguous.
 */
export const generateCategoryTaxonomyCode = (
  mapVarName: string,
  categories: UIDLEcommerceCategory[] | undefined
): string => `
// Category taxonomy (id -> {name, slug, translations}), baked in at export
// time — see flattenCategoriesById in category-taxonomy.ts. Empty when the
// project has no taxonomy, or the row's category_ids simply resolve to nothing.
var ${mapVarName} = ${JSON.stringify(flattenCategoriesById(categories))}

// Resolve a baked category's name to currentLang/mainLang from its
// translations map (same per-request locale as every other i18n field via
// resolveI18nField), falling back to the main-language name.
function resolveCategoryName(categoryInfo, currentLang, mainLang) {
  if (currentLang && mainLang && currentLang !== mainLang && categoryInfo.translations) {
    var override = categoryInfo.translations[currentLang]
    if (override && override.name) return override.name
  }
  return categoryInfo.name
}

// The row's assigned category ids -> resolved {id, name, slug} objects, in the
// order they were assigned. Ids that resolve to nothing (a deleted category) are
// silently dropped. MUST mirror resolveAssignedCategories in the editor
// (teleport-gui features/shared/taxonomy/category-tree.ts), which is what the
// canvas renders from.
function resolveAssignedCategories(categoryIdsRaw, byId, currentLang, mainLang, legacyName) {
  var ids = parseJsonArray(categoryIdsRaw)
  var out = []
  for (var ci = 0; ci < ids.length; ci++) {
    var info = byId[ids[ci]]
    if (!info) continue
    out.push({
      id: ids[ci],
      name: resolveCategoryName(info, currentLang, mainLang),
      slug: info.slug,
    })
  }
  // A row that predates the id column, or one imported with only a name, still
  // shows what it carries — with an EMPTY id, so a filter link built from it
  // carries no value and every listing reads that as "no filter".
  if (out.length === 0 && typeof legacyName === 'string' && legacyName.trim()) {
    var trimmed = legacyName.trim()
    out.push({
      id: '',
      name: trimmed,
      slug: trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'category',
    })
  }
  return out
}
`
