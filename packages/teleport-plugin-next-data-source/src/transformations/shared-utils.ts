/**
 * Generates JavaScript code for shared data transformation utilities.
 * These are included in the generated data source fetcher files
 * when the table requires blog post or e-commerce product transformations.
 */
export const generateSharedTransformationCode = (): string => {
  return `
// ============================================================
// Shared Data Transformation Utilities
// ============================================================

var CURRENCY_SYMBOLS = {
  USD: { symbol: '$', position: 'before' },
  EUR: { symbol: '€', position: 'before' },
  GBP: { symbol: '£', position: 'before' },
  JPY: { symbol: '¥', position: 'before' },
  CAD: { symbol: 'C$', position: 'before' },
  AUD: { symbol: 'A$', position: 'before' },
  CHF: { symbol: 'CHF', position: 'before' },
  CNY: { symbol: '¥', position: 'before' },
  INR: { symbol: '₹', position: 'before' },
  BRL: { symbol: 'R$', position: 'before' },
  MXN: { symbol: 'MX$', position: 'before' },
  KRW: { symbol: '₩', position: 'before' },
  SGD: { symbol: 'S$', position: 'before' },
  HKD: { symbol: 'HK$', position: 'before' },
  NOK: { symbol: 'kr', position: 'after' },
  SEK: { symbol: 'kr', position: 'after' },
  DKK: { symbol: 'kr', position: 'after' },
  PLN: { symbol: 'zł', position: 'after' },
  CZK: { symbol: 'Kč', position: 'after' },
  HUF: { symbol: 'Ft', position: 'after' },
  RON: { symbol: 'lei', position: 'after' },
  TRY: { symbol: '₺', position: 'before' },
  THB: { symbol: '฿', position: 'before' },
  IDR: { symbol: 'Rp', position: 'before' },
  PHP: { symbol: '₱', position: 'before' },
  ZAR: { symbol: 'R', position: 'before' },
  RUB: { symbol: '₽', position: 'after' },
  NZD: { symbol: 'NZ$', position: 'before' },
  TWD: { symbol: 'NT$', position: 'before' },
  ILS: { symbol: '₪', position: 'before' },
  AED: { symbol: 'د.إ', position: 'before' },
  SAR: { symbol: '﷼', position: 'before' },
  MYR: { symbol: 'RM', position: 'before' },
  VND: { symbol: '₫', position: 'after' },
  CLP: { symbol: '$', position: 'before' },
  COP: { symbol: '$', position: 'before' },
  ARS: { symbol: '$', position: 'before' },
  PEN: { symbol: 'S/', position: 'before' },
  UAH: { symbol: '₴', position: 'after' },
  BGN: { symbol: 'лв', position: 'after' },
  HRK: { symbol: 'kn', position: 'after' },
  ISK: { symbol: 'kr', position: 'after' },
  NGN: { symbol: '₦', position: 'before' },
  KES: { symbol: 'KSh', position: 'before' },
  EGP: { symbol: 'E£', position: 'before' },
  PKR: { symbol: '₨', position: 'before' },
  BDT: { symbol: '৳', position: 'before' },
  LKR: { symbol: '₨', position: 'before' },
  GHS: { symbol: 'GH₵', position: 'before' },
}

function getCurrencyInfo(currencyCode) {
  if (!currencyCode) return { symbol: '$', position: 'before' }
  var upper = currencyCode.toUpperCase()
  var entry = CURRENCY_SYMBOLS[upper]
  return entry || { symbol: upper, position: 'before' }
}

function getCurrencySymbol(currencyCode) {
  return getCurrencyInfo(currencyCode).symbol
}

function normalizeTimestamp(value) {
  if (value == null) return Date.now()
  if (typeof value === 'number') {
    if (isNaN(value)) return Date.now()
    return value < 100000000000 ? value * 1000 : value
  }
  if (typeof value === 'string') {
    var parsed = Date.parse(value)
    return isNaN(parsed) ? Date.now() : parsed
  }
  return Date.now()
}

function safeNumber(value, defaultValue) {
  if (value == null) return defaultValue
  var n = Number(value)
  return isNaN(n) ? defaultValue : n
}

function parseJsonArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(function(item) { return typeof item === 'string' })
  if (typeof value === 'string') {
    try {
      var parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.filter(function(item) { return typeof item === 'string' })
      return []
    } catch (e) {
      return value.split(',').map(function(s) { return s.trim() }).filter(Boolean)
    }
  }
  return []
}

// The related-item picks a merchant/author made: a JSON array of row ids stored
// in a TEXT column (\`related_product_ids\` / \`related_post_ids\`). Mirrors
// parseRelatedEntityIds in the GUI (apps/gui/app/project-page/features/shared/
// related-entities/related-entity-ids.ts) — order-preserving, deduplicated,
// blanks dropped, tolerant of a comma-separated cell edited by hand.
//
// \`indexOf\` rather than a seen-map on purpose: these lists hold a handful of
// entries, and an object keyed by arbitrary strings answers truthy for
// 'constructor'/'toString'.
function parseRelatedIds(value) {
  var raw = parseJsonArray(value)
  var ids = []
  for (var i = 0; i < raw.length; i++) {
    var id = String(raw[i] == null ? '' : raw[i]).trim()
    if (!id || ids.indexOf(id) !== -1) continue
    ids.push(id)
  }
  return ids
}

function parseJsonObject(value) {
  if (value == null) return {}
  if (typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      var parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
      return {}
    } catch (e) {
      return {}
    }
  }
  return {}
}

var HTML_ENTITY_MAP = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&#x27;': "'", '&apos;': "'", '&nbsp;': ' ',
  '&#160;': ' ', '&copy;': '©', '&reg;': '®', '&trade;': '™',
  '&hellip;': '…', '&mdash;': '—', '&ndash;': '–',
}

function decodeHtmlEntities(str) {
  if (!str) return str
  // Decode named and numeric entities
  return str
    .replace(/&(?:#x([0-9a-fA-F]+)|#([0-9]+)|([a-zA-Z]+));/g, function(match, hex, dec, named) {
      if (hex) return String.fromCharCode(parseInt(hex, 16))
      if (dec) return String.fromCharCode(parseInt(dec, 10))
      var namedRef = '&' + named + ';'
      return HTML_ENTITY_MAP[namedRef] || match
    })
}

function stripHtmlTags(html) {
  if (!html || typeof html !== 'string') return ''
  // Remove script and style blocks entirely (including content)
  var cleaned = html
    .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ')
    .replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')
  // Strip remaining tags
  cleaned = cleaned.replace(/<[^>]*>/g, ' ')
  // Decode HTML entities
  cleaned = decodeHtmlEntities(cleaned)
  // Collapse whitespace
  return cleaned.replace(/\\s+/g, ' ').trim()
}

function coerceBoolean(value, defaultValue) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true
  if (value === false || value === 'false' || value === 0 || value === '0') return false
  return defaultValue
}

function pickFirst() {
  for (var i = 0; i < arguments.length; i++) {
    var val = arguments[i]
    if (val !== undefined && val !== null) return val
  }
  return null
}

function resolveI18nField(record, snakeCol, camelCol, currentLang, mainLang) {
  if (currentLang && mainLang && currentLang !== mainLang) {
    // Try language-prefixed snake_case column first, then camelCase
    var langSnakeKey = currentLang + '_' + snakeCol
    if (record[langSnakeKey] !== undefined && record[langSnakeKey] !== null && record[langSnakeKey] !== '') {
      return record[langSnakeKey]
    }
    if (snakeCol !== camelCol) {
      var langCamelKey = currentLang + '_' + camelCol
      if (record[langCamelKey] !== undefined && record[langCamelKey] !== null && record[langCamelKey] !== '') {
        return record[langCamelKey]
      }
    }
  }
  if (record[snakeCol] !== undefined && record[snakeCol] !== null) return record[snakeCol]
  if (snakeCol !== camelCol && record[camelCol] !== undefined && record[camelCol] !== null) return record[camelCol]
  return null
}

// Asset URL Resolution with TTL-based caching
var __assetUrlCache = {}
var __assetMapCache = null
var __assetMapTimestamp = 0
var ASSET_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

function isUrl(value) {
  if (!value || typeof value !== 'string') return false
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')
}

function resolveAssetUrl(value, assetMap) {
  if (!value || typeof value !== 'string') return null
  if (isUrl(value)) return value
  // Also treat absolute paths (starting with /) as URLs
  if (value.charAt(0) === '/') return value
  if (__assetUrlCache[value]) return __assetUrlCache[value]
  if (assetMap && assetMap[value]) {
    var asset = assetMap[value]
    var resolved = asset.remoteSrc || asset.imageSrc || asset.src || asset.url || value
    __assetUrlCache[value] = resolved
    return resolved
  }
  // Not found in asset map - return as-is (might already be a usable reference)
  return value
}

function resolveAssetUrls(values, assetMap) {
  if (!Array.isArray(values)) return []
  return values
    .map(function(v) { return resolveAssetUrl(v, assetMap) })
    .filter(function(v) { return v != null && typeof v === 'string' })
}

function deduplicateStrings(arr) {
  var seen = {}
  return arr.filter(function(v) {
    if (!v || typeof v !== 'string' || seen[v]) return false
    seen[v] = true
    return true
  })
}

// Fetches the asset map from the database if available, with TTL-based caching
async function getAssetMap(getClientFn) {
  var now = Date.now()
  if (__assetMapCache && (now - __assetMapTimestamp) < ASSET_CACHE_TTL_MS) {
    return __assetMapCache
  }
  // Reset per-URL cache when asset map is refreshed
  __assetUrlCache = {}
  var map = {}
  var client
  try {
    client = getClientFn()
    await client.connect()
    var result = await client.query('SELECT id, src, remote_src, image_src, url FROM teleport_assets')
    if (result && result.rows) {
      result.rows.forEach(function(row) {
        map[row.id] = {
          src: row.src || null,
          remoteSrc: row.remote_src || null,
          imageSrc: row.image_src || null,
          url: row.url || null,
        }
      })
    }
    __assetMapCache = map
    __assetMapTimestamp = now
  } catch (e) {
    // teleport_assets table may not exist - cache empty map with short TTL
    __assetMapCache = map
    __assetMapTimestamp = now
  } finally {
    if (client) {
      try { await client.end() } catch (e) { /* ignore */ }
    }
  }
  return map
}
`
}
