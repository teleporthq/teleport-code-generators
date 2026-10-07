import type {
  GeneratorOptions,
  UIDLBlogSettings,
  UIDLAuthentication,
  UIDLEcommerceCategory,
} from '@teleporthq/teleport-types'
import { ContentTables, StorefrontTax, TableAccess } from '@teleporthq/teleport-shared'
import { generateSharedTransformationCode } from './shared-utils'
import { generateBlogPostTransformationCode } from './blog-post'
import { generateCustomPageTransformationCode } from './custom-page'
import {
  generateEcommerceProductTransformationCode,
  type EcommerceProductTransformOptions,
} from './ecommerce-product'
import { REQUEST_LOCALE_PARAM } from '../request-locale'
import {
  resolveContentLocalization,
  type ContentLocalization,
  type LocalizedProjectOptions,
} from '../content-localization'

export type { EcommerceProductTransformOptions }

/**
 * Everything a generated fetcher bakes in, for EITHER entity. One options object
 * because `getTransformationCode` is called with a table name and has to be able
 * to serve whichever transform that resolves to — the product fields are ignored
 * for a blog table and vice versa.
 */
/** What a content preset bakes into its post transform — see `UIDLBlogSettings`. */
export interface ContentPresetTransformSettings {
  categories?: UIDLEcommerceCategory[]
  headingAnchors?: boolean
  comments?: boolean
}

export interface EntityTransformOptions extends EcommerceProductTransformOptions {
  /**
   * The settings of every content preset, by preset key — the post transform
   * of a table reads its own preset's (`contentSettingsFor`). The `blog*`
   * fields below are the Blog's, kept for the callers that name them.
   */
  contentSettings?: Partial<Record<ContentTables.ContentPresetKey, ContentPresetTransformSettings>>
  /** Blog post-category taxonomy — see `blogSettings.categories`. */
  blogCategories?: UIDLEcommerceCategory[]
  /** Post content headings get ids and `#` links — see `blogSettings.headingAnchors`. */
  blogHeadingAnchors?: boolean
  /**
   * A post details fetch carries the post's approved comments — see
   * `blogSettings.comments`. Off, the comments table is never queried: a blog
   * without comments has no such table.
   */
  blogComments?: boolean
  /**
   * The languages the rows are stored in — absent for a single-language
   * project. The transform resolves every translatable field against the
   * request's locale (`?locale=es` → `es_name`, falling back to `name`), and
   * the fetcher matches and sorts translatable columns the same way.
   */
  localization?: ContentLocalization
  /**
   * Who may read a money table (gift cards, vouchers, their ledgers) from a
   * browser: the roles the generated admin panel admits. See
   * `TableAccess.resolveTrustedReaderRoles`.
   */
  trustedReaderRoles?: string[]
}

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
const contentPresetTransformSettings = (
  settings: UIDLBlogSettings | undefined
): ContentPresetTransformSettings => ({
  categories: settings?.categories,
  headingAnchors: settings?.headingAnchors === true,
  comments: settings?.comments === true,
})

/**
 * The settings the transform of `tableName` bakes in: its preset's entry in
 * `contentSettings`, or — for the Blog, and for a caller that only set the
 * `blog*` fields — those fields. Empty for a table no preset owns.
 */
export const contentSettingsFor = (
  options: Pick<
    EntityTransformOptions,
    'contentSettings' | 'blogCategories' | 'blogHeadingAnchors' | 'blogComments'
  >,
  tableName: string
): ContentPresetTransformSettings => {
  const role = ContentTables.contentTableRole(stripSchemaQualifier(tableName))
  if (!role) {
    return {}
  }
  const own = options.contentSettings?.[role.key]
  if (own) {
    return own
  }
  if (role.key === 'blog') {
    return {
      categories: options.blogCategories,
      headingAnchors: options.blogHeadingAnchors,
      comments: options.blogComments,
    }
  }
  return {}
}

export const buildProductTransformOptions = (
  options: Pick<
    GeneratorOptions,
    'ecommerceSettings' | 'invoiceSettings' | 'blogSettings' | 'helpCenterSettings' | 'auth'
  > &
    LocalizedProjectOptions & {
      /**
       * The SAME project authentication under the name a `ProjectUIDL` gives
       * it — the project plugins call this with the UIDL itself, where the
       * field is `authentication`, while a component plugin calls it with
       * `GeneratorOptions`, where it is `auth`. Reading only one of the two
       * left every fetcher emitted by the project plugins with an empty
       * trusted-reader list, i.e. a generated admin panel refused its own
       * money tables.
       */
      authentication?: UIDLAuthentication
    }
): EntityTransformOptions => ({
  categories: options.ecommerceSettings?.categories,
  contentSettings: {
    blog: contentPresetTransformSettings(options.blogSettings),
    help: contentPresetTransformSettings(options.helpCenterSettings),
  },
  blogCategories: options.blogSettings?.categories,
  blogHeadingAnchors: options.blogSettings?.headingAnchors === true,
  blogComments: options.blogSettings?.comments === true,
  storefrontTaxRate: StorefrontTax.resolveStorefrontTaxRate(options.invoiceSettings),
  allowBackorders: resolveAllowBackorders(options.ecommerceSettings),
  productPages: options.ecommerceSettings?.productPages,
  localization: resolveContentLocalization(options),
  trustedReaderRoles: TableAccess.resolveTrustedReaderRoles(options.auth || options.authentication),
})

export type TransformationType = 'blog-post' | 'ecommerce-product' | 'custom-page' | null

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
 * IMPORTANT: Only the real platform-managed tables (`teleport_products`, the
 * content presets' posts tables) are routed through the e-commerce/blog
 * view-model transforms. A previous loose substring match (`lower.includes('products')`)
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
  if (ContentTables.isContentPostsTable(bare)) {
    return 'blog-post'
  }
  if (bare === 'teleport_products') {
    return 'ecommerce-product'
  }
  if (bare === 'teleport_pages') {
    return 'custom-page'
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
  options: EntityTransformOptions = {}
): string => {
  const type = detectTransformationType(tableName)
  if (!type) {
    return ''
  }

  const shared = generateSharedTransformationCode()

  switch (type) {
    case 'blog-post': {
      const role = ContentTables.contentTableRole(stripSchemaQualifier(tableName))
      const settings = contentSettingsFor(options, tableName)
      return (
        shared +
        generateBlogPostTransformationCode({
          tables: role ? ContentTables.contentTablesByKey(role.key) : undefined,
          categories: settings.categories,
          headingAnchors: settings.headingAnchors,
        })
      )
    }
    case 'ecommerce-product':
      return shared + generateEcommerceProductTransformationCode(options)
    case 'custom-page':
      return shared + generateCustomPageTransformationCode()
    default:
      return ''
  }
}

/**
 * The request parameter that asks a transformed table for its rows AS STORED.
 *
 * The product, blog-post and custom-page transforms build a storefront view
 * model: camelCased keys, flags as `"true"`/`"false"` strings, derived fields,
 * and several columns left out altogether (a product's `discounts`,
 * `category_ids`, `download_limit`, …). A caller that WRITES the row back —
 * the generated admin's edit forms — needs the columns themselves: fed the view
 * model, its form showed a digital product as not digital, a gift card switch
 * ticked on a product that is not one, no discounts, and every save wrote the
 * missing columns back blank.
 *
 * ⛔ PAIRED with `ADMIN_RAW_ROWS_PARAM` in the GUI's
 * `mappers/domain-to-uidl/feature-detail-page-options.ts`, which bakes it into
 * the admin update pages' detail resource.
 */
export const RAW_ROWS_PARAM = 'rawRows'

/**
 * Returns the JavaScript expression that transforms the data array.
 * This expression assumes the data array variable is called `safeData`,
 * that `getClient` is available for asset resolution, and that `req` is in scope.
 * Returns null if no transformation is needed. A request carrying
 * `RAW_ROWS_PARAM` gets the stored rows instead (see `rawRecords`).
 */
export const getTransformExpression = (tableName: string): string | null => {
  if (!detectTransformationType(tableName)) {
    return null
  }
  return '(__tqWantsRawRows(req.query) ? await rawRecords(safeData, getClient) : await transformRecords(safeData, getClient, req.query))'
}

/**
 * The raw-rows mode every transformed table's fetcher carries: the rows as
 * stored, with one exception — a value that is an uploaded asset's ID, alone or
 * inside a JSON list column, becomes the URL the transform would have shown, so
 * an edit form's image previews keep working. Nothing else is renamed, derived
 * or dropped. The response cache keys on the query, so the two modes never
 * share an entry.
 */
const RAW_ROWS_CODE = `
function __tqWantsRawRows(query) {
  var flag = query ? query.${RAW_ROWS_PARAM} : undefined
  return flag === true || flag === 'true'
}

async function rawRecords(records, getClientFn) {
  if (!Array.isArray(records)) return []
  var assetMap = {}
  try {
    assetMap = await getAssetMap(getClientFn)
  } catch (e) {
    // Asset resolution is best-effort; the stored values pass through as they are.
  }
  return records.map(function(record) { return __tqResolveRowAssets(record, assetMap || {}) })
}

function __tqResolveRowAssets(record, assetMap) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record
  var out = {}
  for (var key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue
    out[key] = __tqResolveAssetValue(record[key], assetMap)
  }
  return out
}

function __tqIsAssetId(value, assetMap) {
  return typeof value === 'string' && value !== '' && Object.prototype.hasOwnProperty.call(assetMap, value)
}

function __tqResolveAssetValue(value, assetMap) {
  if (typeof value !== 'string' || !value) return value
  if (__tqIsAssetId(value, assetMap)) return resolveAssetUrl(value, assetMap)
  var trimmed = value.trim()
  if (trimmed.charAt(0) !== '[') return value
  var list
  try {
    list = JSON.parse(trimmed)
  } catch (e) {
    return value
  }
  if (!Array.isArray(list)) return value
  var changed = false
  var resolved = list.map(function(item) {
    if (!__tqIsAssetId(item, assetMap)) return item
    changed = true
    return resolveAssetUrl(item, assetMap)
  })
  return changed ? JSON.stringify(resolved) : value
}
`

/**
 * How many reviews a product page carries into its structured data.
 *
 * They are inlined TWICE — once into the page's props, once into the JSON-LD
 * script rendered from them — so this number is paid for in bytes on every
 * request. Five is what a review snippet shows; the rest are on the page itself,
 * fetched by the reviews section's own paginated query.
 */
export const REVIEWS_PER_PRODUCT = 5

/**
 * Returns the transform wrapper function code that handles asset map loading
 * and calls the appropriate transformer.
 * Returns empty string if no transformation is needed.
 *
 * The request's `locale` (see `REQUEST_LOCALE_PARAM`) is what every
 * translatable field resolves against; the MAIN locale it falls back to is a
 * project constant and is baked in from `options.localization` rather than
 * asked of every caller. Without a localization every row reads as before —
 * the base columns.
 */
export const getTransformWrapperCode = (
  tableName: string,
  options: Pick<EntityTransformOptions, 'localization' | 'blogComments' | 'contentSettings'> = {}
): string => {
  const type = detectTransformationType(tableName)
  if (!type) {
    return ''
  }

  const mainLanguageLiteral = JSON.stringify(options.localization?.mainLocale ?? null)

  const transformFn =
    type === 'blog-post'
      ? 'transformBlogPosts'
      : type === 'custom-page'
      ? 'transformCustomPages'
      : 'transformEcommerceProducts'

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
  // Declared OUTSIDE the try because the ratings lookup below reuses it. \`var\`
  // would hoist it anyway, but relying on that would make this block break
  // silently the day someone modernises it to \`let\`.
  var __variantPids = []
  try {
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
  }
  // The aggregate star rating for the same id set, in ONE more query. Reuses
  // __variantPids so a details page's related cards get their ratings from the
  // same round trip rather than one query per card.
  //
  // Unlike the variants map this stays {} on failure: "no rating to show" is
  // both the empty answer and the safe answer, so there is no unknown state for
  // a caller to reason about.
  var ratingsByProductId = {}
  try {
    ratingsByProductId = await getRatingsMap(getClientFn, __variantPids)
  } catch (e) {
    // Leaves the map empty — the star rows simply stay hidden.
  }
  // The individual reviews behind the stars, for the product page's JSON-LD.
  //
  // Gated on the SINGLE-RECORD heuristic, unlike the two lookups above. Those
  // feed something every card on the page draws; this feeds structured data,
  // which only a details page emits — and a listing of 24 products would
  // otherwise fetch and inline 120 review rows that nothing on it renders or
  // markup-references.
  var reviewsByProductId = {}
  if (Array.isArray(records) && records.length === 1) {
    try {
      reviewsByProductId = await getProductReviewsMap(getClientFn, __variantPids, ${REVIEWS_PER_PRODUCT})
    } catch (e) {
      // Best-effort; the product simply ships without review snippets.
    }
  }`
      : ''

  // `includeOptionDetail` uses the same single-record heuristic as the related
  // items: only the details page carries a product's full option tree.
  const variantOption =
    type === 'ecommerce-product'
      ? ', variantsByProductId: variantsByProductId, ratingsByProductId: ratingsByProductId, reviewsByProductId: reviewsByProductId, includeOptionDetail: Array.isArray(records) && records.length === 1'
      : ''

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
  // Custom pages have no related items and no variants: their transform only
  // normalises the row's SEO fields.
  const hasRelatedItems = type === 'blog-post' || type === 'ecommerce-product'
  const relatedMapVar = type === 'blog-post' ? 'relatedPostsById' : 'relatedProductsById'
  const relatedMapFn = type === 'blog-post' ? 'getRelatedPostsMap' : 'getRelatedProductsMap'
  const relatedEnrichment = hasRelatedItems
    ? `
  var ${relatedMapVar} = null
  if (Array.isArray(records) && records.length === 1) {
    try {
      ${relatedMapVar} = await ${relatedMapFn}(getClientFn, records)
    } catch (e) {
      // Best-effort; the related rail stays hidden behind its empty gate.
    }
  }`
    : ''
  const relatedOption = hasRelatedItems ? `, ${relatedMapVar}: ${relatedMapVar}` : ''

  // A post page's neighbours and comments, on the same single-record heuristic
  // as the related rail. The comments are only asked for when the blog takes
  // them — see `EntityTransformOptions.blogComments`.
  const blogPageEnrichment =
    type === 'blog-post'
      ? `
  var adjacentPostsById = null
  var commentsByPostId = null
  if (Array.isArray(records) && records.length === 1) {
    try {
      adjacentPostsById = await getAdjacentPostsMap(getClientFn, records)
    } catch (e) {
      // Best-effort; the post navigation stays hidden.
    }${
      contentSettingsFor(options, tableName).comments === true
        ? `
    try {
      commentsByPostId = await getBlogCommentsMap(getClientFn, records)
    } catch (e) {
      // Best-effort; the post renders without comments.
    }`
        : ''
    }
  }`
      : ''
  const blogPageOption =
    type === 'blog-post'
      ? ', adjacentPostsById: adjacentPostsById, commentsByPostId: commentsByPostId'
      : ''

  return `${RAW_ROWS_CODE}
async function transformRecords(records, getClientFn, reqQuery) {
  var assetMap = {}
  try {
    assetMap = await getAssetMap(getClientFn)
  } catch (e) {
    // Asset resolution is best-effort; continue without it
  }${relatedEnrichment}${blogPageEnrichment}${variantEnrichment}
  var currentLanguage = reqQuery && typeof reqQuery.${REQUEST_LOCALE_PARAM} === 'string' && reqQuery.${REQUEST_LOCALE_PARAM} ? reqQuery.${REQUEST_LOCALE_PARAM} : null
  var options = { assetMap: assetMap, currentLanguage: currentLanguage, mainLanguage: ${mainLanguageLiteral}${variantOption}${relatedOption}${blogPageOption} }
  return ${transformFn}(records, options)
}
`
}
