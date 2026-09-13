import { generateDbImport, isPostgresCartDataSource } from './ecommerce-api-routes-generator'

/**
 * Product media is stored on the row in ONE of two shapes:
 *
 *   - a direct URL — the merchant picked a stock photo (Unsplash / Pexels) or
 *     typed one in;
 *   - the id of a PROJECT ASSET — the merchant picked an image that already
 *     lived in the project's asset library, and only its id is written to
 *     `teleport_products.image_url` / `gallery_images` (and to the per-variant
 *     override on `teleport_product_variants.image_url`).
 *
 * The editor resolves the second shape against the live project document, and
 * the generated DATA-SOURCE fetchers resolve it server-side against the
 * `teleport_assets` mirror table. Every OTHER reader used to render the bare id
 * straight into an `<img src>`, where the browser resolves it against the site
 * origin and asks for `/<uuid>` — a 404 and a blank product photo. That is what
 * emptied the cart and checkout thumbnails.
 *
 * This module is the one place that turns an id into a URL for those readers:
 * the storefront bundle (the cart provider) calls the client half, which goes
 * through `/api/ecommerce/assets`; server-side readers (that route, and the
 * order-notification email's line loader) call the server half with their own
 * database handle. Writing the id → URL contract once is what keeps a product's
 * thumbnail the same file on the listing page, in the cart, on the checkout
 * summary and in the merchant's inbox.
 */

// Ids per lookup request. Shared by both halves so the client can never send a
// batch the route rejects.
const MAX_IDS_PER_REQUEST = 200

// How long a FAILED lookup suppresses further attempts. A store whose
// `teleport_assets` mirror was never provisioned would otherwise fire one
// doomed request per cart change, for the life of the page.
const LOOKUP_COOLDOWN_MS = 30000

const ASSETS_ENDPOINT = '/api/ecommerce/assets'

/** `utils/ecommerce/asset-urls.js` — see the module doc comment above. */
export const generateAssetUrlsModule = (): string => `/**
 * Resolves stored product media to a URL a browser can load.
 *
 * A media value on a product / variant row is EITHER a direct URL (a stock
 * photo the merchant picked) OR the id of a project asset (an image that
 * already lived in the project). Only the generated data-source fetchers
 * resolved the second form — against the \`teleport_assets\` mirror table — so
 * every other reader rendered the bare id into an \`<img src>\`, the browser
 * asked this site for \`/<uuid>\`, and the product photo came back 404.
 *
 * Shared by the storefront bundle (the cart provider imports the client half,
 * which goes through \`/api/ecommerce/assets\`) and by the server-side readers
 * that hand it their own database handle — that route, and the
 * order-notification email's line loader. The id → URL contract is written
 * down once.
 *
 * Deliberately dependency-free: it is \`require\`d by an API route AND bundled
 * into the browser, so nothing here may reach for \`pg\` or for the DOM at
 * module scope.
 */

// The batch endpoint the client half calls. Emitted by the same project plugin
// that emits this module, so the two can never disagree.
var ASSETS_ENDPOINT = '${ASSETS_ENDPOINT}'

// Ids per request. The route rejects a larger batch, so the client half splits
// a bigger set across several calls rather than silently dropping ids.
var MAX_IDS_PER_REQUEST = ${MAX_IDS_PER_REQUEST}

// How long a failed lookup suppresses further attempts — see the module doc.
var LOOKUP_COOLDOWN_MS = ${LOOKUP_COOLDOWN_MS}

function hasOwn(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key)
}

// Whether the value is already something an \`<img src>\` can load: an absolute
// URL, a data/blob URL, a protocol-relative \`//cdn/...\` or a root-relative
// \`/uploads/x.png\`. A bare asset id is none of those.
//
// The scheme is matched case-INSENSITIVELY because a browser treats it that
// way: a hand-typed \`HTTPS://…\` loads today, and reading it as an asset id
// would look the value up, find nothing, and blank a picture that worked.
function isDirectAssetUrl(value) {
  if (!value || typeof value !== 'string') {
    return false
  }
  if (value.charAt(0) === '/') {
    return true
  }
  var scheme = value.slice(0, 8).toLowerCase()
  return (
    scheme.indexOf('http://') === 0 ||
    scheme.indexOf('https://') === 0 ||
    scheme.indexOf('data:') === 0 ||
    scheme.indexOf('blob:') === 0
  )
}

function needsAssetLookup(value) {
  return typeof value === 'string' && value.length > 0 && !isDirectAssetUrl(value)
}

// The distinct asset ids inside a mixed list of media values, in first-seen
// order. A store built entirely from stock photography yields an EMPTY list,
// which is what makes the lookup cost nothing for those stores.
function collectAssetLookupIds(values) {
  var ids = []
  var seen = {}
  var list = values || []
  for (var i = 0; i < list.length; i++) {
    var value = list[i]
    if (!needsAssetLookup(value) || seen[value]) {
      continue
    }
    seen[value] = true
    ids.push(value)
  }
  return ids
}

// Column precedence of \`teleport_assets\`, identical to \`resolveAssetUrl\` in
// the generated data-source fetchers (\`remoteSrc || imageSrc || src || url\`)
// so one asset resolves to the same file on the product listing and in the
// cart.
function assetUrlFromRow(row) {
  if (!row) {
    return null
  }
  return row.remote_src || row.image_src || row.src || row.url || null
}

// \`{ id: url | null }\` covering EVERY requested id. An id with no row is
// recorded as \`null\` rather than left out: "this asset is gone" and "the
// lookup never ran" must stay distinguishable, and callers tell them apart by
// whether the key is present at all.
function buildAssetUrlMap(ids, rows) {
  var byId = {}
  var list = rows || []
  for (var r = 0; r < list.length; r++) {
    var row = list[r]
    if (row && row.id != null) {
      byId[String(row.id)] = assetUrlFromRow(row)
    }
  }
  var map = {}
  var requested = ids || []
  for (var i = 0; i < requested.length; i++) {
    map[requested[i]] = hasOwn(byId, requested[i]) ? byId[requested[i]] || null : null
  }
  return map
}

// ── Server half ───────────────────────────────────────────────────────────────

// The mirror table the editor keeps in step with the project's asset library.
var ASSETS_QUERY =
  'SELECT id, src, remote_src, image_src, url FROM teleport_assets WHERE id = ANY($1)'

// Reads the mirror for whatever inside \`values\` needs resolving. Takes the
// database handle rather than opening one, so this module stays free of \`pg\`
// and can be bundled into the browser alongside the client half.
//
// THROWS when the query fails — the mirror is provisioned by the editor and can
// legitimately be absent. That leaves the decision with the caller: an endpoint
// whose whole job is to answer must report that it could not, while a caller
// for whom the image is a nicety (an email) catches and carries on without one.
async function loadAssetUrlMapFromDb(db, values) {
  var ids = collectAssetLookupIds(values)
  if (ids.length === 0) {
    return {}
  }
  var result = await db.query(ASSETS_QUERY, [ids])
  return buildAssetUrlMap(ids, (result && result.rows) || [])
}

// ── Rendering ─────────────────────────────────────────────────────────────────

// The URL to RENDER for a stored media value, or \`null\` when there is none.
//
// A bare asset id must never reach an \`<img src>\`: the browser resolves it
// against the site origin, asks for \`/<uuid>\` and paints a broken image where
// the product photo belongs. So anything that did not become a loadable URL is
// reported as absent.
//
// The three cases the map distinguishes, and why each answer is the right one:
//   - the map ANSWERED with a URL       → that URL;
//   - the map ANSWERED with \`null\`      → the asset was deleted, and its CDN
//     URL died with it, so the thumbnail must CLEAR rather than fall back to a
//     copy that is equally dead;
//   - the map has NOTHING to say        → the lookup never ran or could not
//     answer, so \`fallback\` (the URL an earlier pass already resolved for this
//     line) keeps the thumbnail on screen through the outage.
function resolveMediaUrl(value, assetUrlMap, fallback) {
  if (!needsAssetLookup(value)) {
    return isDirectAssetUrl(value) ? value : null
  }
  if (hasOwn(assetUrlMap, value)) {
    return isDirectAssetUrl(assetUrlMap[value]) ? assetUrlMap[value] : null
  }
  return isDirectAssetUrl(fallback) ? fallback : null
}

// ── Client half ───────────────────────────────────────────────────────────────

// Answers already paid for, for the life of the page. Entries are
// authoritative (\`null\` = the asset is gone), so a cached id is never asked
// for twice.
var assetUrlCache = {}

// In-flight requests keyed by their id set, so the provider's mount pass and
// the \`teleport:cart-changed\` pass that immediately follows it share ONE round
// trip instead of racing two identical ones.
var pendingLookups = {}

var lookupCooldownUntil = 0

function requestAssetUrls(ids) {
  var key = ids.slice().sort().join(',')
  if (pendingLookups[key]) {
    return pendingLookups[key]
  }
  var request = fetch(ASSETS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: ids }),
  })
    .then(function (response) {
      if (!response.ok) {
        throw new Error('asset lookup failed with status ' + response.status)
      }
      return response.json()
    })
    .then(function (body) {
      var assets = (body && body.assets) || {}
      for (var i = 0; i < ids.length; i++) {
        assetUrlCache[ids[i]] = hasOwn(assets, ids[i]) ? assets[ids[i]] || null : null
      }
      delete pendingLookups[key]
      return assets
    })
    .catch(function () {
      // Leave the ids UNCACHED — a later pass must still be able to resolve
      // them — but hold off for a while so a store without the mirror table
      // does not fire one doomed request per cart change.
      lookupCooldownUntil = Date.now() + LOOKUP_COOLDOWN_MS
      delete pendingLookups[key]
      return null
    })
  pendingLookups[key] = request
  return request
}

// Resolves whatever in \`values\` needs resolving and answers with an
// id → URL map. NEVER rejects: a failed lookup answers with what is already
// known, and \`resolveMediaUrl\`'s fallback keeps the previous image on screen.
async function loadAssetUrlMap(values) {
  var map = {}
  var ids = collectAssetLookupIds(values)
  if (ids.length === 0) {
    return map
  }
  var missing = []
  for (var i = 0; i < ids.length; i++) {
    if (hasOwn(assetUrlCache, ids[i])) {
      map[ids[i]] = assetUrlCache[ids[i]]
    } else {
      missing.push(ids[i])
    }
  }
  if (missing.length === 0) {
    return map
  }
  // Never on the server. A relative endpoint has no origin to resolve against
  // there, and Node's global \`fetch\` would reject on it — arming the cooldown
  // in a module scope that outlives the request and starving the browsers this
  // process then serves. The cart is a client-side surface; there is nothing to
  // paint during SSR anyway. The cooldown itself covers a lookup that is down.
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return map
  }
  if (Date.now() < lookupCooldownUntil) {
    return map
  }
  for (var start = 0; start < missing.length; start += MAX_IDS_PER_REQUEST) {
    var batch = missing.slice(start, start + MAX_IDS_PER_REQUEST)
    var assets = await requestAssetUrls(batch)
    if (!assets) {
      // The lookup is down: stop asking for the rest of this pass.
      break
    }
    for (var b = 0; b < batch.length; b++) {
      map[batch[b]] = hasOwn(assets, batch[b]) ? assets[batch[b]] || null : null
    }
  }
  return map
}

module.exports = {
  isDirectAssetUrl: isDirectAssetUrl,
  collectAssetLookupIds: collectAssetLookupIds,
  loadAssetUrlMapFromDb: loadAssetUrlMapFromDb,
  resolveMediaUrl: resolveMediaUrl,
  loadAssetUrlMap: loadAssetUrlMap,
}
`

/**
 * `pages/api/ecommerce/assets.js` — the batch id → URL resolver the storefront
 * bundle calls.
 *
 * Returns `null` when the datasource cannot answer it (no Postgres client, so
 * no `teleport_assets` mirror to read): the project plugin then emits neither
 * this route NOR the resolution calls that would hit it, and stored media
 * values are used exactly as they were before.
 *
 * Public on purpose, like `/api/ecommerce/variants` beside it: it answers only
 * for ids the caller already knows, and every URL it hands back is the same
 * public CDN URL the product listing already renders.
 */
export const generateAssetsApiRoute = (
  dataSourceType: string | null,
  dataSourceConfig: Record<string, unknown> | null
): string | null => {
  const dbImport = generateDbImport(dataSourceType, dataSourceConfig)
  if (!dbImport || !isPostgresCartDataSource(dataSourceType)) {
    return null
  }

  return `${dbImport}
var assetUrls = require('../../../utils/ecommerce/asset-urls')

// Batch resolver for the project-asset ids stored on product and variant rows.
// The mapping (which \`teleport_assets\` column wins, and what an unknown id
// means) lives in \`utils/ecommerce/asset-urls\` so the browser half and this
// route can never drift apart.
var MAX_IDS = ${MAX_IDS_PER_REQUEST}

// GET keeps the endpoint reachable by hand (\`?ids=a,b\`); POST is what the
// storefront uses, because a cart's worth of uuids does not belong in a URL.
function readRequestedIds(req) {
  if (req.method === 'POST') {
    var body = req.body && typeof req.body === 'object' ? req.body : {}
    return Array.isArray(body.ids) ? body.ids : []
  }
  var raw = (req.query && req.query.ids) || ''
  return String(Array.isArray(raw) ? raw.join(',') : raw).split(',')
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  var requested = readRequestedIds(req).map(function (value) {
    return typeof value === 'string' ? value.trim() : ''
  })
  // Drops blanks, duplicates and anything that is already a URL — a caller
  // that passes a whole column through has nothing to special-case.
  var ids = assetUrls.collectAssetLookupIds(requested)
  if (ids.length === 0) {
    return res.status(200).json({ assets: {} })
  }
  if (ids.length > MAX_IDS) {
    return res.status(400).json({ error: 'Too many ids requested' })
  }

  try {
    // A missing id comes back as \`null\`, which the caller reads as "this asset
    // is gone" — distinct from the failure below, which it reads as "ask again
    // later" and answers with the image it already had.
    return res.status(200).json({ assets: await assetUrls.loadAssetUrlMapFromDb(db, ids) })
  } catch (error) {
    // The mirror table is provisioned by the editor and can legitimately be
    // absent on a store that never had a project asset on a product. Failing
    // loudly is right: the caller must not mistake "cannot answer" for "no such
    // asset" and blank a thumbnail it already had.
    console.error('Asset URL lookup error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
`
}
