import { UIDLInvoiceSettings, DataSourceType } from '@teleporthq/teleport-types'

export const generateDataAccessCode = (
  settings: UIDLInvoiceSettings,
  dataSourceType: DataSourceType | null,
  dataSourceConfig: Record<string, unknown> | null
): string => {
  const invoicesTable = settings.tables?.invoicesTable || 'teleport_invoices'
  const invoiceItemsTable = settings.tables?.invoiceItemsTable || 'teleport_invoice_items'
  const dsType = dataSourceType || 'postgresql'

  return `/**
 * Invoice Data Access Layer
 * Data source type: ${dsType}
 * Tables: ${invoicesTable}, ${invoiceItemsTable}
 */

${generateConnectionCode(dsType, dataSourceConfig)}

${generateInsertInvoiceItemsCode(dsType, invoiceItemsTable)}

${generateReserveInvoiceCode(dsType, invoicesTable)}

${generateClaimStaleInvoiceCode(dsType, invoicesTable)}

${generateGetInvoiceByIdCode(dsType, invoicesTable)}

${generateUpdateInvoiceCode(dsType, invoicesTable)}

${generateStoreInvoicePdfCode(dsType)}

${generateGetOrderWithItemsCode(dsType)}

${generateReplaceInvoiceCode(dsType, invoicesTable, invoiceItemsTable)}

${generateLinkOrderToInvoiceCode(dsType)}

module.exports = {
  getClient: getClient,
  reserveInvoice: reserveInvoice,
  claimStaleInvoice: claimStaleInvoice,
  storeInvoicePdf: storeInvoicePdf,
  getInvoiceById: getInvoiceById,
  updateInvoice: updateInvoice,
  getOrderWithItems: getOrderWithItems,
  replaceInvoice: replaceInvoice,
  linkOrderToInvoice: linkOrderToInvoice,
};
`
}

function resolveEnvValue(value: unknown): string {
  if (typeof value === 'string' && value.startsWith('teleporthq.secrets.')) {
    const envKey = value.replace('teleporthq.secrets.', '')
    return `process.env[${JSON.stringify(envKey)}]`
  }
  return JSON.stringify(value || '')
}

function generateConnectionCode(dsType: string, config: Record<string, unknown> | null): string {
  switch (dsType) {
    case 'teleport':
    case 'postgresql':
    case 'cockroachdb':
      return generatePgConnectionCode(config)
    case 'mysql':
    case 'mariadb':
    case 'tidb':
      return generateMysqlConnectionCode(config)
    case 'supabase':
      return generateSupabaseConnectionCode(config)
    default:
      return generatePgConnectionCode(config)
  }
}

function generatePgConnectionCode(config: Record<string, unknown> | null): string {
  const c = config || {}
  const host = resolveEnvValue(c.host || 'localhost')
  const port = resolveEnvValue(c.port || 5432)
  const user = resolveEnvValue(c.user || '')
  const password = resolveEnvValue(c.password || '')
  const database = resolveEnvValue(c.database || '')

  return `
var pg = require('pg');

var _pool = null;
function getClient() {
  if (_pool) return _pool;
  var connectionString = process.env.TELEPORT_DB_CONNECTION_STRING;
  if (connectionString) {
    _pool = new pg.Pool({ connectionString: connectionString, ssl: process.env.TELEPORT_DB_SSL === 'false' ? false : { rejectUnauthorized: false }, max: 5 });
  } else {
    _pool = new pg.Pool({
      host: ${host} || process.env.TELEPORT_DB_HOST || 'localhost',
      port: Number(${port} || process.env.TELEPORT_DB_PORT || 5432),
      user: ${user} || process.env.TELEPORT_DB_USER || '',
      password: ${password} || process.env.TELEPORT_DB_PASSWORD || '',
      database: ${database} || process.env.TELEPORT_DB_NAME || '',
      ssl: process.env.TELEPORT_DB_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return _pool;
}

function quoteIdent(name) {
  return '"' + name.replace(/"/g, '""') + '"';
}`
}

function generateMysqlConnectionCode(config: Record<string, unknown> | null): string {
  const c = config || {}
  const host = resolveEnvValue(c.host || 'localhost')
  const port = resolveEnvValue(c.port || 3306)
  const user = resolveEnvValue(c.user || '')
  const password = resolveEnvValue(c.password || '')
  const database = resolveEnvValue(c.database || '')

  return `
var mysql = require('mysql2/promise');

var _pool = null;
function getClient() {
  if (!_pool) {
    _pool = mysql.createPool({
      host: ${host} || 'localhost',
      port: Number(${port} || 3306),
      user: ${user} || '',
      password: ${password} || '',
      database: ${database} || '',
      waitForConnections: true,
      connectionLimit: 5,
    });
  }
  return _pool;
}

var _bt = String.fromCharCode(96);
function quoteIdent(name) {
  return _bt + name.replace(new RegExp(_bt, 'g'), _bt + _bt) + _bt;
}`
}

function generateSupabaseConnectionCode(config: Record<string, unknown> | null): string {
  const c = config || {}
  const url = resolveEnvValue(c.url || '')
  const key = resolveEnvValue(c.serviceRoleKey || c.key || '')

  return `
var supabase = require('@supabase/supabase-js');

var _client = null;
function getClient() {
  if (!_client) {
    _client = supabase.createClient(${url}, ${key});
  }
  return _client;
}`
}

// Issuing an invoice takes its number and writes the row that holds it as one
// step, before the PDF is rendered: the number is read and the row written
// under one lock (Postgres: a transaction-scoped advisory lock; MySQL: a named
// lock), so two orders paid in the same second never print the same number.
// The same lock keeps one invoice per order: a second request for an order
// that already has one — a provider delivering a slow webhook again while the
// first delivery still renders — gets that invoice back (`created: false`)
// instead of issuing another. Every dialect writes through
// `writeInvoiceRecord`, which retries without a column the database rejected
// as unknown — see `missingOptionalInvoiceColumn` in the record-mapping code.
function generateReserveInvoiceCode(dsType: string, table: string): string {
  const formatNumber = `
function formatInvoiceNumber(prefix, lastNumber) {
  var last = Number(lastNumber);
  return prefix + String((isFinite(last) && last > 0 ? Math.floor(last) : 0) + 1).padStart(4, '0');
}`

  if (dsType === 'supabase') {
    return `${formatNumber}

// PostgREST holds no lock across requests: the order's invoice is looked up
// right before one is issued, which leaves a twin request only the moment
// between the lookup and the insert.
async function reserveInvoice(invoiceData, items, prefix) {
  var client = getClient();
  if (invoiceData.orderId) {
    var held = await client.from('${table}').select('*').eq('order_id', invoiceData.orderId)
      .order('created_at', { ascending: true }).limit(1);
    if (held.error) throw new Error(held.error.message);
    if (held.data && held.data.length > 0) return { invoice: held.data[0], created: false };
  }
  var last = await client.from('${table}').select('invoice_number').like('invoice_number', prefix + '%')
    .order('created_at', { ascending: false }).limit(1);
  if (last.error) throw new Error(last.error.message);
  var lastNumber = last.data && last.data[0] ? parseInt(String(last.data[0].invoice_number).slice(prefix.length), 10) : 0;
  invoiceData.invoiceNumber = formatInvoiceNumber(prefix, lastNumber);
  var row = await writeInvoiceRecord(mapInvoiceToRecord(invoiceData), async function (record) {
    var result = await client.from('${table}').insert(record).select().single();
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });
  await insertInvoiceItems(row.id, items);
  return { invoice: row, created: true };
}`
  }

  if (dsType === 'mysql' || dsType === 'mariadb' || dsType === 'tidb') {
    return `${formatNumber}

var INVOICE_ISSUE_LOCK = '${table}:issue';

async function reserveInvoice(invoiceData, items, prefix) {
  var conn = await getClient().getConnection();
  var locked = false;
  try {
    var [lockRows] = await conn.execute('SELECT GET_LOCK(?, 30) AS acquired', [INVOICE_ISSUE_LOCK]);
    locked = !!(lockRows[0] && Number(lockRows[0].acquired) === 1);
    if (!locked) throw new Error('Another invoice is being issued; the request can be sent again.');
    await conn.beginTransaction();
    try {
      if (invoiceData.orderId) {
        var [heldRows] = await conn.execute(
          'SELECT * FROM ${table} WHERE order_id = ? ORDER BY created_at ASC LIMIT 1',
          [String(invoiceData.orderId)]
        );
        if (heldRows.length > 0) {
          await conn.commit();
          return { invoice: heldRows[0], created: false };
        }
      }
      var [lastRows] = await conn.execute(
        'SELECT MAX(CAST(SUBSTRING(invoice_number, CHAR_LENGTH(?) + 1) AS UNSIGNED)) AS last_number FROM ${table} ' +
          "WHERE LEFT(invoice_number, CHAR_LENGTH(?)) = ? AND SUBSTRING(invoice_number, CHAR_LENGTH(?) + 1) REGEXP '^[0-9]{1,15}$'",
        [prefix, prefix, prefix, prefix]
      );
      invoiceData.invoiceNumber = formatInvoiceNumber(prefix, lastRows[0] && lastRows[0].last_number);
      var row = await writeInvoiceRecord(mapInvoiceToRecord(invoiceData), async function (record) {
        var columns = Object.keys(record);
        var quotedCols = columns.map(quoteIdent).join(', ');
        var placeholders = columns.map(function() { return '?'; }).join(', ');
        var values = columns.map(function(k) { return record[k]; });
        await conn.execute('INSERT INTO ${table} (' + quotedCols + ') VALUES (' + placeholders + ')', values);
        return record;
      });
      await insertInvoiceItemRows(conn, row.id, items);
      await conn.commit();
      return { invoice: row, created: true };
    } catch (err) {
      try { await conn.rollback(); } catch (_rollbackErr) {}
      throw err;
    }
  } finally {
    if (locked) {
      try { await conn.execute('SELECT RELEASE_LOCK(?)', [INVOICE_ISSUE_LOCK]); } catch (_releaseErr) {}
    }
    conn.release();
  }
}`
  }

  return `${formatNumber}

var INVOICE_ISSUE_LOCK = '${table}:issue';

async function reserveInvoice(invoiceData, items, prefix) {
  var client = await getClient().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [INVOICE_ISSUE_LOCK]);
    if (invoiceData.orderId) {
      var held = await client.query(
        'SELECT * FROM ${table} WHERE order_id::text = $1 ORDER BY created_at ASC LIMIT 1',
        [String(invoiceData.orderId)]
      );
      if (held.rows.length > 0) {
        await client.query('COMMIT');
        return { invoice: held.rows[0], created: false };
      }
    }
    var last = await client.query(
      'SELECT MAX(substring(invoice_number FROM char_length($1) + 1)::bigint) AS last_number FROM ${table} ' +
        "WHERE left(invoice_number, char_length($1)) = $1 AND substring(invoice_number FROM char_length($1) + 1) ~ '^[0-9]{1,15}$'",
      [prefix]
    );
    invoiceData.invoiceNumber = formatInvoiceNumber(prefix, last.rows[0] && last.rows[0].last_number);
    var row = await writeInvoiceRecord(mapInvoiceToRecord(invoiceData), async function (record) {
      var columns = Object.keys(record);
      var quotedCols = columns.map(quoteIdent).join(', ');
      var placeholders = columns.map(function(_, i) { return '$' + (i + 1); }).join(', ');
      var values = columns.map(function(k) { return record[k]; });
      // A rejected column fails the statement, and a failed statement ends
      // the transaction — the savepoint keeps it open for the retry.
      await client.query('SAVEPOINT invoice_row');
      try {
        var result = await client.query('INSERT INTO ${table} (' + quotedCols + ') VALUES (' + placeholders + ') RETURNING *', values);
        await client.query('RELEASE SAVEPOINT invoice_row');
        return result.rows[0];
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT invoice_row');
        throw err;
      }
    });
    await insertInvoiceItemRows(client, row.id, items);
    await client.query('COMMIT');
    return { invoice: row, created: true };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_rollbackErr) {}
    throw err;
  } finally {
    client.release();
  }
}`
}

// A reserved invoice whose PDF never arrived — the request that reserved it
// died while rendering — is finished by the next request for its order: once,
// by whichever request moves its `updated_at` first. Timestamps are written by
// the app on both sides of the comparison, so the database's time zone never
// enters it.
function generateClaimStaleInvoiceCode(dsType: string, table: string): string {
  const cutoff = `  var now = new Date();
  var staleBefore = new Date(now.getTime() - staleSeconds * 1000).toISOString();`
  if (dsType === 'supabase') {
    return `
async function claimStaleInvoice(invoiceId, staleSeconds) {
${cutoff}
  var result = await getClient().from('${table}').update({ updated_at: now.toISOString() })
    .eq('id', invoiceId).is('pdf_size_bytes', null).lt('updated_at', staleBefore).select('id');
  if (result.error) throw new Error(result.error.message);
  return !!(result.data && result.data.length > 0);
}`
  }

  if (dsType === 'mysql' || dsType === 'mariadb' || dsType === 'tidb') {
    return `
async function claimStaleInvoice(invoiceId, staleSeconds) {
${cutoff}
  var [result] = await getClient().execute(
    'UPDATE ${table} SET updated_at = ? WHERE id = ? AND pdf_size_bytes IS NULL AND updated_at < ?',
    [now.toISOString(), String(invoiceId), staleBefore]
  );
  return !!(result && result.affectedRows > 0);
}`
  }

  return `
async function claimStaleInvoice(invoiceId, staleSeconds) {
${cutoff}
  var result = await getClient().query(
    'UPDATE ${table} SET updated_at = $1 WHERE id::text = $2 AND pdf_size_bytes IS NULL AND updated_at < $3 RETURNING id',
    [now.toISOString(), String(invoiceId), staleBefore]
  );
  return result.rowCount > 0;
}`
}

// Puts the rendered PDF on the reserved row; `pdf_size_bytes` is what marks
// the invoice finished (see `claimStaleInvoice`).
function generateStoreInvoicePdfCode(dsType: string): string {
  const pdfData = dsType === 'supabase' ? `pdfBuffer.toString('base64')` : 'pdfBuffer'
  return `
async function storeInvoicePdf(invoiceId, pdfBuffer, pdfUrl) {
  return updateInvoice(invoiceId, {
    pdf_data: ${pdfData},
    pdf_size_bytes: pdfBuffer.length,
    pdf_content_type: 'application/pdf',
    pdf_url: pdfUrl,
  });
}`
}

function generateInsertInvoiceItemsCode(dsType: string, table: string): string {
  if (dsType === 'supabase') {
    return `
async function insertInvoiceItems(invoiceId, items) {
  if (!items || items.length === 0) return [];
  var client = getClient();
  var records = items.map(function(item, idx) {
    return mapInvoiceItemToRecord(invoiceId, item, idx);
  });
  var result = await client.from('${table}').insert(records).select();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}`
  }

  if (dsType === 'mysql' || dsType === 'mariadb' || dsType === 'tidb') {
    return `
// \`connection\` is the pool, or the connection of an open transaction.
async function insertInvoiceItemRows(connection, invoiceId, items) {
  if (!items || items.length === 0) return [];
  var results = [];
  for (var i = 0; i < items.length; i++) {
    var record = mapInvoiceItemToRecord(invoiceId, items[i], i);
    var columns = Object.keys(record);
    var quotedCols = columns.map(quoteIdent).join(', ');
    var placeholders = columns.map(function() { return '?'; }).join(', ');
    var values = columns.map(function(k) { return record[k]; });
    var sql = 'INSERT INTO ${table} (' + quotedCols + ') VALUES (' + placeholders + ')';
    var [result] = await connection.execute(sql, values);
    results.push(Object.assign({}, record, { id: result.insertId }));
  }
  return results;
}`
  }

  return `
// \`queryable\` is the pool, or the client of an open transaction.
async function insertInvoiceItemRows(queryable, invoiceId, items) {
  if (!items || items.length === 0) return [];
  var results = [];
  for (var i = 0; i < items.length; i++) {
    var record = mapInvoiceItemToRecord(invoiceId, items[i], i);
    var columns = Object.keys(record);
    var quotedCols = columns.map(quoteIdent).join(', ');
    var placeholders = columns.map(function(_, j) { return '$' + (j + 1); }).join(', ');
    var values = columns.map(function(k) { return record[k]; });
    var sql = 'INSERT INTO ${table} (' + quotedCols + ') VALUES (' + placeholders + ') RETURNING *';
    var result = await queryable.query(sql, values);
    results.push(result.rows[0]);
  }
  return results;
}`
}

function generateGetInvoiceByIdCode(dsType: string, table: string): string {
  if (dsType === 'supabase') {
    return `
async function getInvoiceById(invoiceId) {
  var client = getClient();
  var result = await client.from('${table}').select('*').eq('id', invoiceId).single();
  if (result.error) return null;
  return result.data;
}`
  }

  if (dsType === 'mysql' || dsType === 'mariadb' || dsType === 'tidb') {
    return `
async function getInvoiceById(invoiceId) {
  var pool = getClient();
  var [rows] = await pool.execute('SELECT * FROM ${table} WHERE id = ?', [invoiceId]);
  return rows.length > 0 ? rows[0] : null;
}`
  }

  return `
async function getInvoiceById(invoiceId) {
  var pool = getClient();
  var result = await pool.query('SELECT * FROM ${table} WHERE id = $1', [invoiceId]);
  return result.rows.length > 0 ? result.rows[0] : null;
}`
}

function generateUpdateInvoiceCode(dsType: string, table: string): string {
  if (dsType === 'supabase') {
    return `
async function updateInvoice(invoiceId, updates) {
  var client = getClient();
  updates.updated_at = new Date().toISOString();
  var result = await client.from('${table}').update(updates).eq('id', invoiceId).select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}`
  }

  if (dsType === 'mysql' || dsType === 'mariadb' || dsType === 'tidb') {
    return `
async function updateInvoice(invoiceId, updates) {
  var pool = getClient();
  updates.updated_at = new Date().toISOString();
  var columns = Object.keys(updates);
  var setClauses = columns.map(function(k) { return quoteIdent(k) + ' = ?'; }).join(', ');
  var values = columns.map(function(k) { return updates[k]; });
  values.push(invoiceId);
  var sql = 'UPDATE ${table} SET ' + setClauses + ' WHERE id = ?';
  await pool.execute(sql, values);
  return Object.assign({ id: invoiceId }, updates);
}`
  }

  return `
async function updateInvoice(invoiceId, updates) {
  var pool = getClient();
  updates.updated_at = new Date().toISOString();
  var columns = Object.keys(updates);
  var setClauses = columns.map(function(k, i) { return quoteIdent(k) + ' = $' + (i + 1); }).join(', ');
  var values = columns.map(function(k) { return updates[k]; });
  values.push(invoiceId);
  var sql = 'UPDATE ${table} SET ' + setClauses + ' WHERE id = $' + values.length;
  await pool.query(sql, values);
  return Object.assign({ id: invoiceId }, updates);
}`
}

// Fetches a `teleport_orders` row + its `teleport_order_items` children in a
// single call. Consumed by `/api/invoices/generate` when only `orderId` is
// provided — the caller (the payment webhook's Process Payment Webhook
// custom node) can't know the customer/shipping/line-item details at the
// point it invokes the invoice generator, so the endpoint has to hydrate
// from the DB. Returns `null` when the order doesn't exist, matching the
// shape `getInvoiceById` uses for the same "not found" semantics.
//
// The `teleport_orders` / `teleport_order_items` table names are hard-coded
// across the workflow-based e-commerce flow (see `checkout-workflow-builder.ts`
// column mappings). Keeping them as literals here matches that convention —
// the invoice feature is gated on e-commerce activation, so these tables
// always exist when the generate endpoint runs.
function generateGetOrderWithItemsCode(dsType: string): string {
  if (dsType === 'supabase') {
    return `
async function getOrderWithItems(orderId) {
  if (!orderId) return null;
  var client = getClient();
  var orderRes = await client
    .from('teleport_orders')
    .select('*')
    .eq('id', orderId)
    .single();
  if (orderRes.error || !orderRes.data) return null;
  var itemsRes = await client
    .from('teleport_order_items')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  return {
    order: orderRes.data,
    items: itemsRes.error ? [] : (itemsRes.data || []),
  };
}`
  }

  if (dsType === 'mysql' || dsType === 'mariadb' || dsType === 'tidb') {
    return `
async function getOrderWithItems(orderId) {
  if (!orderId) return null;
  var pool = getClient();
  var [orderRows] = await pool.execute('SELECT * FROM teleport_orders WHERE id = ? LIMIT 1', [orderId]);
  if (!orderRows || orderRows.length === 0) return null;
  var [itemRows] = await pool.execute(
    'SELECT * FROM teleport_order_items WHERE order_id = ? ORDER BY created_at ASC, id ASC',
    [orderId]
  );
  return { order: orderRows[0], items: itemRows || [] };
}`
  }

  return `
async function getOrderWithItems(orderId) {
  if (!orderId) return null;
  var pool = getClient();
  var orderRes = await pool.query('SELECT * FROM teleport_orders WHERE id = $1 LIMIT 1', [orderId]);
  if (!orderRes.rows || orderRes.rows.length === 0) return null;
  var itemsRes = await pool.query(
    'SELECT * FROM teleport_order_items WHERE order_id = $1 ORDER BY created_at ASC, id ASC',
    [orderId]
  );
  return { order: orderRes.rows[0], items: itemsRes.rows || [] };
}`
}

// Rewrites one invoice in place — its figures, customer, PDF and lines — for
// `/api/invoices/[id]/regenerate`. The row keeps its id, so everything that
// points at it (the order, the sent-email ledger) stays valid. Postgres and
// MySQL do it in one transaction, and Supabase undoes its steps, so a failure
// leaves the old invoice whole.
function generateReplaceInvoiceCode(dsType: string, table: string, itemsTable: string): string {
  if (dsType === 'supabase') {
    return `
async function replaceInvoice(invoiceId, invoiceData, items) {
  var client = getClient();
  // PostgREST has no transactions, so each step undoes the ones before it
  // when it fails: new lines first (one INSERT, whole or nothing), then the
  // row, then the old lines — and a failure puts the row and lines back.
  var previousRow = await client.from('${table}').select('*').eq('id', invoiceId).maybeSingle();
  if (previousRow.error) throw new Error(previousRow.error.message);
  if (!previousRow.data) throw new Error('Invoice ' + invoiceId + ' no longer exists');
  var previousLines = await client.from('${itemsTable}').select('id').eq('invoice_id', invoiceId);
  if (previousLines.error) throw new Error(previousLines.error.message);
  var previousIds = (previousLines.data || []).map(function (row) { return row.id; });

  var inserted = await insertInvoiceItems(invoiceId, items);
  var insertedIds = (inserted || []).map(function (row) { return row.id; });
  var written = null;
  try {
    var record = await writeInvoiceRecord(mapInvoiceReplacementToRecord(invoiceData), async function (fields) {
      var result = await client.from('${table}').update(fields).eq('id', invoiceId).select('id');
      if (result.error) throw new Error(result.error.message);
      if (!result.data || result.data.length === 0) throw new Error('Invoice ' + invoiceId + ' no longer exists');
      written = fields;
      return fields;
    });
    if (previousIds.length > 0) {
      var removed = await client.from('${itemsTable}').delete().in('id', previousIds);
      if (removed.error) throw new Error(removed.error.message);
    }
    return record;
  } catch (err) {
    if (written) {
      var restored = {};
      Object.keys(written).forEach(function (column) { restored[column] = previousRow.data[column]; });
      var restoreResult = await client.from('${table}').update(restored).eq('id', invoiceId);
      if (restoreResult.error) console.error('[invoice] Regenerate: could not restore invoice ' + invoiceId + ' — ' + restoreResult.error.message);
    }
    if (insertedIds.length > 0) {
      var undone = await client.from('${itemsTable}').delete().in('id', insertedIds);
      if (undone.error) console.error('[invoice] Regenerate: could not remove the new lines of invoice ' + invoiceId + ' — ' + undone.error.message);
    }
    throw err;
  }
}`
  }

  if (dsType === 'mysql' || dsType === 'mariadb' || dsType === 'tidb') {
    return `
async function replaceInvoice(invoiceId, invoiceData, items) {
  var pool = getClient();
  return writeInvoiceRecord(mapInvoiceReplacementToRecord(invoiceData), async function (fields) {
    var conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      var columns = Object.keys(fields);
      var setClauses = columns.map(function(k) { return quoteIdent(k) + ' = ?'; }).join(', ');
      var values = columns.map(function(k) { return fields[k]; });
      values.push(invoiceId);
      var [updated] = await conn.execute('UPDATE ${table} SET ' + setClauses + ' WHERE id = ?', values);
      if (!updated || !updated.affectedRows) throw new Error('Invoice ' + invoiceId + ' no longer exists');
      await conn.execute('DELETE FROM ${itemsTable} WHERE invoice_id = ?', [invoiceId]);
      await insertInvoiceItemRows(conn, invoiceId, items);
      await conn.commit();
      return fields;
    } catch (err) {
      try { await conn.rollback(); } catch (_rollbackErr) {}
      throw err;
    } finally {
      conn.release();
    }
  });
}`
  }

  return `
async function replaceInvoice(invoiceId, invoiceData, items) {
  var pool = getClient();
  return writeInvoiceRecord(mapInvoiceReplacementToRecord(invoiceData), async function (fields) {
    var client = await pool.connect();
    try {
      await client.query('BEGIN');
      var columns = Object.keys(fields);
      var setClauses = columns.map(function(k, i) { return quoteIdent(k) + ' = $' + (i + 1); }).join(', ');
      var values = columns.map(function(k) { return fields[k]; });
      values.push(invoiceId);
      // The UPDATE takes the row lock first, so two regenerations of the same
      // invoice run one after the other instead of interleaving their lines.
      var updated = await client.query('UPDATE ${table} SET ' + setClauses + ' WHERE id = $' + values.length, values);
      if (!updated.rowCount) throw new Error('Invoice ' + invoiceId + ' no longer exists');
      await client.query('DELETE FROM ${itemsTable} WHERE invoice_id = $1', [invoiceId]);
      await insertInvoiceItemRows(client, invoiceId, items);
      await client.query('COMMIT');
      return fields;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_rollbackErr) {}
      throw err;
    } finally {
      client.release();
    }
  });
}`
}

// Points an order at its (regenerated) invoice — but only an order that
// points at THIS invoice or at none: an order whose link names a different
// invoice keeps it. Returns whether the order was updated.
function generateLinkOrderToInvoiceCode(dsType: string): string {
  if (dsType === 'supabase') {
    return `
async function linkOrderToInvoice(orderId, invoiceId, invoiceNumber, pdfUrl) {
  if (!orderId || !invoiceId) return false;
  var client = getClient();
  var result = await client
    .from('teleport_orders')
    .update({
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      invoice_pdf_url: pdfUrl || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .or('invoice_id.is.null,invoice_id.eq.' + invoiceId)
    .select('id');
  if (result.error) throw new Error(result.error.message);
  return !!(result.data && result.data.length > 0);
}`
  }

  if (dsType === 'mysql' || dsType === 'mariadb' || dsType === 'tidb') {
    return `
async function linkOrderToInvoice(orderId, invoiceId, invoiceNumber, pdfUrl) {
  if (!orderId || !invoiceId) return false;
  var pool = getClient();
  var [result] = await pool.execute(
    'UPDATE teleport_orders SET invoice_id = ?, invoice_number = ?, invoice_pdf_url = ?, updated_at = NOW() WHERE id = ? AND (invoice_id IS NULL OR invoice_id = ?)',
    [invoiceId, invoiceNumber, pdfUrl || null, orderId, invoiceId]
  );
  return !!(result && result.affectedRows > 0);
}`
  }

  return `
async function linkOrderToInvoice(orderId, invoiceId, invoiceNumber, pdfUrl) {
  if (!orderId || !invoiceId) return false;
  var pool = getClient();
  var result = await pool.query(
    'UPDATE teleport_orders SET invoice_id = $1, invoice_number = $2, invoice_pdf_url = $3, updated_at = NOW() WHERE id = $4 AND (invoice_id IS NULL OR invoice_id::text = $5)',
    [invoiceId, invoiceNumber, pdfUrl || null, orderId, String(invoiceId)]
  );
  return result.rowCount > 0;
}`
}

export const getRecordMappingCode = (dsType?: string): string => `
function mapInvoiceToRecord(data) {
  return {
    id: data.id || require('crypto').randomUUID(),
    invoice_number: data.invoiceNumber || '',
    status: data.status || 'issued',
    issue_date: data.issueDate || new Date().toISOString(),
    due_date: data.dueDate || null,
    paid_at: data.paidAt || null,
    customer_name: data.customerName || null,
    customer_email: data.customerEmail || null,
    customer_address: data.customerAddress || null,
    customer_city: data.customerCity || null,
    customer_state: data.customerState || null,
    customer_zip: data.customerZip || null,
    customer_country: data.customerCountry || null,
    customer_vat: data.customerVat || null,
    company_name: data.companyName || null,
    company_address: data.companyAddress || null,
    company_city: data.companyCity || null,
    company_state: data.companyState || null,
    company_zip: data.companyZip || null,
    company_country: data.companyCountry || null,
    company_vat: data.companyVat || null,
    company_reg_number: data.companyRegNumber || null,
    company_email: data.companyEmail || null,
    company_phone: data.companyPhone || null,
    company_logo_url: data.companyLogoUrl || null,
    company_website: data.companyWebsite || null,
    subtotal: data.subtotal || 0,
    tax_rate: data.taxRate || 0,
    tax_amount: data.taxAmount || 0,
    discount_amount: data.discountAmount || 0,
    shipping_amount: data.shippingAmount || 0,
    total: data.total || 0,
    // The gift-card tender and what was left to pay after it (the whole total
    // when no card was used).
    gift_card_amount: data.giftCardAmount || 0,
    amount_due: data.amountDue != null ? data.amountDue : (data.total || 0),
    // Nothing has gone back at issue time; a refund moves this and the status.
    refunded_amount: 0,
    currency: data.currency || 'USD',
    currency_symbol: data.currencySymbol || '$',
    payment_method: data.paymentMethod || null,
    payment_provider: data.paymentProvider || null,
    payment_provider_invoice_id: data.paymentProviderInvoiceId || null,
    payment_intent_id: data.paymentIntentId || null,
    order_id: data.orderId || null,
    pdf_data: data.pdfData ? (${
      dsType === 'supabase'
        ? `Buffer.isBuffer(data.pdfData) ? data.pdfData.toString('base64') : data.pdfData`
        : `data.pdfData`
    }) : null,
    pdf_url: data.pdfUrl || null,
    pdf_content_type: 'application/pdf',
    pdf_size_bytes: data.pdfSizeBytes || null,
    template_snapshot: data.templateSnapshot || null,
    notes: data.notes || null,
    metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// Columns added to the invoices table after stores already had one. The
// editor adds missing columns when the e-commerce activation runs, but a
// store that only republished still has the old table — and an invoice that
// fails to insert is an order the buyer is never billed for. So the write
// retries without the column the database rejected, and says what to re-run.
var OPTIONAL_INVOICE_COLUMNS = ['shipping_amount', 'gift_card_amount', 'amount_due', 'refunded_amount'];

function missingOptionalInvoiceColumn(err, record) {
  var message = String((err && err.message) || '');
  // pg: column "x" of relation "t" does not exist · mysql: Unknown column 'x'
  // in 'field list' · PostgREST: Could not find the 'x' column of 't'.
  if (!/does not exist|Unknown column|Could not find/i.test(message)) return null;
  for (var i = 0; i < OPTIONAL_INVOICE_COLUMNS.length; i++) {
    var column = OPTIONAL_INVOICE_COLUMNS[i];
    if (Object.prototype.hasOwnProperty.call(record, column) && message.indexOf(column) !== -1) {
      return column;
    }
  }
  return null;
}

async function writeInvoiceRecord(record, write) {
  for (var attempt = 0; attempt <= OPTIONAL_INVOICE_COLUMNS.length; attempt++) {
    try {
      return await write(record);
    } catch (err) {
      var missing = missingOptionalInvoiceColumn(err, record);
      if (!missing) throw err;
      console.warn('[invoice] The invoices table has no "' + missing + '" column — writing without it. Re-run the e-commerce activation in the editor to add it.');
      delete record[missing];
    }
  }
  return write(record);
}

// The columns a regeneration rewrites: everything the assembly produces,
// except the row's identity (id, created_at), \`refunded_amount\` — money
// already returned against the invoice stays recorded on it — and the two
// columns the assembly never fills, which keep whatever they hold.
function mapInvoiceReplacementToRecord(data) {
  var record = mapInvoiceToRecord(data);
  delete record.id;
  delete record.created_at;
  delete record.refunded_amount;
  delete record.payment_provider_invoice_id;
  delete record.metadata;
  return record;
}

function mapInvoiceItemToRecord(invoiceId, item, sortOrder) {
  return {
    invoice_id: invoiceId,
    product_id: item.productId || item.product_id || null,
    name: item.name || '',
    variant_label: item.variantLabel || item.variant_label || null,
    variant_swatches: item.variantSwatches || item.variant_swatches || null,
    description: item.description || null,
    quantity: Number(item.quantity) || 1,
    unit_price: Number(item.unitPrice || item.unit_price || item.price) || 0,
    total_price: Number(item.totalPrice || item.total_price) || (Number(item.quantity || 1) * Number(item.unitPrice || item.unit_price || item.price || 0)),
    currency: item.currency || 'USD',
    tax_rate: item.taxRate != null ? Number(item.taxRate) : null,
    tax_amount: item.taxAmount != null ? Number(item.taxAmount) : null,
    discount_amount: item.discountAmount != null ? Number(item.discountAmount) : null,
    sku: item.sku || null,
    metadata: item.metadata ? JSON.stringify(item.metadata) : null,
    sort_order: sortOrder || 0,
    created_at: new Date().toISOString(),
  };
}
`
