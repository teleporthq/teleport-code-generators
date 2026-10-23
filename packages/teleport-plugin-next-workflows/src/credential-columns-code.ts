import { TableAccess } from '@teleporthq/teleport-shared'
import { DATA_NODE_TYPES } from './data-api-route-generator'

/**
 * Runtime helpers that leave the auth users table's credential columns out of
 * the rows a server segment answers the browser with — the columns
 * `TableAccess.AUTH_CREDENTIAL_COLUMNS` names, the ones every browser read of
 * the data route is already served without. A data node of a server segment
 * reads through the data route as the app's own server code, so its rows come
 * back whole, and the segment's reply (or a streamed node result) is the
 * browser's copy of them.
 *
 * Only the results of the nodes that read rows (`DATA_NODE_TYPES`) are
 * touched: all the credentials of a row of the users table, the unambiguous
 * ones of a raw statement's row, whose table is not known. A row is the
 * result itself (a create or update spreads its row into it), an object it
 * holds, or an element of an array it holds; column values are not walked.
 */
export const generateCredentialColumnsCode = (): string => `
var __CREDENTIAL_COLUMNS = ${JSON.stringify(TableAccess.AUTH_CREDENTIAL_COLUMNS)};
var __UNAMBIGUOUS_CREDENTIAL_COLUMNS = ${JSON.stringify(
  TableAccess.UNAMBIGUOUS_CREDENTIAL_COLUMNS
)};
var __CREDENTIAL_TABLES = ${JSON.stringify(TableAccess.AUTH_CREDENTIAL_TABLES)};
var __ROW_NODE_TYPES = ${JSON.stringify(Array.from(DATA_NODE_TYPES))};

function credentialColumnsOf(node) {
  if (!node || __ROW_NODE_TYPES.indexOf(node.type) === -1) return [];
  var tableName = node.config && typeof node.config.tableName === 'string' ? node.config.tableName : '';
  if (!tableName) return __UNAMBIGUOUS_CREDENTIAL_COLUMNS;
  var parts = tableName.trim().toLowerCase().replace(/"/g, '').split('.');
  return __CREDENTIAL_TABLES.indexOf(parts[parts.length - 1]) !== -1 ? __CREDENTIAL_COLUMNS : [];
}

function withoutColumns(row, columns) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  var kept = {};
  Object.keys(row).forEach(function(key) {
    if (columns.indexOf(String(key).toLowerCase()) === -1) kept[key] = row[key];
  });
  return kept;
}

function withoutRowsColumns(value, columns) {
  if (Array.isArray(value)) return value.map(function(row) { return withoutColumns(row, columns); });
  return withoutColumns(value, columns);
}

function withoutCredentialColumns(node, result) {
  var columns = credentialColumnsOf(node);
  if (columns.length === 0 || !result || typeof result !== 'object') return result;
  if (Array.isArray(result)) return withoutRowsColumns(result, columns);
  var kept = withoutColumns(result, columns);
  Object.keys(kept).forEach(function(key) {
    if (kept[key] && typeof kept[key] === 'object') kept[key] = withoutRowsColumns(kept[key], columns);
  });
  return kept;
}
`
