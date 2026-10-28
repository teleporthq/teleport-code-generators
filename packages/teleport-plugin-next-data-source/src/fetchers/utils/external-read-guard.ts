import type { DataReadExposure } from '@teleporthq/teleport-types'
import { DataExposure, TableAccess } from '@teleporthq/teleport-shared'
import {
  generateTableAccessPreamble,
  RequestFieldPolicy,
  SchemaColumn,
  SessionReaderPlacement,
} from './table-access-guard'

/**
 * The same guard for a read route over an EXTERNAL source (MySQL, MariaDB,
 * Redshift, ClickHouse, Turso, Supabase, MongoDB, Firestore, Airtable, Redis,
 * REST, Google Sheets, CSV, JavaScript) as the TeleportHQ / Postgres routes
 * carry inline: the table's exposure, the protected-table net, a row window of
 * whole numbers (a browser's capped), request fields of a safe shape, no
 * credential column in a row, and a generic error to the client.
 *
 * The drivers differ in everything else, so the guard wraps the driver's
 * handler rather than living inside fourteen of them: the driver runs only for
 * a request the guard let through, with `limit` / `perPage` / `page` /
 * `offset` replaced by the whole numbers the guard settled on — a driver that
 * splices them into its SQL text splices digits — and its answer passes back
 * through the guard, which strips credentials and replaces any error text.
 */

/** How a request may name a field for a driver. */
export type RequestFieldRule = 'identifier' | 'label' | 'any'

/**
 * A SQL column: plain, quoted or table-qualified — what the Postgres routes
 * accept (`request-sql-guards.ts`).
 */
const IDENTIFIER_FIELD_RE = /^"?[A-Za-z_][A-Za-z0-9_]*"?(?:\."?[A-Za-z_][A-Za-z0-9_]*"?)?$/

/**
 * A field of a document store or a base whose names are labels: anything but
 * the characters its query language gives a meaning (`{}` closes an Airtable
 * field reference, `$` opens a MongoDB operator, quotes and parentheses open
 * literals and calls).
 */
const LABEL_FIELD_RE = /^[^{}'"`\\(),;$]{1,128}$/

/** SQL drivers splice the field into their statement; document stores read it as a path or an operator. */
export const requestFieldRuleOf = (dataSourceType: string): RequestFieldRule => {
  switch (dataSourceType) {
    case 'mysql':
    case 'tidb':
    case 'mariadb':
    case 'amazon-redshift':
    case 'clickhouse':
    case 'turso':
    case 'supabase':
      return 'identifier'
    case 'mongodb':
    case 'firestore':
    case 'airtable':
      return 'label'
    default:
      // REST, JavaScript, CSV, Google Sheets, Redis filter the rows in memory.
      return 'any'
  }
}

/** The stores that read a `$`-key as an operator or a dotted key as a path. */
const DOCUMENT_STORES = new Set(['mongodb', 'firestore', 'redis'])

/**
 * What a request may name for a driver (see `RequestFieldPolicy`): the
 * export's schema of the table — required for a SQL driver, so a table without
 * one answers every named field 400 — and the driver's own shape rule.
 */
export const driverFieldPolicy = (
  dataSourceType: string,
  schemaColumns: string[] | null
): RequestFieldPolicy => {
  const rule = requestFieldRuleOf(dataSourceType)
  return {
    columns: rule === 'identifier' ? schemaColumns || [] : schemaColumns,
    documentStore: DOCUMENT_STORES.has(dataSourceType),
    ...(rule === 'identifier' && { pattern: IDENTIFIER_FIELD_RE }),
    ...(rule === 'label' && { pattern: LABEL_FIELD_RE }),
  }
}

/**
 * The stores whose search turns the text into a pattern of their own query
 * language (MongoDB's `$regex`): the text is escaped first, so it is matched
 * as text — never an anchored, character-by-character probe, never a pattern
 * that takes the server's time.
 */
const PATTERN_SEARCH_STORES = new Set(['mongodb'])

/** A text type, as the sources name theirs (`text`, `varchar(255)`, `character varying`, `string`). */
const TEXT_COLUMN_TYPE = /char|text|string|clob|enum/i

/**
 * The columns a browser's search runs over when it names none (N3): the
 * table's schema — for Supabase, whose PostgREST `ilike` refuses any other
 * type, its text columns — else, for a source without one, the fields the
 * project's own bindings read. Never a credential column: what a search
 * matches, it lets the searcher test character by character.
 */
export const defaultSearchColumns = (
  dataSourceType: string,
  schema: SchemaColumn[] | null,
  bindingFields: string[]
): string[] => {
  const textOnly = dataSourceType === 'supabase'
  const candidates = schema
    ? schema
        .filter((column) => !textOnly || !column.type || TEXT_COLUMN_TYPE.test(column.type))
        .map((column) => column.name)
    : bindingFields
  return Array.from(new Set(candidates)).filter((name) => !TableAccess.isCredentialColumnName(name))
}

/** The guard's own code, after the shared preamble. */
const generateDriverGuardCode = (
  tableName: string,
  dataSourceType: string,
  searchColumns: string[]
): string => `
// GENERATED — see external-read-guard.ts in teleport-plugin-next-data-source.
var __TQ_DRIVER_TABLE = ${JSON.stringify(tableName)};
var __TQ_DRIVER_WINDOW_KEYS = ['limit', 'perPage', 'page', 'offset'];
var __TQ_DRIVER_TIMEOUT_MS = ${DataExposure.READ_QUERY_TIMEOUT_MS};
// What a browser's search runs over when it names no columns (the driver's own
// fallback reads every column, credentials included).
var __TQ_DRIVER_SEARCH_COLUMNS = ${JSON.stringify(searchColumns)};
var __TQ_DRIVER_PATTERN_SEARCH = ${PATTERN_SEARCH_STORES.has(dataSourceType) ? 'true' : 'false'};

async function __taGuardedDriverRead(req, res, run, kind) {
  var failure = kind === 'count' ? 'Failed to get count' : 'Failed to fetch data';
  var exposure = await __taGuardExposure(req);
  if (exposure) {
    return res.status(exposure.status).json({ success: false, error: exposure.message, timestamp: Date.now() });
  }
  var access = await __taGuardRead(req, __TQ_DRIVER_TABLE, null);
  if (access) {
    return res.status(access.status).json({ success: false, error: access.message, timestamp: Date.now() });
  }
  var window;
  try {
    window = __taReadWindow(req);
    __taAssertReadRequest(req);
  } catch (error) {
    return res.status(400).json({ success: false, error: error && error.status ? error.message : 'Invalid request', timestamp: Date.now() });
  }
  var internal = __taIsInternalRequest(req);
  var query = Object.assign({}, (req && req.query) || {});
  __TQ_DRIVER_WINDOW_KEYS.forEach(function(key) {
    if (window[key] === undefined) delete query[key];
    else query[key] = String(window[key]);
  });
  var searching = query.query !== undefined && query.query !== null && String(query.query) !== '';
  if (searching && !internal && (query.queryColumns === undefined || query.queryColumns === null || query.queryColumns === '')) {
    if (__TQ_DRIVER_SEARCH_COLUMNS.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid search', timestamp: Date.now() });
    }
    query.queryColumns = JSON.stringify(__TQ_DRIVER_SEARCH_COLUMNS);
  }
  if (searching && __TQ_DRIVER_PATTERN_SEARCH) {
    query.query = String(Array.isArray(query.query) ? query.query[0] : query.query).replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
  }
  var forwarded = {
    method: req && req.method,
    headers: (req && req.headers) || {},
    cookies: req && req.cookies,
    // A browser's body never reaches the driver: a REST source configured for
    // POST would send it upstream, under the site's credentials, in place of
    // the configured one. The app's own server code may still supply one.
    body: internal ? req && req.body : undefined,
    query: query,
    __tqServerCall: !!(req && req.__tqServerCall === true),
    __tqOwnerScope: req && req.__tqOwnerScope,
  };
  // A row-owned page's read: the owner condition joins the request's filters.
  __taApplyOwnerScope(forwarded);
  var status = 200;
  var payload = null;
  var proxy = {
    status: function(code) { status = code; return proxy; },
    json: function(data) { payload = data; return proxy; },
    setHeader: function(name, value) {
      if (res && typeof res.setHeader === 'function') res.setHeader(name, value);
      return proxy;
    },
  };
  // No read waits on the source longer than __TQ_DRIVER_TIMEOUT_MS: a driver
  // without a query timeout of its own is answered for when it overruns.
  var timer = null;
  try {
    await Promise.race([
      run(forwarded, proxy),
      new Promise(function(_resolve, reject) {
        timer = setTimeout(function() { reject(new Error('the read timed out')); }, __TQ_DRIVER_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    status = 500;
    payload = { success: false, error: error };
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (status !== 200 || !payload || payload.success === false) {
    // The driver's error names tables, columns and values: server log only.
    var id = __taErrorId();
    console.error('[data-source] reading ' + __TQ_DRIVER_TABLE + ' failed (' + id + '):', payload && payload.error);
    return res.status(status >= 400 && status < 500 ? status : 500).json({ success: false, error: failure, id: id, timestamp: Date.now() });
  }
  if (Array.isArray(payload.data)) {
    payload = Object.assign({}, payload, { data: __taWithoutCredentials(payload.data, __TQ_DRIVER_TABLE) });
  }
  return res.status(200).json(payload);
}
`

const UNGUARDED_HANDLER = '__tqUnguardedHandler'
const UNGUARDED_COUNT = '__tqUnguardedGetCount'
const DRIVER_HANDLER_DECLARATION = 'export default async function handler('
const COUNT_DECLARATION = 'async function getCount(req, res)'

/** The driver module's single-line imports, which must stay at the top of an ES module. */
const IMPORT_LINE = /^import\s.*$/gm

/**
 * The driver's fetcher module with the guard around its handler: same
 * imports, the preamble, the driver renamed, and a guarded `handler` exported
 * in its place.
 */
export const guardExternalDriverModule = (
  driverCode: string,
  params: {
    tableName: string
    dataSourceType: string
    exposure: DataReadExposure
    trustedReaderRoles: ReadonlyArray<string>
    /** The table's columns as the data source config lists them (null: no schema). */
    schema?: SchemaColumn[] | null
    /** Where the route sits and whether its session reader checks revocation. */
    reader?: SessionReaderPlacement
  }
): string => {
  const schema = params.schema ?? null
  const schemaColumns = schema ? schema.map((column) => column.name) : null
  if (driverCode.split(DRIVER_HANDLER_DECLARATION).length !== 2) {
    // A driver that is not one handler cannot be wrapped; refusing to generate
    // it is the only answer that does not serve it unguarded.
    throw new Error('a data source read route must declare exactly one handler')
  }
  const imports = driverCode.match(IMPORT_LINE) || []
  const body = driverCode
    .replace(IMPORT_LINE, '')
    .trim()
    .replace(DRIVER_HANDLER_DECLARATION, `async function ${UNGUARDED_HANDLER}(`)

  return `${imports.join('\n')}

${generateTableAccessPreamble(
  params.trustedReaderRoles,
  params.exposure,
  driverFieldPolicy(params.dataSourceType, schemaColumns),
  params.tableName,
  params.reader
)}${generateDriverGuardCode(
    params.tableName,
    params.dataSourceType,
    defaultSearchColumns(params.dataSourceType, schema, params.exposure.fields || [])
  )}
${body}

export default async function handler(req, res) {
  return __taGuardedDriverRead(req, res, ${UNGUARDED_HANDLER}, 'data')
}
`
}

/** The driver's count handler behind the same guard (the guard code comes with the handler module). */
export const guardExternalDriverCount = (countCode: string): string => {
  if (countCode.split(COUNT_DECLARATION).length !== 2) {
    throw new Error('a data source count route must declare exactly one getCount')
  }
  return `${countCode.replace(COUNT_DECLARATION, `async function ${UNGUARDED_COUNT}(req, res)`)}

async function getCount(req, res) {
  return __taGuardedDriverRead(req, res, ${UNGUARDED_COUNT}, 'count')
}
`
}
