import type { UIDLAuthentication } from '@teleporthq/teleport-types'
import { CONTENT_COMMENTS_TABLES } from './content-tables'

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
 * and, on a per-table read route, only once the route's exposure check
 * (`__taGuardExposure`, teleport-plugin-next-data-source) admitted the session
 * for a page that binds the table —
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
/**
 * Tables no caller reaches any more: not a browser, not the app's own server
 * code. `password_reset_tokens` kept live reset tokens in clear; the dedicated
 * reset routes replaced it (`teleport_password_resets`: hashed, single use).
 * Both data-route families refuse a request that names one, by its table or
 * anywhere in a statement's text.
 */
export const RETIRED_TABLES: ReadonlyArray<string> = ['password_reset_tokens']

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
  // Retired (RETIRED_TABLES): no caller reaches the table any more.
  'password_reset_tokens',
  // The hashed, single-use reset tokens of the dedicated reset routes.
  'teleport_password_resets',
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
  // A push subscription is a capability: whoever holds the endpoint and its
  // keys can notify that device. Only the app's push routes read the table.
  'teleport_push_subscriptions',
  // A comment is public once approved, but the row carries the commenter's
  // email and the comments still waiting for approval; the post page reads
  // the approved ones server-side, public columns only. One table per content
  // preset that takes comments.
  ...CONTENT_COMMENTS_TABLES,
  // What visitors told the AI assistant, and the merchant's private knowledge
  // base it answers from: the assistant reads them in its own server
  // segments, the admin lists them with its session.
  'teleport_ai_chat_knowledge_sources',
  'teleport_ai_chat_documents',
  'teleport_ai_chat_conversations',
  'teleport_ai_chat_messages',
  // A booking carries the customer's name, email and phone and the key of
  // their booking link; the capacity counters decide who gets the last place;
  // the business's settings row carries the address its notices go to. The
  // booking pages read them only in server segments (public columns only),
  // the admin with its session.
  'teleport_bookings',
  'teleport_booking_units',
  'teleport_booking_settings',
  // A calendar link holds the other platform's private calendar address and
  // the key of this site's own feed; its blocks are that platform's bookings.
  // Only the sync's server segments and the feed route read them.
  'teleport_booking_calendars',
  'teleport_booking_calendar_blocks',
  // The automations' queue: which automations are on, what each run did (its
  // error text quotes the customer's details) and the runs parked at a Wait,
  // whose stored context carries the event's details. Only the app's own
  // dispatcher reads them; the editor reads them through the data source.
  'teleport_automations',
  'teleport_event_deliveries',
  'teleport_automation_waits',
  // Which records each signed-in visitor looked at, keyed by their user id:
  // the "recently viewed" strips read it in server segments, for the session's
  // own user only.
  'teleport_recently_viewed',
  // The addresses people left to be told when something opens up: an audience
  // is the merchant's, never a page's.
  'teleport_waitlist_entries',
  'teleport_booking_waitlist',
  // The newsletter's issues: drafts, schedules, what each send reached and why
  // one failed. The editor and the worker reach them through the data source,
  // the admin with its session; a page a visitor opens reads none of them
  // (PRIVATE_CUSTOMER_RECORD_TABLES). Its subscribers are `users` rows.
  'teleport_newsletter_issues',
]

/**
 * The generated app's own bookkeeping: the request limiter's counters
 * (`utils/security-runtime.js`) key every visitor's address and email hash, and
 * the automations dispatcher's replay ledger remembers which signed requests it
 * has already run.
 */
export const RUNTIME_TABLES: ReadonlyArray<string> = [
  'teleport_rate_limits',
  'teleport_automation_requests',
]

export const PROTECTED_TABLES: ReadonlyArray<string> = [
  ...MONEY_TABLES,
  ...CUSTOMER_RECORD_TABLES,
  ...RUNTIME_TABLES,
]

/**
 * The customer tables whose every row is ONE customer's private record: an
 * account, an order and its lines, an invoice, a shipment, a refund request, a
 * subscription and what it downloaded, a booking, a cart. A read of one that a
 * server segment runs for a visitor (the data API) is always narrowed to the
 * visitor's own rows, whatever its filters name — a list built without an
 * owner filter still shows only them. A staff session and a server job read
 * them whole, as before.
 *
 * `teleport_newsletter_issues` is here too though no visitor owns a row: with
 * no owner column, a visitor's read of it finds nothing, so a page cannot list
 * drafts, schedules or send errors. A public archive of sent issues would be a
 * `PUBLIC_FEED_TABLES` projection (`status = 'sent'`).
 *
 * The other customer tables hold content a page shows everyone once approved
 * (a product review, a comment), or the merchant's own (an audience, the AI
 * assistant's knowledge, the booking settings): their reads are scoped only by
 * the owner filters they name.
 */
export const PRIVATE_CUSTOMER_RECORD_TABLES: ReadonlyArray<string> = [
  'users',
  'teleport_orders',
  'teleport_order_items',
  'teleport_invoices',
  'teleport_invoice_items',
  'teleport_shipments',
  'teleport_shipment_items',
  'teleport_withdrawal_requests',
  'teleport_withdrawal_request_items',
  'teleport_abandoned_carts',
  'teleport_cart',
  'teleport_cart_items',
  'teleport_subscriptions',
  'teleport_downloads',
  'teleport_bookings',
  'teleport_newsletter_issues',
]

/**
 * A private record table whose rows name no owner of their own but belong to a
 * parent row that does (an order's lines are the order's buyer's): the column
 * that holds the parent's `id`. Used only when the table has no owner column
 * and does have this one; otherwise a visitor's read of it finds nothing.
 */
export const PRIVATE_RECORD_PARENTS: Readonly<Record<string, { column: string; parent: string }>> =
  {
    teleport_order_items: { column: 'order_id', parent: 'teleport_orders' },
    teleport_invoices: { column: 'order_id', parent: 'teleport_orders' },
    teleport_invoice_items: { column: 'invoice_id', parent: 'teleport_invoices' },
    teleport_shipments: { column: 'order_id', parent: 'teleport_orders' },
    teleport_shipment_items: { column: 'shipment_id', parent: 'teleport_shipments' },
    teleport_withdrawal_requests: { column: 'order_id', parent: 'teleport_orders' },
    teleport_withdrawal_request_items: {
      column: 'withdrawal_request_id',
      parent: 'teleport_withdrawal_requests',
    },
    teleport_cart_items: { column: 'cart_id', parent: 'teleport_cart' },
    teleport_downloads: { column: 'order_id', parent: 'teleport_orders' },
  }

/**
 * The columns of a customer record that say WHOSE record it is. A read of a
 * customer table that a server segment runs for a visitor (the data API) is
 * scoped to that visitor by these columns: a filter on one never widens to the
 * whole table (an empty, `all` or `!=` value matches nothing), and for a
 * signed-in visitor its value must be the session's own id or email — never a
 * value the browser chose. The `users` row IS its owner, so its own `id` and
 * `email` are the owner columns there.
 */
export const OWNER_ID_COLUMNS: ReadonlyArray<string> = ['user_id', 'customer_id', 'owner_id']
export const OWNER_EMAIL_COLUMNS: ReadonlyArray<string> = ['customer_email', 'user_email', 'email']
export const OWNER_COLUMNS_BY_TABLE: Readonly<Record<string, { ids: string[]; emails: string[] }>> =
  {
    users: { ids: ['id'], emails: ['email'] },
  }

/**
 * The address domain of a GUEST's own `users` row: the "Resolve Current User
 * Or Guest Session" node files a signed-out visitor as `<uuid>@anonymous.local`
 * before anything is written under that id. Such a row is no account. The
 * editor's `ANONYMOUS_GUEST_EMAIL_SUFFIX` (and its `anonymousOwnerSql`) is the
 * same rule.
 */
export const ANONYMOUS_GUEST_EMAIL_SUFFIX = '@anonymous.local'

/**
 * SQL: the `users` row whose email column is `emailColumn` is a REGISTERED
 * account — any row but a guest's anonymous one. A row with no address at all
 * counts as registered (an account signed in some other way), as in the
 * editor's `anonymousOwnerSql`: a guest id never names it.
 */
export const registeredAccountEmailSql = (emailColumn: string): string =>
  `COALESCE(LOWER(${emailColumn}), '') NOT LIKE '%${ANONYMOUS_GUEST_EMAIL_SUFFIX}'`

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

/**
 * A column of ANY table whose name is a credential's: a password or its hash, a
 * secret, a token or key of the kinds that ARE an account or an integration —
 * never a word that merely contains one (`secret_ingredient`, `token_count`,
 * `design_tokens`). Such a column never leaves the server in a row, whatever
 * the table, unless the server-side caller named it in its own projection (see
 * `__taWithoutCredentials`). The auth users table's own credential columns
 * (`AUTH_CREDENTIAL_COLUMNS`: the OAuth token type, scope and expiry too) are
 * dropped from its rows on top of these.
 *
 *  - exactly `password`, `password_hash` / `hashed_password` / `passwordhash`,
 *    `secret`, `token`;
 *  - an access, refresh, reset, verification, session, id, api, auth, bearer
 *    or csrf token, as `<kind>_token` or `<kind>token`, alone or at the end of
 *    a longer name (`password_reset_token`, `oauth_access_token`);
 *  - a client, api, webhook, signing or app secret, the same way;
 *  - an API key: `api_key`, `apikey`, `<anything>_api_key`;
 *  - a one-time-password seed (`otp`, `totp`, `totp_secret`), a private key
 *    (`private_key`, `signing_private_key`) and recovery or backup codes.
 */
export const CREDENTIAL_COLUMN_PATTERN =
  /^(?:password|password_hash|hashed_password|passwordhash|secret|token|otp|totp)$|(?:^|_)(?:access|refresh|reset|verification|session|id|api|auth|bearer|csrf)_?token$|(?:^|_)(?:client|api|webhook|signing|app|otp|totp)_?secret$|(?:^|_)api_?key$|(?:^|_)private_?key$|(?:^|_)(?:recovery|backup)_?codes?$/i

export const isCredentialColumnName = (name: string): boolean =>
  CREDENTIAL_COLUMN_PATTERN.test(String(name || '').trim())

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
 * The roles that may open the generated admin panel as a whole: the roles its
 * FOLDER admits, which the middleware and the workflow-route guard union into
 * every page under it. A page's own roles never count — an admin page that also
 * admits another role (a staff screen) must not hand that role the rest of the
 * panel.
 *
 * A folder that records no roles (an older project, or one an owner edited)
 * falls back to the roles EVERY protected admin page admits. Sorted; empty
 * without an admin panel.
 */
export const resolveAdminPanelRoles = (auth?: UIDLAuthentication | null): string[] => {
  if (!auth) {
    return []
  }
  const folderRoles = new Set<string>()
  Object.values(auth.folderProtection || {}).forEach((folder) => {
    if (folder && folder.folderName === ADMIN_FOLDER_NAME) {
      ;(folder.allowedRoles || []).forEach((role) => folderRoles.add(role))
    }
  })
  if (folderRoles.size > 0) {
    return Array.from(folderRoles).sort()
  }

  let everyPageAdmits: string[] | null = null
  for (const page of Object.values(auth.pageProtection || {})) {
    const route = page && typeof page.route === 'string' ? page.route : ''
    if (route !== ADMIN_ROUTE_PREFIX && !route.startsWith(`${ADMIN_ROUTE_PREFIX}/`)) {
      continue
    }
    const pageRoles = page.allowedRoles || []
    everyPageAdmits =
      everyPageAdmits === null
        ? Array.from(new Set(pageRoles))
        : everyPageAdmits.filter((role) => pageRoles.indexOf(role) !== -1)
  }
  return (everyPageAdmits || []).sort()
}

/**
 * The roles allowed to read a protected table from a browser: the admin
 * panel's (`resolveAdminPanelRoles`) — so a role that opens only some admin
 * pages reads no account, email or order. A project without an admin panel
 * has no page that binds a money table, so the empty list (server-side
 * callers only) is the right answer.
 */
export const resolveTrustedReaderRoles = (auth?: UIDLAuthentication | null): string[] =>
  resolveAdminPanelRoles(auth)

/** The role a project names its administrators by, whether or not it has the generated admin panel. */
export const ADMIN_ROLE = 'admin'

/**
 * The roles the project grants staff access: the admin panel's
 * (`resolveAdminPanelRoles`) and the explicit `admin` role. Only these read and
 * change OTHER customers' records through a server segment; every other role
 * — the one every sign-up gets, and the ones customers get through a sign-up
 * or a subscription (`member` …) — is scoped to its own rows.
 */
export const resolveStaffRoles = (auth?: UIDLAuthentication | null): string[] =>
  Array.from(new Set([...resolveAdminPanelRoles(auth), ADMIN_ROLE])).sort()

/**
 * Where the shared security runtime lives in a generated project, from its
 * root — `securityRuntimeSpecifier` in teleport-plugin-next-workflows, which
 * writes the module, names the same file.
 */
export const SECURITY_RUNTIME_MODULE_PATH = 'utils/security-runtime'

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
 *  - `__taWithoutCredentials(rows, tableName, keep?)` — the rows with the auth
 *    users table's credential columns removed (all of them for that table's
 *    rows, the unambiguous ones for a raw statement's, `tableName` null) and
 *    every column of any table named like a credential
 *    (`isCredentialColumnName`), except the ones in `keep`: the columns a
 *    server-side caller named in its own projection.
 *  - `__taCredentialsNamedBy(sql, rows)` — the credential-named columns of a
 *    raw statement's rows that the statement names itself.
 *  - `__taSafeEqual(given, expected)` — constant-time secret comparison: the
 *    shared security runtime's `safeEqual` (`utils/security-runtime.js`,
 *    which every app with data routes carries), required from `projectRoot`
 *    (`'../../..'` for `pages/api/<folder>/<route>.js`, the default; `'../..'`
 *    for `utils/<dir>/<file>.js` and `pages/api/<route>.js`). Without it no
 *    secret matches.
 *  - `__taIsCredentialTable(tableName)` — the table holds those credentials.
 *  - `__taGuardRead(req, tableName, rawQuery)` — for the per-table read routes:
 *    resolves to `null` when the request may proceed, else `{status, message}`.
 *    A protected table is readable by an internal caller or by a session whose
 *    role is in `trustedReaderRoles`; the session is decoded by the
 *    `__tqSessionToken` resolver, which the host route must inline as well.
 */
export const generateTableAccessHelperCode = (params: {
  trustedReaderRoles: ReadonlyArray<string>
  projectRoot?: string
}): string => {
  const securityRuntime = `${params.projectRoot || '../../..'}/${SECURITY_RUNTIME_MODULE_PATH}`
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
// Reached by no caller, the app's own server code included — see RETIRED_TABLES.
var __TA_RETIRED_TABLES = ${JSON.stringify(RETIRED_TABLES)};
var __TA_TRUSTED_READER_ROLES = ${JSON.stringify(params.trustedReaderRoles)};
var __TA_CREDENTIAL_COLUMNS = ${JSON.stringify(AUTH_CREDENTIAL_COLUMNS)};
var __TA_UNAMBIGUOUS_CREDENTIAL_COLUMNS = ${JSON.stringify(UNAMBIGUOUS_CREDENTIAL_COLUMNS)};
var __TA_CREDENTIAL_TABLES = ${JSON.stringify(AUTH_CREDENTIAL_TABLES)};
// A column of any table whose name is a credential's (see CREDENTIAL_COLUMN_PATTERN).
var __TA_CREDENTIAL_NAME_RE = ${CREDENTIAL_COLUMN_PATTERN.toString()};
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
  return __taSafeEqual(secret, process.env.NEXTAUTH_SECRET);
}

// Constant-time comparison of two secrets: the shared security runtime's
// safeEqual (false for a missing, empty or differently long value, never a
// throw). It is loaded only once a value is presented; an app without the
// runtime matches no secret (fail closed — every app with data routes has it).
function __taSafeEqual(given, expected) {
  if (typeof given !== 'string' || !given) return false;
  var security = null;
  try {
    security = require('${securityRuntime}');
  } catch (e) {
    return false;
  }
  return !!security && typeof security.safeEqual === 'function' && security.safeEqual(given, expected) === true;
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

// A column named like a credential, in any table.
function __taIsCredentialColumn(name) {
  var column = String(name == null ? '' : name).toLowerCase();
  return __TA_CREDENTIAL_NAME_RE.test(column.trim());
}

// Credentials never travel in a row: a column is dropped by name, however the
// caller spelled it in its projection — the auth table's credentials, and any
// column of any table named like one. \`keep\` lists the columns a SERVER-SIDE
// caller named in its own projection (a sign-in check reading the hash it then
// compares on the server); nothing else is ever kept.
function __taWithoutCredentials(rows, tableName, keep) {
  if (!Array.isArray(rows)) return rows;
  var dropped = tableName && __taIsCredentialTable(tableName)
    ? __TA_CREDENTIAL_COLUMNS
    : tableName ? [] : __TA_UNAMBIGUOUS_CREDENTIAL_COLUMNS;
  var kept = Array.isArray(keep)
    ? keep.map(function(column) { return __taNormalizeTable(column); })
    : [];
  return rows.map(function(row) {
    if (!row || typeof row !== 'object') return row;
    var copy = {};
    Object.keys(row).forEach(function(key) {
      var column = String(key).toLowerCase();
      var credential = dropped.indexOf(column) !== -1 || __taIsCredentialColumn(column);
      if (!credential || kept.indexOf(column) !== -1) copy[key] = row[key];
    });
    return copy;
  });
}

// The credential-named columns a raw statement names itself (\`SELECT password
// FROM …\`, \`WHERE token = $1\`) — the only ones its rows may carry back.
function __taCredentialsNamedBy(sql, rows) {
  var cleaned = __taCleanSql(sql);
  if (!cleaned.ok || !Array.isArray(rows) || !rows[0] || typeof rows[0] !== 'object') return [];
  return Object.keys(rows[0]).filter(function(key) {
    if (!__taIsCredentialColumn(key) && __TA_UNAMBIGUOUS_CREDENTIAL_COLUMNS.indexOf(String(key).toLowerCase()) === -1) return false;
    var escaped = String(key).replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
    return new RegExp('(?:^|[^A-Za-z0-9_$])"?' + escaped + '"?(?![A-Za-z0-9_$])', 'i').test(cleaned.text);
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

// The retired table a request names (__TA_RETIRED_TABLES), or null: its
// table, or any mention in a statement's text — quoted or not, in any case,
// schema-qualified, even inside a string or a comment.
function __taRetiredTableNamed(tableName, sql) {
  var named = __taNormalizeTable(tableName);
  for (var i = 0; i < __TA_RETIRED_TABLES.length; i++) {
    var table = __TA_RETIRED_TABLES[i];
    if (named === table) return table;
    if (typeof sql === 'string' && new RegExp('(?:^|[^A-Za-z0-9_$])"?' + table + '"?(?![A-Za-z0-9_$])', 'i').test(sql)) return table;
  }
  return null;
}

// null when the read may proceed, else { status, message }.
async function __taGuardRead(req, tableName, rawQuery) {
  if (__taRetiredTableNamed(tableName, rawQuery)) return { status: 403, message: 'Forbidden' };
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
