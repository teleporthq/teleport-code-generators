import type { GeneratorOptions } from '@teleporthq/teleport-types'
import { StorefrontTax } from '@teleporthq/teleport-shared'
import { generateSharedTransformationCode } from './shared-utils'
import { generateBlogPostTransformationCode } from './blog-post'
import {
  generateEcommerceProductTransformationCode,
  type EcommerceProductTransformOptions,
} from './ecommerce-product'

export type { EcommerceProductTransformOptions }

/**
 * Stock never gates purchasability when the merchant disabled stock management
 * entirely or opted into backorders. Mirrors the GUI rule in
 * `apps/gui/app/project-page/features/e-commerce/utils/product-variants.ts`
 * (`isVariantInStock`). A project without e-commerce settings keeps the
 * strict default (stock gates apply) — same behaviour as before the flag.
 */
const resolveAllowBackorders = (
  settings: GeneratorOptions['ecommerceSettings'] | undefined
): boolean => {
  if (!settings) {
    return false
  }
  return !settings.stockManagement || settings.stockManagementConfig?.allowBackorders === true
}

/**
 * Collects everything the product transform bakes in from the generator
 * options, in ONE place so every fetcher-emitting call site stays in step.
 *
 * `storefrontTaxRate` is what turns a NET catalogue price into the price the
 * shopper is quoted; `resolveStorefrontTaxRate` returns 0 (a no-op) for
 * tax-inclusive or untaxed stores. `allowBackorders` is the effective
 * "stock never blocks a purchase" flag — see `resolveAllowBackorders`.
 */
export const buildProductTransformOptions = (
  options: Pick<GeneratorOptions, 'ecommerceSettings' | 'invoiceSettings'>
): EcommerceProductTransformOptions => ({
  categories: options.ecommerceSettings?.categories,
  storefrontTaxRate: StorefrontTax.resolveStorefrontTaxRate(options.invoiceSettings),
  allowBackorders: resolveAllowBackorders(options.ecommerceSettings),
})

export type TransformationType = 'blog-post' | 'ecommerce-product' | null

/**
 * Strips a leading `schema.` qualifier from a table name so that only the
 * bare table identifier remains (e.g. `public.teleport_products` ->
 * `teleport_products`). Returns the lowercased, unquoted bare table name.
 */
const stripSchemaQualifier = (tableName: string): string => {
  const lower = tableName.toLowerCase().trim()
  const lastDot = lower.lastIndexOf('.')
  const bare = lastDot >= 0 ? lower.slice(lastDot + 1) : lower
  // Remove any surrounding quoting/backticks a qualifier may carry.
  return bare.replace(/["'`]/g, '')
}

/**
 * Detects which transformation type to apply based on the table name.
 * Returns null if no transformation is needed.
 *
 * IMPORTANT: Only the real platform-managed tables (`teleport_products`,
 * `teleport_blog_posts`) are routed through the e-commerce/blog view-model
 * transforms. A previous loose substring match (`lower.includes('products')`)
 * incorrectly routed CUSTOM tables such as `products`, `store_products` or
 * `wholesale_products` through `buildEcommerceProduct`, which emits a fixed set
 * of platform product fields and silently drops all custom columns. Matching the
 * exact platform table name prevents that data loss.
 */
export const detectTransformationType = (tableName: string): TransformationType => {
  if (!tableName) {
    return null
  }
  const bare = stripSchemaQualifier(tableName)
  if (bare === 'teleport_blog_posts') {
    return 'blog-post'
  }
  if (bare === 'teleport_products') {
    return 'ecommerce-product'
  }
  return null
}

/**
 * Returns the full transformation code (shared utils + specific transformer)
 * to be included in the generated data source fetcher file.
 * Returns empty string if no transformation is needed for this table.
 */
export const getTransformationCode = (
  tableName: string,
  options: EcommerceProductTransformOptions = {}
): string => {
  const type = detectTransformationType(tableName)
  if (!type) {
    return ''
  }

  const shared = generateSharedTransformationCode()

  switch (type) {
    case 'blog-post':
      return shared + generateBlogPostTransformationCode()
    case 'ecommerce-product':
      return shared + generateEcommerceProductTransformationCode(options)
    default:
      return ''
  }
}

/**
 * Returns the JavaScript expression that transforms the data array.
 * This expression assumes the data array variable is called `safeData`,
 * that `getClient` is available for asset resolution, and that `req` is in scope.
 * Returns null if no transformation is needed.
 */
export const getTransformExpression = (tableName: string): string | null => {
  const type = detectTransformationType(tableName)
  if (!type) {
    return null
  }

  switch (type) {
    case 'blog-post':
      return 'await transformRecords(safeData, getClient, req.query)'
    case 'ecommerce-product':
      return 'await transformRecords(safeData, getClient, req.query)'
    default:
      return null
  }
}

/**
 * Returns the transform wrapper function code that handles asset map loading
 * and calls the appropriate transformer.
 * Returns empty string if no transformation is needed.
 */
export const getTransformWrapperCode = (tableName: string): string => {
  const type = detectTransformationType(tableName)
  if (!type) {
    return ''
  }

  const transformFn = type === 'blog-post' ? 'transformBlogPosts' : 'transformEcommerceProducts'

  // Products additionally get their purchasable variant combinations attached in
  // ONE batched query (keyed by product id). Blog posts have no such enrichment.
  //
  // ⛔ The map starts as NULL and stays null when the query cannot run. The
  // transform reads null as "combinations unknown" and keeps every picker
  // selectable; a `{}` would mean "the lookup ran and this catalogue has none",
  // which strikes out every value and hides every buy button. A transient DB
  // failure must not be able to say that.
  //
  // Runs AFTER the related-items lookup so the related rows — which the details
  // page draws as real product cards, each with its own picker — get their
  // combinations from the SAME query instead of transforming as variant-less.
  const variantEnrichment =
    type === 'ecommerce-product'
      ? `
  var variantsByProductId = null
  try {
    var __variantPids = []
    for (var __i = 0; __i < records.length; __i++) {
      if (records[__i] && records[__i].id != null) __variantPids.push(records[__i].id)
    }
    if (relatedProductsById) {
      for (var __rk in relatedProductsById) {
        if (!Object.prototype.hasOwnProperty.call(relatedProductsById, __rk)) continue
        // The ROW's own id, not the map key: the key was stringified when the map
        // was built, and a query parameter array of mixed types is one the driver
        // cannot type against the product_id column.
        var __rrow = relatedProductsById[__rk]
        if (__rrow && __rrow.id != null) __variantPids.push(__rrow.id)
      }
    }
    variantsByProductId = await getVariantsMap(getClientFn, __variantPids)
  } catch (e) {
    // Leaves the map null — "unknown", never "none".
  }`
      : ''

  const variantOption =
    type === 'ecommerce-product' ? ', variantsByProductId: variantsByProductId' : ''

  // Related items are resolved for a SINGLE-record fetch only — which is the
  // details page, the one surface that renders them (it looks the row up by
  // slug). A listing fetch returns many rows, and resolving there would run an
  // extra query and then inline up to four fully-transformed entities PER CARD
  // into __NEXT_DATA__ that nothing on that page draws. The canvas renderer
  // draws the same line for the same reason: only the details-page item node
  // passes a resolver.
  //
  // A one-product store's listing does pay for one extra query. That is the
  // whole cost of the heuristic, and it beats plumbing a page-role flag through
  // every fetcher.
  const relatedMapVar = type === 'blog-post' ? 'relatedPostsById' : 'relatedProductsById'
  const relatedMapFn = type === 'blog-post' ? 'getRelatedPostsMap' : 'getRelatedProductsMap'
  const relatedEnrichment = `
  var ${relatedMapVar} = null
  if (Array.isArray(records) && records.length === 1) {
    try {
      ${relatedMapVar} = await ${relatedMapFn}(getClientFn, records)
    } catch (e) {
      // Best-effort; the related rail stays hidden behind its empty gate.
    }
  }`

  return `
async function transformRecords(records, getClientFn, reqQuery) {
  var assetMap = {}
  try {
    assetMap = await getAssetMap(getClientFn)
  } catch (e) {
    // Asset resolution is best-effort; continue without it
  }${relatedEnrichment}${variantEnrichment}
  var currentLanguage = (reqQuery && reqQuery.lang) || null
  var mainLanguage = (reqQuery && reqQuery.mainLang) || null
  var options = { assetMap: assetMap, currentLanguage: currentLanguage, mainLanguage: mainLanguage${variantOption}, ${relatedMapVar}: ${relatedMapVar} }
  return ${transformFn}(records, options)
}
`
}
