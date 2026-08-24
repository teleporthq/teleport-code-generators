import type { UIDLEcommerceCategory } from '@teleporthq/teleport-types'
import { StorefrontTax } from '@teleporthq/teleport-shared'

/**
 * Everything the product transform needs baked in at export time, beyond the
 * row itself. An options OBJECT rather than positional parameters: the list has
 * already grown twice and every caller in the chain has to forward it verbatim.
 */
export interface EcommerceProductTransformOptions {
  /** Category taxonomy — lives only in the UIDL, there is no DB table for it. */
  categories?: UIDLEcommerceCategory[]
  /**
   * Percentage to ADD on top of every stored (NET) price for DISPLAY, or 0.
   * Resolved by the caller through `StorefrontTax.resolveStorefrontTaxRate`.
   */
  storefrontTaxRate?: number
}

/**
 * Flattens the nested category tree (`ecommerceSettings.categories`, baked at
 * export time) into an `id -> {name, slug, translations}` lookup map,
 * JSON-embedded into the generated transform below so a product's
 * `category_ids` can be resolved to display names with no runtime DB lookup
 * (there is no DB table for the taxonomy — it lives only in the UIDL).
 * `translations` is carried through unresolved (a per-language `{name,
 * description}` map) so `buildEcommerceProduct` can resolve it against the
 * SAME per-request `currentLanguage`/`mainLanguage` used for every other i18n
 * field — `slug` is never localized (it's the language-neutral join key).
 * Tolerant of a missing/malformed tree.
 */
const flattenCategoriesById = (
  categories: UIDLEcommerceCategory[] | undefined
): Record<
  string,
  { name: string; slug: string; translations?: UIDLEcommerceCategory['translations'] }
> => {
  const byId: Record<
    string,
    { name: string; slug: string; translations?: UIDLEcommerceCategory['translations'] }
  > = {}
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
 * Generates JavaScript code for e-commerce product data transformation.
 * Transforms raw snake_case database records into the camelCase shape
 * that UIDL components expect.
 */
export const generateEcommerceProductTransformationCode = (
  options: EcommerceProductTransformOptions = {}
): string => {
  const categoriesByIdJson = JSON.stringify(flattenCategoriesById(options.categories))
  const taxHelperCode = StorefrontTax.generateStorefrontTaxHelperCode(
    options.storefrontTaxRate ?? 0
  )

  return `
${taxHelperCode}

// Category taxonomy (id -> {name, slug, translations}), baked in at export
// time — see flattenCategoriesById in ecommerce-product.ts. Empty when the
// store has no category taxonomy, or products.category_ids simply resolves
// to nothing.
var PRODUCT_CATEGORIES_BY_ID = ${categoriesByIdJson}

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

// ============================================================
// E-Commerce Product Transformation
// ============================================================

function buildEcommerceProduct(record, options) {
  if (!record || typeof record !== 'object') return record
  options = options || {}
  var currentLang = options.currentLanguage || null
  var mainLang = options.mainLanguage || null
  var assetMap = options.assetMap || {}

  var id = record.id !== undefined && record.id !== null ? record.id : null

  // i18n-resolved text fields
  var name = resolveI18nField(record, 'name', 'name', currentLang, mainLang) || ''
  var slug = resolveI18nField(record, 'slug', 'slug', currentLang, mainLang) || ''
  var description = resolveI18nField(record, 'description', 'description', currentLang, mainLang) || ''
  var category = resolveI18nField(record, 'category', 'category', currentLang, mainLang) || null
  var tagsRaw = resolveI18nField(record, 'tags', 'tags', currentLang, mainLang)
  var imageAlt = resolveI18nField(record, 'image_alt', 'imageAlt', currentLang, mainLang) || null

  // Computed: plain-text description (HTML stripped)
  var descriptionText = stripHtmlTags(description)

  // Numeric fields (with NaN protection)
  var price = safeNumber(record.price, 0)
  var quantity = safeNumber(record.quantity, null)

  // Currency
  var currency = (record.currency || 'USD').toUpperCase()
  var rawCurrencySymbol = pickFirst(record.currency_symbol, record.currencySymbol)
  var currencySymbol = rawCurrencySymbol || getCurrencySymbol(currency)

  // Status and active (normalize case — DB / forms may send "Active", "Inactive", etc.)
  var statusRaw = record.status
  if (statusRaw == null || statusRaw === '') {
    statusRaw = record.active ? 'active' : 'inactive'
  }
  var status =
    typeof statusRaw === 'string'
      ? statusRaw.trim().toLowerCase()
      : String(statusRaw).toLowerCase()
  var active = status === 'active'

  // Payment fields
  var paymentType = pickFirst(record.payment_type, record.paymentType) || 'one_time'
  var recurringInterval = pickFirst(record.recurring_interval, record.recurringInterval) || null
  var rawRecurringCount = pickFirst(record.recurring_interval_count, record.recurringIntervalCount)
  var recurringIntervalCount = safeNumber(rawRecurringCount, null)

  // Physical product fields
  var sku = record.sku || null
  var weight = safeNumber(record.weight, null)
  var weightUnit = pickFirst(record.weight_unit, record.weightUnit) || null
  var dimensions = record.dimensions || null

  // Tags - parse as JSON array (handles JSON strings, arrays, comma-separated)
  var tags = parseJsonArray(tagsRaw)

  // Variant AXES (translatable). The i18n-resolved column already carries the
  // display labels for the current language (with the SAME stable keys as the
  // base column); we just parse + normalize. The purchasable combinations live
  // in teleport_product_variants and are fetched by the variant picker widget.
  var variantOptionsRaw = resolveI18nField(record, 'variant_options', 'variantOptions', currentLang, mainLang)
  var variantOptions = normalizeVariantOptions(variantOptionsRaw)
  // Emitted as a STRING ('true'/'false') to match the strict-equality checks the
  // storefront uses (same convention as outOfStock).
  var requiresVariantSelection = variantOptions.length > 0 ? 'true' : 'false'

  // Provider fields
  var providerType = pickFirst(record.provider_type, record.providerType) || null
  var providerProductId = pickFirst(record.provider_product_id, record.providerProductId) || null
  var defaultPrice = pickFirst(record.default_price, record.defaultPrice) || null

  // Metadata
  var metadata = parseJsonObject(record.metadata)

  // Visible custom properties -> [{key,value,kind,color,imageUrl}] for the
  // storefront pills mapper. MUST mirror buildVisibleProductProperties /
  // classifyProductProperty in
  // apps/gui/app/project-page/features/e-commerce/utils/product-property-display.ts
  // (the canvas-preview SSOT) field-for-field: same reserved-key exclusions,
  // same default-VISIBLE (opt-out) rule, same color/image classification. A
  // property is shown unless it is a reserved key, has an empty value, or is
  // explicitly hidden (false) in the _tqPropVisibility map -- so it also
  // renders for products whose form was never opened (no visibility map yet).
  var propVisibility = parseJsonObject(metadata._tqPropVisibility)
  var visibleProperties = []
  Object.keys(metadata).forEach(function (propKey) {
    if (isReservedProductMetadataKey(propKey)) return
    if (propVisibility[propKey] === false) return
    var rawValue = metadata[propKey]
    if (rawValue == null) return
    var propValue = String(rawValue)
    if (propValue.trim() === '') return
    visibleProperties.push(classifyProductProperty(propKey, propValue))
  })

  // Assigned category ids -> resolved {id,name,slug} objects for the
  // storefront category pills mapper. The taxonomy itself is not in the DB
  // (categories are authored in the GUI and live only in
  // ecommerceSettings.categories); resolved here against PRODUCT_CATEGORIES_BY_ID,
  // baked in at export time (see flattenCategoriesById). Unknown/stale ids
  // (a deleted category) are silently dropped.
  var categoryIds = parseJsonArray(record.category_ids)
  var categories = []
  for (var ci = 0; ci < categoryIds.length; ci++) {
    var categoryInfo = PRODUCT_CATEGORIES_BY_ID[categoryIds[ci]]
    if (categoryInfo) {
      categories.push({
        id: categoryIds[ci],
        name: resolveCategoryName(categoryInfo, currentLang, mainLang),
        slug: categoryInfo.slug,
      })
    }
  }

  // Purchasable variant COMBINATIONS for this product ({id, options map, price,
  // stock, image}). Empty for flat products. Fetched in ONE batched query by
  // transformRecords and passed in via options.variantsByProductId, keyed by
  // product id. The storefront card/details read these to default-select the
  // first in-stock variant, disable dead options, and resolve the chosen id.
  //
  // NULL (not {}) means the lookup could not run — the table is missing, or the
  // query failed. That is "combinations UNKNOWN", which is NOT "this product has
  // none": a transient DB failure must never turn every variant product in the
  // catalogue into an unbuyable one. See hasPurchasableVariant below.
  var variantsResolved = options.variantsByProductId != null
  var variantsByProductId = options.variantsByProductId || {}
  var rawVariants = variantsByProductId[id] || []
  var variants = []
  for (var vi = 0; vi < rawVariants.length; vi++) {
    var vrow = rawVariants[vi] || {}
    var vopts = parseJsonObject(vrow.options)
    variants.push({
      id: vrow.id != null ? String(vrow.id) : '',
      options: vopts && typeof vopts === 'object' ? vopts : {},
      price: safeNumber(vrow.price, null),
      quantity: safeNumber(vrow.quantity, null),
      image_url: vrow.image_url ? resolveAssetUrl(vrow.image_url, assetMap) : null,
    })
  }

  // The merchant's related-product picks. \`relatedProducts\` carries the
  // TRANSFORMED rows, not ids, so the details page's related-products rail can
  // map over it and draw a product card per entry; \`relatedProductIds\` keeps
  // the raw selection for anything that wants it. The rows arrive from ONE
  // batched query (getRelatedProductsMap) that transformRecords runs, keyed by
  // id in options.relatedProductsById.
  //
  // MUST mirror buildRelatedEcommerceProducts in
  // packages/renderer/src/utils/ecommerce-products.ts (the canvas-preview SSOT):
  // the merchant's order, inactive products dropped, self dropped, and the
  // nested build deliberately WITHOUT the map — two products referencing each
  // other is the normal case (they are each other's accessories) and threading
  // the map through would recurse until the stack ran out.
  var relatedProductIds = parseRelatedIds(record.related_product_ids)
  var relatedProductsById = options.relatedProductsById
  var relatedProducts = []
  if (relatedProductsById && relatedProductIds.length > 0) {
    var relatedNestedOptions = {
      assetMap: assetMap,
      currentLanguage: currentLang,
      mainLanguage: mainLang,
      // Passed through UNCOALESCED so a related product inherits the same
      // known/unknown answer as its parent — \`|| {}\` here would tell the nested
      // build "the lookup ran and found nothing" and strike out every related
      // card's picker. The batched query includes the related ids for exactly
      // this reason (see getTransformWrapperCode).
      variantsByProductId: options.variantsByProductId,
    }
    for (var rp = 0; rp < relatedProductIds.length; rp++) {
      var relatedId = relatedProductIds[rp]
      if (id != null && relatedId === String(id)) continue
      var relatedRecord = relatedProductsById[relatedId]
      if (!relatedRecord) continue
      // A product taken off sale must not come back through the back door on
      // every product that references it. Missing status reads as active, the
      // same default the main status normalization uses above.
      var relatedStatusRaw = relatedRecord.status
      var relatedStatus =
        relatedStatusRaw == null || relatedStatusRaw === ''
          ? 'active'
          : String(relatedStatusRaw).trim().toLowerCase()
      if (relatedStatus !== 'active') continue
      relatedProducts.push(buildEcommerceProduct(relatedRecord, relatedNestedOptions))
    }
  }

  // -------------------------------------------------------
  // Image resolution (complex multi-step process)
  // -------------------------------------------------------

  // Step 1: Get raw image values
  var rawImageUrl = pickFirst(record.image_url, record.mainImage, record.imageUrl)
  var rawGalleryImages = pickFirst(record.gallery_images, record.galleryImages)
  var legacyImages = Array.isArray(record.images)
    ? record.images.filter(function(v) { return typeof v === 'string' })
    : []

  // Step 2: Parse gallery images from JSON
  var parsedGalleryImages = parseJsonArray(rawGalleryImages)

  // Step 3: Build combined raw images array
  var allRawImages = []
  if (rawImageUrl) allRawImages.push(rawImageUrl)
  allRawImages = allRawImages.concat(parsedGalleryImages).concat(legacyImages)

  // Step 4: Resolve all asset URLs first, then deduplicate
  var resolvedAll = resolveAssetUrls(allRawImages, assetMap)
  var resolvedImages = deduplicateStrings(resolvedAll)

  // Step 5: Determine mainImage
  var mainImage = rawImageUrl
    ? resolveAssetUrl(rawImageUrl, assetMap)
    : (resolvedImages.length > 0 ? resolvedImages[0] : null)

  // Step 6: galleryImages = resolvedImages without mainImage
  var galleryImages = mainImage
    ? resolvedImages.filter(function(url) { return url !== mainImage })
    : resolvedImages.slice()

  // Step 7: images = full resolved deduplicated array
  var images = resolvedImages

  // Timestamps
  var rawCreatedAt = pickFirst(record.created_at, record.createdAt, record.created)
  var createdAt = normalizeTimestamp(rawCreatedAt)

  var rawUpdatedAt = pickFirst(record.updated_at, record.updatedAt, record.updated)
  var updatedAt = rawUpdatedAt != null ? normalizeTimestamp(rawUpdatedAt) : createdAt

  // Computed: created = Unix seconds
  var created = Math.floor(createdAt / 1000)

  // Computed: outOfStock (emitted as a STRING — 'true' / 'false' — so it
  // matches the strict equality check the AI generates on product
  // cards/details pages: \`ecommerceProduct?.outOfStock === 'true'\`.
  // A boolean here would silently fail that comparison (boolean !==
  // string), leaving the Add to Cart button visible on out-of-stock
  // products. NULL/NaN quantity → 'false' (treated as "unlimited
  // stock", same as the upstream cart-availability rewriter).
  var outOfStock = (quantity !== null && !isNaN(quantity) && quantity <= 0) ? 'true' : 'false'

  // Per-value availability + default-selection flags, derived from the
  // purchasable combinations, so the storefront picker renders its
  // Default / Selected / Unavailable states with NO runtime fetch. The card
  // (N instances) first-paints from these data flags; the details page seeds
  // its selection from the same combinations. axisValueKey (axisKey|valueKey)
  // disambiguates same-named values across axes (Size "s" vs Sleeve "s").
  // Emitted as STRINGS to match the storefront's string-equality convention.
  var variantAxisKeys = []
  for (var ak = 0; ak < variantOptions.length; ak++) { variantAxisKeys.push(variantOptions[ak].key) }
  var firstVariant = pickFirstAvailableVariant(variants, variantAxisKeys)
  var deadValueKeys = computeDeadVariantKeys(variants, variantOptions, variantsResolved)
  for (var ai = 0; ai < variantOptions.length; ai++) {
    var vax = variantOptions[ai]
    for (var vj = 0; vj < vax.values.length; vj++) {
      var vval = vax.values[vj]
      var composite = vax.key + '|' + vval.value
      vval.axisValueKey = composite
      vval.isDead = deadValueKeys[composite] ? 'true' : 'false'
      vval.isDefault =
        firstVariant && firstVariant.options && firstVariant.options[vax.key] === vval.value
          ? 'true'
          : 'false'
      // Whether THIS value renders as a colour swatch vs a text pill. A colour
      // axis whose value has no resolvable colour degrades to a text pill so it
      // is never an invisible empty circle. Emitted as a string to match the
      // picker's string-equality rendering gate. MUST mirror the renderer
      // enrichment in packages/renderer/src/utils/ecommerce-products.ts.
      vval.showSwatch = vax.type === 'color' && vval.color ? 'true' : 'false'
    }
  }
  // The combination the picker auto-selects on first paint: the first in-stock
  // one covering every axis. Absent means there is nothing the shopper could add
  // without choosing — which is what gates the buy button below.
  var hasInStockCombination = !!(firstVariant && isVariantInStock(firstVariant))
  var defaultVariantId = hasInStockCombination ? firstVariant.id : ''
  var defaultVariantPrice = firstVariant ? formatVariantPrice(firstVariant.price, price) : ''
  // Gross (tax-inclusive) counterparts of the three price fields the STOREFRONT
  // renders. \`price\` / \`defaultVariantPrice\` / \`variantsJson\` deliberately stay
  // NET: the same transform feeds the merchant's admin panel, and every write
  // path (add-to-cart, checkout, the invoice route) re-reads the raw row and
  // must keep seeing the price the merchant typed. Only these three are safe to
  // gross, because nothing writes them back.
  //
  // MUST mirror packages/renderer/src/utils/ecommerce-products.ts.
  var displayPrice = grossMoney(price)
  var defaultVariantDisplayPrice = firstVariant
    ? grossMoney(formatVariantPrice(firstVariant.price, price))
    : ''
  var variantsDisplay = []
  for (var dv = 0; dv < variants.length; dv++) {
    var dvRow = variants[dv]
    variantsDisplay.push({
      id: dvRow.id,
      options: dvRow.options,
      // A null variant price INHERITS the product price, so gross the RESOLVED
      // value — otherwise an inheriting combination would fall back to the net
      // base price in the picker while an overriding one showed gross.
      price: applyStorefrontTax(dvRow.price == null ? price : dvRow.price),
      quantity: dvRow.quantity,
      image_url: dvRow.image_url,
    })
  }
  // Can this product be added to the cart at all, before the shopper touches the
  // picker? A STRING, same convention as outOfStock/requiresVariantSelection.
  //
  //   flat product         -> 'true'  (stock is governed by outOfStock)
  //   combinations UNKNOWN -> 'true'  (the lookup could not run; a transient DB
  //                                    failure must never make a whole catalogue
  //                                    unbuyable — same permissive rule as
  //                                    dead-marking)
  //   otherwise            -> whether an in-stock combination covering every axis
  //                           exists. 'false' therefore covers BOTH "every
  //                           combination is sold out" AND "the axes have no
  //                           combinations at all" — to a shopper those are the
  //                           same thing: there is no size to pick.
  //
  // MUST mirror packages/renderer/src/utils/ecommerce-products.ts.
  var hasPurchasableVariant =
    (requiresVariantSelection !== 'true' || !variantsResolved || hasInStockCombination)
      ? 'true'
      : 'false'
  // Stringified companions: a data-* attr bound to an ARRAY renders
  // '[object Object]', so the picker's on-mount/click workflows read the
  // combinations + axes from these JSON strings via getAttribute.
  var variantOptionsJson = safeStringifyJson(variantOptions)
  var variantsJson = safeStringifyJson(variants)
  var variantsDisplayJson = safeStringifyJson(variantsDisplay)

  return {
    id: id,
    name: name,
    slug: slug,
    description: description,
    descriptionText: descriptionText,
    price: price,
    currency: currency,
    currencySymbol: currencySymbol,
    status: status,
    active: active,
    quantity: quantity,
    paymentType: paymentType,
    recurringInterval: recurringInterval,
    recurringIntervalCount: recurringIntervalCount,
    sku: sku,
    weight: weight,
    weightUnit: weightUnit,
    dimensions: dimensions,
    category: category,
    categories: categories,
    tags: tags,
    relatedProductIds: relatedProductIds,
    relatedProducts: relatedProducts,
    imageAlt: imageAlt,
    providerType: providerType,
    providerProductId: providerProductId,
    default_price: defaultPrice,
    metadata: metadata,
    visibleProperties: visibleProperties,
    mainImage: mainImage,
    imageUrl: mainImage,
    image_url: mainImage,
    galleryImages: galleryImages,
    images: images,
    createdAt: createdAt,
    updatedAt: updatedAt,
    created: created,
    outOfStock: outOfStock,
    variantOptions: variantOptions,
    requiresVariantSelection: requiresVariantSelection,
    variants: variants,
    variantOptionsJson: variantOptionsJson,
    variantsJson: variantsJson,
    variantsDisplayJson: variantsDisplayJson,
    defaultVariantId: defaultVariantId,
    defaultVariantPrice: defaultVariantPrice,
    displayPrice: displayPrice,
    defaultVariantDisplayPrice: defaultVariantDisplayPrice,
    hasPurchasableVariant: hasPurchasableVariant,
  }
}

// --- Variant availability helpers (mirror packages/renderer ecommerce-products) ---
// A variant is in stock when its quantity is null (unlimited) or > 0.
function isVariantInStock(v) {
  return !v ? false : v.quantity == null || v.quantity > 0
}
function variantCoversAllAxes(v, axisKeys) {
  if (!v || !v.options) return false
  for (var i = 0; i < axisKeys.length; i++) {
    if (v.options[axisKeys[i]] == null) return false
  }
  return true
}
// First in-stock combination covering every axis; falls back to the first
// covering combination (even if OOS) so a fully-OOS product still has a
// visual default; null when no combination covers the axes.
function pickFirstAvailableVariant(variants, axisKeys) {
  if (!Array.isArray(variants) || !axisKeys.length) return null
  for (var i = 0; i < variants.length; i++) {
    if (variantCoversAllAxes(variants[i], axisKeys) && isVariantInStock(variants[i])) return variants[i]
  }
  for (var j = 0; j < variants.length; j++) {
    if (variantCoversAllAxes(variants[j], axisKeys)) return variants[j]
  }
  return null
}
// Map of composite "axisKey|valueKey" -> true for every value that appears in
// NO in-stock combination (rendered as the Unavailable state).
//
// variantsResolved is the whole subtlety: dead-marking is only meaningful
// against combinations we actually LOOKED UP. When the lookup could not run,
// nothing is dead — a missing table or a failed query must not grey out every
// picker in the store. When it DID run, an empty list is a fact, not a gap:
// every value is unbuyable and renders as Unavailable.
function computeDeadVariantKeys(variants, axes, variantsResolved) {
  if (!variantsResolved || !Array.isArray(variants)) return {}
  var alive = {}
  for (var i = 0; i < variants.length; i++) {
    var v = variants[i]
    if (!isVariantInStock(v)) continue
    for (var k in v.options) {
      if (Object.prototype.hasOwnProperty.call(v.options, k)) alive[k + '|' + v.options[k]] = true
    }
  }
  var dead = {}
  for (var a = 0; a < axes.length; a++) {
    var ax = axes[a]
    for (var b = 0; b < ax.values.length; b++) {
      var key = ax.key + '|' + ax.values[b].value
      if (!alive[key]) dead[key] = true
    }
  }
  return dead
}
// Variant price with base-price inheritance (null variant price -> product price).
function formatVariantPrice(vprice, basePrice) {
  var p = vprice == null || isNaN(vprice) ? basePrice : vprice
  return String(Number(p).toFixed(2))
}
function safeStringifyJson(obj) {
  try {
    return JSON.stringify(obj)
  } catch (e) {
    return '[]'
  }
}

// Parse + normalize the variant_options JSON into render-ready axes. Tolerant of
// null / malformed / partial data (returns []). Keeps ONLY the fields the pill
// widget needs; the labels are already language-resolved by the caller.
function normalizeVariantOptions(raw) {
  if (!raw) return []
  var parsed = raw
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) } catch (e) { return [] }
  }
  if (!Array.isArray(parsed)) return []
  var out = []
  for (var i = 0; i < parsed.length; i++) {
    var axis = parsed[i]
    if (!axis || typeof axis !== 'object' || !Array.isArray(axis.values)) continue
    var name = typeof axis.name === 'string' ? axis.name : ''
    var key = typeof axis.key === 'string' && axis.key ? axis.key : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (!key) continue
    var type = axis.type === 'color' ? 'color' : 'text'
    var values = []
    for (var j = 0; j < axis.values.length; j++) {
      var v = axis.values[j]
      if (!v || typeof v !== 'object') continue
      var label = typeof v.label === 'string' ? v.label : ''
      var value = typeof v.value === 'string' && v.value ? v.value : label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      if (!value) continue
      var entry = { value: value, label: label }
      if (type === 'color' && typeof v.color === 'string' && v.color) entry.color = v.color
      values.push(entry)
    }
    if (!values.length) continue
    out.push({ key: key, name: name, type: type, values: values })
  }
  return out
}

// --- Custom-property classification (MUST mirror product-property-display.ts) ---

// Product-attribute keys that can leak into the free-form \`metadata\` map (e.g.
// from a payment-provider sync or legacy data) but are NOT user custom
// properties. Kept in sync with the GUI's RESERVED_PRODUCT_METADATA_KEYS.
var RESERVED_PRODUCT_METADATA_KEYS = {
  paymentType: true, recurringInterval: true, recurringIntervalCount: true,
  price: true, currency: true, status: true, sku: true, weightUnit: true,
  dimensions: true, category: true, brand: true, gtin: true, mpn: true,
  condition: true, tags: true,
}
function isReservedProductMetadataKey(key) {
  return !!RESERVED_PRODUCT_METADATA_KEYS[key] ||
    key.indexOf('mainImage') === 0 ||
    key.indexOf('secondaryImage') === 0 ||
    key.indexOf('_tq') === 0
}

var CSS_NAMED_COLORS = {
  aliceblue: 1, antiquewhite: 1, aqua: 1, aquamarine: 1, azure: 1, beige: 1, bisque: 1,
  black: 1, blanchedalmond: 1, blue: 1, blueviolet: 1, brown: 1, burlywood: 1,
  cadetblue: 1, chartreuse: 1, chocolate: 1, coral: 1, cornflowerblue: 1, cornsilk: 1,
  crimson: 1, cyan: 1, darkblue: 1, darkcyan: 1, darkgoldenrod: 1, darkgray: 1,
  darkgrey: 1, darkgreen: 1, darkkhaki: 1, darkmagenta: 1, darkolivegreen: 1,
  darkorange: 1, darkorchid: 1, darkred: 1, darksalmon: 1, darkseagreen: 1,
  darkslateblue: 1, darkslategray: 1, darkslategrey: 1, darkturquoise: 1,
  darkviolet: 1, deeppink: 1, deepskyblue: 1, dimgray: 1, dimgrey: 1, dodgerblue: 1,
  firebrick: 1, floralwhite: 1, forestgreen: 1, fuchsia: 1, gainsboro: 1,
  ghostwhite: 1, gold: 1, goldenrod: 1, gray: 1, grey: 1, green: 1, greenyellow: 1,
  honeydew: 1, hotpink: 1, indianred: 1, indigo: 1, ivory: 1, khaki: 1, lavender: 1,
  lavenderblush: 1, lawngreen: 1, lemonchiffon: 1, lightblue: 1, lightcoral: 1,
  lightcyan: 1, lightgoldenrodyellow: 1, lightgray: 1, lightgrey: 1, lightgreen: 1,
  lightpink: 1, lightsalmon: 1, lightseagreen: 1, lightskyblue: 1, lightslategray: 1,
  lightslategrey: 1, lightsteelblue: 1, lightyellow: 1, lime: 1, limegreen: 1,
  linen: 1, magenta: 1, maroon: 1, mediumaquamarine: 1, mediumblue: 1,
  mediumorchid: 1, mediumpurple: 1, mediumseagreen: 1, mediumslateblue: 1,
  mediumspringgreen: 1, mediumturquoise: 1, mediumvioletred: 1, midnightblue: 1,
  mintcream: 1, mistyrose: 1, moccasin: 1, navajowhite: 1, navy: 1, oldlace: 1,
  olive: 1, olivedrab: 1, orange: 1, orangered: 1, orchid: 1, palegoldenrod: 1,
  palegreen: 1, paleturquoise: 1, palevioletred: 1, papayawhip: 1, peachpuff: 1,
  peru: 1, pink: 1, plum: 1, powderblue: 1, purple: 1, rebeccapurple: 1, red: 1,
  rosybrown: 1, royalblue: 1, saddlebrown: 1, salmon: 1, sandybrown: 1, seagreen: 1,
  seashell: 1, sienna: 1, silver: 1, skyblue: 1, slateblue: 1, slategray: 1,
  slategrey: 1, snow: 1, springgreen: 1, steelblue: 1, tan: 1, teal: 1, thistle: 1,
  tomato: 1, turquoise: 1, violet: 1, wheat: 1, white: 1, whitesmoke: 1, yellow: 1,
  yellowgreen: 1, transparent: 1,
}
var HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
var FUNCTIONAL_COLOR_RE = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\((?:[0-9a-z%.,\\s/+-]+)\\)$/i
var COLOR_KEY_WORDS = {
  color: 1, colors: 1, colour: 1, colours: 1, shade: 1, shades: 1, hue: 1, hues: 1,
  tint: 1, tints: 1, tone: 1, tones: 1, swatch: 1, swatches: 1,
}
function splitKeyWords(key) {
  return key.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}
function keyIndicatesColor(key) {
  var normalized = key.toLowerCase()
  if (/colou?r/.test(normalized)) return true
  return splitKeyWords(key).some(function(word) { return !!COLOR_KEY_WORDS[word] })
}
function resolvePropertyColor(key, value) {
  var v = value.trim()
  if (!v) return ''
  if (HEX_COLOR_RE.test(v) || FUNCTIONAL_COLOR_RE.test(v)) return v
  if (CSS_NAMED_COLORS[v.toLowerCase()] && keyIndicatesColor(key)) return v
  return ''
}

var DATA_IMAGE_URI_RE = /^data:image\\//i
var ABSOLUTE_URL_RE = /^(?:https?:)?\\/\\//i
var IMAGE_EXTENSION_RE = /\\.(?:png|jpe?g|gif|webp|svg|avif|bmp|ico|tiff?|heic|heif)$/i
var IMAGE_KEY_WORDS = {
  image: 1, images: 1, img: 1, imgs: 1, photo: 1, photos: 1, picture: 1, pictures: 1,
  pic: 1, pics: 1, thumbnail: 1, thumbnails: 1, thumb: 1, thumbs: 1, icon: 1, icons: 1,
  logo: 1, logos: 1, avatar: 1, avatars: 1, banner: 1, banners: 1, cover: 1, covers: 1,
  gallery: 1, screenshot: 1, screenshots: 1, poster: 1, posters: 1, artwork: 1,
  graphic: 1, graphics: 1, illustration: 1, wallpaper: 1, preview: 1, snapshot: 1,
  media: 1, visual: 1, visuals: 1,
}
function keyIndicatesImage(key) {
  var normalized = key.toLowerCase()
  if (/(?:image|img|photo|picture|thumb|icon|logo|avatar|banner|gallery|screenshot|poster|artwork|graphic|wallpaper)/.test(normalized)) return true
  return splitKeyWords(key).some(function(word) { return !!IMAGE_KEY_WORDS[word] })
}
function stripUrlQueryAndHash(url) {
  return url.split(/[?#]/)[0]
}
function resolvePropertyImage(key, value) {
  var v = value.trim()
  if (!v) return ''
  if (DATA_IMAGE_URI_RE.test(v)) return v
  var isAbsoluteUrl = ABSOLUTE_URL_RE.test(v)
  var isRootRelative = v.charAt(0) === '/' && !isAbsoluteUrl
  if (!isAbsoluteUrl && !isRootRelative) return ''
  if (IMAGE_EXTENSION_RE.test(stripUrlQueryAndHash(v))) return v
  if (isAbsoluteUrl && keyIndicatesImage(key)) return v
  return ''
}

// Image wins over colour (a URL can never be a CSS colour, but checking image
// first keeps the precedence explicit), text is the fallback.
function classifyProductProperty(key, value) {
  var imageUrl = resolvePropertyImage(key, value)
  if (imageUrl) return { key: key, value: value, kind: 'image', color: '', imageUrl: imageUrl }
  var color = resolvePropertyColor(key, value)
  if (color) return { key: key, value: value, kind: 'color', color: color, imageUrl: '' }
  return { key: key, value: value, kind: 'text', color: '', imageUrl: '' }
}

function transformEcommerceProducts(records, options) {
  if (!Array.isArray(records)) return []
  return records.map(function(record) { return buildEcommerceProduct(record, options) })
}

// Batched fetch of the purchasable variant rows for a set of product ids, keyed
// by product_id, so buildEcommerceProduct can attach product.variants without a
// per-product query. Best-effort: a store with no variants (or before the table
// exists) yields an empty map and flat products keep variants: [].
// Batched fetch of the product rows a set of products reference as "related",
// keyed by id, so buildEcommerceProduct can attach product.relatedProducts
// without a query per product.
//
// Best-effort by design: a store whose products table predates the column
// yields no ids at all (the read below is of an absent property, not of a
// column — the SQL never names it), the map stays empty, and the details page's
// rail simply stays hidden behind its is_not_empty gate. Same for a failed
// query.
async function getRelatedProductsMap(getClientFn, records) {
  var map = {}
  if (!Array.isArray(records) || records.length === 0) return map

  var wantedIds = []
  for (var i = 0; i < records.length; i++) {
    var ids = parseRelatedIds(records[i] && records[i].related_product_ids)
    for (var j = 0; j < ids.length; j++) {
      if (wantedIds.indexOf(ids[j]) === -1) wantedIds.push(ids[j])
    }
  }
  if (wantedIds.length === 0) return map

  var client
  try {
    client = getClientFn()
    await client.connect()
    var result = await client.query('SELECT * FROM teleport_products WHERE id = ANY($1)', [
      wantedIds,
    ])
    if (result && result.rows) {
      for (var r = 0; r < result.rows.length; r++) {
        var row = result.rows[r]
        if (row && row.id != null) map[String(row.id)] = row
      }
    }
  } catch (e) {
    // Leaves relatedProducts empty rather than failing the page.
  } finally {
    if (client) {
      try { await client.end() } catch (e) { /* ignore */ }
    }
  }
  return map
}

// Combinations for every product on the page, keyed by product id. Returns NULL
// when the lookup could not run, which the transform reads as "unknown" and
// stays permissive with; an empty map means the query ran and this catalogue
// simply has no combinations.
async function getVariantsMap(getClientFn, productIds) {
  var map = {}
  if (!Array.isArray(productIds) || productIds.length === 0) return map
  var uniqueIds = []
  var seenIds = {}
  for (var u = 0; u < productIds.length; u++) {
    var pid0 = productIds[u]
    if (pid0 != null && !seenIds[pid0]) { seenIds[pid0] = true; uniqueIds.push(pid0) }
  }
  if (uniqueIds.length === 0) return map
  var client
  try {
    client = getClientFn()
    await client.connect()
    var result = await client.query(
      'SELECT id, product_id, options, price, quantity, image_url FROM teleport_product_variants WHERE product_id = ANY($1) ORDER BY position ASC, id ASC',
      [uniqueIds]
    )
    if (result && result.rows) {
      for (var r = 0; r < result.rows.length; r++) {
        var row = result.rows[r]
        var pid = row.product_id
        if (!map[pid]) map[pid] = []
        map[pid].push(row)
      }
    }
  } catch (e) {
    // teleport_product_variants may not exist for a non-variant store, or the
    // query may have failed. Either way the combinations are UNKNOWN — null
    // keeps every picker selectable instead of declaring the catalogue unbuyable.
    map = null
  } finally {
    if (client) {
      try { await client.end() } catch (e) { /* ignore */ }
    }
  }
  return map
}
`
}
