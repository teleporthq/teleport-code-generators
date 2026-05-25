interface DataSourceConfig {
  type: string
  config: Record<string, unknown>
}

const resolveEnvRef = (value: unknown, fallbackEnvKey: string): string => {
  if (typeof value === 'string' && value.startsWith('teleporthq.secrets.')) {
    const envKey = value.replace('teleporthq.secrets.', '')
    return `process.env.${envKey}`
  }
  return `process.env.${fallbackEnvKey}`
}

export function generateDBConnectionCode(dataSource: DataSourceConfig | null): string {
  if (!dataSource) {
    return generatePostgresDBCode({})
  }

  const dsType = dataSource.type
  const config = dataSource.config || {}

  switch (dsType) {
    case 'teleport':
    case 'postgresql':
    case 'amazon-redshift':
    case 'cockroachdb':
      return generatePostgresDBCode(config)
    case 'supabase':
      return generateSupabaseDBCode(config)
    case 'mysql':
    case 'mariadb':
    case 'tidb':
      return generateMysqlDBCode(config)
    default:
      return generatePostgresDBCode(config)
  }
}

function generatePostgresDBCode(config: Record<string, unknown>): string {
  const hostRef = resolveEnvRef(config.host, 'TELEPORT_DB_HOST')
  const portRef = resolveEnvRef(config.port, 'TELEPORT_DB_PORT')
  const userRef = resolveEnvRef(config.user || config.username, 'TELEPORT_DB_USER')
  const passwordRef = resolveEnvRef(config.password, 'TELEPORT_DB_PASSWORD')
  const databaseRef = resolveEnvRef(config.database, 'TELEPORT_DB_NAME')

  return `var pg = require('pg');

function _getClient() {
  if (process.env.TELEPORT_DB_CONNECTION_STRING) {
    return new pg.Client({ connectionString: process.env.TELEPORT_DB_CONNECTION_STRING, ssl: process.env.TELEPORT_DB_SSL === 'false' ? false : { rejectUnauthorized: false } });
  }
  return new pg.Client({
    host: ${hostRef},
    port: parseInt(${portRef} || '5432', 10),
    user: ${userRef},
    password: ${passwordRef},
    database: ${databaseRef},
    ssl: process.env.TELEPORT_DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
}

function _buildWhere(where, startIdx) {
  if (!where || Object.keys(where).length === 0) return { clause: '', params: [], nextIdx: startIdx };
  var clauses = [];
  var params = [];
  var idx = startIdx;
  var keys = Object.keys(where);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = where[k];
    if (v && typeof v === 'object' && v.operator) {
      clauses.push('"' + k + '" ' + v.operator + ' $' + idx);
      params.push(v.value);
    } else {
      clauses.push('"' + k + '" = $' + idx);
      params.push(v);
    }
    idx++;
  }
  return { clause: ' WHERE ' + clauses.join(' AND '), params: params, nextIdx: idx };
}

async function selectMany(table, options) {
  var opts = options || {};
  var columns = opts.columns || '*';
  var sql = 'SELECT ' + columns + ' FROM "' + table + '"';
  var params = [];
  var paramIdx = 1;

  if (opts.where) {
    var w = _buildWhere(opts.where, paramIdx);
    sql += w.clause;
    params = params.concat(w.params);
    paramIdx = w.nextIdx;
  }

  if (opts.whereIn) {
    var col = opts.whereIn.column;
    var vals = opts.whereIn.values || [];
    if (vals.length > 0) {
      var placeholders = vals.map(function(_, i) { return '$' + (paramIdx + i); });
      sql += (params.length > 0 ? ' AND ' : ' WHERE ') + '"' + col + '" IN (' + placeholders.join(', ') + ')';
      params = params.concat(vals);
      paramIdx += vals.length;
    }
  }

  if (opts.orderBy) {
    sql += ' ORDER BY "' + opts.orderBy.column + '" ' + (opts.orderBy.direction || 'ASC');
    if (opts.orderBy.nulls) sql += ' NULLS ' + opts.orderBy.nulls;
  }

  if (opts.limit) {
    sql += ' LIMIT $' + paramIdx;
    params.push(opts.limit);
    paramIdx++;
  }

  if (opts.offset) {
    sql += ' OFFSET $' + paramIdx;
    params.push(opts.offset);
    paramIdx++;
  }

  var client = _getClient();
  await client.connect();
  try {
    var result = await client.query(sql, params);
    return result.rows;
  } finally {
    await client.end();
  }
}

async function selectOne(table, where) {
  var rows = await selectMany(table, { where: where, limit: 1 });
  return rows[0] || null;
}

async function insert(table, data) {
  var keys = Object.keys(data);
  var values = Object.values(data);
  var placeholders = keys.map(function(_, i) { return '$' + (i + 1); });
  var sql = 'INSERT INTO "' + table + '" (' + keys.map(function(k) { return '"' + k + '"'; }).join(', ') + ') VALUES (' + placeholders.join(', ') + ') RETURNING *';
  var client = _getClient();
  await client.connect();
  try {
    var result = await client.query(sql, values);
    return result.rows[0] || null;
  } finally {
    await client.end();
  }
}

async function update(table, id, data) {
  var keys = Object.keys(data);
  var values = Object.values(data);
  var setClauses = keys.map(function(k, i) { return '"' + k + '" = $' + (i + 1); });
  values.push(id);
  var sql = 'UPDATE "' + table + '" SET ' + setClauses.join(', ') + ' WHERE id = $' + values.length + ' RETURNING *';
  var client = _getClient();
  await client.connect();
  try {
    var result = await client.query(sql, values);
    return result.rows[0] || null;
  } finally {
    await client.end();
  }
}

async function remove(table, id) {
  var client = _getClient();
  await client.connect();
  try {
    await client.query('DELETE FROM "' + table + '" WHERE id = $1', [id]);
  } finally {
    await client.end();
  }
}

async function removeWhere(table, where) {
  var w = _buildWhere(where, 1);
  var sql = 'DELETE FROM "' + table + '"' + w.clause;
  var client = _getClient();
  await client.connect();
  try {
    await client.query(sql, w.params);
  } finally {
    await client.end();
  }
}

module.exports = {
  selectMany: selectMany,
  selectOne: selectOne,
  insert: insert,
  update: update,
  remove: remove,
  removeWhere: removeWhere,
};
`
}

function generateSupabaseDBCode(config: Record<string, unknown>): string {
  const supabaseUrl = config.supabaseUrl
  const urlRef = resolveEnvRef(supabaseUrl, 'SUPABASE_URL')
  const keyRef = resolveEnvRef(
    config.serviceRoleKey || config.publicApiKey,
    'SUPABASE_SERVICE_ROLE_KEY'
  )

  return `var supabaseJs = require('@supabase/supabase-js');

var _client = null;
function _getClient() {
  if (!_client) {
    _client = supabaseJs.createClient(${urlRef}, ${keyRef});
  }
  return _client;
}

async function selectMany(table, options) {
  var opts = options || {};
  var sb = _getClient();
  var query = sb.from(table).select(opts.columns || '*');

  if (opts.where) {
    var keys = Object.keys(opts.where);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = opts.where[k];
      if (v && typeof v === 'object' && v.operator) {
        var op = v.operator;
        if (op === '=' || op === 'eq') query = query.eq(k, v.value);
        else if (op === '!=' || op === 'neq') query = query.neq(k, v.value);
        else if (op === '>' || op === 'gt') query = query.gt(k, v.value);
        else if (op === '<' || op === 'lt') query = query.lt(k, v.value);
        else if (op === '>=' || op === 'gte') query = query.gte(k, v.value);
        else if (op === '<=' || op === 'lte') query = query.lte(k, v.value);
        else if (op === 'LIKE' || op === 'like') query = query.like(k, v.value);
        else if (op === 'ILIKE' || op === 'ilike') query = query.ilike(k, v.value);
        else if (op === 'IN' || op === 'in') query = query.in(k, v.value);
        else query = query.eq(k, v.value);
      } else {
        query = query.eq(k, v);
      }
    }
  }

  if (opts.whereIn) {
    query = query.in(opts.whereIn.column, opts.whereIn.values || []);
  }

  if (opts.orderBy) {
    query = query.order(opts.orderBy.column, {
      ascending: (opts.orderBy.direction || 'ASC').toUpperCase() === 'ASC',
      nullsFirst: opts.orderBy.nulls === 'FIRST',
    });
  }

  var limit = opts.limit || 1000;
  var offset = opts.offset || 0;
  query = query.range(offset, offset + limit - 1);

  var result = await query;
  if (result.error) throw result.error;
  return result.data || [];
}

async function selectOne(table, where) {
  var rows = await selectMany(table, { where: where, limit: 1 });
  return rows[0] || null;
}

async function insert(table, data) {
  var sb = _getClient();
  var result = await sb.from(table).insert(data).select().single();
  if (result.error) throw result.error;
  return result.data;
}

async function update(table, id, data) {
  var sb = _getClient();
  var result = await sb.from(table).update(data).eq('id', id).select().single();
  if (result.error) throw result.error;
  return result.data;
}

async function remove(table, id) {
  var sb = _getClient();
  var result = await sb.from(table).delete().eq('id', id);
  if (result.error) throw result.error;
}

async function removeWhere(table, where) {
  var sb = _getClient();
  var query = sb.from(table).delete();
  var keys = Object.keys(where);
  for (var i = 0; i < keys.length; i++) {
    query = query.eq(keys[i], where[keys[i]]);
  }
  var result = await query;
  if (result.error) throw result.error;
}

module.exports = {
  selectMany: selectMany,
  selectOne: selectOne,
  insert: insert,
  update: update,
  remove: remove,
  removeWhere: removeWhere,
};
`
}

function generateMysqlDBCode(config: Record<string, unknown>): string {
  const hostRef = resolveEnvRef(config.host, 'TELEPORT_DB_HOST')
  const portRef = resolveEnvRef(config.port, 'TELEPORT_DB_PORT')
  const userRef = resolveEnvRef(config.user || config.username, 'TELEPORT_DB_USER')
  const passwordRef = resolveEnvRef(config.password, 'TELEPORT_DB_PASSWORD')
  const databaseRef = resolveEnvRef(config.database, 'TELEPORT_DB_NAME')

  const lines = [
    'var mysql = require("mysql2/promise");',
    '',
    'var _pool = null;',
    'function _getPool() {',
    '  if (!_pool) {',
    '    _pool = mysql.createPool({',
    `      host: ${hostRef},`,
    `      port: parseInt(${portRef} || '3306', 10),`,
    `      user: ${userRef},`,
    `      password: ${passwordRef},`,
    `      database: ${databaseRef},`,
    '      waitForConnections: true,',
    '      connectionLimit: 5,',
    '    });',
    '  }',
    '  return _pool;',
    '}',
    '',
    'var _BT = String.fromCharCode(96);',
    'function _qi(name) { return _BT + name + _BT; }',
    '',
    'function _buildWhere(where, params) {',
    '  if (!where || Object.keys(where).length === 0) return { clause: "", params: params };',
    '  var clauses = [];',
    '  var keys = Object.keys(where);',
    '  for (var i = 0; i < keys.length; i++) {',
    '    var k = keys[i];',
    '    var v = where[k];',
    '    if (v && typeof v === "object" && v.operator) {',
    '      clauses.push(_qi(k) + " " + v.operator + " ?");',
    '      params.push(v.value);',
    '    } else {',
    '      clauses.push(_qi(k) + " = ?");',
    '      params.push(v);',
    '    }',
    '  }',
    '  return { clause: " WHERE " + clauses.join(" AND "), params: params };',
    '}',
    '',
    'async function selectMany(table, options) {',
    '  var opts = options || {};',
    '  var columns = opts.columns || "*";',
    '  var sql = "SELECT " + columns + " FROM " + _qi(table);',
    '  var params = [];',
    '  if (opts.where) {',
    '    var w = _buildWhere(opts.where, params);',
    '    sql += w.clause;',
    '    params = w.params;',
    '  }',
    '  if (opts.whereIn) {',
    '    var col = opts.whereIn.column;',
    '    var vals = opts.whereIn.values || [];',
    '    if (vals.length > 0) {',
    '      var placeholders = vals.map(function() { return "?"; });',
    '      sql += (params.length > 0 ? " AND " : " WHERE ") + _qi(col) + " IN (" + placeholders.join(", ") + ")";',
    '      params = params.concat(vals);',
    '    }',
    '  }',
    '  if (opts.orderBy) {',
    '    sql += " ORDER BY " + _qi(opts.orderBy.column) + " " + (opts.orderBy.direction || "ASC");',
    '  }',
    '  if (opts.limit) { sql += " LIMIT ?"; params.push(opts.limit); }',
    '  if (opts.offset) { sql += " OFFSET ?"; params.push(opts.offset); }',
    '  var pool = _getPool();',
    '  var result = await pool.execute(sql, params);',
    '  return result[0];',
    '}',
    '',
    'async function selectOne(table, where) {',
    '  var rows = await selectMany(table, { where: where, limit: 1 });',
    '  return rows[0] || null;',
    '}',
    '',
    'async function insert(table, data) {',
    '  var keys = Object.keys(data);',
    '  var values = Object.values(data);',
    '  var placeholders = keys.map(function() { return "?"; });',
    '  var sql = "INSERT INTO " + _qi(table) + " (" + keys.map(function(k) { return _qi(k); }).join(", ") + ") VALUES (" + placeholders.join(", ") + ")";',
    '  var pool = _getPool();',
    '  await pool.execute(sql, values);',
    '  return data;',
    '}',
    '',
    'async function update(table, id, data) {',
    '  var keys = Object.keys(data);',
    '  var values = Object.values(data);',
    '  var setClauses = keys.map(function(k) { return _qi(k) + " = ?"; });',
    '  values.push(id);',
    '  var sql = "UPDATE " + _qi(table) + " SET " + setClauses.join(", ") + " WHERE id = ?";',
    '  var pool = _getPool();',
    '  await pool.execute(sql, values);',
    '  return await selectOne(table, { id: id });',
    '}',
    '',
    'async function remove(table, id) {',
    '  var pool = _getPool();',
    '  await pool.execute("DELETE FROM " + _qi(table) + " WHERE id = ?", [id]);',
    '}',
    '',
    'async function removeWhere(table, where) {',
    '  var params = [];',
    '  var w = _buildWhere(where, params);',
    '  var sql = "DELETE FROM " + _qi(table) + w.clause;',
    '  var pool = _getPool();',
    '  await pool.execute(sql, w.params);',
    '}',
    '',
    'module.exports = {',
    '  selectMany: selectMany,',
    '  selectOne: selectOne,',
    '  insert: insert,',
    '  update: update,',
    '  remove: remove,',
    '  removeWhere: removeWhere,',
    '};',
  ]

  return lines.join('\n') + '\n'
}

export function getDBDependencies(dataSource: DataSourceConfig | null): Record<string, string> {
  if (!dataSource) {
    return { pg: '^8.11.0' }
  }

  switch (dataSource.type) {
    case 'teleport':
    case 'postgresql':
    case 'amazon-redshift':
    case 'cockroachdb':
      return { pg: '^8.11.0' }
    case 'supabase':
      return { '@supabase/supabase-js': '^2.38.0' }
    case 'mysql':
    case 'mariadb':
    case 'tidb':
      return { mysql2: '^3.6.0' }
    default:
      return { pg: '^8.11.0' }
  }
}
