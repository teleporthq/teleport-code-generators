import { generateSharedTransformationCode } from './shared-utils'
import { generateBlogPostTransformationCode } from './blog-post'
import { generateEcommerceProductTransformationCode } from './ecommerce-product'

export type TransformationType = 'blog-post' | 'ecommerce-product' | null

/**
 * Detects which transformation type to apply based on the table name.
 * Returns null if no transformation is needed.
 */
export const detectTransformationType = (tableName: string): TransformationType => {
  if (!tableName) {
    return null
  }
  const lower = tableName.toLowerCase()
  if (lower.includes('blog_posts') || lower.includes('blog-posts')) {
    return 'blog-post'
  }
  if (lower.includes('products')) {
    return 'ecommerce-product'
  }
  return null
}

/**
 * Returns the full transformation code (shared utils + specific transformer)
 * to be included in the generated data source fetcher file.
 * Returns empty string if no transformation is needed for this table.
 */
export const getTransformationCode = (tableName: string): string => {
  const type = detectTransformationType(tableName)
  if (!type) {
    return ''
  }

  const shared = generateSharedTransformationCode()

  switch (type) {
    case 'blog-post':
      return shared + generateBlogPostTransformationCode()
    case 'ecommerce-product':
      return shared + generateEcommerceProductTransformationCode()
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

  return `
async function transformRecords(records, getClientFn, reqQuery) {
  var assetMap = {}
  try {
    assetMap = await getAssetMap(getClientFn)
  } catch (e) {
    // Asset resolution is best-effort; continue without it
  }
  var currentLanguage = (reqQuery && reqQuery.lang) || null
  var mainLanguage = (reqQuery && reqQuery.mainLang) || null
  var options = { assetMap: assetMap, currentLanguage: currentLanguage, mainLanguage: mainLanguage }
  return ${transformFn}(records, options)
}
`
}
