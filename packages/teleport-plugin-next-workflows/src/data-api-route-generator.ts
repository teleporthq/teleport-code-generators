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
import {
  AccountFields,
  ContentTables,
  DataExposure,
  TableAccess,
} from '@teleporthq/teleport-shared'
import type { DataReadExposure, ProjectDataExposure } from '@teleporthq/teleport-types'
import { AUTOMATIONS_PATH } from './automations/automations-scope'
import { APP_EVENTS_FILE_NAME, APP_EVENTS_PATH } from './automations/app-events-source'
import { CONFIGURED_NEXTAUTH_URL_EXPRESSION } from './configured-nextauth-url'
import { generateSelfCallHeadersCode } from './self-call-headers'

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
  // The project has the in-app event bus (`hasAutomationsBus`): a
  // successful write to `teleport_events` wakes the automations, each
  // product a low-stock scan finds is recorded as `product-low-stock`, and
  // every request starts the due check (automations/activity-kicks.ts).
  withAutomations?: boolean
  // The roles the project grants staff access (`TableAccess.resolveStaffRoles`):
  // the only sessions a server segment reads or changes OTHER customers'
  // records for. Absent, only the explicit `admin` role.
  staffRoles?: string[]
  // Who reads which table from a browser (`DataExposure.resolveDataExposure`):
  // the data API admits a browser's read of a table outside the storefront's
  // own the way that table's per-table route does. Absent, none.
  dataExposure?: ProjectDataExposure
  // The project's TeleportHQ data sources (`DataExposure.managedDataSourceIds`):
  // the only ones this route reads (the managed database), so the only ids a
  // browser's read may name. Absent, none.
  managedDataSourceIds?: string[]
}

/** What the data API needs of the exposure: who reads each table, not how many rows. */
const browserExposureTables = (
  exposure: ProjectDataExposure | undefined,
  managedDataSourceIds: string[]
): Record<
  string,
  Pick<DataReadExposure, 'public' | 'anySession' | 'roles' | 'subscriberRules'>
> => {
  const out: Record<
    string,
    Pick<DataReadExposure, 'public' | 'anySession' | 'roles' | 'subscriberRules'>
  > = {}
  Object.entries((exposure && exposure.tables) || {}).forEach(([key, entry]) => {
    // This route reads the managed database only: another source's table of the
    // same name is that source's route's to admit.
    const source = key.slice(0, key.lastIndexOf(':'))
    if (source !== '*' && managedDataSourceIds.indexOf(source) === -1) {
      return
    }
    const admits =
      entry.public ||
      entry.anySession ||
      entry.roles.length > 0 ||
      (entry.subscriberRules || []).length > 0
    if (admits) {
      out[key] = {
        public: entry.public,
        anySession: entry.anySession,
        roles: entry.roles,
        ...(entry.subscriberRules && { subscriberRules: entry.subscriberRules }),
      }
    }
  })
  return out
}

/** From `pages/api/data/[...params].js` to the project root. */
const DATA_ROUTE_ROOT = '../../..'

/**
 * The row window of a BROWSER read through the data API (the storefront's own
 * reads: products, the discount feed, the regional pricing tables). The largest
 * count the generated storefront asks for is 1000 (the regional pricing rows),
 * so that is the most a browser read gets; a read naming no count gets 100.
 */
export const DATA_API_BROWSER_DEFAULT_LIMIT = 100
export const DATA_API_BROWSER_MAX_LIMIT = 1000
export const DATA_API_BROWSER_MAX_OFFSET = 1000000

/**
 * The columns that key a GUEST's own rows in a customer table (a favourite, a
 * cart, a conversation kept by the browser's session id): a read that names
 * one, for a visitor without a session, finds the rows no account owns.
 */
const GUEST_KEY_COLUMNS = [
  'session_id',
  'anonymous_id',
  'anon_id',
  'visitor_id',
  'guest_id',
  'device_id',
  'browser_id',
  'cart_id',
  'cart_token',
  'basket_id',
]

/**
 * Whether the route requires `utils/app-events.js` (`ensureAppEventsModule`):
 * it records the low-stock events through it.
 */
export const dataAPIRouteRecordsLowStock = (options: DataAPIRouteOptions): boolean =>
  !!options.withAutomations && !!options.lowStockAlertsEnabled

/**
 * The wake-up and the low-stock events, for a project with automations. The
 * regex finds an INSERT into the ledger in a raw query, however the table is
 * written (`public.`, quoted, any case), the order event claims'
 * `WITH claim AS (INSERT INTO teleport_events (…` included.
 */
const generateBusinessEventsCode = (
  recordsLowStock: boolean
): string => `// The project has automations. A new teleport_events row wakes their queue
// (the in-app event bus, lib/automations/event-bus.js) off the request path,
// once the write has succeeded: a create into the table, or a raw query that
// inserts into it (the order event claims). A claim row is inserted BEFORE the
// step it gates, so a dispatch may start while that step is still running;
// that is harmless, the dispatcher runs off the request and reads every record
// afresh. A node that writes the ledger straight to the database, not through
// this route, bypasses the wake-up.
var BUSINESS_EVENTS_TABLE = 'teleport_events';
var BUSINESS_EVENT_INSERT_RE = /\\binsert\\s+into\\s+(?:"?public"?\\s*\\.\\s*)?"?teleport_events"?(?![\\w$])/i;

// How many rows each request's raw query touched (handleRawQuery notes it):
// an insert that wrote none — a row ON CONFLICT DO NOTHING skipped, an error
// answered as an empty result — wakes nothing.
var RAW_QUERY_ROW_COUNTS = new WeakMap();

// An order event claim answers whether it took its row (its claimed column); a claim
// that lost to an earlier one wrote nothing.
function answersUnclaimed(result) {
  var rows = result && Array.isArray(result.rows) ? result.rows : [];
  return rows.length > 0 && rows.every(function (row) {
    if (!row || !Object.prototype.hasOwnProperty.call(row, 'claimed')) {
      return false;
    }
    var flag = row.claimed;
    return !(flag === true || flag === 'true' || Number(flag) > 0);
  });
}

function wroteBusinessEvent(operation, body, result, req) {
  if (!body || typeof body !== 'object') {
    return false;
  }
  if (operation === 'create') {
    return __dataPublicTable(body.tableName) === BUSINESS_EVENTS_TABLE && !!(result && result.item);
  }
  if (operation === 'raw-query') {
    return (
      typeof body.query === 'string' &&
      BUSINESS_EVENT_INSERT_RE.test(body.query) &&
      RAW_QUERY_ROW_COUNTS.get(req) > 0 &&
      !answersUnclaimed(result)
    );
  }
  return false;
}

// Site activity: due automation work (a Wait, a retry) starts off the request
// (lib/automations/due-check.js checks at most once a minute).
function kickDueAutomations(req) {
  try {
    require('${DATA_ROUTE_ROOT}/${AUTOMATIONS_PATH.join('/')}/due-check').kickWhenDue(req);
  } catch (error) {
    console.warn('[data-api] could not check for due automations: ' + (error && error.message ? error.message : String(error)));
  }
}

function wakeAutomations(req) {
  try {
    require('${DATA_ROUTE_ROOT}/${AUTOMATIONS_PATH.join('/')}/event-bus').scheduleDispatch(req);
  } catch (error) {
    console.warn('[data-api] could not wake the automations: ' + (error && error.message ? error.message : String(error)));
  }
}
${
  recordsLowStock
    ? `
// Each product a low-stock scan finds is a product-low-stock event: one per
// product and stock level reached, so a scan that finds the same level again
// records nothing new. Written on a connection of its own and never awaited by
// the request, like the alert email; on Vercel the platform keeps it alive
// until it is done.
function lowStockLevel(row) {
  var raw = row.stock !== undefined && row.stock !== null ? row.stock : row.quantity;
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  var level = Number(raw);
  return isFinite(level) ? level : null;
}

function recordLowStockEvents(req, rows, threshold) {
  var work = (async function () {
    var eventClient = getClient();
    try {
      var appEvents = require('${DATA_ROUTE_ROOT}/${APP_EVENTS_PATH.join(
        '/'
      )}/${APP_EVENTS_FILE_NAME}');
      await eventClient.connect();
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i] || {};
        if (row.id === undefined || row.id === null || row.id === '') {
          continue;
        }
        var id = String(row.id);
        var stock = lowStockLevel(row);
        var product = {
          id: id,
          name: row.name !== undefined && row.name !== null ? String(row.name) : '',
          stock: stock,
          threshold: threshold,
        };
        if (row.sku !== undefined && row.sku !== null && row.sku !== '') {
          product.sku = String(row.sku);
        }
        await appEvents.recordAppEvent(eventClient, {
          type: 'product-low-stock',
          entityType: 'product',
          entityId: id,
          payload: { product: product },
          actorType: 'system',
          dedupeKey: 'low-stock:' + id + ':' + String(stock),
        }, req);
      }
    } catch (error) {
      console.error('[data-api] could not record the low-stock events: ' + (error && error.message ? error.message : String(error)));
    } finally {
      try { await eventClient.end(); } catch (_e) {}
    }
  })();
  try {
    var keepAlive = require('${DATA_ROUTE_ROOT}/${AUTOMATIONS_PATH.join(
        '/'
      )}/wait-until').waitUntil;
    if (typeof keepAlive === 'function') {
      keepAlive(work);
    }
  } catch (_e) {}
}
`
    : ''
}
`

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
  ...ContentTables.CONTENT_POSTS_TABLES,
]

/**
 * What a browser is served of the readable tables whose unpublished rows sit
 * beside the public ones — the same map the per-table read routes apply
 * (teleport-plugin-next-data-source `browser-row-policy.ts`): both read it from
 * teleport-shared. A browser may not filter or sort by a hidden column: a
 * filter is an oracle for a column it never returns.
 */
export const BROWSER_ROW_POLICIES: Readonly<Record<string, ContentTables.VisitorRowPolicy>> =
  ContentTables.VISITOR_ROW_POLICIES

export const generateDataAPIRoute = (options: DataAPIRouteOptions = {}): string => {
  const validatorCode = generateSqlValidatorCode()
  const authUsersTable = options.authUsersTableName || null
  const lowStockAlertsEnabled = !!options.lowStockAlertsEnabled
  const lowStockThreshold =
    typeof options.lowStockThreshold === 'number' && options.lowStockThreshold >= 0
      ? options.lowStockThreshold
      : 5
  const withAutomations = !!options.withAutomations
  const managedDataSourceIds = Array.isArray(options.managedDataSourceIds)
    ? Array.from(
        new Set(options.managedDataSourceIds.filter((id) => typeof id === 'string'))
      ).sort()
    : []
  const exposureTables = browserExposureTables(options.dataExposure, managedDataSourceIds)
  const hasSubscriberRules = Object.values(exposureTables).some(
    (entry) => (entry.subscriberRules || []).length > 0
  )
  const staffRoles =
    Array.isArray(options.staffRoles) && options.staffRoles.length > 0
      ? Array.from(new Set(options.staffRoles.filter((role) => typeof role === 'string'))).sort()
      : [TableAccess.ADMIN_ROLE]
  const recordsLowStock = dataAPIRouteRecordsLowStock(options)

  return `const { Client, types: pgTypes } = require('pg');
// A DATE stays the day it names, whatever the server's time zone: node-pg would read it as
// local midnight, which a server east of UTC sends as the day before.
if (pgTypes && typeof pgTypes.setTypeParser === 'function') {
  pgTypes.setTypeParser(1082, (value) => value);
}
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
${
  // The money-table lists and the guards over them, shared with the per-table
  // read routes so both families refuse the same tables. No browser reads a
  // protected table through THIS route (workflow data nodes run server-side),
  // so the roles that may read from a browser are irrelevant here.
  TableAccess.generateTableAccessHelperCode({ trustedReaderRoles: [] })
}
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
  // No query waits on the database longer than this (enforced by the client:
  // a server-side statement_timeout does not survive a pooler).
  if (connStr) {
    return new Client(
      Object.assign(
        { connectionString: connStr, query_timeout: ${DataExposure.READ_QUERY_TIMEOUT_MS} },
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
        query_timeout: ${DataExposure.READ_QUERY_TIMEOUT_MS},
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
  var ownerScope = (options && options.ownerScope) || null;
  // A read already bound to the visitor — an owner filter that is the
  // session's own id or email, or a guest's own browser key — may drop a
  // wildcard on another key: that only widens it within the visitor's own rows.
  var visitorScoped = !!ownerScope && __dataReadIsBoundToVisitor(ownerScope, filters);

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

    // A read of a customer table for a visitor: the filter on whose record it
    // is never widens the read, and names only the visitor's own (see
    // __dataOwnerScope).
    if (ownerScope && __dataIsOwnerColumn(ownerScope, field)) {
      var ownerClause = __dataOwnerClause(ownerScope, field, value, operand, f, filters);
      if (ownerClause !== null) {
        conditions.push(ownerClause);
        continue;
      }
    } else if (ownerScope && !visitorScoped && __dataIsWideningValue(value, f)) {
      // A customer table read for a visitor: an empty, "all" or wildcard value
      // on ANY key matches nothing — it never drops the condition and widens
      // the read to every customer's rows.
      conditions.push('FALSE');
      continue;
    } else if (!strict && f.__skippable === true) {
      // The data-select node keeps every filter it would have left out, for the
      // scope above; anywhere else it is left out, as the node always did.
      continue;
    }

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
  // A browser never filters, sorts or selects by a credential column.
  __dataAssertNoCredentialFields(req, tableName, filters.map(function(f) { return f && (f.source || f.field); })
    .concat(sorts.map(function(s) { return s && s.field; }), selectedColumns));
  // A browser reads a published table's public rows, and never names a hidden
  // column — to read it, filter by it or sort by it.
  var rowPolicy = __dataRowPolicy(req, tableName);
  if (rowPolicy) {
    __dataAssertVisibleFields(rowPolicy, filters.map(function(f) { return f && (f.source || f.field); }));
    __dataAssertVisibleFields(rowPolicy, sorts.map(function(s) { return s && s.field; }));
    __dataAssertVisibleFields(rowPolicy, selectedColumns);
  }

  // A browser reads a bounded page of rows, of whole numbers (see
  // __dataReadWindow); the app's own server code reads what it names.
  var rowWindow = __dataReadWindow(req, limit, skip);
  limit = rowWindow.limit;
  skip = rowWindow.skip;
  var ownerScope = await __dataOwnerScope(req, tableName);

  var queryParams = [];
  var cols = selectedColumns.length > 0 ? selectedColumns.join(', ') : '*';
  if (feed) cols = feed.columns.join(', ');
  var sql = 'SELECT ' + cols + ' FROM ' + tableName;

  var where = buildWhereClause(filters, queryParams, 1, { skipOptionalEmpty: true, ownerScope: ownerScope });
  if (!rawQueryUserPart) where = await __dataWithPrivateScope(client, ownerScope, filters, queryParams, where);
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

  if (limit !== undefined) {
    sql += ' LIMIT ' + limit;
  }
  if (skip !== undefined) {
    sql += ' OFFSET ' + skip;
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
  // No credential column leaves in a row — a server segment relays its rows
  // to the browser. Only a server-side caller that names one in its own
  // projection (a check that compares a hash on the server) gets it.
  rows = rawQueryUserPart
    ? __taWithoutCredentials(rows, null, isAuthLayerCall(req) ? __taCredentialsNamedBy(rawQueryUserPart, rows) : [])
    : __taWithoutCredentials(rows, tableName, isAuthLayerCall(req) ? selectedColumns : []);
  if (rowPolicy) rows = __dataWithoutHidden(rowPolicy, rows);

  var countSql = 'SELECT COUNT(*) FROM ' + tableName;
  var countParams = [];
  var countWhere = buildWhereClause(filters, countParams, 1, { skipOptionalEmpty: true, ownerScope: ownerScope });
  countWhere = await __dataWithPrivateScope(client, ownerScope, filters, countParams, countWhere);
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
  __dataAssertNoCredentialFields(req, tableName, filters.map(function(f) { return f && (f.source || f.field); }));
  var rowPolicy = __dataRowPolicy(req, tableName);
  if (rowPolicy) {
    __dataAssertVisibleFields(rowPolicy, filters.map(function(f) { return f && (f.source || f.field); }));
  }
  var ownerScope = await __dataOwnerScope(req, tableName);
  var queryParams = [];
  var sql = 'SELECT COUNT(*) FROM ' + tableName;
  var where = buildWhereClause(filters, queryParams, 1, { skipOptionalEmpty: true, ownerScope: ownerScope });
  where = await __dataWithPrivateScope(client, ownerScope, filters, queryParams, where);
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
// (the definitions on the product, the chosen configuration on an order line)
// and the record an activity-log line is about (its entity).
// A write naming one on a store whose table never gained it drops that column
// instead of failing the whole statement — an order must never lose its lines
// over a column that was not added. Only when the table's columns are known:
// an unreadable schema leaves the write exactly as it was.
var OPTIONAL_FEATURE_COLUMNS = {
  teleport_products: ['option_groups', 'product_page'],
  teleport_order_items: ['configuration', 'configuration_label'],
  teleport_events: ['entity_type', 'entity_id', 'claimed_at'],
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

async function handleCreate(client, body, req) {
  var tableName = body.tableName;
  var columnMappings = body.columnMappings || {};
  // Optional fallback passed by the data-create-item workflow handler
  // when the workflow context carries a resolve-user output. See
  // coerceUuidColumnValue for why ownership columns get this special
  // treatment instead of being NULL'd outright.
  var anonymousUserIdFallback = await __dataGuestFallback(client, req, body.__anonymousUserId);

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
  // The written row goes back to a segment that relays it: never its credentials.
  return { item: __dataWithoutItemCredentials(item, tableName), id: resolvedId };
}

async function handleUpdate(client, body, req) {
  var tableName = body.tableName;
  var filters = body.filters || [];
  var columnMappings = body.columnMappings || {};
  var anonymousUserIdFallback = await __dataGuestFallback(client, req, body.__anonymousUserId);

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
  return {
    updatedCount: result.rowCount || 0,
    item: __dataWithoutItemCredentials(result.rows[0] || null, tableName),
    id: (result.rows[0] && result.rows[0].id) || null,
  };
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
// background-work case where the request context isn't visible. NEXTAUTH_URL
// is read as configured, never as the auth route rewrote it from a request
// (configured-nextauth-url.ts).
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
    var configured = String(${CONFIGURED_NEXTAUTH_URL_EXPRESSION} || '').trim();
    if (!configured) return requestOrigin;
    var origin;
    try { origin = new URL(configured).origin; } catch (e) { return requestOrigin; }
    if (isLoopbackHost(host) && isLoopbackHost(new URL(origin).host)) return requestOrigin;
    return origin;
  }
  if (${CONFIGURED_NEXTAUTH_URL_EXPRESSION}) return String(${CONFIGURED_NEXTAUTH_URL_EXPRESSION}).replace(/\\/+$/, '');
  if (process.env.VERCEL_URL) return 'https://' + String(process.env.VERCEL_URL).replace(/\\/+$/, '');
  return '';
}

${generateSelfCallHeadersCode()}

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
      headers: __selfCallHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    }).catch(function(err) {
      console.error('[data-api] low-stock alert POST failed: ' + (err && err.message ? err.message : String(err)));
    });
  } catch (e) {
    console.error('[data-api] low-stock alert POST threw synchronously: ' + (e && e.message ? e.message : String(e)));
  }
}

${
  withAutomations ? generateBusinessEventsCode(recordsLowStock) : ''
}async function handleRawQuery(client, body, req) {
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
  // No credential column comes back to a segment a visitor's request runs: its
  // results are relayed to the browser. A server job (a cron's calendar sync)
  // and the auth layer get the credential columns the statement names itself
  // (see __taCredentialsNamedBy); a SELECT * over the users table brings none.
  var rows = Array.isArray(result.rows) ? result.rows : [];
  var namedCredentials = __dataIsServerJob(req) || isAuthLayerCall(req) ? __taCredentialsNamedBy(query, rows) : [];
  rows = __taWithoutCredentials(rows, null, namedCredentials);

  // Auto-fire the low-stock alert when the workflow runs the post-
  // stock-decrement SELECT and gets back a non-empty list. The
  // workflow's own email-payload-builder node (af26cd7e) returns
  // skip:true and never dispatches; this fire-and-forget covers
  // that gap without requiring the AI to wire an email-send node.
  if (LOW_STOCK_ALERTS_ENABLED && rows.length > 0 && looksLikeLowStockProductSelect(query)) {
    fireAndForgetLowStockAlert(req, rows, extractThresholdFromQuery(query));
${
  recordsLowStock ? '    recordLowStockEvents(req, rows, extractThresholdFromQuery(query));\n' : ''
}  }
${
  withAutomations
    ? "  RAW_QUERY_ROW_COUNTS.set(req, typeof result.rowCount === 'number' ? result.rowCount : rows.length);\n"
    : ''
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

// A server job — a cron, a webhook or an automation run, which runs no
// visitor's request — flags its data calls (the runners put x-tq-server-job in
// the run's __internalHeaders) and presents the app secret; the flag counts
// only with it. Every other internal call is a segment a visitor's request
// runs: its reads of customer records are the visitor's (__dataOwnerScope), and
// its raw results carry no credential.
function __dataIsServerJob(req) {
  if (!isInternalDataRequest(req)) return false;
  var flag = req && req.headers && req.headers['x-tq-server-job'];
  return (Array.isArray(flag) ? flag[0] : flag) === '1';
}

// The auth layer's own in-process call (a property, never a header, so nothing
// on the wire can claim it): the only caller a credential column it names in
// its projection is returned to. Every other caller — every workflow segment —
// gets the row without its credentials.
function isAuthLayerCall(req) {
  return !!(req && req.__tqAuthLayerCall === true && req.__tqServerCall === true);
}

function __dataAssertNoCredentialFields(req, tableName, fields) {
  if (isInternalDataRequest(req)) return;
  for (var i = 0; i < fields.length; i++) {
    if (!fields[i]) continue;
    var name = __taNormalizeTable(fields[i]);
    if (__taIsCredentialColumn(name) || (__taIsCredentialTable(tableName) && __TA_CREDENTIAL_COLUMNS.indexOf(name) !== -1)) {
      var err = new Error('Invalid field');
      err.status = 400;
      throw err;
    }
  }
}

// Who reads which table from a browser beyond the storefront's own tables:
// the pages that bind it decide (DataExposure in teleport-shared), as on the
// per-table read routes — anyone for a public page's table, a session the
// binding pages admit otherwise (with the entitlement on a subscriber-only
// page). A row-owned page's table is read on its own route, never here.
var DATA_EXPOSURE_TABLES = ${JSON.stringify(exposureTables)};
${hasSubscriberRules ? DataExposure.generateEntitlementCheckCode() : ''}
var MANAGED_DATA_SOURCE_IDS = ${JSON.stringify(managedDataSourceIds)};
async function __dataBrowserMayRead(req, dataSourceId, tableName) {
  // This route reads the managed database whatever id the path names: a browser
  // names one of its sources, never another's whose table has the same name.
  if (MANAGED_DATA_SOURCE_IDS.indexOf(dataSourceId) === -1) return false;
  var bare = __dataPublicTable(tableName);
  if (!bare) return false;
  var entry = DATA_EXPOSURE_TABLES[dataSourceId + ':' + bare] || DATA_EXPOSURE_TABLES['*:' + bare];
  if (!entry) return false;
  if (entry.public) return true;
  var token = await __dataSession(req);
  if (!token) return false;
  if (entry.anySession) return true;
  var role = __taRoleOf(token);
  if (role && entry.roles.indexOf(role) !== -1) return true;
  var rules = entry.subscriberRules || [];
  var products = null;
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].roles.length > 0 && (!role || rules[i].roles.indexOf(role) === -1)) continue;
    products = rules[i].productIds.length === 0 || (products && products.length === 0)
      ? []
      : (products || []).concat(rules[i].productIds);
  }
  return !!products && (await __dxEntitled(token, products));
}

function __dataWithoutItemCredentials(item, tableName) {
  if (!item || typeof item !== 'object') return item;
  return __taWithoutCredentials([item], tableName)[0];
}

// The id a guest's row may be filed under when its owner column got no id of
// its own (see coerceUuidColumnValue): an ANONYMOUS id only. With a session it
// must be the session's own id; without one it must not be a registered
// account's id — any users row but the guest's own anonymous one
// (<uuid>${TableAccess.ANONYMOUS_GUEST_EMAIL_SUFFIX}, written by "Resolve Current User"
// before the checkout's insert; see TableAccess.registeredAccountEmailSql) — a
// request never files a row under someone else's account. Any doubt (no users
// table, a failed check) drops it.
async function __dataGuestFallback(client, req, value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) return undefined;
  var token = await __dataSession(req);
  if (token) {
    var own = token.id || token.sub;
    return own && String(own) === value ? value : undefined;
  }
  try {
    var registered = await client.query(
      'SELECT 1 FROM ' + GUEST_FALLBACK_USERS_TABLE + " WHERE id::text = $1 AND ${TableAccess.registeredAccountEmailSql(
        'email'
      )} LIMIT 1",
      [value]
    );
    return registered && registered.rows && registered.rows.length > 0 ? undefined : value;
  } catch (e) {
    return undefined;
  }
}

// How many rows a read gets. A browser (the storefront's own reads) gets
// BROWSER_DEFAULT_LIMIT rows when it names no count, never more than
// BROWSER_MAX_LIMIT, starts no further in than BROWSER_MAX_OFFSET, and a count
// that is not a whole number is refused. The app's own server code reads what
// it names (a count it cannot read is left out, as before).
var BROWSER_DEFAULT_LIMIT = ${DATA_API_BROWSER_DEFAULT_LIMIT};
var BROWSER_MAX_LIMIT = ${DATA_API_BROWSER_MAX_LIMIT};
var BROWSER_MAX_OFFSET = ${DATA_API_BROWSER_MAX_OFFSET};

function __dataRowCount(value, label, strict) {
  if (value === undefined || value === null || value === '') return undefined;
  var text = String(value).trim();
  if (/^[0-9]{1,15}$/.test(text)) return parseInt(text, 10);
  if (strict) {
    var err = new Error('Invalid ' + label);
    err.status = 400;
    throw err;
  }
  var parsed = parseInt(text, 10);
  return isNaN(parsed) || parsed < 0 ? undefined : parsed;
}

function __dataReadWindow(req, limit, skip) {
  if (isInternalDataRequest(req)) {
    return { limit: __dataRowCount(limit, 'limit', false), skip: __dataRowCount(skip, 'skip', false) };
  }
  var browserLimit = __dataRowCount(limit, 'limit', true);
  var browserSkip = __dataRowCount(skip, 'skip', true);
  return {
    limit: Math.min(browserLimit === undefined ? BROWSER_DEFAULT_LIMIT : browserLimit, BROWSER_MAX_LIMIT),
    skip: browserSkip === undefined ? undefined : Math.min(browserSkip, BROWSER_MAX_OFFSET),
  };
}

// Whose record a customer-table row is (see TableAccess.OWNER_* in
// teleport-shared). A server segment reads these tables for a visitor with the
// app secret, so the browser's session reaches here only as the cookie the
// segment forwards — and the filter values only as the context the browser
// sent. So for a visitor who is not staff — a guest, an ordinary account, a
// customer role such as a subscription's member — a filter on an owner column:
//  - never widens the read: an empty or "all" value, a negation or a pattern
//    matches nothing — a guest's own rows, found by the guest key the same read
//    names (session_id …), are the ones no account owns;
//  - names only the visitor: for a signed-in visitor the value must be the
//    session's own id (or email), never one the browser chose.
// A staff role (STAFF_ROLES: the admin panel's roles and admin) reads every
// customer's records.
var OWNER_SCOPED_TABLES = ${JSON.stringify(TableAccess.CUSTOMER_RECORD_TABLES)};
var OWNER_ID_COLUMNS = ${JSON.stringify(TableAccess.OWNER_ID_COLUMNS)};
var OWNER_EMAIL_COLUMNS = ${JSON.stringify(TableAccess.OWNER_EMAIL_COLUMNS)};
var OWNER_COLUMNS_BY_TABLE = ${JSON.stringify(TableAccess.OWNER_COLUMNS_BY_TABLE)};
// The private customer records (TableAccess.PRIVATE_CUSTOMER_RECORD_TABLES): a
// visitor's read of one is always the visitor's own rows, whatever its filters
// name (__dataWithPrivateScope).
var PRIVATE_RECORD_TABLES = ${JSON.stringify(TableAccess.PRIVATE_CUSTOMER_RECORD_TABLES)};
var PRIVATE_RECORD_PARENTS = ${JSON.stringify(TableAccess.PRIVATE_RECORD_PARENTS)};
var GUEST_KEY_COLUMNS = ${JSON.stringify(GUEST_KEY_COLUMNS)};
// The accounts table a guest's fallback id is checked against.
var GUEST_FALLBACK_USERS_TABLE = ${JSON.stringify(
    authUsersTable && /^[A-Za-z_][A-Za-z0-9_]*$/.test(authUsersTable) ? authUsersTable : 'users'
  )};
var STAFF_ROLES = ${JSON.stringify(staffRoles)};

async function __dataSession(req) {
  if (typeof __tqSessionToken !== 'function') return null;
  try {
    return (await __tqSessionToken(req)) || null;
  } catch (e) {
    return null;
  }
}

// The visitor a read of \`tableName\` is scoped to, or null when it is not
// scoped: not a customer table, a browser (which reads none of them here), or
// a staff role.
async function __dataOwnerScope(req, tableName) {
  if (!isInternalDataRequest(req)) return null;
  // Every segment a visitor's request runs is scoped; only a server job (a
  // cron, a webhook, an automation) reads the customer records as before. An
  // admin server step runs with a staff session (below).
  if (__dataIsServerJob(req)) return null;
  var table = __taNormalizeTable(tableName);
  if (OWNER_SCOPED_TABLES.indexOf(table) === -1) return null;
  var token = await __dataSession(req);
  var role = token ? __taRoleOf(token) : null;
  if (role && STAFF_ROLES.indexOf(role) !== -1) return null;
  var own = Object.prototype.hasOwnProperty.call(OWNER_COLUMNS_BY_TABLE, table) ? OWNER_COLUMNS_BY_TABLE[table] : null;
  return {
    table: table,
    ids: own ? own.ids : OWNER_ID_COLUMNS,
    emails: own ? own.emails : OWNER_EMAIL_COLUMNS,
    signedIn: !!token,
    sessionId: token && (token.id || token.sub) ? String(token.id || token.sub) : '',
    sessionEmail: token && token.email ? String(token.email).trim().toLowerCase() : '',
  };
}

// A visitor's read of a private record table that its own filters do not bind
// to the visitor (__dataReadIsBoundToVisitor) gets the owner condition anyway:
// a list built with no owner filter shows only the visitor's rows. A session's
// is its id or email on the table's owner columns (or its parent row's, for a
// table owned through one); a guest's read of one is its guest key's, or
// nothing.
async function __dataWithPrivateScope(client, scope, filters, queryParams, where) {
  if (!scope || PRIVATE_RECORD_TABLES.indexOf(scope.table) === -1) return where;
  if (__dataReadIsBoundToVisitor(scope, filters)) return where;
  // A read one of whose conditions is already FALSE finds nothing as it is.
  if (/(?:^ WHERE | AND )FALSE(?: AND |$)/.test(where.clause || '')) return where;
  var condition = scope.signedIn
    ? await __dataPrivateOwnerCondition(client, scope, scope.table, queryParams, 0)
    : 'FALSE';
  return {
    clause: (where.clause ? where.clause + ' AND ' : ' WHERE ') + condition,
    paramIndex: queryParams.length + 1,
  };
}

// The session's own rows of \`table\`, by the owner columns it has (read from
// the schema), or by its parent row's (PRIVATE_RECORD_PARENTS); 'FALSE' when it
// has neither, or the session lacks the identity they name.
async function __dataPrivateOwnerCondition(client, scope, table, queryParams, depth) {
  var types = await getColumnTypes(client, table);
  var columns = Object.keys(types).map(function(name) { return String(name).toLowerCase(); });
  var own = Object.prototype.hasOwnProperty.call(OWNER_COLUMNS_BY_TABLE, table) ? OWNER_COLUMNS_BY_TABLE[table] : null;
  var present = function(name) { return columns.indexOf(name) !== -1; };
  var ids = (own ? own.ids : OWNER_ID_COLUMNS).filter(present);
  var emails = (own ? own.emails : OWNER_EMAIL_COLUMNS).filter(present);
  if (ids.length > 0 || emails.length > 0) {
    var parts = [];
    if (scope.sessionId) {
      ids.forEach(function(name) {
        queryParams.push(scope.sessionId);
        parts.push(name + '::text = $' + queryParams.length);
      });
    }
    if (scope.sessionEmail) {
      emails.forEach(function(name) {
        queryParams.push(scope.sessionEmail);
        parts.push('LOWER(' + name + '::text) = $' + queryParams.length);
      });
    }
    return parts.length > 0 ? '(' + parts.join(' OR ') + ')' : 'FALSE';
  }
  var parent = Object.prototype.hasOwnProperty.call(PRIVATE_RECORD_PARENTS, table) ? PRIVATE_RECORD_PARENTS[table] : null;
  if (!parent || depth >= 3 || !present(parent.column)) return 'FALSE';
  var inner = await __dataPrivateOwnerCondition(client, scope, parent.parent, queryParams, depth + 1);
  if (inner === 'FALSE') return 'FALSE';
  return parent.column + ' IN (SELECT id FROM ' + parent.parent + ' WHERE ' + inner + ')';
}

function __dataIsOwnerColumn(scope, field) {
  var column = __taNormalizeTable(field);
  return scope.ids.indexOf(column) !== -1 || scope.emails.indexOf(column) !== -1;
}

// Whether a filter binds the read to a guest's own browser key: a guest-key
// column equal (=, nothing else) to one concrete value. A LIKE, a negation, a
// "contains", a list or a value that would drop the condition (empty, "all", a
// bare wildcard) binds nothing.
function __dataNamesGuestKey(filters) {
  for (var i = 0; i < filters.length; i++) {
    var f = filters[i] || {};
    var column = __taNormalizeTable(f.source || f.field);
    var value = f.destination !== undefined ? f.destination : f.value;
    if (
      GUEST_KEY_COLUMNS.indexOf(column) !== -1 &&
      typeof value === 'string' &&
      __dataFilterOperator(f.operand || f.operator || '=', value) === '=' &&
      !__dataIsWideningValue(value, f)
    ) {
      return true;
    }
  }
  return false;
}

// The operator buildWhereClause would write for this filter.
function __dataFilterOperator(operand, value) {
  var normalized = String(operand || '=').toLowerCase();
  if (Array.isArray(value)) return operand === '!=' ? '!=' : '=';
  if (/^(?:not[_-]?)?contains$|^starts[_-]?with$|^ends[_-]?with$/.test(normalized)) return 'like';
  var validOps = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'ILIKE'];
  return validOps.indexOf(operand) !== -1 ? operand : '=';
}

// null when the owner filter may run as written, else the clause it becomes.
// Whether some filter binds the read to the visitor: for a signed-in visitor an
// owner filter whose value is the session's own; for a guest a guest-key filter.
function __dataReadIsBoundToVisitor(scope, filters) {
  if (!Array.isArray(filters)) return false;
  if (!scope.signedIn) return __dataNamesGuestKey(filters);
  for (var i = 0; i < filters.length; i++) {
    var f = filters[i] || {};
    var field = f.source || f.field;
    if (!field || !__dataIsOwnerColumn(scope, field)) continue;
    var value = f.destination !== undefined ? f.destination : f.value;
    if (__dataOwnerClause(scope, field, value, f.operand || f.operator || '=', f, filters) === null) return true;
  }
  return false;
}

// A value that would drop its condition: empty, missing, "all"/wildcard, or one
// the data-select node marked as left out.
function __dataIsWideningValue(value, filter) {
  return filter.__skippable === true || isMissingFilterValue(value) || isSkippableFilterValue(value) ||
    isAllSentinelFilterValue(value, filter) || value === '__TQ_UNRESOLVED_ROUTE_PARAM__' ||
    (typeof value === 'string' && /^[*%]+$/.test(value.trim()));
}

function __dataOwnerClause(scope, field, value, operand, filter, filters) {
  var empty = __dataIsWideningValue(value, filter);
  if (empty) {
    return !scope.signedIn && __dataNamesGuestKey(filters) ? field + ' IS NULL' : 'FALSE';
  }
  if (__dataFilterOperator(operand, value) !== '=') return 'FALSE';
  var values = Array.isArray(value) ? value : [value];
  var isEmailColumn = scope.emails.indexOf(__taNormalizeTable(field)) !== -1;
  for (var i = 0; i < values.length; i++) {
    var entry = values[i];
    if (entry === null || entry === undefined || typeof entry === 'object') return 'FALSE';
    var text = String(entry).trim();
    if (text === '' || isAllSentinelFilterValue(text, null)) return 'FALSE';
    // A guest never names whose record to read: only a read bound to the
    // guest's own browser key (a guest-key filter with a value) may carry one.
    if (!scope.signedIn) {
      if (!__dataNamesGuestKey(filters)) return 'FALSE';
      continue;
    }
    var own = isEmailColumn ? scope.sessionEmail : scope.sessionId;
    if (!own || (isEmailColumn ? text.toLowerCase() !== own : text !== own)) {
      console.warn('[data-api] refused a read of ' + scope.table + ' by ' + field + ': it names another account than the session');
      return 'FALSE';
    }
  }
  return null;
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

// The retired tables (TableAccess.RETIRED_TABLES: the old password_reset_tokens)
// are refused to EVERY caller, the app's own server code and its jobs included,
// before anything else runs: by the table a request names, and by any mention
// in a raw statement's text.
function assertNoRetiredTable(operation, body) {
  if (!body || typeof body !== 'object') return;
  var sql = operation === 'raw-query' ? body.query : body.rawQueryUserPart;
  if (__taRetiredTableNamed(body.tableName, typeof sql === 'string' ? sql : null)) {
    var err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
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
    if (
      BROWSER_READABLE_TABLES.indexOf(__dataPublicTable(body.tableName)) === -1 &&
      req.__tqBrowserExposure !== true
    ) {
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
  if (WRITE_OPERATIONS[operation] && __TA_WRITE_PROTECTED_TABLES.indexOf(table) !== -1) __taForbid(table);
  // A select's raw override replaces the assembled SELECT wholesale, so its
  // text is checked like a raw query rather than trusting \`tableName\`.
  if (operation === 'select' && typeof body.rawQueryUserPart === 'string') {
    __taAssertSqlTextAllowed(body.rawQueryUserPart);
  }
}

// The columns of the auth users table that decide what a session may DO, not
// who it is: a role, an admin or staff flag, a verified email, credit, a plan,
// an entitlement, in any spelling (the one shared rule,
// AccountFields.isPrivilegedAccountField). The session token carries the role
// off the \`users\` row, and the middleware's page gates and the money-table
// guard both read it — so a visitor who could write one of these would be
// handing themselves the store administrator's reads. A browser never writes
// one; a server segment writes one only for staff (STAFF_ROLES) or as the
// server's own job (no visitor): a segment acts for the visitor whose cookie
// it forwards, and a profile form that maps one of these would let a customer
// make themselves the administrator. Everything else on the row stays
// writable, and the rule is the ACCOUNT table's only: \`plan\`, \`tier\` or
// \`credits\` are ordinary columns of any other table.
${AccountFields.generatePrivilegedAccountFieldCode('__dataIsPrivilegedAccountColumn')}

// The privileged account columns a statement's text names.
function __dataPrivilegedColumnsNamed(text) {
  var words = String(text || '').match(/[A-Za-z_][A-Za-z0-9_$]*/g) || [];
  return words.filter(__dataIsPrivilegedAccountColumn);
}

function __dataWrittenColumns(body) {
  var columnMappings = (body && body.columnMappings) || {};
  return Array.isArray(columnMappings)
    ? columnMappings.map(function(m) { return m && (m.source || m.column); })
    : Object.keys(columnMappings);
}

async function assertNoPrivilegeWriteForCustomer(req, operation, body) {
  if (ROLE_SOURCE_TABLES.length === 0 || !isInternalDataRequest(req)) return;
  if (!body || typeof body !== 'object') return;
  var sql = operation === 'raw-query' ? body.query : null;
  var written = [];
  if (typeof sql === 'string' && sql.length > 0) {
    var cleaned = __taCleanSql(sql);
    if (cleaned.ok && !__TA_SQL_WRITE_RE.test(cleaned.text)) return;
    var mentionsAccounts = ROLE_SOURCE_TABLES.some(function(table) { return __taSqlMentionsTable(sql, table); });
    if (!mentionsAccounts) return;
    written = __dataPrivilegedColumnsNamed(cleaned.ok ? cleaned.text : sql);
  } else if (operation === 'create' || operation === 'update') {
    if (ROLE_SOURCE_TABLES.indexOf(__taNormalizeTable(body.tableName)) === -1) return;
    written = __dataWrittenColumns(body).filter(function(column) { return __dataIsPrivilegedAccountColumn(column); });
  }
  if (written.length === 0) return;
  var token = await __dataSession(req);
  if (!token) return;
  var role = __taRoleOf(token);
  if (role && STAFF_ROLES.indexOf(role) !== -1) return;
  __forbidRoleWrite(written[0]);
}

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
    if (__dataIsPrivilegedAccountColumn(written[i])) __forbidRoleWrite(written[i]);
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
${withAutomations ? '  kickDueAutomations(req);\n' : ''}
  var params = req.query.params;
  if (!params || params.length < 2) {
    return res.status(400).json({ error: 'Invalid path. Expected /api/data/<dataSourceId>/<operation>' });
  }

  var operation = params[params.length - 1];
  var body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  var client = getClient();

  try {
    assertNoRetiredTable(operation, body);
    // A browser's read of a table the storefront runtime does not read is
    // admitted the way its per-table route admits it (DATA_EXPOSURE_TABLES).
    if (!isInternalDataRequest(req) && (operation === 'select' || operation === 'count') && body && body.tableName) {
      req.__tqBrowserExposure = await __dataBrowserMayRead(req, String(params[0]), body.tableName);
    }
    assertTableAccess(req, operation, body);
    assertNoBrowserRoleWrite(req, operation, body);
    await assertNoPrivilegeWriteForCustomer(req, operation, body);
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
        result = await handleCreate(client, body, req);
        break;
      case 'update':
        result = await handleUpdate(client, body, req);
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

${
  withAutomations
    ? `    // The write succeeded: a new business event wakes the automations.
    if (wroteBusinessEvent(operation, body, result, req)) {
      wakeAutomations(req);
    }

`
    : ''
}    return res.status(200).json(result);
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
