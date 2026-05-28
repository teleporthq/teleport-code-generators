/**
 * Generates JavaScript code for e-commerce product data transformation.
 * Transforms raw snake_case database records into the camelCase shape
 * that UIDL components expect.
 */
export const generateEcommerceProductTransformationCode = (): string => {
  return `
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

  // Provider fields
  var providerType = pickFirst(record.provider_type, record.providerType) || null
  var providerProductId = pickFirst(record.provider_product_id, record.providerProductId) || null
  var defaultPrice = pickFirst(record.default_price, record.defaultPrice) || null

  // Metadata
  var metadata = parseJsonObject(record.metadata)

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
    tags: tags,
    imageAlt: imageAlt,
    providerType: providerType,
    providerProductId: providerProductId,
    default_price: defaultPrice,
    metadata: metadata,
    mainImage: mainImage,
    imageUrl: mainImage,
    image_url: mainImage,
    galleryImages: galleryImages,
    images: images,
    createdAt: createdAt,
    updatedAt: updatedAt,
    created: created,
    outOfStock: outOfStock,
  }
}

function transformEcommerceProducts(records, options) {
  if (!Array.isArray(records)) return []
  return records.map(function(record) { return buildEcommerceProduct(record, options) })
}
`
}
