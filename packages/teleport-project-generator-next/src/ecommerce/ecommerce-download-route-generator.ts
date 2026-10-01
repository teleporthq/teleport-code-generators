import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'
import { SessionCookieResolver } from '@teleporthq/teleport-shared'
import { generateDbImport } from './ecommerce-api-routes-generator'

/**
 * `pages/api/downloads/[fileId].js` — the one door to a store's private
 * digital files.
 *
 * A link on the buyer's order page is `/api/downloads/<file id>?order=<order
 * id>&key=<download key>`. The key is the order's own
 * `teleport_orders.download_key`, issued by the database when the order was
 * written: no workflow mints it, no secret signs it, and it never expires —
 * the entitlement is re-checked against the database on every hit instead.
 *
 * In order: the parameters must be well-formed (400); the order must exist
 * (404); the key must match the order's, compared in constant time (403);
 * an order placed from an ACCOUNT — one whose `user_id` is a row in `users`,
 * as opposed to the anonymous id a guest checkout stamps — is served only to
 * that account's NextAuth session (401 without one, 403 for another user);
 * the file must belong to a digital line of the order (404); the order must
 * be paid, or refunded while the merchant keeps refunded orders' files, and
 * not cancelled (402 / 403); the line's download limit and window must hold
 * (410). Only then are the bytes read from the storage worker's content
 * endpoint, with the project's key, and PROXIED to the buyer — a `Range`
 * request is passed through and answered as the worker answers it — so no
 * storage address or credential ever reaches a browser. The download is
 * counted once the worker answered 2xx, against the limit in the same
 * transaction (410 when a concurrent request took the last one). Every
 * request counts except a RESUMED one: a range past the first byte of a file
 * already counted for that line within the day — for the same account on an
 * account order, from the same address on a guest's — which is served even
 * once the limit is reached, so the last allowed download can still finish.
 * 503 means the store is not configured for downloads, 502 that the worker
 * refused.
 */

const DOWNLOAD_ROUTE_PATH = '/api/downloads'

export const DOWNLOAD_ROUTE_ERRORS = {
  METHOD: 'Method not allowed',
  MALFORMED: 'This download link is not valid',
  INVALID: 'This download link is not valid for this order',
  SIGN_IN: 'Sign in to the account that placed this order to download its files',
  OTHER_ACCOUNT: 'This order belongs to another account',
  NOT_CONFIGURED: 'Downloads are not configured for this store',
  NOT_FOUND: 'This file is not part of your order',
  UNPAID: 'Your downloads unlock once the payment is confirmed',
  REVOKED: 'Downloads are no longer available for this order',
  LIMIT: 'This file has reached its download limit',
  WINDOW: 'The download window for this order has closed',
  STORAGE: 'The file could not be fetched right now. Please try again',
} as const

/**
 * The order the link names, with its key (read through the row's JSON form so
 * a store whose orders table predates the column answers NULL rather than
 * failing) and whether it was placed from an account: a guest checkout stamps
 * the browser's anonymous id into `user_id`, and that id is no `users` row.
 * `$1` order id.
 */
export const DOWNLOAD_ORDER_QUERY = [
  'SELECT o.id::text AS order_id, o.user_id::text AS user_id, o.status, o.payment_status,',
  "  to_jsonb(o) ->> 'download_key' AS download_key,",
  '  EXISTS (SELECT 1 FROM users u WHERE u.id::text = o.user_id::text) AS account_order',
  'FROM teleport_orders o',
  'WHERE o.id::text = $1',
  'LIMIT 1',
].join('\n')

/**
 * The entitlement: the order, a digital line of it whose product owns the
 * file, the product's limits and the file, with the file's download count
 * for that line. Optional columns are read through the row's JSON form so a
 * store provisioned before them still answers. `$1` order id, `$2` file id.
 */
export const DOWNLOAD_ENTITLEMENT_QUERY = [
  'SELECT o.id::text AS order_id, o.payment_status, o.status, o.created_at, o.user_id::text AS user_id,',
  '  oi.id::text AS order_item_id,',
  "  to_jsonb(p) ->> 'download_limit' AS download_limit, to_jsonb(p) ->> 'download_expiry_days' AS download_expiry_days,",
  '  pf.id::text AS file_id, pf.file_name, pf.storage_file_id, pf.content_type,',
  '  (SELECT COUNT(*) FROM teleport_downloads d WHERE d.order_item_id = oi.id AND d.product_file_id = pf.id) AS downloads',
  'FROM teleport_orders o',
  'JOIN teleport_order_items oi ON oi.order_id = o.id',
  'LEFT JOIN teleport_products p ON p.id::text = oi.product_id::text',
  'JOIN teleport_product_files pf ON pf.product_id::text = oi.product_id::text',
  'WHERE o.id::text = $1 AND pf.id::text = $2',
  "  AND (to_jsonb(oi) ->> 'is_digital' = 'true'",
  "    OR (to_jsonb(oi) ->> 'is_digital' IS NULL AND to_jsonb(p) ->> 'is_digital' = 'true'))",
  'ORDER BY oi.created_at ASC, oi.id ASC',
  'LIMIT 1',
].join('\n')

/**
 * Whether a download of the file was already counted for the order line
 * within the day, for the same client: `$1` order line id, `$2` file id, `$3`
 * the client's address, or '' for any (an account order, whose every request
 * is already bound to the account's session).
 */
export const DOWNLOAD_RESUME_QUERY = [
  'SELECT 1 FROM teleport_downloads d',
  'WHERE d.order_item_id = $1::uuid AND d.product_file_id = $2::uuid',
  "  AND ($3::text = '' OR d.ip_address = $3::text)",
  "  AND d.created_at > NOW() - INTERVAL '24 hours'",
  'LIMIT 1',
].join('\n')

/**
 * Taken before `DOWNLOAD_CLAIM_QUERY`, in the same transaction: the limit
 * check and the insert are one decision only because concurrent requests for
 * the line queue here. `$1` order line id.
 */
export const DOWNLOAD_LINE_LOCK_QUERY =
  'SELECT 1 FROM teleport_order_items WHERE id = $1::uuid FOR UPDATE'

/**
 * Counts the download only while the file's count for the line is under the
 * limit, returning the new row when it did. A separate statement from the
 * lock on purpose: under READ COMMITTED a statement counts what was committed
 * when IT began, so this one, begun once the lock was granted, sees the
 * download the previous holder just committed. A lock folded into this
 * statement (a CTE `FOR UPDATE`) waits just the same but counts with the
 * snapshot taken before it, and N parallel requests all pass. `$1` order id,
 * `$2` order line id, `$3` file id, `$4` user id, `$5` client address, `$6`
 * the limit (0 for none).
 */
export const DOWNLOAD_CLAIM_QUERY = [
  'INSERT INTO teleport_downloads (order_id, order_item_id, product_file_id, user_id, ip_address)',
  "SELECT $1::uuid, $2::uuid, $3::uuid, NULLIF($4, '')::uuid, NULLIF($5, '')",
  'WHERE $6::int <= 0',
  '  OR (SELECT COUNT(*) FROM teleport_downloads d WHERE d.order_item_id = $2::uuid AND d.product_file_id = $3::uuid) < $6::int',
  'RETURNING id',
].join('\n')

export const generateDownloadApiRoute = (
  settings: UIDLEcommerceSettings,
  dataSourceType: string | null,
  dataSourceConfig: Record<string, unknown> | null
): string => {
  const dbImport = generateDbImport(dataSourceType, dataSourceConfig)
  const revokeOnRefund = settings.digitalProducts?.revokeOnRefund !== false

  if (!dbImport) {
    return [
      'export default async function handler(req, res) {',
      `  return res.status(503).json({ error: ${JSON.stringify(
        DOWNLOAD_ROUTE_ERRORS.NOT_CONFIGURED
      )} })`,
      '}',
      '',
    ].join('\n')
  }

  return [
    dbImport,
    '',
    // `__tqSessionToken(req)`: the NextAuth session decoded from the cookie
    // the request actually carries, the way every generated route does it.
    SessionCookieResolver.generateCommonJsSessionTokenResolverCode(),
    `const DOWNLOAD_ERRORS = ${JSON.stringify(DOWNLOAD_ROUTE_ERRORS)}`,
    `const REVOKE_ON_REFUND = ${revokeOnRefund}`,
    "const PAID_STATUSES = ['paid', 'partially_refunded']",
    `const ORDER_QUERY = ${JSON.stringify(DOWNLOAD_ORDER_QUERY)}`,
    `const ENTITLEMENT_QUERY = ${JSON.stringify(DOWNLOAD_ENTITLEMENT_QUERY)}`,
    `const RESUME_QUERY = ${JSON.stringify(DOWNLOAD_RESUME_QUERY)}`,
    `const LINE_LOCK_QUERY = ${JSON.stringify(DOWNLOAD_LINE_LOCK_QUERY)}`,
    `const CLAIM_QUERY = ${JSON.stringify(DOWNLOAD_CLAIM_QUERY)}`,
    'const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i',
    'const KEY_RE = /^[A-Za-z0-9_-]{16,128}$/',
    '',
    'function queryValue(value) {',
    "  return String((Array.isArray(value) ? value[0] : value) || '').trim()",
    '}',
    '',
    '// The key of the link against the key of the order, in constant time.',
    'function keyMatches(given, expected) {',
    "  const a = Buffer.from(String(given || ''), 'utf8')",
    "  const b = Buffer.from(String(expected || ''), 'utf8')",
    '  if (a.length === 0 || a.length !== b.length) {',
    '    return false',
    '  }',
    "  return require('crypto').timingSafeEqual(a, b)",
    '}',
    '',
    'function sessionUserId(token) {',
    "  if (!token || typeof token !== 'object') {",
    '    return null',
    '  }',
    '  return token.id != null ? String(token.id) : token.sub != null ? String(token.sub) : null',
    '}',
    '',
    '// Whether the row entitles a download right now: { ok: true } or { ok: false, status, error }.',
    '// A resumed download is past the limit check: it was counted when it began.',
    'function decideDownload(row, nowMs, resuming) {',
    '  if (!row) {',
    '    return { ok: false, status: 404, error: DOWNLOAD_ERRORS.NOT_FOUND }',
    '  }',
    "  const paymentStatus = String(row.payment_status || '').toLowerCase()",
    "  const orderStatus = String(row.status || '').toLowerCase()",
    "  const refunded = paymentStatus === 'refunded'",
    "  if ((refunded && REVOKE_ON_REFUND) || orderStatus === 'cancelled') {",
    '    return { ok: false, status: 403, error: DOWNLOAD_ERRORS.REVOKED }',
    '  }',
    '  if (!refunded && PAID_STATUSES.indexOf(paymentStatus) === -1) {',
    '    return { ok: false, status: 402, error: DOWNLOAD_ERRORS.UNPAID }',
    '  }',
    '  const limit = parseInt(row.download_limit, 10)',
    '  const used = parseInt(row.downloads, 10) || 0',
    '  if (!resuming && !isNaN(limit) && limit > 0 && used >= limit) {',
    '    return { ok: false, status: 410, error: DOWNLOAD_ERRORS.LIMIT }',
    '  }',
    '  const expiryDays = parseInt(row.download_expiry_days, 10)',
    '  if (!isNaN(expiryDays) && expiryDays > 0) {',
    '    const placedAt = new Date(row.created_at).getTime()',
    '    if (!isNaN(placedAt) && placedAt + expiryDays * 86400000 <= nowMs) {',
    '      return { ok: false, status: 410, error: DOWNLOAD_ERRORS.WINDOW }',
    '    }',
    '  }',
    '  return { ok: true }',
    '}',
    '',
    '// Where the storage worker serves the private object and the key that',
    '// opens it; null when the store is not configured for downloads.',
    'function storageContentRequest(storageFileId, env) {',
    '  const storageUrl = env.RUNTIME_STORAGE_URL',
    '  const apiKey = env.RUNTIME_STORAGE_API_KEY',
    '  const projectId = env.RUNTIME_STORAGE_PROJECT_ID',
    '  if (!storageUrl || !apiKey || !projectId || !storageFileId) {',
    '    return null',
    '  }',
    '  return {',
    '    url:',
    "      String(storageUrl).replace(/\\/+$/, '') +",
    "      '/project/' + encodeURIComponent(String(projectId)) +",
    "      '/files/' + encodeURIComponent(String(storageFileId)) +",
    "      '/content',",
    "    headers: { Authorization: 'Bearer ' + apiKey },",
    '  }',
    '}',
    '',
    'function clientIp(req) {',
    "  const forwarded = req.headers && req.headers['x-forwarded-for']",
    '  if (forwarded) {',
    "    return String(Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim()",
    '  }',
    "  return (req.socket && req.socket.remoteAddress) || ''",
    '}',
    '',
    '// The first byte a Range asks for when it is ONE `bytes=N-` or `bytes=N-M`',
    '// range; 0 for no range, a range from the first byte, and anything a worker',
    '// may answer with the whole file (a suffix, several ranges, a malformed header).',
    'function rangeStart(range) {',
    "  const match = /^bytes=(\\d{1,15})-(\\d{0,15})$/i.exec(String(range || '').replace(/\\s+/g, ''))",
    '  if (!match) {',
    '    return 0',
    '  }',
    '  const start = parseInt(match[1], 10)',
    "  return match[2] !== '' && parseInt(match[2], 10) < start ? 0 : start",
    '}',
    '',
    '// Counts the download if the limit still allows it; true when it did. The',
    '// line is locked first, so the count the INSERT reads includes every',
    '// download a concurrent request counted before it.',
    'async function claimDownload(pool, params) {',
    "  if (typeof pool.connect !== 'function') {",
    '    // A driver without transactions: the conditional INSERT alone.',
    '    const single = await pool.query(CLAIM_QUERY, params)',
    '    return !!(single && single.rows && single.rows.length > 0)',
    '  }',
    '  const client = await pool.connect()',
    '  try {',
    "    await client.query('BEGIN')",
    '    await client.query(LINE_LOCK_QUERY, [params[1]])',
    '    const claimed = await client.query(CLAIM_QUERY, params)',
    "    await client.query('COMMIT')",
    '    return !!(claimed && claimed.rows && claimed.rows.length > 0)',
    '  } catch (error) {',
    "    await client.query('ROLLBACK').catch(() => undefined)",
    '    throw error',
    '  } finally {',
    '    client.release()',
    '  }',
    '}',
    '',
    '// Lets the upstream connection go when its bytes will not be sent.',
    'function discardBody(body) {',
    "  if (body && typeof body.cancel === 'function') {",
    '    Promise.resolve(body.cancel()).catch(() => undefined)',
    "  } else if (body && typeof body.destroy === 'function') {",
    '    body.destroy()',
    '  }',
    '}',
    '',
    '// `attachment; filename="<ascii-safe>"; filename*=UTF-8\'\'<encoded>` — the',
    '// second form carries the real name, the first is for clients without it.',
    'function contentDisposition(fileName) {',
    "  const name = String(fileName || 'download')",
    "  const ascii = name.replace(/[^\\x20-\\x7e]/g, '_').replace(/[\"\\\\]/g, '_')",
    "  return 'attachment; filename=\"' + ascii + '\"; filename*=UTF-8\\'\\'' + encodeURIComponent(name)",
    '}',
    '',
    '// Streams the upstream body to the response without buffering it: a Node',
    '// stream is piped, a WHATWG stream (the global fetch) is read chunk by',
    '// chunk under back-pressure. A client that goes away cancels the read.',
    'function pipeBody(body, res) {',
    '  return new Promise((resolve, reject) => {',
    '    if (!body) {',
    '      res.end()',
    '      resolve()',
    '      return',
    '    }',
    "    if (typeof body.pipe === 'function') {",
    "      body.on('error', reject)",
    "      res.on('finish', resolve)",
    "      res.on('error', reject)",
    '      body.pipe(res)',
    '      return',
    '    }',
    "    if (typeof body.getReader !== 'function') {",
    '      res.end()',
    '      resolve()',
    '      return',
    '    }',
    '    const reader = body.getReader()',
    '    let closed = false',
    "    res.on('close', () => {",
    '      closed = true',
    '      reader.cancel().catch(() => undefined)',
    '      resolve()',
    '    })',
    '    const pump = () =>',
    '      reader',
    '        .read()',
    '        .then(({ done, value }) => {',
    '          if (closed) {',
    '            return',
    '          }',
    '          if (done) {',
    '            res.end()',
    '            resolve()',
    '            return',
    '          }',
    '          if (res.write(Buffer.from(value))) {',
    '            pump()',
    '          } else {',
    "            res.once('drain', pump)",
    '          }',
    '        })',
    '        .catch((error) => {',
    '          res.destroy(error)',
    '          reject(error)',
    '        })',
    '    pump()',
    '  })',
    '}',
    '',
    '// The whole request, with its collaborators injectable (the test runs it with fakes).',
    'async function serveDownload(req, res, ctx) {',
    "  res.setHeader('Cache-Control', 'no-store')",
    "  res.setHeader('X-Robots-Tag', 'noindex')",
    "  if (req.method !== 'GET') {",
    '    return res.status(405).json({ error: DOWNLOAD_ERRORS.METHOD })',
    '  }',
    '  const query = req.query || {}',
    '  const fileId = queryValue(query.fileId)',
    '  const orderId = queryValue(query.order)',
    '  const key = queryValue(query.key)',
    '  if (!UUID_RE.test(fileId) || !UUID_RE.test(orderId) || !KEY_RE.test(key)) {',
    '    return res.status(400).json({ error: DOWNLOAD_ERRORS.MALFORMED })',
    '  }',
    '  try {',
    '    const orderResult = await ctx.query(ORDER_QUERY, [orderId])',
    '    const order = orderResult && orderResult.rows && orderResult.rows[0] ? orderResult.rows[0] : null',
    '    if (!order) {',
    '      return res.status(404).json({ error: DOWNLOAD_ERRORS.NOT_FOUND })',
    '    }',
    '    if (!keyMatches(key, order.download_key)) {',
    '      return res.status(403).json({ error: DOWNLOAD_ERRORS.INVALID })',
    '    }',
    "    const accountOrder = order.account_order === true || order.account_order === 't' || order.account_order === 'true'",
    '    const sessionBound = accountOrder && !!order.user_id',
    '    if (sessionBound) {',
    '      const sessionId = sessionUserId(await ctx.sessionToken(req))',
    '      if (!sessionId) {',
    '        return res.status(401).json({ error: DOWNLOAD_ERRORS.SIGN_IN })',
    '      }',
    '      if (sessionId !== String(order.user_id)) {',
    '        return res.status(403).json({ error: DOWNLOAD_ERRORS.OTHER_ACCOUNT })',
    '      }',
    '    }',
    '    const result = await ctx.query(ENTITLEMENT_QUERY, [orderId, fileId])',
    '    const row = result && result.rows && result.rows[0] ? result.rows[0] : null',
    "    const range = req.headers && req.headers.range ? String(req.headers.range) : ''",
    '    const address = clientIp(req)',
    '    // A range past the first byte resumes a download only when one was counted',
    "    // for this client; any other is a download of its own, or a shared link's",
    '    // chunks would never count.',
    '    let resuming = false',
    '    if (row && rangeStart(range) > 0 && (sessionBound || address)) {',
    "      const earlier = await ctx.query(RESUME_QUERY, [row.order_item_id, row.file_id, sessionBound ? '' : address])",
    '      resuming = !!(earlier && earlier.rows && earlier.rows.length > 0)',
    '    }',
    '    const verdict = decideDownload(row, ctx.now(), resuming)',
    '    if (!verdict.ok) {',
    '      return res.status(verdict.status).json({ error: verdict.error })',
    '    }',
    '    const content = storageContentRequest(row.storage_file_id, ctx.env)',
    '    if (!content) {',
    '      return res.status(503).json({ error: DOWNLOAD_ERRORS.NOT_CONFIGURED })',
    '    }',
    '    let upstream',
    '    try {',
    '      upstream = await ctx.fetch(content.url, {',
    "        method: 'GET',",
    '        headers: range ? { ...content.headers, Range: range } : content.headers,',
    '      })',
    '    } catch (_e) {',
    '      upstream = null',
    '    }',
    '    if (!upstream || !upstream.ok) {',
    '      return res.status(502).json({ error: DOWNLOAD_ERRORS.STORAGE })',
    '    }',
    '    // Counted only once the worker answered with the bytes, so a failed fetch',
    '    // never costs the buyer a download. A resumed range the worker answered',
    '    // with the whole file (200) is a whole download, and counts.',
    '    if (!(resuming && upstream.status === 206)) {',
    '      const limit = parseInt(row.download_limit, 10)',
    '      const counted = await ctx.claim([',
    '        row.order_id,',
    '        row.order_item_id,',
    '        row.file_id,',
    '        order.user_id || row.user_id || null,',
    '        address,',
    '        limit > 0 ? limit : 0,',
    '      ])',
    '      if (!counted) {',
    '        discardBody(upstream.body)',
    '        return res.status(410).json({ error: DOWNLOAD_ERRORS.LIMIT })',
    '      }',
    '    }',
    "    const upstreamHeader = (name) => (upstream.headers && typeof upstream.headers.get === 'function' ? upstream.headers.get(name) : null)",
    "    res.setHeader('Content-Type', upstreamHeader('content-type') || row.content_type || 'application/octet-stream')",
    "    for (const name of ['content-length', 'content-range', 'accept-ranges']) {",
    '      const value = upstreamHeader(name)',
    '      if (value) {',
    '        res.setHeader(name, value)',
    '      }',
    '    }',
    "    res.setHeader('Content-Disposition', contentDisposition(row.file_name))",
    '    res.status(upstream.status)',
    '    await pipeBody(upstream.body, res)',
    '    return undefined',
    '  } catch (error) {',
    "    console.error('Download route error:', error)",
    '    if (res.headersSent) {',
    '      res.destroy(error)',
    '      return undefined',
    '    }',
    "    return res.status(500).json({ error: 'Internal server error' })",
    '  }',
    '}',
    '',
    '// The file is streamed, never buffered: no response size cap.',
    'export const config = { api: { responseLimit: false } }',
    '',
    'export default async function handler(req, res) {',
    '  return serveDownload(req, res, {',
    '    query: (text, params) => db.query(text, params),',
    '    claim: (params) => claimDownload(db, params),',
    '    env: process.env,',
    '    fetch: fetch,',
    '    now: () => Date.now(),',
    '    sessionToken: __tqSessionToken,',
    '  })',
    '}',
    '',
  ].join('\n')
}

/** Where the generated route lives, for the page builders that link to it. */
export const DOWNLOAD_API_ROUTE_PATH = DOWNLOAD_ROUTE_PATH
