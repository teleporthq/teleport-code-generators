import type { DataReadExposure } from '@teleporthq/teleport-types'
import { DataExposure, SessionCookieResolver, TableAccess } from '@teleporthq/teleport-shared'
import { generateBrowserRowAccessCall, generateBrowserRowPolicyCode } from './browser-row-policy'

/**
 * The guard of a generated per-table read route
 * (`/api/teleport-<table>-<source>` and its `-count` twin).
 *
 * Every table a page binds gets such a route, and the route is a URL anyone
 * can call. Three nets, in this order:
 *  1. the table's EXPOSURE, decided at export time from the pages that bind it
 *     (`DataExposure.resolveDataExposure`): a table a public page shows is read
 *     by anyone; one only protected pages bind needs a session one of them
 *     admits; one no page binds is the app's own server code's;
 *  2. the protected tables (see `TableAccess.PROTECTED_TABLES`): money and
 *     customer records, read only by a server segment presenting the app
 *     secret or a signed-in member of a trusted role (the generated admin);
 *  3. the browser row policy (see `browser-row-policy.ts`): unpublished rows
 *     and private columns of the public tables.
 * A server-side caller (the app secret, or the module's own in-process
 * `fetchData`) passes all three.
 *
 * Every row count a request names is a whole number, and a browser's read is
 * capped (`__taReadWindow`): a missing count gets the table's default, a large
 * one the table's maximum.
 */

/** No route reads more than this many rows past the first, from a browser. */
export const BROWSER_READ_MAX_OFFSET = 1000000

/**
 * What a request may name as a field of the route's table (C1):
 *  - `columns`: the columns the export knows the table has (its schema in the
 *    data source config, plus every field the project's own bindings of the
 *    table name), or null for a source that has none to know (REST,
 *    JavaScript, CSV, Google Sheets, Redis: they filter in memory);
 *  - `virtualFields` / `virtualPrefixes`: the names the route itself answers
 *    with an expression (the products' effective price, rating, variant axes);
 *  - `documentStore`: a store that reads a `$`-key as an operator or a dotted
 *    key as a path (MongoDB, Firestore, Redis).
 * A table with a schema but no known column answers every named field 400.
 */
export interface RequestFieldPolicy {
  columns: string[] | null
  virtualFields?: string[]
  virtualPrefixes?: string[]
  documentStore?: boolean
  /** The shape every named field must also have (a driver's identifier or label rule). */
  pattern?: RegExp
}

/** A column of `config.selectedTables[tableName]`: its name, and its type when the config gives one. */
export interface SchemaColumn {
  name: string
  type?: string
}

/** The columns `config.selectedTables[tableName]` lists, with their types, or null when the config holds no schema for it. */
export const schemaOf = (config: unknown, tableName: string): SchemaColumn[] | null => {
  const selected = (
    config as {
      selectedTables?: Record<string, { columns?: Array<{ name?: unknown; type?: unknown }> }>
    }
  )?.selectedTables
  if (!selected || typeof selected !== 'object') {
    return null
  }
  const bare = DataExposure.bareTableName(tableName)
  const table =
    selected[tableName] ||
    Object.keys(selected)
      .filter((key) => DataExposure.bareTableName(key) === bare)
      .map((key) => selected[key])[0]
  if (!table || !Array.isArray(table.columns)) {
    return null
  }
  return table.columns
    .filter((column) => column && typeof column.name === 'string' && column.name.length > 0)
    .map((column) => ({
      name: column.name as string,
      ...(typeof column.type === 'string' && { type: column.type }),
    }))
}

/** The columns `config.selectedTables[tableName]` lists, or null when the config holds no schema for it. */
export const schemaColumnsOf = (config: unknown, tableName: string): string[] | null => {
  const schema = schemaOf(config, tableName)
  return schema ? schema.map((column) => column.name) : null
}

/**
 * The exposure check, the row window and the request-field check, for a
 * module whose table is `exposure`'s. Uses `__taIsInternalRequest`,
 * `__taRoleOf` and `__tqSessionToken` from the preamble.
 */
export const generateRouteExposureCode = (
  exposure: DataReadExposure | null | undefined,
  fieldPolicy: RequestFieldPolicy = { columns: [] },
  tableName: string = ''
): string => {
  const routeExposure = exposure || DataExposure.CLOSED_READ_EXPOSURE
  const subscriberRules = routeExposure.subscriberRules || []
  const ownerRules = routeExposure.ownerRules || []
  const knownColumns =
    fieldPolicy.columns === null
      ? null
      : Array.from(
          new Set(
            [...fieldPolicy.columns, ...(routeExposure.fields || [])].map((column) =>
              String(column).toLowerCase()
            )
          )
        ).sort()
  return `// GENERATED — see generateRouteExposureCode in teleport-plugin-next-data-source.
// Who may read this route's table from a browser, decided at export time from
// the pages that bind it: anyone when a page every visitor may open does;
// otherwise a session one of the binding pages admits — with an entitled
// subscription, when that page is subscriber-only. The app's own server code
// always may.
var __TA_ROUTE_EXPOSURE = ${JSON.stringify({
    public: routeExposure.public === true,
    anySession: routeExposure.anySession === true,
    roles: routeExposure.roles || [],
    subscriberRules,
    ownerRules,
    defaultLimit: routeExposure.defaultLimit,
    maxLimit: routeExposure.maxLimit,
  })};
var __TA_MAX_OFFSET = ${BROWSER_READ_MAX_OFFSET};
var __TA_ROUTE_TABLE = ${JSON.stringify(DataExposure.bareTableName(tableName))};
// The fields a request may name (see RequestFieldPolicy): null columns = a source
// without a schema, checked for shape only.
var __TA_FIELD_POLICY = ${JSON.stringify({
    columns: knownColumns,
    virtualFields: (fieldPolicy.virtualFields || []).map((field) => field.toLowerCase()),
    virtualPrefixes: (fieldPolicy.virtualPrefixes || []).map((prefix) => prefix.toLowerCase()),
    documentStore: fieldPolicy.documentStore === true,
  })};
var __TA_FIELD_PATTERN = ${fieldPolicy.pattern ? fieldPolicy.pattern.toString() : 'null'};
${subscriberRules.length > 0 ? DataExposure.generateEntitlementCheckCode() : ''}
// null when the request may read the table, else { status, message }.
async function __taGuardExposure(req) {
  if (__TA_ROUTE_EXPOSURE.public === true) return null;
  if (__taIsInternalRequest(req)) return null;
  // No page binds the table: no session could read it from a browser.
  if (
    __TA_ROUTE_EXPOSURE.anySession !== true &&
    __TA_ROUTE_EXPOSURE.roles.length === 0 &&
    __TA_ROUTE_EXPOSURE.subscriberRules.length === 0 &&
    __TA_ROUTE_EXPOSURE.ownerRules.length === 0
  ) {
    return { status: 403, message: 'Forbidden' };
  }
  var token = null;
  try {
    token = await __tqSessionToken(req);
  } catch (e) {
    token = null;
  }
  if (!token) return { status: 401, message: 'Unauthenticated' };
  if (__TA_ROUTE_EXPOSURE.anySession === true) return null;
  var role = __taRoleOf(token);
  if (role && __TA_ROUTE_EXPOSURE.roles.indexOf(role) !== -1) return null;
  // A row-owned page: the session reads its own rows only — the condition is
  // added to the read by the server (__taApplyOwnerScope).
  if (__TA_ROUTE_EXPOSURE.ownerRules.length > 0) {
    var ownerId = token.id || token.sub;
    if (!ownerId) return { status: 403, message: 'Forbidden' };
    req.__tqOwnerScope = { userId: String(ownerId) };
    return null;
  }
  // A subscriber-only page that admits the session: the products its rules
  // name (any product when one rule names none).
  var products = null;
  for (var i = 0; i < __TA_ROUTE_EXPOSURE.subscriberRules.length; i++) {
    var rule = __TA_ROUTE_EXPOSURE.subscriberRules[i];
    if (rule.roles.length > 0 && (!role || rule.roles.indexOf(role) === -1)) continue;
    products = rule.productIds.length === 0 || (products && products.length === 0)
      ? []
      : (products || []).concat(rule.productIds);
  }
  if (products && (await __dxEntitled(token, products))) return null;
  return { status: 403, message: 'Forbidden' };
}

function __taRefuseRequest(label) {
  var err = new Error('Invalid ' + label);
  err.status = 400;
  throw err;
}

// A row count from the request: a whole number, or nothing. Anything else
// (\`1;--\`, \`1 OR 1=1\`, \`-5\`, \`1e9\`) is refused, never parsed into one.
function __taWholeNumber(value, label) {
  if (Array.isArray(value)) value = value[0];
  if (value === undefined || value === null || value === '') return undefined;
  var text = String(value).trim();
  if (!/^[0-9]{1,15}$/.test(text)) __taRefuseRequest(label);
  return parseInt(text, 10);
}

// The rows a read may ask for. A server-side caller gets what it names; a
// browser gets the table's default when it names no count, never more than the
// table's maximum, and starts no further in than __TA_MAX_OFFSET.
function __taReadWindow(req) {
  var q = (req && req.query) || {};
  var limit = __taWholeNumber(q.limit, 'limit');
  var perPage = __taWholeNumber(q.perPage, 'perPage');
  var page = __taWholeNumber(q.page, 'page');
  var offset = __taWholeNumber(q.offset, 'offset');
  if (!__taIsInternalRequest(req)) {
    var max = __TA_ROUTE_EXPOSURE.maxLimit;
    if (limit !== undefined) limit = Math.min(limit, max);
    if (perPage !== undefined) perPage = Math.min(perPage, max);
    if (!limit && !perPage) limit = __TA_ROUTE_EXPOSURE.defaultLimit;
    if (offset !== undefined) offset = Math.min(offset, __TA_MAX_OFFSET);
    if (page !== undefined) {
      page = Math.max(1, Math.min(page, Math.floor(__TA_MAX_OFFSET / Math.max(perPage || 1, 1)) + 1));
    }
  }
  return { limit: limit, perPage: perPage, page: page, offset: offset };
}

// The parsed value of a JSON request parameter: undefined when absent, and a
// refusal when it is text that is not JSON (a driver would read it char by char).
function __taJsonParam(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) __taRefuseRequest(label);
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    __taRefuseRequest(label);
  }
}

// Every field a filter names, in every shape the drivers accept
// (normalizeFilterTree): a list of conditions and groups, or an object whose
// KEYS are the fields. \`values\` collects what each field is compared with.
function __taFilterFields(parsed, out, values) {
  if (parsed === undefined) return out;
  if (Array.isArray(parsed)) {
    for (var i = 0; i < parsed.length; i++) __taFilterNodeFields(parsed[i], out, values);
    return out;
  }
  if (parsed && typeof parsed === 'object') {
    Object.keys(parsed).forEach(function(key) {
      out.push(key);
      values.push(parsed[key]);
    });
    return out;
  }
  __taRefuseRequest('filters');
}

function __taFilterNodeFields(entry, out, values) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
  if (entry.type === 'group') {
    var children = Array.isArray(entry.children) ? entry.children : [];
    for (var i = 0; i < children.length; i++) __taFilterNodeFields(children[i], out, values);
    return;
  }
  if (entry.source !== undefined) {
    out.push(entry.source);
    values.push(entry.destination);
  }
}

// What a document store compares a field with: a plain value, or a list of
// plain values (an "in" filter). An object would reach the store as an
// operator (\`{ "$ne": null }\`, \`{ "$regex": … }\`) and widen the read.
function __taAssertPlainValue(value) {
  if (value === null || value === undefined) return;
  var type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return;
  if (Array.isArray(value)) {
    for (var i = 0; i < value.length; i++) {
      if (value[i] !== null && typeof value[i] === 'object') __taRefuseRequest('filters');
    }
    return;
  }
  __taRefuseRequest('filters');
}

// The columns a request's projection names (\`select\`, which Supabase hands
// PostgREST): the bare star, or a comma list of plain column names. An alias
// (\`name:password\`), a cast or an embedded table (\`users(email)\`) is
// refused — it reads a column under another name, or a table no page binds.
function __taSelectFields(select) {
  if (select === undefined || select === null || select === '') return [];
  if (typeof select !== 'string') __taRefuseRequest('select');
  var text = select.trim();
  if (text === '*') return [];
  var parts = text.split(',');
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var name = parts[i].trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) __taRefuseRequest('select');
    out.push(name);
  }
  return out;
}

var __TA_UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];

// One field a request names: a column the export knows for the table (or a
// field the route answers itself), of a safe shape, and — for a browser —
// never a credential column.
function __taAssertField(field, browser) {
  if (typeof field !== 'string' || field.length === 0 || field.length > 128) __taRefuseRequest('field');
  if (field.charAt(0) === '$' || __TA_UNSAFE_KEYS.indexOf(field) !== -1) __taRefuseRequest('field');
  if (__TA_FIELD_POLICY.documentStore && field.indexOf('.') !== -1) __taRefuseRequest('field');
  if (__TA_FIELD_PATTERN && !__TA_FIELD_PATTERN.test(field)) __taRefuseRequest('field');
  var name = field.replace(/"/g, '').toLowerCase();
  if (browser) {
    var column = name.split('.').pop();
    if (__taIsCredentialColumn(column)) __taRefuseRequest('field');
  }
  if (__TA_FIELD_POLICY.columns === null) return;
  if (__TA_FIELD_POLICY.virtualFields.indexOf(name) !== -1) return;
  for (var i = 0; i < __TA_FIELD_POLICY.virtualPrefixes.length; i++) {
    if (name.indexOf(__TA_FIELD_POLICY.virtualPrefixes[i]) === 0) return;
  }
  var parts = name.split('.');
  if (parts.length > 2) __taRefuseRequest('field');
  if (parts.length === 2 && parts[0] !== __TA_ROUTE_TABLE) __taRefuseRequest('field');
  if (__TA_FIELD_POLICY.columns.indexOf(parts[parts.length - 1]) === -1) __taRefuseRequest('field');
}

// A sort order: ascending or descending, or none.
function __taAssertOrder(order) {
  if (order === undefined || order === null || order === '') return;
  if (typeof order !== 'string' || !/^(asc|desc)$/i.test(order)) __taRefuseRequest('sort order');
}

// Every field a request filters, sorts or searches by, checked before any
// driver call: one sort field with asc|desc, no repeated parameter.
function __taAssertReadRequest(req) {
  var q = (req && req.query) || {};
  var browser = !__taIsInternalRequest(req);
  var values = [];
  var fields = __taFilterFields(__taJsonParam(q.filters, 'filters'), [], values);
  if (__TA_FIELD_POLICY.documentStore) {
    for (var v = 0; v < values.length; v++) __taAssertPlainValue(values[v]);
  }
  fields = fields.concat(__taSelectFields(q.select));
  var sorts = __taJsonParam(q.sorts, 'sorts');
  if (sorts !== undefined) {
    if (!Array.isArray(sorts) || sorts.length > 1) __taRefuseRequest('sorts');
    for (var i = 0; i < sorts.length; i++) {
      if (!sorts[i] || typeof sorts[i] !== 'object') __taRefuseRequest('sorts');
      fields.push(sorts[i].field);
      __taAssertOrder(sorts[i].order);
    }
  }
  if (q.sortBy !== undefined && q.sortBy !== '') {
    if (typeof q.sortBy !== 'string') __taRefuseRequest('sortBy');
    fields.push(q.sortBy);
  }
  if (Array.isArray(q.sortOrder)) __taRefuseRequest('sortOrder');
  __taAssertOrder(q.sortOrder);
  var queryColumns = q.queryColumns;
  if (typeof queryColumns === 'string' && queryColumns.length > 0 && queryColumns.charAt(0) !== '[' && queryColumns.charAt(0) !== '"') {
    queryColumns = JSON.stringify(queryColumns);
  }
  var searchColumns = __taJsonParam(queryColumns, 'queryColumns');
  if (searchColumns !== undefined) {
    var list = Array.isArray(searchColumns) ? searchColumns : [searchColumns];
    for (var c = 0; c < list.length; c++) fields.push(list[c]);
  }
  for (var f = 0; f < fields.length; f++) __taAssertField(fields[f], browser);
}

// A row-owned page's read (see __taGuardExposure): the owner condition joins
// whatever the request filters by, so no filter can widen it.
function __taApplyOwnerScope(req) {
  var scope = req && req.__tqOwnerScope;
  if (!scope) return req;
  var q = (req && req.query) || {};
  var parsed = __taJsonParam(q.filters, 'filters');
  var original = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
    ? Object.keys(parsed).map(function(key) { return { source: key, destination: parsed[key], operand: '=' }; })
    : [];
  var owners = __TA_ROUTE_EXPOSURE.ownerRules.map(function(rule) {
    return { type: 'condition', source: rule.column, destination: scope.userId, operand: '=' };
  });
  var tree = [{ type: 'group', operator: 'or', children: owners }];
  if (original.length > 0) tree.push({ type: 'group', operator: 'and', children: original });
  req.query = Object.assign({}, q, { filters: JSON.stringify(tree) });
  return req;
}

// An opaque reference for a refused read: the client gets it, the server log
// gets the detail under the same reference.
function __taErrorId() {
  try {
    return require('crypto').randomBytes(8).toString('hex');
  } catch (e) {
    return Math.floor(Math.random() * 0xffffffff).toString(16);
  }
}
`
}

/**
 * Where a read route sits and what its session reader checks (see
 * `EntityTransformOptions.routeProjectRoot` / `.sessionRevocation`).
 */
export interface SessionReaderPlacement {
  /** The route's path back to the project root; absent, two folders. */
  routeProjectRoot?: string
  /** The project has authentication; absent, the reader checks revocation. */
  sessionRevocation?: boolean
}

/**
 * Declares the session resolver, the `__ta*` guard and the route's exposure
 * once per module.
 */
export const generateTableAccessPreamble = (
  trustedReaderRoles: ReadonlyArray<string>,
  exposure?: DataReadExposure | null,
  fieldPolicy?: RequestFieldPolicy,
  tableName?: string,
  reader: SessionReaderPlacement = {}
): string => {
  // The fetcher lives in utils/data-sources/ or pages/api/ (two folders below
  // the root) unless the caller says otherwise (pages/api/global-state/).
  const projectRoot = reader.routeProjectRoot || '../..'
  return `${SessionCookieResolver.generateCommonJsSessionTokenResolverCode(projectRoot, {
    withRevocation: reader.sessionRevocation !== false,
  })}
${TableAccess.generateTableAccessHelperCode({ trustedReaderRoles, projectRoot })}
${generateBrowserRowPolicyCode()}
${generateRouteExposureCode(exposure, fieldPolicy, tableName || '')}`
}

/** The products table's virtual filter and sort fields (`product-filter-fields.ts`, `product-price-sort.ts`). */
export const PRODUCT_VIRTUAL_FIELDS = ['rating', 'on_sale', 'price', 'discounts']
export const PRODUCT_VIRTUAL_PREFIXES = ['variant_options.']

/** What a TeleportHQ / Postgres route's request may name: its schema, plus the products' virtual fields. */
export const sqlRouteFieldPolicy = (config: unknown, tableName: string): RequestFieldPolicy => {
  const products = DataExposure.bareTableName(tableName) === 'teleport_products'
  return {
    columns: schemaColumnsOf(config, tableName) || [],
    ...(products && {
      virtualFields: PRODUCT_VIRTUAL_FIELDS,
      virtualPrefixes: PRODUCT_VIRTUAL_PREFIXES,
    }),
  }
}

/**
 * The early return at the top of a handler, before the client connects:
 * `tableName` is the module's table, `rawQueryExpr` the request's raw statement
 * (or `null` where the handler accepts none).
 */
export const generateReadGuardCall = (tableName: string, rawQueryExpr: string | null): string => {
  return `  const __exposure = await __taGuardExposure(req)
  if (__exposure) {
    return res.status(__exposure.status).json({ success: false, error: __exposure.message, timestamp: Date.now() })
  }
  const __access = await __taGuardRead(req, ${JSON.stringify(tableName)}, ${rawQueryExpr || 'null'})
  if (__access) {
    return res.status(__access.status).json({ success: false, error: __access.message, timestamp: Date.now() })
  }
${generateBrowserRowAccessCall(
  tableName,
  rawQueryExpr
)}  // Every field the request names is one the export knows; a row-owned page's
  // owner condition joins the request's own filters.
  try {
    __taAssertReadRequest(req)
  } catch (__invalid) {
    return res.status(400).json({ success: false, error: __invalid && __invalid.status ? __invalid.message : 'Invalid request', timestamp: Date.now() })
  }
  __taApplyOwnerScope(req)
`
}
