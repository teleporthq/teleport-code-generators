/**
 * Generates a catch-all API route for workflow data operations.
 *
 * Workflow data handler nodes (data-select, data-create-item, data-update-item,
 * data-delete-item, data-count, data-raw-query) call /api/data/<dataSourceId>/<operation>.
 * This generator produces the Next.js catch-all route that handles those requests.
 *
 * Every SQL query is validated at runtime before execution to block forbidden
 * DDL / DCL operations (CREATE, ALTER, DROP, TRUNCATE, GRANT, etc.).
 * All interpolated identifiers (table names, column names, sort fields, filter
 * fields) are validated to prevent SQL injection.
 */

import { generateSqlValidatorCode } from './sql-validator'
import { generateCommonJsSessionTokenResolverCode } from './session-cookie-resolver'
import { TableAccess } from '@teleporthq/teleport-shared'

const DATA_NODE_TYPES = new Set([
  'data-select',
  'data-create-item',
  'data-update-item',
  'data-delete-item',
  'data-count',
  'data-raw-query',
  // Not a data-category node, but its handler executes its validated SQL
  // through this route's raw-query operation, so a workflow using only this
  // node still needs the route emitted.
  'ai-select-database-data',
])

export const needsDataAPIRoute = (usedNodeTypes: Set<string>): boolean => {
  for (const nt of usedNodeTypes) {
    if (DATA_NODE_TYPES.has(nt)) {
      return true
    }
  }
  return false
}

export interface DataAPIRouteOptions {
  // When auth is enabled and the users table is exposed to data mutations,
  // setting this to the users table name enforces a server-side check that
  // any update/delete targeting it uses session.user.id as the row filter.
  authUsersTableName?: string
  // Source-of-truth for "is the low-stock alert pipeline configured?". When
  // true, handleRawQuery inspects the rows returned from a query that looks
  // like the place-order workflow's "find low-stock products after stock
  // decrement" SELECT, and fires a fire-and-forget POST to
  // /api/ecommerce/low-stock-alert. When false (or omitted), the
  // detection short-circuits and never even pattern-matches the query —
  // a no-op for projects that don't have stock management on.
  lowStockAlertsEnabled?: boolean
  // Used as the fallback threshold the alert endpoint reports when the
  // SELECT itself didn't carry a `<= N` filter that the auto-fire could
  // extract. Defaulting to 5 mirrors the GUI's default.
  lowStockThreshold?: number
  // Tables a browser reads only through the per-table routes, as a member of
  // the roles listed for each (an internal tool's — see
  // `TableAccess.resolveRestrictedTables`). Like the protected tables, no caller
  // but the app's own server code reaches them through this route.
  restrictedTables?: Record<string, string[]>
}

/**
 * The only tables a BROWSER reads through this route, in an app whose server
 * code identifies itself with the app secret (see `__taBrowserIsReadOnly`).
 *
 * Every workflow data node runs server-side and presents the secret, so the
 * browser's reads here are the storefront's own: the cart re-reading its
 * products, the discount feed, the regional-pricing tables. Anything else a
 * browser names — a merchant's own table, the AI assistant's conversations and
 * knowledge base, `information_schema`, a `pg_*` catalog or statistics view —
 * is refused, rather than refused only when a list of dangerous names
 * remembered it. (An app without a secret cannot tell its server calls from a
 * browser's; there `assertNoSystemCatalogRead` still keeps the catalogs out, and
 * the shared protected set — `TableAccess.PROTECTED_TABLES`, the AI assistant's
 * tables among them — the store's private tables.)
 */
export const BROWSER_READABLE_TABLES: ReadonlyArray<string> = [
  'teleport_products',
  'teleport_product_variants',
  'teleport_discounts',
  'teleport_shipping_zones',
  'teleport_shipping_rates',
  'teleport_tax_rates',
  'teleport_store_locations',
  'teleport_blog_posts',
]

/**
 * What a browser is served of the readable tables whose unpublished rows sit
 * beside the public ones — the same policy the per-table read routes apply
 * (teleport-plugin-next-data-source `browser-row-policy.ts`, which this mirrors;
 * keep the two in step). A browser may not filter or sort by a hidden column:
 * a filter is an oracle for a column it never returns.
 */
export const BROWSER_ROW_POLICIES: Readonly<
  Record<string, { predicate: string; hiddenColumns: ReadonlyArray<string> }>
> = {
  teleport_blog_posts: {
    predicate: "status = 'published'",
    hiddenColumns: ['author_email', 'authorEmail'],
  },
  teleport_products: {
    predicate: "LOWER(TRIM(status)) = 'active'",
    hiddenColumns: [],
  },
  teleport_calendar_events: {
    predicate: "status = 'published'",
    hiddenColumns: ['online_url', 'onlineUrl'],
  },
}

export const generateDataAPIRoute = (options: DataAPIRouteOptions = {}): string => {
  const validatorCode = generateSqlValidatorCode()
  const authUsersTable = options.authUsersTableName || null
  const lowStockAlertsEnabled = !!options.lowStockAlertsEnabled
  const lowStockThreshold =
    typeof options.lowStockThreshold === 'number' && options.lowStockThreshold >= 0
      ? options.lowStockThreshold
      : 5
  // The money-table lists and the guards over them, shared with the per-table
  // read routes so both families refuse the same tables. No browser reads a
  // protected or restricted table through THIS route (workflow data nodes run
  // server-side), so the roles that may read one from a browser are irrelevant
  // here: every caller but the app's own server code is refused them.
  const tableAccessCode = TableAccess.generateTableAccessHelperCode({
    trustedReaderRoles: [],
    restrictedTables: options.restrictedTables,
  })
  const restrictsTables = tableAccessCode.indexOf('var __TA_RESTRICTED_TABLES =') !== -1

  return `const { Client } = require('pg');
${
  // The session cookie is resolved from the REQUEST rather than from
  // process.env.NEXTAUTH_URL — see session-cookie-resolver.ts. Reading it the
  // old way made `assertSessionOwnsUsersRow` answer 401 to a signed-in user on
  // any serverless instance that had not served an auth request first.
  authUsersTable ? generateCommonJsSessionTokenResolverCode() : ''
}const AUTH_USERS_TABLE = ${JSON.stringify(authUsersTable)};
const LOW_STOCK_ALERTS_ENABLED = ${JSON.stringify(lowStockAlertsEnabled)};
const LOW_STOCK_THRESHOLD = ${JSON.stringify(lowStockThreshold)};
${validatorCode}
${tableAccessCode}
function getPgSslFromEnv() {
  if (process.env.TELEPORT_DB_SSL === 'false') return false;
  if (process.env.TELEPORT_DB_SSL === 'true') return { rejectUnauthorized: false };
  return undefined;
}

/**
 * Common typo: postgresql:/user@host (one slash). pg-connection-string then parses
 * host as empty and misroutes the connection (SSL negotiation fails on wrong peer).
 */
function normalizePostgresConnectionString(connectionString) {
  if (!connectionString || typeof connectionString !== 'string') return connectionString;
  if (/^postgresql:\\/(?!\\/)/i.test(connectionString)) {
    return connectionString.replace(/^postgresql:\\//i, 'postgresql://');
  }
  return connectionString;
}

/**
 * pg parses connectionString and merges parse() over explicit ssl:false, so
 * ?sslmode=require still enables SSL. Remove ssl* query params when ssl is off.
 */
function stripSslQueryParamsFromConnectionString(connectionString) {
  if (!connectionString || typeof connectionString !== 'string') return connectionString;
  try {
    var u = new URL(connectionString.replace(/^postgresql:/i, 'postgres:'));
    u.searchParams.delete('sslmode');
    u.searchParams.delete('ssl');
    u.searchParams.delete('sslrootcert');
    u.searchParams.delete('sslcert');
    u.searchParams.delete('sslkey');
    return u.toString().replace(/^postgres:/i, 'postgresql:');
  } catch (e) {
    return connectionString;
  }
}

const getClient = () => {
  var ssl = getPgSslFromEnv();
  var connStr = process.env.TELEPORT_DB_CONNECTION_STRING;
  if (connStr) {
    connStr = normalizePostgresConnectionString(connStr);
  }
  if (ssl === false && connStr) {
    connStr = stripSslQueryParamsFromConnectionString(connStr);
  }
  if (connStr) {
    return new Client(
      Object.assign(
        { connectionString: connStr },
        ssl !== undefined ? { ssl: ssl } : {}
      )
    );
  }
  return new Client(
    Object.assign(
      {
        host: process.env.TELEPORT_DB_HOST,
        port: parseInt(process.env.TELEPORT_DB_PORT || '5432', 10),
        user: process.env.TELEPORT_DB_USER,
        password: process.env.TELEPORT_DB_PASSWORD,
        database: process.env.TELEPORT_DB_NAME,
      },
      ssl !== undefined ? { ssl: ssl } : {}
    )
  );
};

/**
 * Validate all filter field names (source) to prevent identifier injection.
 */
function validateFilters(filters) {
  if (!filters || !Array.isArray(filters)) return;
  for (var i = 0; i < filters.length; i++) {
    var filterField = filters[i].source || filters[i].field;
    if (filterField) {
      assertIdentifierSafe(filterField, 'filter field');
    }
  }
}

// Wrap an awaited client.query() so Postgres type-coercion errors
// (UUID, integer, date, …) degrade to "no match" instead of throwing
// a 500. Triggered when the workflow's upstream value is an empty
// string (a guest checkout that lost its anonymous id, a Stripe
// session that lost its orderId metadata, …) — the row could never
// have matched anyway, so returning empty rows is the correct
// semantics and the caller gets a clean fallback path. Error codes
// covered: 22P02 (invalid_text_representation), 22008 (datetime out of range),
// 22003 (numeric value out of range), 22023 (invalid parameter value).
// We pass the original query / params back to the caller as a debug
// label so log output stays diagnosable.
// Also covers 22007 (invalid_datetime_format — an empty "Filter by date" value
// hitting a date column: invalid input syntax for type date). Beyond the code
// list we ALSO suppress ANY "invalid input syntax for type" message: every one
// means the bound value could never coerce to the column type, so no row can
// match and an empty result is the correct semantics — never a 500 the user sees
// as "Failed to update. Please try again".
var SAFE_COERCION_ERROR_CODES = { '22P02': 1, '22007': 1, '22008': 1, '22003': 1, '22023': 1 };
function isSafeCoercionError(err) {
  if (!err) return false;
  if (SAFE_COERCION_ERROR_CODES[err.code]) return true;
  return typeof err.message === 'string' && /invalid input syntax for type/i.test(err.message);
}
async function safeQuery(client, sql, params, mode) {
  try {
    return await client.query(sql, params);
  } catch (err) {
    if (isSafeCoercionError(err)) {
      console.warn('[data-api] suppressed Postgres coercion error (' + err.code + '): ' + (err.message || err) +
        ' — returning empty result for ' + (mode || 'query') + '. SQL=' + sql + ' params=' + JSON.stringify(params));
      if (mode === 'count') {
        return { rows: [{ count: '0' }], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    }
    throw err;
  }
}

function isSkippableFilterValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function isAllSentinelFilterValue(value, filter) {
  if (typeof value !== 'string') return false;
  var normalized = value.trim().toLowerCase();
  if (filter && typeof filter.treatAsAll === 'string' && filter.treatAsAll.trim().toLowerCase() === normalized) {
    return true;
  }
  return normalized === 'all' || normalized === 'any' || normalized === 'everything' || normalized === '__all__';
}

// A filter value that never reached the server: its binding produced nothing,
// or the client→server hand-off replaced an oversized value with a placeholder.
function isMissingFilterValue(value) {
  if (value === undefined) return true;
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    (value.__truncated === true || value.__serializationError === true);
}

function refuseUnscopedWrite(field) {
  var err = new Error('Refused: the filter on "' + (field || 'unknown') + '" has no value, so this write would change every row.');
  err.status = 400;
  return err;
}

// \`strict\` (every UPDATE and DELETE): a filter that lost its value, or names no
// column, REFUSES the write instead of being left out — leaving it out widens
// the write to every row of the table. An empty list matches no row.
function buildWhereClause(filters, queryParams, startIndex, options) {
  var conditions = [];
  var paramIndex = startIndex;
  var skipOptionalEmpty = !!(options && options.skipOptionalEmpty);
  var strict = !!(options && options.strict);

  if (!filters || !Array.isArray(filters) || filters.length === 0) {
    return { clause: '', paramIndex: paramIndex };
  }

  validateFilters(filters);

  for (var i = 0; i < filters.length; i++) {
    var f = filters[i];
    var field = f.source || f.field;
    if (!field) {
      if (strict) throw refuseUnscopedWrite('');
      continue;
    }
    var value = f.destination !== undefined ? f.destination : f.value;
    var operand = f.operand || f.operator || '=';

    if (strict && isMissingFilterValue(value)) throw refuseUnscopedWrite(field);
    if (value === undefined) continue;
    if (skipOptionalEmpty && (isSkippableFilterValue(value) || isAllSentinelFilterValue(value, f))) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        if (strict) conditions.push('FALSE');
        continue;
      }
      var placeholders = value.map(function() { return '$' + (paramIndex++); });
      queryParams.push.apply(queryParams, value);
      if (operand === '!=') {
        conditions.push(field + ' NOT IN (' + placeholders.join(', ') + ')');
      } else {
        conditions.push(field + ' IN (' + placeholders.join(', ') + ')');
      }
    } else if (value === null) {
      if (operand === '=') {
        conditions.push(field + ' IS NULL');
      } else if (operand === '!=') {
        conditions.push(field + ' IS NOT NULL');
      }
    } else {
      var normalizedOperand = String(operand || '=').toLowerCase();
      if (normalizedOperand === 'contains' || normalizedOperand === 'not_contains' || normalizedOperand === 'not-contains') {
        if (isSkippableFilterValue(value)) {
          conditions.push('FALSE');
          continue;
        }
        conditions.push(field + (normalizedOperand === 'contains' ? ' ILIKE ' : ' NOT ILIKE ') + '$' + paramIndex);
        queryParams.push('%' + String(value) + '%');
        paramIndex++;
        continue;
      }
      if (normalizedOperand === 'startswith' || normalizedOperand === 'starts_with' || normalizedOperand === 'starts-with') {
        if (isSkippableFilterValue(value)) {
          conditions.push('FALSE');
          continue;
        }
        conditions.push(field + ' ILIKE $' + paramIndex);
        queryParams.push(String(value) + '%');
        paramIndex++;
        continue;
      }
      if (normalizedOperand === 'endswith' || normalizedOperand === 'ends_with' || normalizedOperand === 'ends-with') {
        if (isSkippableFilterValue(value)) {
          conditions.push('FALSE');
          continue;
        }
        conditions.push(field + ' ILIKE $' + paramIndex);
        queryParams.push('%' + String(value));
        paramIndex++;
        continue;
      }
      var validOps = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'ILIKE'];
      var sqlOp = validOps.indexOf(operand) !== -1 ? operand : '=';
      conditions.push(field + ' ' + sqlOp + ' $' + paramIndex);
      queryParams.push(value);
      paramIndex++;
    }
  }

  return {
    clause: conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '',
    paramIndex: paramIndex
  };
}

async function handleSelect(client, body, req) {
  var tableName = body.tableName;
  var filters = body.filters || [];
  var sorts = body.sorts || [];
  var selectedColumns = body.selectedColumns || [];
  var limit = body.limit;
  var skip = body.skip;
  var rawQueryUserPart = body.rawQueryUserPart;

  // Validate table name
  assertIdentifierSafe(tableName, 'table name');

  // Validate selected columns
  for (var ci = 0; ci < selectedColumns.length; ci++) {
    assertIdentifierSafe(selectedColumns[ci], 'column name');
  }

  // Validate sort fields
  for (var si = 0; si < sorts.length; si++) {
    if (sorts[si].field) {
      assertIdentifierSafe(sorts[si].field, 'sort field');
    }
  }

  // A browser reads a feed table only as its feed: the pricing columns of the
  // rows the DATABASE calls live. The window is therefore the server's
  // judgement, not the browser clock's, and nothing unlaunched is handed out.
  var feed = __taPublicFeed(req, tableName);
  if (feed) {
    __taAssertFeedFields(tableName, feed, filters.map(function(f) { return f && (f.source || f.field); }));
    __taAssertFeedFields(tableName, feed, sorts.map(function(s) { return s && s.field; }));
  }
  // A browser reads a published table's public rows, and never names a hidden
  // column — to read it, filter by it or sort by it.
  var rowPolicy = __dataRowPolicy(req, tableName);
  if (rowPolicy) {
    __dataAssertVisibleFields(rowPolicy, filters.map(function(f) { return f && (f.source || f.field); }));
    __dataAssertVisibleFields(rowPolicy, sorts.map(function(s) { return s && s.field; }));
    __dataAssertVisibleFields(rowPolicy, selectedColumns);
  }

  var queryParams = [];
  var cols = selectedColumns.length > 0 ? selectedColumns.join(', ') : '*';
  if (feed) cols = feed.columns.join(', ');
  var sql = 'SELECT ' + cols + ' FROM ' + tableName;

  var where = buildWhereClause(filters, queryParams, 1, { skipOptionalEmpty: true });
  sql += where.clause;
  if (feed) sql += (where.clause ? ' AND ' : ' WHERE ') + feed.predicate;
  if (rowPolicy) sql += (where.clause || feed ? ' AND ' : ' WHERE ') + '(' + rowPolicy.predicate + ')';

  if (sorts.length > 0) {
    var orderClauses = sorts.map(function(s) {
      if (!s.field) return null;
      var order = (s.order || '').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      return s.field + ' ' + order;
    }).filter(Boolean);
    if (orderClauses.length > 0) {
      sql += ' ORDER BY ' + orderClauses.join(', ');
    }
  }

  if (limit !== undefined && limit !== null) {
    sql += ' LIMIT ' + parseInt(limit);
  }
  if (skip !== undefined && skip !== null) {
    sql += ' OFFSET ' + parseInt(skip);
  }

  if (rawQueryUserPart) {
    // Validate the raw user-provided query for forbidden operations
    assertQuerySafe(rawQueryUserPart);
    sql = rawQueryUserPart;
    // SECURITY: the raw override fully replaces the assembled SELECT, so bind the
    // security net's $N params for it, never inline text. rawQueryUserPartParams
    // carries the workflow values (already resolved by the executor) that back the
    // $1, $2, … placeholders the net emitted into rawQueryUserPart.
    queryParams = Array.isArray(body.rawQueryUserPartParams) ? body.rawQueryUserPartParams : [];
  }

  // Final validation of the assembled query
  assertQuerySafe(sql);

  var result = await safeQuery(client, sql, queryParams, 'select');
  var rows = Array.isArray(result.rows) ? result.rows : [];
  // A browser reads the users table's profile, never its credentials.
  if (!isInternalDataRequest(req)) rows = __taWithoutCredentials(rows, tableName);
  if (rowPolicy) rows = __dataWithoutHidden(rowPolicy, rows);

  var countSql = 'SELECT COUNT(*) FROM ' + tableName;
  var countParams = [];
  var countWhere = buildWhereClause(filters, countParams, 1, { skipOptionalEmpty: true });
  countSql += countWhere.clause;
  if (feed) countSql += (countWhere.clause ? ' AND ' : ' WHERE ') + feed.predicate;
  if (rowPolicy) countSql += (countWhere.clause || feed ? ' AND ' : ' WHERE ') + '(' + rowPolicy.predicate + ')';
  var countResult = await safeQuery(client, countSql, countParams, 'count');
  var count = parseInt(countResult.rows[0].count, 10);

  return { rows: rows, count: count };
}

async function handleCount(client, body, req) {
  var tableName = body.tableName;
  var filters = body.filters || [];

  // Validate table name
  assertIdentifierSafe(tableName, 'table name');

  var feed = __taPublicFeed(req, tableName);
  if (feed) {
    __taAssertFeedFields(tableName, feed, filters.map(function(f) { return f && (f.source || f.field); }));
  }
  var rowPolicy = __dataRowPolicy(req, tableName);
  if (rowPolicy) {
    __dataAssertVisibleFields(rowPolicy, filters.map(function(f) { return f && (f.source || f.field); }));
  }
  var queryParams = [];
  var sql = 'SELECT COUNT(*) FROM ' + tableName;
  var where = buildWhereClause(filters, queryParams, 1, { skipOptionalEmpty: true });
  sql += where.clause;
  if (feed) sql += (where.clause ? ' AND ' : ' WHERE ') + feed.predicate;
  if (rowPolicy) sql += (where.clause || feed ? ' AND ' : ' WHERE ') + '(' + rowPolicy.predicate + ')';

  var result = await safeQuery(client, sql, queryParams, 'count');
  var count = parseInt(result.rows[0].count, 10);
  return { count: count };
}

var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function splitCommaOrPgArrayString(val) {
  if (typeof val !== 'string') return val;
  var s = val.trim();
  if (s === '') return null;
  if (s[0] === '{' && s[s.length - 1] === '}') {
    var inner = s.slice(1, -1);
    if (!inner) return [];
    return inner.split(',').map(function(part) {
      var t = part.trim();
      if (t[0] === '"' && t[t.length - 1] === '"') return t.slice(1, -1).replace(/""/g, '"');
      return t;
    }).filter(Boolean);
  }
  return s.split(',').map(function(x) { return x.trim(); }).filter(Boolean);
}

// HTML checkbox convention: a checked box submits a truthy string value
// ('on' by default, or the input's own value attribute); an UNCHECKED box
// is omitted from FormData entirely, which general-extract-form-data (the
// client-side node that builds the workflow payload) represents as '' /
// undefined - never false. Without this branch that '' fell through to
// the generic empty-string-to-null guard below and was written as SQL
// NULL instead of false: a silent "not featured" -> NULL data corruption
// in the common case (breaks any WHERE is_featured = true/false filter,
// since NULL fails three-valued-logic equality), and a hard 23502
// not-null-violation whenever the boolean column itself is NOT NULL - the
// exact "update failed" error reported for an unchecked "feature this item"
// checkbox. "Not submitted" always means unchecked/false for an HTML
// checkbox, so this mapping is unambiguous and safe for every boolean
// column, not just one page's flag.
var BOOLEAN_TRUE_STRINGS = { 'on': 1, 'true': 1, '1': 1 };

function coerceValueForPgColumn(col, val, colTypes) {
  var dt = colTypes[col];
  if (dt === 'boolean') {
    if (typeof val === 'boolean') return val;
    if (val === undefined || val === null) return false;
    if (typeof val === 'number') return val !== 0;
    if (typeof val === 'string') return !!BOOLEAN_TRUE_STRINGS[val.trim().toLowerCase()];
    return false;
  }
  if (dt !== 'ARRAY') return val;
  if (val == null) return val;
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') return splitCommaOrPgArrayString(val);
  return val;
}

// True for columns that conventionally hold "the user who owns / created
// this row" — the same columns page-load workflows use as the WHERE
// clause to scope row-ownership SELECTs. Used by coerceUuidColumnValue
// to decide whether substituting the workflow's anonymousUserId hint
// for an unrecoverable guest sentinel is safe.
function isUserOwnershipColumn(col) {
  if (typeof col !== 'string') return false;
  if (col === 'user_id') return true;
  // "_user_id" suffix is the standard for cross-entity ownership refs
  // (e.g. created_by_user_id, assigned_to_user_id). Substituting the
  // anon UUID for these mirrors the SQL ownership pattern.
  if (col.length > 8 && col.lastIndexOf('_user_id') === col.length - 8) return true;
  return false;
}

// Coerce values destined for non-"id" UUID columns. Workflows commonly feed
// "user_id" / "owner_id" / "pickup_location_id" etc. from upstream nodes
// that may resolve to:
//   - a real UUID                → keep verbatim
//   - null / undefined           → keep as null (PG inserts NULL on nullable cols)
//   - "" / "anonymous" / "user" / any other non-UUID string
//                                → coerce to NULL so PG does NOT reject the
//                                  INSERT with "invalid input syntax for
//                                  type uuid".
// Guest-checkout flows are the canonical case: the "Resolve Current User"
// custom node falls back to a string sentinel when no account is signed in,
// but the teleport_orders.user_id column is a nullable uuid — without an
// anon-fallback the row lands with user_id = NULL, which means the
// "/order-details/<order_number>" page-load SQL ("WHERE user_id =
// anonymousUserId") can never recover the row the guest just paid for.
// The optional "anonymousUserIdFallback" argument — passed by the
// data-create-item / data-update-item workflow handlers when they see a
// resolve-user output in the workflow context — restores that linkage:
// the row gets the anon UUID for user_id, the ownership SELECT matches,
// and the buyer sees their order. The fallback only fires for ownership
// columns (user_id / "*_user_id") so non-ownership uuid foreign keys keep
// the safer "drop garbage to NULL" behaviour.
//
// The "id" PK column is handled separately by handleCreate (auto-generate
// a fresh UUID when missing/invalid), so this helper deliberately skips
// it — overwriting the PK to NULL would break the INSERT.
function coerceUuidColumnValue(col, val, colTypes, anonymousUserIdFallback) {
  if (col === 'id') return val;
  if (colTypes[col] !== 'uuid') return val;
  if (val == null) return val;
  if (typeof val !== 'string') return val;
  if (UUID_RE.test(val)) return val;
  // Non-UUID string about to be dropped. For ownership columns we
  // substitute the workflow's anonymousUserId hint when present and
  // itself a valid UUID; otherwise we keep the existing NULL safety.
  if (isUserOwnershipColumn(col)
      && typeof anonymousUserIdFallback === 'string'
      && UUID_RE.test(anonymousUserIdFallback)) {
    return anonymousUserIdFallback;
  }
  return null;
}

async function getColumnTypes(client, tableName) {
  try {
    var schema = 'public';
    var table = tableName;
    if (tableName.indexOf('.') !== -1) {
      var parts = tableName.split('.');
      schema = parts[0];
      table = parts[1];
    }
    var res = await client.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2",
      [schema, table]
    );
    var types = {};
    for (var i = 0; i < res.rows.length; i++) {
      types[res.rows[i].column_name] = res.rows[i].data_type;
    }
    return types;
  } catch(e) { return {}; }
}

// Tables whose rows remember the language of the storefront they were
// written from, so the emails about them can be sent in it later (by a cron,
// a webhook, an admin action — none of which run in the buyer's language).
// The column is stamped ONLY when the table actually has it: a store
// provisioned before the column existed keeps inserting exactly as before.
var LOCALE_STAMPED_TABLES = { teleport_orders: 1 };
var LOCALE_COLUMN = 'locale';

function stampRequestLocale(tableName, entries, colTypes, requestLocale) {
  if (!LOCALE_STAMPED_TABLES[tableName]) return entries;
  if (typeof requestLocale !== 'string' || !requestLocale) return entries;
  if (!colTypes[LOCALE_COLUMN]) return entries;
  for (var i = 0; i < entries.length; i++) {
    if (entries[i][0] === LOCALE_COLUMN) return entries;
  }
  return entries.concat([[LOCALE_COLUMN, requestLocale.slice(0, 10)]]);
}

// Columns a feature added after stores were provisioned: product options
// (the definitions on the product, the chosen configuration on an order line).
// A write naming one on a store whose table never gained it drops that column
// instead of failing the whole statement — an order must never lose its lines
// over a column that was not added. Only when the table's columns are known:
// an unreadable schema leaves the write exactly as it was.
var OPTIONAL_FEATURE_COLUMNS = {
  teleport_products: ['option_groups', 'product_page'],
  teleport_order_items: ['configuration', 'configuration_label'],
};

function dropMissingOptionalColumns(tableName, entries, colTypes) {
  if (!Object.prototype.hasOwnProperty.call(OPTIONAL_FEATURE_COLUMNS, tableName)) return entries;
  if (Object.keys(colTypes).length === 0) return entries;
  var optional = OPTIONAL_FEATURE_COLUMNS[tableName];
  var dropped = [];
  var kept = entries.filter(function(e) {
    var missing = optional.indexOf(e[0]) !== -1 && !colTypes[e[0]];
    if (missing) dropped.push(e[0]);
    return !missing;
  });
  if (dropped.length > 0) {
    console.warn('[data-api] ' + tableName + ' has no ' + dropped.join(', ') + ' column; written without it.');
  }
  return kept;
}

async function handleCreate(client, body) {
  var tableName = body.tableName;
  var columnMappings = body.columnMappings || {};
  // Optional fallback passed by the data-create-item workflow handler
  // when the workflow context carries a resolve-user output. See
  // coerceUuidColumnValue for why ownership columns get this special
  // treatment instead of being NULL'd outright.
  var anonymousUserIdFallback = body.__anonymousUserId;

  // Validate table name
  assertIdentifierSafe(tableName, 'table name');

  var entries = Array.isArray(columnMappings)
    ? columnMappings.map(function(m) { return [m.source || m.column, m.destination !== undefined ? m.destination : m.value]; })
    : Object.entries(columnMappings);

  if (entries.length === 0) {
    return { item: null, id: null, error: 'No columns provided' };
  }

  // Validate all column names
  for (var ei = 0; ei < entries.length; ei++) {
    assertIdentifierSafe(entries[ei][0], 'column name');
  }

  var colTypes = await getColumnTypes(client, tableName);
  entries = stampRequestLocale(tableName, entries, colTypes, body.__requestLocale);
  entries = dropMissingOptionalColumns(tableName, entries, colTypes);

  var TEXT_TYPES = { 'character varying': 1, 'text': 1, 'char': 1, 'character': 1, 'varchar': 1, 'name': 1 };
  var columns = entries.map(function(e) { return e[0]; });
  var values = entries.map(function(e, i) {
    var col = columns[i];
    var val = e[1];
    val = coerceValueForPgColumn(col, val, colTypes);
    // Auto-generate a UUID ONLY for the primary "id" column when missing.
    // Don't do this for other UUID columns (e.g. nullable foreign keys like
    // pickup_location_id) — those legitimately carry null when the buyer's
    // selection didn't apply, and replacing null with a random UUID inserts
    // a non-existent reference and silently breaks downstream joins.
    if (col === 'id' && colTypes[col] === 'uuid' && (val == null || (typeof val === 'string' && !UUID_RE.test(val)))) {
      return generateUUID();
    }
    // For non-"id" UUID columns, drop garbage strings to NULL — UNLESS
    // the column is an ownership column AND the workflow supplied an
    // anonymousUserId hint, in which case the row gets attributed to the
    // guest session so future ownership SELECTs can find it again. See
    // coerceUuidColumnValue.
    val = coerceUuidColumnValue(col, val, colTypes, anonymousUserIdFallback);
    if (val === '' && colTypes[col] && !TEXT_TYPES[colTypes[col]]) {
      return null;
    }
    return val;
  });

  if (colTypes['id'] === 'uuid' && columns.indexOf('id') === -1) {
    columns.push('id');
    values.push(generateUUID());
  }

  var placeholders = values.map(function(_, i) { return '$' + (i + 1); });

  // Opt-in idempotent insert. ON CONFLICT DO NOTHING turns a duplicate-key
  // insert into a safe no-op instead of a 23505 error, so callers that
  // re-ensure a known row (e.g. the resolve-user node re-persisting a guest's
  // anonymous users record on every resolution) don't fail when it already
  // exists. On a conflict the RETURNING clause yields no row, so fall back to
  // the id the caller supplied so the response still carries a usable id.
  var onConflictClause = body.onConflictDoNothing ? ' ON CONFLICT DO NOTHING' : '';
  var sql = 'INSERT INTO ' + tableName + ' (' + columns.join(', ') + ') VALUES (' + placeholders.join(', ') + ')' + onConflictClause + ' RETURNING *';
  var result = await client.query(sql, values);
  var item = result.rows && result.rows[0] ? result.rows[0] : null;
  var idIdx = columns.indexOf('id');
  var resolvedId = item ? (item.id || null) : (idIdx >= 0 ? values[idIdx] : null);
  return { item: item, id: resolvedId };
}

async function handleUpdate(client, body) {
  var tableName = body.tableName;
  var filters = body.filters || [];
  var columnMappings = body.columnMappings || {};
  var anonymousUserIdFallback = body.__anonymousUserId;

  // Validate table name
  assertIdentifierSafe(tableName, 'table name');

  var entries = Array.isArray(columnMappings)
    ? columnMappings.map(function(m) { return [m.source || m.column, m.destination !== undefined ? m.destination : m.value]; })
    : Object.entries(columnMappings);

  if (entries.length === 0) {
    return { updatedCount: 0, error: 'No columns provided' };
  }

  // Validate all column names
  for (var ei = 0; ei < entries.length; ei++) {
    assertIdentifierSafe(entries[ei][0], 'column name');
  }

  var colTypes = await getColumnTypes(client, tableName);
  entries = dropMissingOptionalColumns(tableName, entries, colTypes);
  if (entries.length === 0) {
    return { updatedCount: 0, item: null, id: null };
  }
  var TEXT_TYPES = { 'character varying': 1, 'text': 1, 'char': 1, 'character': 1, 'varchar': 1, 'name': 1 };

  var queryParams = [];
  var paramIndex = 1;
  var setClauses = entries.map(function(e) {
    var col = e[0];
    var val = e[1];
    val = coerceValueForPgColumn(col, val, colTypes);
    val = coerceUuidColumnValue(col, val, colTypes, anonymousUserIdFallback);
    if (val === '' && colTypes[col] && !TEXT_TYPES[colTypes[col]]) {
      val = null;
    }
    queryParams.push(val);
    return col + ' = $' + (paramIndex++);
  });

  var sql = 'UPDATE ' + tableName + ' SET ' + setClauses.join(', ');
  var where = buildWhereClause(filters, queryParams, paramIndex, { strict: true });
  sql += where.clause;
  sql += ' RETURNING *';

  var result = await safeQuery(client, sql, queryParams, 'update');
  return { updatedCount: result.rowCount || 0, item: result.rows[0] || null, id: (result.rows[0] && result.rows[0].id) || null };
}

async function handleDelete(client, body) {
  var tableName = body.tableName;
  var filters = body.filters || [];

  // Validate table name
  assertIdentifierSafe(tableName, 'table name');

  // Extract the deletedId from filter values before running the delete
  var deletedId = null;
  if (filters && filters.length > 0) {
    for (var fi = 0; fi < filters.length; fi++) {
      var filterField = filters[fi].source || filters[fi].field;
      if (filterField === 'id') {
        deletedId = filters[fi].destination !== undefined ? filters[fi].destination : filters[fi].value;
        break;
      }
    }
  }

  var queryParams = [];
  var sql = 'DELETE FROM ' + tableName;
  var where = buildWhereClause(filters, queryParams, 1, { strict: true });
  sql += where.clause;

  var result = await safeQuery(client, sql, queryParams, 'delete');
  return { deletedCount: result.rowCount || 0, deletedId: deletedId };
}

var __pgvectorEnabled = false;

async function ensurePgVector(client) {
  if (__pgvectorEnabled) return;
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
  } catch(e) {
    // Extension may not be available, ignore
  }
  __pgvectorEnabled = true;
}

// Detect SQL of the shape "SELECT ... FROM teleport_products ... WHERE
// ... quantity ... <= ..." — the canonical post-stock-decrement check
// the AI's place-order workflow emits at stepNumber 26. We avoid
// matching unrelated stock SELECTs (e.g. inventory dashboards) by
// requiring all three signals to be present in the SAME query string.
function looksLikeLowStockProductSelect(query) {
  if (typeof query !== 'string' || query.length === 0) return false;
  if (!/\\bSELECT\\b/i.test(query)) return false;
  if (!/\\bFROM\\s+teleport_products\\b/i.test(query)) return false;
  if (!/\\bWHERE\\b[\\s\\S]*?\\bquantity\\b[\\s\\S]*?<=/i.test(query)) return false;
  return true;
}

// Extracts the numeric threshold from the WHERE clause (e.g.
// "quantity <= 5"). Falls back to LOW_STOCK_THRESHOLD when the
// query uses a bind parameter, an expression, or anything else that
// is not a literal number. The fallback exists so the email's
// {{threshold}} token always renders to a meaningful value.
function extractThresholdFromQuery(query) {
  var match = /quantity\\s*<=\\s*(\\d+(?:\\.\\d+)?)/i.exec(query);
  if (!match) return LOW_STOCK_THRESHOLD;
  var n = Number(match[1]);
  return isFinite(n) && n >= 0 ? n : LOW_STOCK_THRESHOLD;
}

// Resolves the base URL for an internal fire-and-forget POST — the store's
// own origin, NEVER a host the request named: the POST carries the store's
// stock levels, and outside Vercel the Host header is whatever the caller
// sent. The rule of the server runtime's \`trustedBaseUrl\`
// (server-runtime-code.ts), inlined because this route must not depend on
// that module: on Vercel the request's host (the domain Vercel routed to this
// deployment); elsewhere NEXTAUTH_URL's origin when it is set — except that a
// local server on another port than a local NEXTAUTH_URL keeps its own
// loopback address (NEXTAUTH_URL stuck at :3000 while the dev server runs on
// :3001). Env vars are tried as fallbacks for the rare serverless
// background-work case where the request context isn't visible.
function isLoopbackHost(host) {
  var name = String(host || '').replace(/:[0-9]+$/, '').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]';
}

function resolveSelfBaseUrl(req) {
  var host = req && req.headers && req.headers.host;
  if (host) {
    var proto = (req && req.headers && req.headers['x-forwarded-proto']) || (isLoopbackHost(host) ? 'http' : 'https');
    var requestOrigin = String(proto).split(',')[0].trim() + '://' + host;
    if (process.env.VERCEL) return requestOrigin;
    var configured = String(process.env.NEXTAUTH_URL || '').trim();
    if (!configured) return requestOrigin;
    var origin;
    try { origin = new URL(configured).origin; } catch (e) { return requestOrigin; }
    if (isLoopbackHost(host) && isLoopbackHost(new URL(origin).host)) return requestOrigin;
    return origin;
  }
  if (process.env.NEXTAUTH_URL) return String(process.env.NEXTAUTH_URL).replace(/\\/+$/, '');
  if (process.env.VERCEL_URL) return 'https://' + String(process.env.VERCEL_URL).replace(/\\/+$/, '');
  return '';
}

// Fire-and-forget POST to /api/ecommerce/low-stock-alert. Errors
// are swallowed because the merchant must never see a failed alert
// surface as a failed checkout — the worst case is a missed email,
// which is recoverable by re-running the alert manually.
function fireAndForgetLowStockAlert(req, rows, threshold) {
  if (!LOW_STOCK_ALERTS_ENABLED) return;
  if (!Array.isArray(rows) || rows.length === 0) return;
  var base = resolveSelfBaseUrl(req);
  if (!base) {
    console.warn('[low-stock-alert] cannot resolve base URL for fire-and-forget POST; skipping');
    return;
  }
  var payload = {
    products: rows.map(function(r) {
      return {
        id: r && r.id != null ? r.id : null,
        name: r && r.name != null ? r.name : '',
        sku: r && r.sku != null ? r.sku : '',
        stock: r && r.stock != null ? r.stock : (r && r.quantity != null ? r.quantity : null),
      };
    }),
    threshold: threshold,
  };
  console.log('[data-api] firing low-stock alert for ' + rows.length + ' product(s) (threshold=' + threshold + ')');
  try {
    var fetchImpl = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
    fetchImpl(base + '/api/ecommerce/low-stock-alert', {
      method: 'POST',
      // The alert route emails the merchant only for the store's own server
      // code, which presents the app secret.
      headers: { 'Content-Type': 'application/json', 'x-internal-data-secret': process.env.NEXTAUTH_SECRET || '' },
      body: JSON.stringify(payload),
    }).catch(function(err) {
      console.error('[data-api] low-stock alert POST failed: ' + (err && err.message ? err.message : String(err)));
    });
  } catch (e) {
    console.error('[data-api] low-stock alert POST threw synchronously: ' + (e && e.message ? e.message : String(e)));
  }
}

async function handleRawQuery(client, body, req) {
  var query = body.query;
  if (!query || typeof query !== 'string') {
    return { rows: [], error: 'No query provided' };
  }

  // SECURITY: bind the workflow's context/state values as POSITIONAL parameters
  // ($1, $2, …) instead of interpolating them into the SQL text. The generation
  // net rewrites every {{state.X}}/{{Current User.id}}/… value interpolation into
  // a $N placeholder and moves the {{…}} token into this sibling params array; the
  // executor resolves those tokens to concrete values before POSTing, so here they
  // arrive as plain bound values. A bound value can never terminate a string literal
  // or alter query structure — SQL injection is impossible for the value class.
  // Legacy raw queries carry no params array and run unparameterized (backward-compat).
  var params = Array.isArray(body.params) ? body.params : [];

  // Validate the raw query for forbidden operations before execution
  assertQuerySafe(query);

  if (query.indexOf('vector') !== -1 || query.indexOf('::vector') !== -1 || query.indexOf('<=>' ) !== -1) {
    await ensurePgVector(client);
  }

  var result = await safeQuery(client, query, params, 'raw-query');
  var rows = Array.isArray(result.rows) ? result.rows : [];

  // Auto-fire the low-stock alert when the workflow runs the post-
  // stock-decrement SELECT and gets back a non-empty list. The
  // workflow's own email-payload-builder node (af26cd7e) returns
  // skip:true and never dispatches; this fire-and-forget covers
  // that gap without requiring the AI to wire an email-send node.
  if (LOW_STOCK_ALERTS_ENABLED && rows.length > 0 && looksLikeLowStockProductSelect(query)) {
    fireAndForgetLowStockAlert(req, rows, extractThresholdFromQuery(query));
  }

  return { rows: rows };
}

// Trusted internal server-side workflow calls (the data nodes of a server
// segment, password reset, server-side profile updates) carry the app's
// internal secret in a header — see __taIsInternalRequest. Direct
// (non-workflow) client calls have no secret and stay guarded.
function isInternalDataRequest(req) {
  return __taIsInternalRequest(req);
}

var WRITE_OPERATIONS = { create: 1, update: 1, delete: 1 };

// See BROWSER_READABLE_TABLES / BROWSER_ROW_POLICIES in data-api-route-generator.ts.
var BROWSER_READABLE_TABLES = ${JSON.stringify(BROWSER_READABLE_TABLES)};
var BROWSER_ROW_POLICIES = ${JSON.stringify(BROWSER_ROW_POLICIES)};

// The table a structured request names, or null when it names another schema
// than the app's own: \`information_schema.tables\`, \`pg_catalog.pg_user\`.
function __dataPublicTable(tableName) {
  var parts = String(tableName || '').trim().toLowerCase().replace(/"/g, '').split('.');
  if (parts.length > 2 || (parts.length === 2 && parts[0] !== 'public')) return null;
  return parts[parts.length - 1];
}

// Postgres searches pg_catalog before the app's own schema, so a bare \`pg_*\`
// name is a system catalog or statistics view (pg_user, pg_stats, pg_settings).
var SYSTEM_CATALOG_SQL_RE = /\\b(?:information_schema|pg_catalog|pg_toast)\\b|\\bpg_[a-z0-9_]+/i;

function __forbidSystemCatalog() {
  var err = new Error('Forbidden: system catalogs are not readable through this route');
  err.status = 403;
  throw err;
}

// No caller but the app's own server code reads the database's catalogs — the
// schema, the roles, the planner's sampled column values of every table. Holds
// in an app without a secret too, where every caller counts as a browser.
function assertNoSystemCatalogRead(operation, body) {
  var sql = operation === 'raw-query' ? body.query : body.rawQueryUserPart;
  if (typeof sql === 'string' && sql.length > 0) {
    var cleaned = __taCleanSql(sql);
    if (!cleaned.ok || SYSTEM_CATALOG_SQL_RE.test(cleaned.text)) __forbidSystemCatalog();
  }
  if (operation === 'raw-query' || body.tableName === undefined) return;
  var table = __dataPublicTable(body.tableName);
  if (table === null || table.indexOf('pg_') === 0) __forbidSystemCatalog();
}

// A browser's view of a readable table: the rows the storefront publishes,
// never a hidden column. null for a server-side call, which reads it whole —
// and in an app without a secret, where a server call (the scheduled-post
// publisher, a blog workflow) cannot be told apart from a browser.
function __dataRowPolicy(req, tableName) {
  if (!__taBrowserIsReadOnly(req)) return null;
  var table = __dataPublicTable(tableName);
  return table && Object.prototype.hasOwnProperty.call(BROWSER_ROW_POLICIES, table) ? BROWSER_ROW_POLICIES[table] : null;
}

function __dataIsHidden(policy, field) {
  var parts = String(field == null ? '' : field).replace(/"/g, '').trim().toLowerCase().split('.');
  var name = parts[parts.length - 1];
  for (var i = 0; i < policy.hiddenColumns.length; i++) {
    if (policy.hiddenColumns[i].toLowerCase() === name) return true;
  }
  return false;
}

function __dataAssertVisibleFields(policy, fields) {
  for (var i = 0; i < fields.length; i++) {
    if (fields[i] && __dataIsHidden(policy, fields[i])) {
      var err = new Error('Forbidden: ' + fields[i] + ' is not readable');
      err.status = 403;
      throw err;
    }
  }
}

function __dataWithoutHidden(policy, rows) {
  if (!Array.isArray(rows) || policy.hiddenColumns.length === 0) return rows;
  return rows.map(function(row) {
    if (!row || typeof row !== 'object') return row;
    var copy = {};
    Object.keys(row).forEach(function(key) {
      if (!__dataIsHidden(policy, key)) copy[key] = row[key];
    });
    return copy;
  });
}

function __forbidBrowserOperation(what) {
  var err = new Error('Forbidden: ' + what + ' is only available to server-side workflow nodes');
  err.status = 403;
  throw err;
}

// Refuses a browser's access to the money tables (see the shared table-access
// helper above); a trusted internal call passes untouched. Where the app can
// tell its own server-side calls apart (__taBrowserIsReadOnly), a browser only
// reads, through the structured select and count.
function assertTableAccess(req, operation, body) {
  if (isInternalDataRequest(req)) return;
  if (!body || typeof body !== 'object') return;
  if (__taBrowserIsReadOnly(req)) {
    if (operation !== 'select' && operation !== 'count') __forbidBrowserOperation('the ' + operation + ' operation');
    if (body.rawQueryUserPart) __forbidBrowserOperation('a raw query');
    if (BROWSER_READABLE_TABLES.indexOf(__dataPublicTable(body.tableName)) === -1) {
      __forbidBrowserOperation('reading ' + String(body.tableName || 'this table'));
    }
  }
  assertNoSystemCatalogRead(operation, body);
  if (operation === 'raw-query') {
    if (typeof body.query === 'string') __taAssertSqlTextAllowed(body.query);
    return;
  }
  var table = __taNormalizeTable(body.tableName);
  if (__TA_PROTECTED_TABLES.indexOf(table) !== -1) __taForbid(table);
${
  restrictsTables
    ? '  if (Object.prototype.hasOwnProperty.call(__TA_RESTRICTED_TABLES, table)) __taForbid(table);\n'
    : ''
}  if (WRITE_OPERATIONS[operation] && __TA_WRITE_PROTECTED_TABLES.indexOf(table) !== -1) __taForbid(table);
  // A select's raw override replaces the assembled SELECT wholesale, so its
  // text is checked like a raw query rather than trusting \`tableName\`.
  if (operation === 'select' && typeof body.rawQueryUserPart === 'string') {
    __taAssertSqlTextAllowed(body.rawQueryUserPart);
  }
}

// The columns of the auth users table that decide what a session may DO, not
// who it is. The session token carries role / roleName / roles off the
// \`users\` row, and the middleware's page gates and the money-table guard
// both read the role off it — so a browser that could write one of these
// columns would be handing itself the store administrator's reads. Everything
// else on the row stays writable: a generated profile form updates whatever
// columns the merchant put there, and only the server-side segments (which
// present the app secret) may grant a role.
var AUTH_ROLE_COLUMNS = { role: 1, roles: 1, rolename: 1, role_name: 1 };

// The identity table this route guards, and \`users\`, which is where the auth
// options read the session's role from whatever the identity table is called.
var ROLE_SOURCE_TABLES = AUTH_USERS_TABLE
  ? [__taNormalizeTable(AUTH_USERS_TABLE), 'users'].filter(function(t, i, all) { return all.indexOf(t) === i; })
  : [];

function __forbidRoleWrite(what) {
  var err = new Error('Forbidden: ' + what + ' is not settable from a browser');
  err.status = 403;
  throw err;
}

// Refuses a browser every way of writing a role column: a create or update
// naming one (however the column is spelled), and any raw statement that
// writes and mentions a role-source table — a positional INSERT or a
// row-valued SET names no column, so the statement is refused whole, the way
// the write-protected money tables are.
function assertNoBrowserRoleWrite(req, operation, body) {
  if (ROLE_SOURCE_TABLES.length === 0 || isInternalDataRequest(req)) return;
  if (!body || typeof body !== 'object') return;
  var sql = operation === 'raw-query' ? body.query : operation === 'select' ? body.rawQueryUserPart : null;
  if (typeof sql === 'string' && sql.length > 0) {
    var cleaned = __taCleanSql(sql);
    if (cleaned.ok && !__TA_SQL_WRITE_RE.test(cleaned.text)) return;
    for (var ti = 0; ti < ROLE_SOURCE_TABLES.length; ti++) {
      if (__taSqlMentionsTable(sql, ROLE_SOURCE_TABLES[ti])) __forbidRoleWrite('a write to ' + ROLE_SOURCE_TABLES[ti]);
    }
    return;
  }
  if (operation !== 'create' && operation !== 'update') return;
  if (ROLE_SOURCE_TABLES.indexOf(__taNormalizeTable(body.tableName)) === -1) return;
  var columnMappings = body.columnMappings || {};
  var written = Array.isArray(columnMappings)
    ? columnMappings.map(function(m) { return m && (m.source || m.column); })
    : Object.keys(columnMappings);
  for (var i = 0; i < written.length; i++) {
    if (AUTH_ROLE_COLUMNS[__taNormalizeTable(written[i])]) __forbidRoleWrite(written[i]);
  }
}

// Enforces that any update/delete against the auth users table is keyed by
// the session user's id. Prevents a logged-in user from coercing a mutation
// targeting another user's row via a client-supplied filter.
async function assertSessionOwnsUsersRow(req, operation, body) {
  if (!AUTH_USERS_TABLE) return;
  if (operation !== 'update' && operation !== 'delete') return;
  // Schema-qualified and quoted spellings reach the SAME table — the identifier
  // validator allows both — so the guard compares the bare name.
  if (!body || __taNormalizeTable(body.tableName) !== __taNormalizeTable(AUTH_USERS_TABLE)) return;

  // Trusted internal server-side workflow calls (e.g. password reset, which has
  // NO logged-in session) bypass the per-session ownership check.
  if (isInternalDataRequest(req)) {
    return;
  }

  var token;
  try {
    token = await __tqSessionToken(req);
  } catch (e) {
    token = null;
  }
  var sessionUserId = token && (token.id || token.sub);
  if (!sessionUserId) {
    var authErr = new Error('Unauthenticated');
    authErr.status = 401;
    throw authErr;
  }

  var filters = body.filters || [];
  var idFilter = null;
  for (var i = 0; i < filters.length; i++) {
    var field = filters[i].source || filters[i].field;
    if (field === 'id') {
      idFilter = filters[i].destination !== undefined ? filters[i].destination : filters[i].value;
      break;
    }
  }
  if (idFilter === null || idFilter === undefined || String(idFilter) !== String(sessionUserId)) {
    var err = new Error('Forbidden: cannot modify another user');
    err.status = 403;
    throw err;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var params = req.query.params;
  if (!params || params.length < 2) {
    return res.status(400).json({ error: 'Invalid path. Expected /api/data/<dataSourceId>/<operation>' });
  }

  var operation = params[params.length - 1];
  var body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  var client = getClient();

  try {
    assertTableAccess(req, operation, body);
    assertNoBrowserRoleWrite(req, operation, body);
    await assertSessionOwnsUsersRow(req, operation, body);
    await client.connect();
    var result;

    switch (operation) {
      case 'select':
        result = await handleSelect(client, body, req);
        break;
      case 'count':
        result = await handleCount(client, body, req);
        break;
      case 'create':
        result = await handleCreate(client, body);
        break;
      case 'update':
        result = await handleUpdate(client, body);
        break;
      case 'delete':
        result = await handleDelete(client, body);
        break;
      case 'raw-query':
        // req is forwarded so the low-stock auto-fire can derive
        // the self-base URL when no NEXTAUTH_URL / VERCEL_URL env
        // var is set (typical dev setup).
        result = await handleRawQuery(client, body, req);
        break;
      default:
        return res.status(400).json({ error: 'Unknown operation: ' + operation });
    }

    return res.status(200).json(result);
  } catch (error) {
    // Return proper status codes for validation errors
    var statusCode = error.status || 500;
    // An error this route raised for the caller carries a status and a message
    // written for it. Anything else is the database's, and its text names
    // tables, columns, constraints and values: it stays in the server log. The
    // SQLSTATE travels on — a caller can act on it (23505, a duplicate) and it
    // says nothing about the schema.
    var errorResponse = { error: error.status ? error.message || 'Request refused' : 'Internal server error' };

    if (error.code === 'FORBIDDEN_SQL_OPERATION') {
      errorResponse.error = 'FORBIDDEN_SQL_OPERATION';
      errorResponse.message = error.message;
      errorResponse.matchedOperation = error.matchedOperation;
    } else if (error.code === 'INVALID_SQL_IDENTIFIER') {
      errorResponse.error = 'INVALID_SQL_IDENTIFIER';
      errorResponse.message = error.message;
    } else {
      console.error('Data API error (' + operation + '):', error);
      if (!error.status && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) {
        errorResponse.code = error.code;
      }
    }

    return res.status(statusCode).json(errorResponse);
  } finally {
    try {
      await client.end();
    } catch (e) {
      console.error('Error closing database client:', e);
    }
  }
};
`
}
