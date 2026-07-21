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

${generateInsertInvoiceCode(dsType, invoicesTable)}

${generateInsertInvoiceItemsCode(dsType, invoiceItemsTable)}

${generateGetInvoiceByIdCode(dsType, invoicesTable)}

${generateUpdateInvoiceCode(dsType, invoicesTable)}

${generateGetNextInvoiceNumberCode(dsType, invoicesTable)}

${generateGetOrderWithItemsCode(dsType)}

module.exports = {
  getClient: getClient,
  insertInvoice: insertInvoice,
  insertInvoiceItems: insertInvoiceItems,
  getInvoiceById: getInvoiceById,
  updateInvoice: updateInvoice,
  getNextInvoiceNumber: getNextInvoiceNumber,
  getOrderWithItems: getOrderWithItems,
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

function generateInsertInvoiceCode(dsType: string, table: string): string {
  if (dsType === 'supabase') {
    return `
async function insertInvoice(invoiceData) {
  var client = getClient();
  var record = mapInvoiceToRecord(invoiceData);
  var result = await client.from('${table}').insert(record).select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}`
  }

  if (dsType === 'mysql' || dsType === 'mariadb' || dsType === 'tidb') {
    return `
async function insertInvoice(invoiceData) {
  var pool = getClient();
  var record = mapInvoiceToRecord(invoiceData);
  var columns = Object.keys(record);
  var quotedCols = columns.map(quoteIdent).join(', ');
  var placeholders = columns.map(function() { return '?'; }).join(', ');
  var values = columns.map(function(k) { return record[k]; });
  var sql = 'INSERT INTO ${table} (' + quotedCols + ') VALUES (' + placeholders + ')';
  var [result] = await pool.execute(sql, values);
  return Object.assign({}, record, { _insertId: result.insertId });
}`
  }

  return `
async function insertInvoice(invoiceData) {
  var pool = getClient();
  var record = mapInvoiceToRecord(invoiceData);
  var columns = Object.keys(record);
  var quotedCols = columns.map(quoteIdent).join(', ');
  var placeholders = columns.map(function(_, i) { return '$' + (i + 1); }).join(', ');
  var values = columns.map(function(k) { return record[k]; });
  var sql = 'INSERT INTO ${table} (' + quotedCols + ') VALUES (' + placeholders + ') RETURNING *';
  var result = await pool.query(sql, values);
  return result.rows[0];
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
async function insertInvoiceItems(invoiceId, items) {
  if (!items || items.length === 0) return [];
  var pool = getClient();
  var results = [];
  for (var i = 0; i < items.length; i++) {
    var record = mapInvoiceItemToRecord(invoiceId, items[i], i);
    var columns = Object.keys(record);
    var quotedCols = columns.map(quoteIdent).join(', ');
    var placeholders = columns.map(function() { return '?'; }).join(', ');
    var values = columns.map(function(k) { return record[k]; });
    var sql = 'INSERT INTO ${table} (' + quotedCols + ') VALUES (' + placeholders + ')';
    var [result] = await pool.execute(sql, values);
    results.push(Object.assign({}, record, { id: result.insertId }));
  }
  return results;
}`
  }

  return `
async function insertInvoiceItems(invoiceId, items) {
  if (!items || items.length === 0) return [];
  var pool = getClient();
  var results = [];
  for (var i = 0; i < items.length; i++) {
    var record = mapInvoiceItemToRecord(invoiceId, items[i], i);
    var columns = Object.keys(record);
    var quotedCols = columns.map(quoteIdent).join(', ');
    var placeholders = columns.map(function(_, j) { return '$' + (j + 1); }).join(', ');
    var values = columns.map(function(k) { return record[k]; });
    var sql = 'INSERT INTO ${table} (' + quotedCols + ') VALUES (' + placeholders + ') RETURNING *';
    var result = await pool.query(sql, values);
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

function generateGetNextInvoiceNumberCode(dsType: string, table: string): string {
  if (dsType === 'supabase') {
    return `
async function getNextInvoiceNumber(prefix) {
  var client = getClient();
  var result = await client.from('${table}')
    .select('invoice_number')
    .like('invoice_number', prefix + '%')
    .order('created_at', { ascending: false })
    .limit(1);
  if (result.error || !result.data || result.data.length === 0) return 1;
  var lastNum = result.data[0].invoice_number.replace(prefix, '');
  var parsed = parseInt(lastNum, 10);
  return isNaN(parsed) ? 1 : parsed + 1;
}`
  }

  if (dsType === 'mysql' || dsType === 'mariadb' || dsType === 'tidb') {
    return `
async function getNextInvoiceNumber(prefix) {
  var pool = getClient();
  var conn = await pool.getConnection();
  try {
    await conn.execute('START TRANSACTION');
    var [rows] = await conn.execute(
      'SELECT invoice_number FROM ${table} WHERE invoice_number LIKE ? ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
      [prefix + '%']
    );
    var nextNum = 1;
    if (rows.length > 0) {
      var lastNum = rows[0].invoice_number.replace(prefix, '');
      var parsed = parseInt(lastNum, 10);
      nextNum = isNaN(parsed) ? 1 : parsed + 1;
    }
    await conn.execute('COMMIT');
    return nextNum;
  } catch (err) {
    await conn.execute('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }
}`
  }

  return `
async function getNextInvoiceNumber(prefix) {
  var pool = getClient();
  var client = await pool.connect();
  try {
    await client.query('BEGIN');
    var result = await client.query(
      'SELECT invoice_number FROM ${table} WHERE invoice_number LIKE $1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
      [prefix + '%']
    );
    var nextNum = 1;
    if (result.rows.length > 0) {
      var lastNum = result.rows[0].invoice_number.replace(prefix, '');
      var parsed = parseInt(lastNum, 10);
      nextNum = isNaN(parsed) ? 1 : parsed + 1;
    }
    await client.query('COMMIT');
    return nextNum;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
    total: data.total || 0,
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
