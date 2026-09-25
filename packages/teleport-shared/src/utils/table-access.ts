import type { UIDLAuthentication } from '@teleporthq/teleport-types'

/**
 * Which store tables a browser may touch through the generated data routes.
 *
 * Every generated Next store exposes two families of data routes: the
 * workflow data API (`/api/data/<source>/<op>`, called by workflow data nodes)
 * and one read route per bound table (`/api/teleport-<table>-<source>`, called
 * by the pages' data providers, with a `rawQuery` escape hatch). Both accept
 * a browser's request. For most tables that is the product: a catalogue is
 * public. For the tables below it is theft.
 *
 * `MONEY_TABLES` are money and the keys to it: a gift card's code and
 * balance, its ledger, every voucher code (a generated batch is a list of
 * single-use coupons) and the redemption ledger. A browser reads or writes
 * them only as a signed-in member of a trusted role (the generated admin) —
 * the server-side workflow segments that look a card up, debit it or redeem a
 * code identify themselves with the app secret instead.
 *
 * `CUSTOMER_RECORD_TABLES` are the customers' own records: who ordered what
 * and where it ships, their invoices, parcels, returns, carts and reviews,
 * and the accounts themselves. A buyer is served their own order through the
 * page-load workflow (a server segment), the merchant every order through
 * the admin's session — nothing in a generated storefront lists them from
 * the browser, so a browser that asks for the list is not the store.
 *
 * `PROTECTED_TABLES` is both, spliced into both route families and the
 * restricted-caller SQL check, so no reader can disagree about what is
 * private.
 *
 * `WRITE_PROTECTED_TABLES` decide how much is given away but must stay readable:
 * the storefront provider loads the active automatic rules to price the order
 * summary. A browser that could update `usage_count` or `discount_value` could
 * discount forever, so writes need the same trust.
 */
export const MONEY_TABLES: ReadonlyArray<string> = [
  'teleport_gift_cards',
  'teleport_gift_card_transactions',
  'teleport_vouchers',
  'teleport_voucher_redemptions',
  // The sent-email log keeps the RENDERED message, and a gift-card email
  // carries the full code — protecting the card table while serving its
  // codes from the email log would be no protection at all.
  'teleport_sent_emails',
  // A live reset token IS the account: whoever reads one sets the password.
  // Only the server-side reset workflows ever read or write the table.
  'password_reset_tokens',
  // A digital product's files and license keys ARE the product: the order
  // page's server segment mints a download link per paid line, and the
  // download route assigns a key; nothing else reads them.
  'teleport_product_files',
  'teleport_license_keys',
]

export const CUSTOMER_RECORD_TABLES: ReadonlyArray<string> = [
  'users',
  'teleport_orders',
  'teleport_order_items',
  'teleport_invoices',
  'teleport_invoice_items',
  'teleport_events',
  'teleport_shipments',
  'teleport_shipment_items',
  'teleport_withdrawal_requests',
  'teleport_withdrawal_request_items',
  'teleport_abandoned_carts',
  'teleport_cart',
  'teleport_cart_items',
  'teleport_favourites',
  // Who subscribed to what and what they downloaded: the buyer's own page reads
  // them through a server segment, the admin through its session.
  'teleport_subscriptions',
  'teleport_downloads',
  // A review is public once approved, but the row carries the reviewer's
  // email and the ones still in moderation; the product page reads the
  // approved ones server-side.
  'teleport_product_reviews',
]

export const PROTECTED_TABLES: ReadonlyArray<string> = [...MONEY_TABLES, ...CUSTOMER_RECORD_TABLES]

export const WRITE_PROTECTED_TABLES: ReadonlyArray<string> = ['teleport_discounts']

/**
 * The auth users table's CREDENTIALS — the password hash and the OAuth
 * provider's tokens (an access or refresh token IS the user's account at the
 * provider). Profile columns stay readable; these never leave the server in a
 * row, whoever asks: the generated admin's users list shows no password either.
 */
export const AUTH_CREDENTIAL_COLUMNS: ReadonlyArray<string> = [
  'password',
  'access_token',
  'refresh_token',
  'id_token',
  'session_state',
  'token_type',
  'scope',
  'expires_at',
]

/** The table the generated auth reads and writes those credentials in. */
export const AUTH_CREDENTIAL_TABLES: ReadonlyArray<string> = ['users']

/**
 * The credential names no other table has a reason to use: dropped from the
 * rows of a raw statement too, where a column cannot be traced to its table
 * (`scope` and `expires_at` are ordinary columns elsewhere — a gift card
 * expires).
 */
const UNAMBIGUOUS_CREDENTIAL_COLUMNS = AUTH_CREDENTIAL_COLUMNS.filter(
  (column) => column !== 'scope' && column !== 'expires_at'
)

export interface PublicTableFeed {
  /** The only columns a browser is ever served. */
  columns: ReadonlyArray<string>
  /** SQL every browser read of the table is narrowed with. */
  predicate: string
}

/**
 * A table a browser may read ONLY as a fixed projection of the rows the
 * DATABASE considers live — never whole, never through raw SQL, and never
 * filtered or sorted by a column outside the projection (a filter is an
 * oracle: `usage_count > 100` answers for a column that is never returned).
 *
 * `teleport_discounts` is the merchant's campaign plan: drafts, paused rules,
 * launches scheduled for next month, how often each has been used. The
 * storefront needs none of that; it prices the order summary from the rules
 * that apply right now. Serving exactly those rows is what keeps an
 * unannounced campaign unannounced, and it makes the WINDOW the database's
 * judgement, the same clock that re-prices the order at submit: the storefront
 * prices every row it is served and re-derives nothing from the browser clock,
 * so a disagreement with the server's re-pricing is resolved by re-reading the
 * feed.
 */
export const PUBLIC_FEED_TABLES: Readonly<Record<string, PublicTableFeed>> = {
  teleport_discounts: {
    // Exactly what the shared engine normalises a rule from (`__deNormalizeRule`),
    // plus `status`, which the storefront still checks. The window bounds,
    // `description` and `usage_count` are the merchant's, and stay with the
    // merchant.
    columns: [
      'id',
      'name',
      'status',
      'priority',
      'discount_type',
      'discount_value',
      'applies_to_all_products',
      'product_ids',
      'category_ids',
      'min_order_value',
      'min_quantity',
      'first_order_only',
      'buy_quantity',
      'get_quantity',
      'stackable',
    ],
    predicate:
      "status = 'active' AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at > NOW())",
  },
}

/** The generated back office: its folder in the pages tree and its route prefix. */
const ADMIN_FOLDER_NAME = 'admin-panel'
const ADMIN_ROUTE_PREFIX = '/admin'

/**
 * The roles allowed to read a protected table from a browser: whoever may open
 * the generated admin panel, read off the protection the UIDL records for its
 * folder and pages. A project without an admin panel has no page that binds a
 * money table, so the empty list (server-side callers only) is the right answer.
 */
export const resolveTrustedReaderRoles = (auth?: UIDLAuthentication | null): string[] => {
  const roles = new Set<string>()
  if (!auth) {
    return []
  }
  Object.values(auth.folderProtection || {}).forEach((folder) => {
    if (folder && folder.folderName === ADMIN_FOLDER_NAME) {
      ;(folder.allowedRoles || []).forEach((role) => roles.add(role))
    }
  })
  Object.values(auth.pageProtection || {}).forEach((page) => {
    const route = page && typeof page.route === 'string' ? page.route : ''
    if (route === ADMIN_ROUTE_PREFIX || route.startsWith(`${ADMIN_ROUTE_PREFIX}/`)) {
      ;(page.allowedRoles || []).forEach((role) => roles.add(role))
    }
  })
  return Array.from(roles).sort()
}

/**
 * ES5 source of the guard, inlined into a generated route. Declares:
 *  - `__taIsInternalRequest(req)` — the caller presented the app secret, or
 *    is the module's own server-side `fetchData` (`req.__tqServerCall`).
 *  - `__taIsRestrictedRequest(req)` — a server-side node that presents the app
 *    secret but runs SQL it did not write (the AI data-query node): trusted to
 *    run raw SQL, never trusted with the protected tables.
 *  - `__taBrowserIsReadOnly(req)` — true for a browser in an app that has an
 *    app secret: every server-side caller identifies itself there, so a browser
 *    reads through the structured routes only — no raw SQL, no writes.
 *  - `__taNormalizeTable(name)` — the bare table a spelling names.
 *  - `__taSqlMentionsTable(sql, table)` — the statement names the table as an
 *    identifier (bare, double-quoted or schema-qualified; comments and string
 *    literals cannot hide or fake a mention).
 *  - `__taAssertSqlTextAllowed(sql)` — throws a 403 error when an untrusted
 *    caller's raw statement touches a protected table or a feed table, or
 *    writes a write-protected one.
 *  - `__taPublicFeed(req, tableName)` — the projection an untrusted caller is
 *    served of a feed table (`{ columns, predicate }`), or `null` when the
 *    caller may read the table as asked (a server-side one) or the table has
 *    no feed.
 *  - `__taAssertFeedFields(tableName, feed, fields)` — throws a 403 error when
 *    a filter or sort field is not one of the feed's columns.
 *  - `__taWithoutCredentials(rows, tableName)` — the rows with the auth users
 *    table's credential columns removed: all of them for that table's rows,
 *    the unambiguous ones for a raw statement's (`tableName` null).
 *  - `__taIsCredentialTable(tableName)` — the table holds those credentials.
 *  - `__taGuardRead(req, tableName, rawQuery)` — for the per-table read routes:
 *    resolves to `null` when the request may proceed, else `{status, message}`.
 *    A protected table is readable by an internal caller or by a session whose
 *    role is in `trustedReaderRoles`; the session is decoded by the
 *    `__tqSessionToken` resolver, which the host route must inline as well.
 */
export const generateTableAccessHelperCode = (params: {
  trustedReaderRoles: ReadonlyArray<string>
}): string => {
  return `// GENERATED — see generateTableAccessHelperCode in
// @teleporthq/teleport-shared/src/utils/table-access.ts.
//
// Tables that ARE money, and tables that decide how much of it is given away.
// A browser reads the first group only as a trusted role (the generated admin)
// and writes the second group never; server-side workflow segments present the
// app secret instead. One list for both data-route families.
var __TA_PROTECTED_TABLES = ${JSON.stringify(PROTECTED_TABLES)};
var __TA_WRITE_PROTECTED_TABLES = ${JSON.stringify(WRITE_PROTECTED_TABLES)};
// Readable from a browser only as this projection of the rows the database
// calls live — see PUBLIC_FEED_TABLES. The per-table routes serve a whole
// table (and raw SQL), which cannot express a feed, so there they are refused
// like a protected table.
var __TA_PUBLIC_FEED_TABLES = ${JSON.stringify(PUBLIC_FEED_TABLES)};
var __TA_FEED_TABLES = Object.keys(__TA_PUBLIC_FEED_TABLES);
var __TA_TRUSTED_READER_ROLES = ${JSON.stringify(params.trustedReaderRoles)};
var __TA_CREDENTIAL_COLUMNS = ${JSON.stringify(AUTH_CREDENTIAL_COLUMNS)};
var __TA_UNAMBIGUOUS_CREDENTIAL_COLUMNS = ${JSON.stringify(UNAMBIGUOUS_CREDENTIAL_COLUMNS)};
var __TA_CREDENTIAL_TABLES = ${JSON.stringify(AUTH_CREDENTIAL_TABLES)};
var __TA_SQL_WRITE_RE = /\\b(?:insert|update|delete|merge|truncate)\\b/i;
// What a statement can reach without spelling a table's name where this scan
// can see it: a Unicode-escaped identifier (U&"\\0075sers" is \`users\`), the
// functions that run SQL text or dump whole tables, schemas or the database
// (the table name then sits in a string, or is not named at all), and the
// planner statistics, which hold sampled column values of every table.
var __TA_OPAQUE_SQL_RE = /u&"|\\b(?:query|table|cursor|schema|database)_to_xml\\w*\\s*\\(|\\bts_(?:stat|rewrite)\\s*\\(|\\bdblink\\w*\\s*\\(|\\bpg_read_(?:binary_)?file\\s*\\(|\\blo_(?:import|export|get)\\s*\\(|\\bpg_stat(?:s|istic)\\w*/i;

// Only server code can read NEXTAUTH_SECRET, so a browser cannot forge the
// header a server segment sends. An in-process call (getStaticProps and the
// page-load workflows call the handler directly with a synthetic request)
// marks its request object instead — a property, never a header, so nothing
// on the wire can claim it.
function __taPresentsAppSecret(req) {
  var secret = req && req.headers && req.headers['x-internal-data-secret'];
  return !!(secret && process.env.NEXTAUTH_SECRET && secret === process.env.NEXTAUTH_SECRET);
}

function __taIsRestrictedRequest(req) {
  return __taPresentsAppSecret(req) && !!(req.headers && req.headers['x-tq-restricted-sql'] === '1');
}

function __taIsInternalRequest(req) {
  if (req && req.__tqServerCall === true) return true;
  return __taPresentsAppSecret(req) && !__taIsRestrictedRequest(req);
}

// Generated browser code reads through the structured routes and never sends
// SQL or a write of its own — every data node runs server-side and presents
// the secret. So where a secret exists to tell the two apart, anything else a
// browser sends is refused whole: no statement scan has to be right about it.
// An app without one (no authentication, hence no store) keeps the scan.
function __taBrowserIsReadOnly(req) {
  return !!process.env.NEXTAUTH_SECRET && !__taIsInternalRequest(req) && !__taIsRestrictedRequest(req);
}

// Comments and string literals out, so a table name inside a string neither
// hides a reference nor fakes one. Quoted identifiers stay, whole: in Postgres
// they name tables, which is exactly what is being looked for.
//
// ⛔ This is a lexer, not a search: a quote or comment marker inside a quoted
// identifier ("x'", "--") is part of the name, a \`$\` or an \`E\` inside an
// identifier (a$b$, ELSE'…') starts neither a dollar quote nor an escape
// string, and a dollar-quoted body is consumed by its own tag. An UNTERMINATED
// literal, identifier, comment or dollar quote makes the whole scan fail closed
// (ok:false): a statement this cleaner cannot read is one it cannot vouch for.
function __taCleanSql(sql) {
  var text = String(sql || '');
  var out = '';
  var i = 0;
  function inIdentifier(at) { return at > 0 && /[A-Za-z0-9_$]/.test(text[at - 1]); }
  while (i < text.length) {
    var ch = text[i];
    var next = text[i + 1];
    if (ch === '-' && next === '-') {
      while (i < text.length && text[i] !== '\\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      var depth = 1;
      while (i < text.length && depth > 0) {
        if (text[i] === '/' && text[i + 1] === '*') { depth++; i += 2; continue; }
        if (text[i] === '*' && text[i + 1] === '/') { depth--; i += 2; continue; }
        i++;
      }
      if (depth > 0) return { ok: false, text: out };
      out += ' ';
      continue;
    }
    // "…" is one identifier token; "" inside it is an escaped quote.
    if (ch === '"') {
      var end = i + 1;
      var closedIdentifier = false;
      while (end < text.length) {
        if (text[end] === '"' && text[end + 1] === '"') { end += 2; continue; }
        if (text[end] === '"') { closedIdentifier = true; break; }
        end++;
      }
      if (!closedIdentifier) return { ok: false, text: out };
      out += text.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    // $tag$ … $tag$ — the body is data whatever it holds.
    if (ch === '$' && !inIdentifier(i)) {
      var tagMatch = /^\\$[A-Za-z_][A-Za-z0-9_]*\\$|^\\$\\$/.exec(text.slice(i));
      if (tagMatch) {
        var tag = tagMatch[0];
        var close = text.indexOf(tag, i + tag.length);
        if (close === -1) return { ok: false, text: out };
        i = close + tag.length;
        out += ' ';
        continue;
      }
    }
    // E'…' understands backslash escapes; a plain '…' doubles the quote.
    if (ch === "'" || ((ch === 'E' || ch === 'e') && next === "'" && !inIdentifier(i))) {
      var escapes = ch !== "'";
      if (escapes) i++;
      i++;
      var closed = false;
      while (i < text.length) {
        if (escapes && text[i] === '\\\\') { i += 2; continue; }
        if (text[i] === "'" && text[i + 1] === "'") { i += 2; continue; }
        if (text[i] === "'") { i++; closed = true; break; }
        i++;
      }
      if (!closed) return { ok: false, text: out };
      out += ' ';
      continue;
    }
    out += ch;
    i++;
  }
  return { ok: true, text: out };
}

function __taNormalizeTable(tableName) {
  var name = String(tableName || '').trim().toLowerCase();
  var parts = name.split('.');
  return parts[parts.length - 1].replace(/"/g, '');
}

// An unreadable statement, or one that can reach a table without naming it,
// counts as mentioning EVERY protected table: fail closed rather than let a
// spelling this scan cannot see decide it is harmless.
function __taSqlMentionsTable(sql, table) {
  var cleaned = __taCleanSql(sql);
  if (!cleaned.ok || __TA_OPAQUE_SQL_RE.test(cleaned.text)) return true;
  var pattern = new RegExp('(?:^|[^A-Za-z0-9_])"?' + table + '"?(?![A-Za-z0-9_])', 'i');
  return pattern.test(cleaned.text);
}

function __taIsCredentialTable(tableName) {
  return __TA_CREDENTIAL_TABLES.indexOf(__taNormalizeTable(tableName)) !== -1;
}

// Credentials never travel in a row: a column is dropped by name, however the
// caller spelled it in its projection.
function __taWithoutCredentials(rows, tableName) {
  if (!Array.isArray(rows)) return rows;
  var dropped = tableName && __taIsCredentialTable(tableName)
    ? __TA_CREDENTIAL_COLUMNS
    : tableName ? [] : __TA_UNAMBIGUOUS_CREDENTIAL_COLUMNS;
  if (dropped.length === 0) return rows;
  return rows.map(function(row) {
    if (!row || typeof row !== 'object') return row;
    var copy = {};
    Object.keys(row).forEach(function(key) {
      if (dropped.indexOf(String(key).toLowerCase()) === -1) copy[key] = row[key];
    });
    return copy;
  });
}

function __taForbid(table) {
  var err = new Error('Forbidden: ' + table + ' is only accessible to server-side workflow nodes');
  err.status = 403;
  throw err;
}

function __taAssertSqlTextAllowed(sql) {
  var text = String(sql || '');
  // A statement can hand back a whole row (\`SELECT u FROM users u\`,
  // \`row_to_json(u)\`) without naming a credential column, so the table itself
  // is out of reach of anything but the server's own calls.
  for (var ci = 0; ci < __TA_CREDENTIAL_TABLES.length; ci++) {
    if (__taSqlMentionsTable(text, __TA_CREDENTIAL_TABLES[ci])) __taForbid(__TA_CREDENTIAL_TABLES[ci]);
  }
  for (var pi = 0; pi < __TA_PROTECTED_TABLES.length; pi++) {
    if (__taSqlMentionsTable(text, __TA_PROTECTED_TABLES[pi])) __taForbid(__TA_PROTECTED_TABLES[pi]);
  }
  // A feed table has exactly one browser-readable shape, and a statement the
  // caller wrote is not it.
  for (var fi = 0; fi < __TA_FEED_TABLES.length; fi++) {
    if (__taSqlMentionsTable(text, __TA_FEED_TABLES[fi])) __taForbid(__TA_FEED_TABLES[fi]);
  }
  var cleaned = __taCleanSql(text);
  // Unreadable, or a write: either way the write-protected tables are refused.
  if (cleaned.ok && !__TA_SQL_WRITE_RE.test(cleaned.text)) return;
  for (var wi = 0; wi < __TA_WRITE_PROTECTED_TABLES.length; wi++) {
    if (__taSqlMentionsTable(text, __TA_WRITE_PROTECTED_TABLES[wi])) __taForbid(__TA_WRITE_PROTECTED_TABLES[wi]);
  }
}

function __taRoleOf(token) {
  if (!token || typeof token !== 'object') return null;
  if (typeof token.role === 'string') return token.role;
  if (typeof token.roleName === 'string') return token.roleName;
  if (Array.isArray(token.roles) && typeof token.roles[0] === 'string') return token.roles[0];
  return null;
}

// The tables a read of \`tableName\` (or the raw statement) touches that this
// route family may not serve to a browser: the protected ones, and the feed
// tables, whose one browser-readable projection lives on the data API instead.
var __TA_ROUTE_PROTECTED_TABLES = __TA_PROTECTED_TABLES.concat(__TA_FEED_TABLES);

function __taProtectedTablesRead(tableName, rawQuery) {
  var touched = [];
  var bare = __taNormalizeTable(tableName);
  if (__TA_ROUTE_PROTECTED_TABLES.indexOf(bare) !== -1) touched.push(bare);
  if (typeof rawQuery === 'string' && rawQuery.length > 0) {
    for (var i = 0; i < __TA_ROUTE_PROTECTED_TABLES.length; i++) {
      if (touched.indexOf(__TA_ROUTE_PROTECTED_TABLES[i]) === -1 && __taSqlMentionsTable(rawQuery, __TA_ROUTE_PROTECTED_TABLES[i])) {
        touched.push(__TA_ROUTE_PROTECTED_TABLES[i]);
      }
    }
  }
  return touched;
}

// The projection an untrusted caller gets of a feed table, or null when the
// table has no feed or the caller is a server-side one reading it whole.
function __taPublicFeed(req, tableName) {
  if (__taIsInternalRequest(req)) return null;
  var feed = __TA_PUBLIC_FEED_TABLES[__taNormalizeTable(tableName)];
  return feed || null;
}

// A feed is filtered and sorted only by the columns it serves: a condition on
// any other column (or an expression over one) would answer for it.
function __taAssertFeedFields(tableName, feed, fields) {
  for (var i = 0; i < fields.length; i++) {
    if (!fields[i]) continue;
    var column = String(fields[i]).trim().replace(/"/g, '').toLowerCase();
    if (feed.columns.indexOf(column) === -1) __taForbid(__taNormalizeTable(tableName) + '.' + fields[i]);
  }
}

// null when the read may proceed, else { status, message }.
async function __taGuardRead(req, tableName, rawQuery) {
  if (typeof rawQuery === 'string' && rawQuery.length > 0 && __taBrowserIsReadOnly(req)) {
    return { status: 403, message: 'Forbidden: raw queries are only available to server-side calls' };
  }
  var touched = __taProtectedTablesRead(tableName, rawQuery);
  if (touched.length === 0) return null;
  if (__taIsInternalRequest(req)) return null;
  var token = null;
  try {
    token = await __tqSessionToken(req);
  } catch (e) {
    token = null;
  }
  if (!token) return { status: 401, message: 'Unauthenticated' };
  var role = __taRoleOf(token);
  if (!role || __TA_TRUSTED_READER_ROLES.indexOf(role) === -1) {
    return { status: 403, message: 'Forbidden: ' + touched[0] + ' is only readable by the store administrators' };
  }
  return null;
}
`
}
