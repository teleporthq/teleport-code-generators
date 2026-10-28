import { toJsLiteral } from '../pwa/source-literals'
import { VISITOR_READ_SOURCE } from '../plugins/visitor-read-source'
import { DetailsRoute } from '../instant-search/sections'
import { CompareKind, ItemComparisonConfig } from './settings'

/**
 * `pages/api/plugins/compare.js`: the rows of the picked items, read through
 * the table's generated fetcher (the visitor row policy applies: only active
 * products), with the attributes the owner chose laid out as columns the
 * table can compare — a number where one can be better, text otherwise — and
 * each item's custom properties as its visitors see them (a product's from
 * its `metadata`, a bookable item's from its `properties`, the hidden ones
 * left out), which the runtime lays out as rows by the settings.
 */

export const COMPARE_ROUTE = '/api/plugins/compare'
const MAX_IDS = 6

export interface CompareRouteKind {
  kind: CompareKind
  label: string
  fetcherImport: string
  route: DetailsRoute
  attributes: string[]
  activeColumn: string | null
}

/** Each attribute's label, where its value is read from and whether a lower or higher value wins. */
const ATTRIBUTE_SPECS: Record<
  CompareKind,
  Record<string, { label: string; better: 'low' | 'high' | null }>
> = {
  products: {
    price: { label: 'Price', better: 'low' },
    rating: { label: 'Rating', better: 'high' },
    brand: { label: 'Brand', better: null },
    condition: { label: 'Condition', better: null },
    category: { label: 'Category', better: null },
    tags: { label: 'Tags', better: null },
    weight: { label: 'Weight', better: null },
    dimensions: { label: 'Dimensions', better: null },
    stock: { label: 'In stock', better: 'high' },
    sku: { label: 'SKU', better: null },
  },
  bookingItems: {
    price: { label: 'Price', better: 'low' },
    unit: { label: 'Booked by', better: null },
    capacity: { label: 'Capacity', better: 'high' },
    duration: { label: 'Duration', better: null },
    category: { label: 'Category', better: null },
  },
}

const attributeColumns = (kind: CompareKind, keys: string[]) =>
  keys
    .filter((key) => ATTRIBUTE_SPECS[kind][key])
    .map((key) => ({ key, ...ATTRIBUTE_SPECS[kind][key] }))

const fetcherName = (index: number) => `fetcher${index}`

export const buildCompareRouteSource = (
  config: ItemComparisonConfig,
  kinds: CompareRouteKind[]
): string => {
  const imports = kinds
    .map((entry, index) => `import ${fetcherName(index)} from ${toJsLiteral(entry.fetcherImport)}`)
    .join('\n')
  const kindLiterals = kinds
    .map(
      (entry, index) => `  ${toJsLiteral(entry.kind)}: {
    label: ${toJsLiteral(entry.label)},
    fetch: (params) => readAsVisitor(${fetcherName(index)}, params),
    route: ${toJsLiteral(entry.route)},
    activeColumn: ${toJsLiteral(entry.activeColumn)},
    attributes: ${toJsLiteral(attributeColumns(entry.kind, entry.attributes))},
  }`
    )
    .join(',\n')
  return `${imports}

${VISITOR_READ_SOURCE}

const KINDS = {
${kindLiterals}
}
const MAX_ITEMS = ${config.maxItems}
const MAX_IDS = ${MAX_IDS}

function text(value) {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ')
  if (typeof value === 'object') return ''
  return String(value).trim()
}

function number(value) {
  if (typeof value === 'number') return isFinite(value) ? value : null
  const parsed = parseFloat(String(value == null ? '' : value).replace(/[^0-9.-]/g, ''))
  return isFinite(parsed) ? parsed : null
}

function list(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean)
  const raw = text(value)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map(text).filter(Boolean)
  } catch (e) {}
  return raw.split(',').map((item) => item.trim()).filter(Boolean)
}

function priceCell(row) {
  const amount = number(row.price)
  if (amount === null) return null
  const symbol = text(row.currency_symbol || row.currencySymbol) || text(row.currency) || ''
  return { text: symbol + amount.toFixed(2), number: amount }
}

function minutes(value) {
  const total = number(value)
  if (total === null) return null
  const hours = Math.floor(total / 60)
  const rest = total % 60
  const parts = []
  if (hours) parts.push(hours + ' h')
  if (rest || !hours) parts.push(rest + ' min')
  return { text: parts.join(' '), number: total }
}

// One cell per attribute: what the table prints, and the number it compares.
function cell(kind, key, row) {
  switch (kind + ':' + key) {
    case 'products:price':
    case 'bookingItems:price':
      return priceCell(row)
    case 'products:rating': {
      const rating = number(row.average_rating || row.averageRating || row.rating)
      return rating === null ? null : { text: rating.toFixed(1) + ' / 5', number: rating }
    }
    case 'products:stock': {
      const out = String(row.outOfStock) === 'true' || number(row.quantity) === 0
      return { text: out ? 'Out of stock' : 'In stock', number: out ? 0 : 1 }
    }
    case 'products:weight': {
      const weight = number(row.weight)
      return weight === null ? null : { text: weight + ' ' + (text(row.weight_unit || row.weightUnit) || 'kg'), number: weight }
    }
    case 'products:tags':
      return { text: list(row.tags).join(', '), number: null }
    case 'bookingItems:unit': {
      const unit = text(row.booking_unit || row.bookingUnit)
      return unit ? { text: unit === 'night' ? 'Per night' : unit === 'day' ? 'Per day' : 'Per time slot', number: null } : null
    }
    case 'bookingItems:capacity': {
      const capacity = number(row.capacity) !== null ? number(row.capacity) : number(row.max_guests || row.maxGuests)
      return capacity === null ? null : { text: String(capacity), number: capacity }
    }
    case 'bookingItems:duration':
      return minutes(row.duration_minutes || row.durationMinutes)
    default: {
      const value = text(row[key])
      return value ? { text: value, number: number(value) } : null
    }
  }
}

// A product's own metadata keys, never custom properties: kept in step with
// the editor's RESERVED_PRODUCT_METADATA_KEYS (product-property-display.ts)
// and the storefront's transform (ecommerce-product.ts).
const RESERVED_PRODUCT_METADATA_KEYS = {
  paymentType: true, recurringInterval: true, recurringIntervalCount: true,
  price: true, currency: true, status: true, sku: true, weightUnit: true,
  dimensions: true, category: true, brand: true, gtin: true, mpn: true,
  condition: true, tags: true,
}
const MAX_PROPERTIES = 50

function isReservedProductMetadataKey(key) {
  return !!RESERVED_PRODUCT_METADATA_KEYS[key] || key.indexOf('mainImage') === 0 || key.indexOf('secondaryImage') === 0 || key.indexOf('_tq') === 0
}

// JSON stored as text, or already parsed; anything else reads as \`fallback\`.
function parsed(value, fallback) {
  if (typeof value !== 'string') return value == null ? fallback : value
  try {
    return value.trim() ? JSON.parse(value) : fallback
  } catch (e) {
    return fallback
  }
}

// The custom properties a visitor is shown, in the owner's order: named, valued, not hidden.
function shownProperties(kind, row) {
  const shown = []
  if (kind === 'products') {
    const metadata = parsed(row.metadata, {})
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return shown
    const visibility = parsed(metadata._tqPropVisibility, {}) || {}
    Object.keys(metadata).forEach((key) => {
      const value = text(metadata[key])
      if (!isReservedProductMetadataKey(key) && visibility[key] !== false && value && shown.length < MAX_PROPERTIES) shown.push({ key, value })
    })
    return shown
  }
  const entries = parsed(row.properties, [])
  ;(Array.isArray(entries) ? entries : []).forEach((entry) => {
    const key = entry && typeof entry === 'object' ? text(entry.key) : ''
    const value = key ? text(entry.value) : ''
    if (key && value && entry.visible !== false && shown.length < MAX_PROPERTIES) shown.push({ key, value })
  })
  return shown
}

function itemUrl(route, row) {
  const value = row[route.column]
  if (value === undefined || value === null || value === '') return null
  return route.staticBase + '/' + encodeURIComponent(String(value))
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }
  const kind = String(Array.isArray(req.query.kind) ? req.query.kind[0] : req.query.kind || '')
  const spec = Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : null
  if (!spec) {
    return res.status(400).json({ success: false, error: 'Unknown kind' })
  }
  const ids = String(Array.isArray(req.query.ids) ? req.query.ids[0] : req.query.ids || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id, index, all) => id && id.length <= 64 && all.indexOf(id) === index)
    .slice(0, Math.min(MAX_IDS, MAX_ITEMS))
  if (ids.length === 0) {
    return res.status(200).json({ success: true, kind, label: spec.label, attributes: spec.attributes, items: [] })
  }
  let rows = []
  try {
    rows = await spec.fetch({
      filters: JSON.stringify([{ source: 'id', destination: ids, operand: 'in' }]),
      limit: String(ids.length),
    })
  } catch (error) {
    // Never a cached blank: the client keeps what it had and asks again.
    console.warn('[item-comparison] ' + kind + ' could not be read:', error && error.message)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(503).json({ success: false, error: 'The comparison could not be read' })
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=120')
  const byId = {}
  ;(Array.isArray(rows) ? rows : []).forEach((row) => {
    if (row && typeof row === 'object' && row.id !== undefined) byId[String(row.id)] = row
  })
  // In the order they were picked; a row that is gone or no longer offered is left out.
  const items = []
  ids.forEach((id) => {
    const row = byId[id]
    if (!row || (spec.activeColumn && row[spec.activeColumn] === false)) return
    const url = itemUrl(spec.route, row)
    const attributes = {}
    spec.attributes.forEach((attribute) => {
      attributes[attribute.key] = cell(kind, attribute.key, row)
    })
    items.push({
      id,
      title: text(row.name || row.title) || 'Untitled',
      url,
      image: text(row.image_url || row.imageUrl) || null,
      attributes,
      properties: shownProperties(kind, row),
    })
  })
  return res.status(200).json({ success: true, kind, label: spec.label, attributes: spec.attributes, items })
}
`
}
