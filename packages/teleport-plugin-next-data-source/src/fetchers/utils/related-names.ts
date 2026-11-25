import { DataExposure, TableAccess } from '@teleporthq/teleport-shared'
import { RAW_ROWS_PARAM } from '../../transformations'
import { schemaColumnsOf, schemaOf } from './table-access-guard'

/**
 * The names a table's rows carry for their foreign keys.
 *
 * A data source's config may say, per table, which record each foreign key
 * points at and which of that record's columns names it:
 *
 *   relatedNames: {
 *     teleport_shipments: [
 *       { column: 'order_id', table: 'teleport_orders', matchColumn: 'id', displayColumn: 'order_number' },
 *     ],
 *   }
 *
 * A read of such a table then gives each row `<column>__name`: the related
 * record's name as it is now, or null when there is no such record. The names
 * of every row read come from ONE statement, keyed by the rows' foreign keys,
 * never one per row; if it fails, the rows are served without names.
 *
 * Only the store's own server code and its trusted readers (the generated
 * admin) are given the names, and only on a read of the rows as shown: a read
 * of the rows as stored (`rawRows`, what an edit form writes back) and every
 * other caller get the rows as before.
 *
 * ⛔ PAIRED with `RELATED_NAMES_CONFIG_KEY` in the GUI's
 * `admin-panel/utils/admin-list-related-names.ts`, which declares the names
 * the generated admin's lists show.
 */

export const RELATED_NAMES_CONFIG_KEY = 'relatedNames'

export interface RelatedNameLookup {
  /** The foreign key, a column of the route's table. */
  column: string
  /** The related record's table. */
  table: string
  /** The related record's column the foreign key holds. */
  matchColumn: string
  /** The related record's column that names it. */
  displayColumn: string
  /** The row field the name is served as. */
  field: string
  /** The related records are keyed by a UUID column (compared as one, so its index is used). */
  uuidKey: boolean
}

export const relatedNameField = (column: string): string => `${column}__name`

const LOWERCASE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/

interface DeclaredRelatedName {
  column?: unknown
  table?: unknown
  matchColumn?: unknown
  displayColumn?: unknown
}

const isNamingColumn = (table: string, column: string): boolean =>
  !TableAccess.isCredentialColumnName(column) &&
  !(
    TableAccess.AUTH_CREDENTIAL_TABLES.includes(table) &&
    TableAccess.AUTH_CREDENTIAL_COLUMNS.includes(column)
  )

/**
 * The related names `config` declares for `tableName` that the export can
 * vouch for: plain lowercase identifiers, a foreign key the table has, and a
 * related table whose schema the data source holds with both columns — the
 * naming one never a credential. Anything else is left out.
 */
export const relatedNamesOf = (config: unknown, tableName: string): RelatedNameLookup[] => {
  const declared = (config as { [RELATED_NAMES_CONFIG_KEY]?: unknown } | null)?.[
    RELATED_NAMES_CONFIG_KEY
  ]
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) {
    return []
  }
  const byTable = declared as Record<string, unknown>
  const entries = byTable[tableName] ?? byTable[DataExposure.bareTableName(tableName)]
  if (!Array.isArray(entries)) {
    return []
  }
  const ownColumns = schemaColumnsOf(config, tableName)
  const lookups: RelatedNameLookup[] = []
  for (const entry of entries as DeclaredRelatedName[]) {
    const { column, table, matchColumn, displayColumn } = entry || {}
    if (
      typeof column !== 'string' ||
      typeof table !== 'string' ||
      typeof matchColumn !== 'string' ||
      typeof displayColumn !== 'string' ||
      ![column, table, matchColumn, displayColumn].every((name) => LOWERCASE_IDENTIFIER.test(name))
    ) {
      continue
    }
    if (ownColumns && !ownColumns.includes(column)) {
      continue
    }
    if (TableAccess.RETIRED_TABLES.includes(table) || !isNamingColumn(table, displayColumn)) {
      continue
    }
    const related = schemaOf(config, table)
    const matched = related?.find((candidate) => candidate.name === matchColumn)
    if (!matched || !related?.some((candidate) => candidate.name === displayColumn)) {
      continue
    }
    if (lookups.some((lookup) => lookup.column === column)) {
      continue
    }
    lookups.push({
      column,
      table,
      matchColumn,
      displayColumn,
      field: relatedNameField(column),
      uuidKey: /uuid/i.test(matched.type || ''),
    })
  }
  return lookups
}

/**
 * The one statement that reads every lookup's names: `$<n>` is the keys of
 * lookup n-1, an empty list matching nothing. Built here, from the checked
 * identifiers only — nothing a request sends reaches its text.
 */
const relatedNamesStatement = (lookups: RelatedNameLookup[]): string =>
  lookups
    .map((lookup, index) => {
      const alias = `x${index}`
      const key = `${alias}."${lookup.matchColumn}"`
      const matches = lookup.uuidKey
        ? `${key} = ANY($${index + 1}::uuid[])`
        : `CAST(${key} AS text) = ANY($${index + 1}::text[])`
      return (
        `SELECT ${index} AS "lookup", CAST(${key} AS text) AS "key", ` +
        `CAST(${alias}."${lookup.displayColumn}" AS text) AS "name" ` +
        `FROM "${lookup.table}" ${alias} WHERE ${matches}`
      )
    })
    .join(' UNION ALL ')

/**
 * `__rnWithRelatedNames(client, req, rows)` — the rows with their related
 * names, for a route whose table declares some; '' for one that declares none.
 * Uses `__taIsVisitorView`, `__taIsInternalRequest`, `__tqSessionToken`,
 * `__taRoleOf` and `__TA_TRUSTED_READER_ROLES` from the route's preamble.
 */
export const generateRelatedNamesCode = (lookups: RelatedNameLookup[]): string => {
  if (lookups.length === 0) {
    return ''
  }
  return `// GENERATED — see related-names.ts in teleport-plugin-next-data-source.
// The names this table's rows carry for their foreign keys.
var __RN_LOOKUPS = ${JSON.stringify(
    lookups.map((lookup) => ({ column: lookup.column, field: lookup.field, uuid: lookup.uuidKey }))
  )};
var __RN_STATEMENT = ${JSON.stringify(relatedNamesStatement(lookups))};
var __RN_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Names are for the store's own server code and its trusted readers, on a read
// of the rows as shown: never for a visitor, nor on a read of the rows as
// stored, which an edit form writes back column by column.
async function __rnServesRelatedNames(req) {
  var query = (req && req.query) || {};
  var raw = query.${RAW_ROWS_PARAM};
  if (raw === true || raw === 'true') return false;
  if (__taIsVisitorView(req)) return false;
  if (__taIsInternalRequest(req)) return true;
  var token = null;
  try {
    token = await __tqSessionToken(req);
  } catch (e) {
    token = null;
  }
  var role = __taRoleOf(token);
  return !!role && __TA_TRUSTED_READER_ROLES.indexOf(role) !== -1;
}

// The key a row's foreign key is looked up by, or null for none.
function __rnKey(lookup, value) {
  if (value === null || value === undefined) return null;
  var key = String(value).trim();
  if (!key) return null;
  if (!lookup.uuid) return key;
  return __RN_UUID_RE.test(key) ? key.toLowerCase() : null;
}

async function __rnWithRelatedNames(client, req, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  if (!(await __rnServesRelatedNames(req))) return rows;
  var keysByLookup = __RN_LOOKUPS.map(function(lookup) {
    var keys = [];
    rows.forEach(function(row) {
      var key = row && typeof row === 'object' ? __rnKey(lookup, row[lookup.column]) : null;
      if (key !== null && keys.indexOf(key) === -1) keys.push(key);
    });
    return keys;
  });
  var names = __RN_LOOKUPS.map(function() { return new Map(); });
  if (keysByLookup.some(function(keys) { return keys.length > 0; })) {
    try {
      var result = await client.query(__RN_STATEMENT, keysByLookup);
      (result && Array.isArray(result.rows) ? result.rows : []).forEach(function(found) {
        var lookupIndex = Number(found.lookup);
        var lookup = __RN_LOOKUPS[lookupIndex];
        var key = lookup ? __rnKey(lookup, found.key) : null;
        if (key !== null) names[lookupIndex].set(key, found.name === undefined ? null : found.name);
      });
    } catch (error) {
      console.error('Related names could not be read:', error && error.message);
      return rows;
    }
  }
  return rows.map(function(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    var named = Object.assign({}, row);
    __RN_LOOKUPS.forEach(function(lookup, index) {
      var key = __rnKey(lookup, row[lookup.column]);
      named[lookup.field] = key !== null && names[index].has(key) ? names[index].get(key) : null;
    });
    return named;
  });
}

`
}

/** `rowsExpression`, with the related names folded in when the table declares any. */
export const withRelatedNamesExpression = (
  lookups: RelatedNameLookup[],
  rowsExpression: string
): string =>
  lookups.length === 0
    ? rowsExpression
    : `await __rnWithRelatedNames(client, req, ${rowsExpression})`
