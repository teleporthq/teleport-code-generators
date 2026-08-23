import { generateCommonJsSessionTokenResolverCode } from '@teleporthq/teleport-plugin-next-workflows'
import { generateDbImport, isPostgresCartDataSource } from './ecommerce-api-routes-generator'

// Re-exported from `ecommerce-api-routes-generator`, which owns the
// datasource-shape knowledge (`generateDbImport` lives there and the
// order-notification route needs the same predicate). Kept exported from this
// module too so the existing importers — and the cart-persistence tests —
// don't have to move.
export { isPostgresCartDataSource }

/**
 * Generates `pages/api/cart/[op].js` — the database-backed cart endpoint.
 * One dynamic route, three operations dispatched on `req.query.op`:
 *   - load:         hydrate the active cart for the current identity
 *   - sync:         transactionally replace the active cart's items
 *   - mark-ordered: flip the active cart's status to 'ordered'
 *
 * Identity is resolved server-side: the NextAuth token's user id when logged
 * in, else a client-supplied guest `sessionId`. The cart is product-level
 * (the `teleport_cart_items` table has no variant column), so quantities are
 * summed per product. Every operation is wrapped so a DB failure returns HTTP
 * 200 `{ ok: false }` and NEVER throws — the UI keeps working from
 * localStorage regardless.
 *
 * Returns null for non-Postgres datasources so the caller can skip
 * registration entirely.
 */
export const generateCartApiRoute = (
  dataSourceType: string | null,
  dataSourceConfig: Record<string, unknown> | null
): string | null => {
  if (!isPostgresCartDataSource(dataSourceType)) {
    return null
  }
  const dbImport = generateDbImport(dataSourceType, dataSourceConfig)
  if (!dbImport) {
    return null
  }

  return `${dbImport}
${generateCommonJsSessionTokenResolverCode()}
const UUID_RE =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0
    var v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Resolve who owns this cart. Logged-in users come from the NextAuth token
// (a uuid id); guests supply a client-generated sessionId. anonymousUserId is
// the guest-order attribution key (data-create-item maps guest orders onto
// user_id via it) and is only used by mark-ordered.
async function resolveIdentity(req, body) {
  var userId = null
  try {
    var token = await __tqSessionToken(req)
    if (token) userId = token.id || token.sub || null
  } catch (e) {
    userId = null
  }
  if (userId != null && !UUID_RE.test(String(userId))) userId = null
  var sessionId = null
  if (body && typeof body.sessionId === 'string' && body.sessionId) {
    sessionId = body.sessionId.slice(0, 255)
  }
  var anonymousUserId = null
  if (body && typeof body.anonymousUserId === 'string' && UUID_RE.test(body.anonymousUserId)) {
    anonymousUserId = body.anonymousUserId
  }
  return { userId: userId, sessionId: sessionId, anonymousUserId: anonymousUserId }
}

// Owner WHERE fragment + bind params starting at $startIdx. Returns null when
// there is no usable identity (caller treats that as "match nothing").
function ownerClause(identity, startIdx) {
  if (identity.userId) {
    return { sql: 'user_id = $' + startIdx, params: [identity.userId] }
  }
  if (identity.sessionId) {
    return { sql: '(session_id = $' + startIdx + ' AND user_id IS NULL)', params: [identity.sessionId] }
  }
  return null
}

async function handleLoad(req, res, body) {
  var identity = await resolveIdentity(req, body)
  var owner = ownerClause(identity, 1)
  if (!owner) return res.status(200).json({ ok: true, items: [] })
  try {
    var sql =
      'SELECT product_id, variant_id, SUM(quantity) AS quantity FROM teleport_cart_items ' +
      "WHERE cart_id = (SELECT id FROM teleport_cart WHERE status = 'active' AND " +
      owner.sql +
      ' ORDER BY updated_at DESC LIMIT 1) GROUP BY product_id, variant_id'
    var result = await db.query(sql, owner.params)
    var items = (result.rows || [])
      .map(function (r) {
        return { productId: r.product_id, variantId: r.variant_id || null, quantity: Number(r.quantity) || 0 }
      })
      .filter(function (i) {
        return i.productId && i.quantity > 0
      })
    return res.status(200).json({ ok: true, items: items })
  } catch (e) {
    return res.status(200).json({ ok: false, items: [] })
  }
}

async function handleSync(req, res, body) {
  if (req.method !== 'POST') return res.status(200).json({ ok: false })
  var identity = await resolveIdentity(req, body)
  if (!identity.userId && !identity.sessionId) return res.status(200).json({ ok: false })

  // Cart lines are keyed by (product, variant): two variants of the same
  // product stay distinct rows. Quantities are summed per line. Non-uuid
  // productIds are dropped before any DB call so a bad id can't 500 on the
  // product_id FK.
  var rawItems = body && Array.isArray(body.items) ? body.items : []
  var lineByKey = {}
  for (var i = 0; i < rawItems.length; i++) {
    var it = rawItems[i] || {}
    var pid = typeof it.productId === 'string' ? it.productId : ''
    if (!UUID_RE.test(pid)) continue
    var variantId = typeof it.variantId === 'string' && it.variantId ? it.variantId.slice(0, 255) : null
    var q = Math.floor(Number(it.quantity))
    if (!isFinite(q) || q <= 0) continue
    var key = pid + '|' + (variantId || '')
    if (lineByKey[key]) lineByKey[key].quantity += q
    else lineByKey[key] = { productId: pid, variantId: variantId, quantity: q }
  }
  var lines = Object.keys(lineByKey).map(function (k) {
    return lineByKey[k]
  })

  var client
  try {
    client = await db.connect()
  } catch (e) {
    return res.status(200).json({ ok: false })
  }
  try {
    await client.query('BEGIN')
    var owner = ownerClause(identity, 1)
    // Lock the active cart row so two tabs syncing at once serialize instead
    // of racing to create duplicate carts.
    var found = await client.query(
      "SELECT id FROM teleport_cart WHERE status = 'active' AND " +
        owner.sql +
        ' ORDER BY updated_at DESC LIMIT 1 FOR UPDATE',
      owner.params
    )
    var cartId
    if (found.rows && found.rows.length > 0) {
      cartId = found.rows[0].id
    } else if (lines.length === 0) {
      // Nothing to store and no existing cart — don't create an empty row.
      await client.query('COMMIT')
      return res.status(200).json({ ok: true })
    } else {
      cartId = generateUUID()
      await client.query(
        'INSERT INTO teleport_cart (id, user_id, session_id, status, created_at, updated_at) ' +
          "VALUES ($1, $2, $3, 'active', NOW(), NOW())",
        [cartId, identity.userId || null, identity.userId ? null : identity.sessionId]
      )
    }
    await client.query('DELETE FROM teleport_cart_items WHERE cart_id = $1', [cartId])
    for (var p = 0; p < lines.length; p++) {
      var line = lines[p]
      // WHERE EXISTS guards the product FK: a stale product becomes a silent
      // no-op instead of a 23503 violation that would abort the transaction.
      await client.query(
        'INSERT INTO teleport_cart_items (id, cart_id, product_id, variant_id, quantity, created_at, updated_at) ' +
          'SELECT $1, $2, $3, $4, $5, NOW(), NOW() WHERE EXISTS (SELECT 1 FROM teleport_products WHERE id = $3)',
        [generateUUID(), cartId, line.productId, line.variantId, line.quantity]
      )
    }
    await client.query('UPDATE teleport_cart SET updated_at = NOW() WHERE id = $1', [cartId])
    await client.query('COMMIT')
    return res.status(200).json({ ok: true })
  } catch (e) {
    try {
      await client.query('ROLLBACK')
    } catch (e2) {}
    return res.status(200).json({ ok: false })
  } finally {
    try {
      client.release()
    } catch (e3) {}
  }
}

async function handleMarkOrdered(req, res, body) {
  if (req.method !== 'POST') return res.status(200).json({ ok: false })
  var identity = await resolveIdentity(req, body)
  var clauses = []
  var params = []
  if (identity.userId) {
    params.push(identity.userId)
    clauses.push('user_id = $' + params.length)
  }
  if (identity.sessionId) {
    params.push(identity.sessionId)
    clauses.push('(session_id = $' + params.length + ' AND user_id IS NULL)')
  }
  if (identity.anonymousUserId) {
    params.push(identity.anonymousUserId)
    clauses.push('user_id = $' + params.length)
  }
  if (clauses.length === 0) return res.status(200).json({ ok: true, updated: 0 })
  try {
    var result = await db.query(
      "UPDATE teleport_cart SET status = 'ordered', updated_at = NOW() " +
        "WHERE status = 'active' AND (" +
        clauses.join(' OR ') +
        ')',
      params
    )
    return res.status(200).json({ ok: true, updated: result.rowCount || 0 })
  } catch (e) {
    return res.status(200).json({ ok: false })
  }
}

module.exports = async function handler(req, res) {
  var op = req.query.op
  var body = {}
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  } catch (e) {
    body = {}
  }
  try {
    if (op === 'load') return await handleLoad(req, res, body)
    if (op === 'sync') return await handleSync(req, res, body)
    if (op === 'mark-ordered') return await handleMarkOrdered(req, res, body)
    return res.status(200).json({ ok: false, error: 'unknown op' })
  } catch (e) {
    // The cart must never break the app: degrade to localStorage-only.
    return res.status(200).json({ ok: false })
  }
}
`
}
