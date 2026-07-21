import type { UIDLEcommerceCategory } from '@teleporthq/teleport-types'
import { generateSharedTransformationCode } from './shared-utils'
import { generateBlogPostTransformationCode } from './blog-post'
import { generateEcommerceProductTransformationCode } from './ecommerce-product'

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
  categories?: UIDLEcommerceCategory[]
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
      return shared + generateEcommerceProductTransformationCode(categories)
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
  const variantEnrichment =
    type === 'ecommerce-product'
      ? `
  var variantsByProductId = {}
  try {
    var __variantPids = []
    for (var __i = 0; __i < records.length; __i++) {
      if (records[__i] && records[__i].id != null) __variantPids.push(records[__i].id)
    }
    variantsByProductId = await getVariantsMap(getClientFn, __variantPids)
  } catch (e) {
    // Variant enrichment is best-effort; flat products keep variants: [].
  }`
      : ''

  const variantOption =
    type === 'ecommerce-product' ? ', variantsByProductId: variantsByProductId' : ''

  return `
async function transformRecords(records, getClientFn, reqQuery) {
  var assetMap = {}
  try {
    assetMap = await getAssetMap(getClientFn)
  } catch (e) {
    // Asset resolution is best-effort; continue without it
  }${variantEnrichment}
  var currentLanguage = (reqQuery && reqQuery.lang) || null
  var mainLanguage = (reqQuery && reqQuery.mainLang) || null
  var options = { assetMap: assetMap, currentLanguage: currentLanguage, mainLanguage: mainLanguage${variantOption} }
  return ${transformFn}(records, options)
}
`
}
