import {
  UIDLAuthentication,
  UIDLAuthProvider,
  UIDLCustomUserProperty,
  DataSourceType,
} from '@teleporthq/teleport-types'

// GUI provider id → the actual next-auth v4 provider MODULE name, for the few
// cases where they differ. Everything else uses the id as the module name.
// (Providers next-auth v4 cannot supply are not offered by the GUI; if one
// ever slips through, generateProvidersSetup skips it gracefully.)
const PROVIDER_MODULE_OVERRIDES: Record<string, string> = {
  boxyhq: 'boxyhq-saml',
  duende: 'duende-identity-server6',
  identityserver4: 'identity-server4',
}

// OAuth providers that guarantee a verified email address. For these we enable
// `allowDangerousEmailAccountLinking` so a person who first signed up with
// email/password (or another of these providers) and then signs in with this
// provider using the SAME email is linked to the existing `users` row instead
// of hitting NextAuth's `OAuthAccountNotLinked` error. Restricted to
// email-verifying providers because linking-by-email on a provider that does
// NOT verify the address is an account-takeover vector. Trivial to edit.
const TRUSTED_EMAIL_VERIFYING_PROVIDERS = new Set<string>([
  'google',
  'apple',
  'facebook',
  'github',
  'gitlab',
  'azure-ad',
  'azure-ad-b2c',
  'discord',
  'linkedin',
])

// Extra OAuth `authorization.params` emitted per provider. `access_type:
// 'offline'` makes Google (and Google-style providers) return a refresh_token
// on first consent so the short-lived access token can be rotated server-side
// (see the generated auth-refresh.js + the jwt callback).
const PROVIDER_AUTHORIZATION_PARAMS: Record<string, Record<string, string>> = {
  google: { access_type: 'offline' },
}

export const getDatabaseDriverDependencies = (
  dataSourceType: DataSourceType | null
): Record<string, string> => {
  if (!dataSourceType) {
    return {}
  }
  switch (dataSourceType) {
    case 'teleport':
    case 'postgresql':
    case 'cockroachdb':
      return { pg: '^8.12.0' }
    case 'supabase':
      return { '@supabase/supabase-js': '^2.43.0' }
    case 'mysql':
    case 'mariadb':
    case 'tidb':
      return { mysql2: '^3.10.0' }
    case 'mongodb':
      return { mongodb: '^6.7.0' }
    case 'firestore':
      return { 'firebase-admin': '^12.2.0' }
    case 'turso':
      return { '@libsql/client': '^0.6.0' }
    case 'airtable':
      return { airtable: '^0.12.0' }
    default:
      return {}
  }
}

const resolveConfigValue = (value: unknown, defaultEnvKey: string): string => {
  if (typeof value === 'string' && value.startsWith('teleporthq.secrets.')) {
    const envVar = value.replace('teleporthq.secrets.', '')
    return `process.env.${envVar}`
  }
  if (typeof value === 'string' && value) {
    return JSON.stringify(value)
  }
  return `process.env.${defaultEnvKey}`
}

const generateDbSetupCode = (
  dataSourceType: DataSourceType | null,
  dataSourceConfig?: Record<string, unknown> | null
): string => {
  if (!dataSourceType) {
    return ''
  }
  const cfg = (dataSourceConfig || {}) as Record<string, unknown>

  switch (dataSourceType) {
    case 'teleport':
      return `const Client = require('pg').Client;

function getClient() {
  if (process.env.TELEPORT_DB_CONNECTION_STRING) {
    return new Client({ connectionString: process.env.TELEPORT_DB_CONNECTION_STRING, ssl: process.env.TELEPORT_DB_SSL === 'false' ? false : { rejectUnauthorized: false } });
  }
  return new Client({
    host: ${resolveConfigValue(cfg.host, 'TELEPORT_DB_HOST')},
    port: parseInt(${resolveConfigValue(cfg.port, 'TELEPORT_DB_PORT')} || '5432', 10),
    user: ${resolveConfigValue(cfg.user || cfg.username, 'TELEPORT_DB_USER')},
    password: ${resolveConfigValue(cfg.password, 'TELEPORT_DB_PASSWORD')},
    database: ${resolveConfigValue(cfg.database, 'TELEPORT_DB_NAME')},
    ssl: process.env.TELEPORT_DB_SSL === 'false' ? false : { rejectUnauthorized: false }
  });
}
`
    case 'postgresql':
    case 'cockroachdb': {
      const sslCode = cfg.ssl === false ? 'false' : '{ rejectUnauthorized: false }'
      return `const Client = require('pg').Client;

function getClient() {
  if (process.env.DB_CONNECTION_STRING) {
    return new Client({ connectionString: process.env.DB_CONNECTION_STRING });
  }
  return new Client({
    host: ${resolveConfigValue(cfg.host, 'DB_HOST')},
    port: parseInt(${resolveConfigValue(cfg.port, 'DB_PORT')} || '5432', 10),
    user: ${resolveConfigValue(cfg.user || cfg.username, 'DB_USER')},
    password: ${resolveConfigValue(cfg.password, 'DB_PASSWORD')},
    database: ${resolveConfigValue(cfg.database, 'DB_NAME')},
    ssl: ${sslCode}
  });
}
`
    }
    case 'supabase':
      return `const createClient = require('@supabase/supabase-js').createClient;

let _supabaseClient = null;
function getSupabaseClient() {
  if (_supabaseClient) return _supabaseClient;
  _supabaseClient = createClient(
    ${resolveConfigValue(cfg.url || cfg.supabaseUrl, 'SUPABASE_URL')},
    ${resolveConfigValue(cfg.serviceRoleKey || cfg.apiKey, 'SUPABASE_SERVICE_ROLE_KEY')}
  );
  return _supabaseClient;
}
`
    case 'mysql':
    case 'mariadb':
    case 'tidb':
      return `const mysql = require('mysql2/promise');

async function getConnection() {
  return mysql.createConnection({
    host: ${resolveConfigValue(cfg.host, 'DB_HOST')},
    port: parseInt(${resolveConfigValue(cfg.port, 'DB_PORT')} || '3306', 10),
    user: ${resolveConfigValue(cfg.user || cfg.username, 'DB_USER')},
    password: ${resolveConfigValue(cfg.password, 'DB_PASSWORD')},
    database: ${resolveConfigValue(cfg.database, 'DB_NAME')}
  });
}
`
    case 'mongodb':
      return `const MongoClient = require('mongodb').MongoClient;
const _mongoUri = ${resolveConfigValue(cfg.connectionString || cfg.uri, 'MONGODB_URI')};
const _mongoClient = new MongoClient(_mongoUri, {
  connectTimeoutMS: 30000,
  serverSelectionTimeoutMS: 30000
});
let _mongoClientPromise;
if (process.env.NODE_ENV === 'development') {
  if (!global._mongoClientPromise) {
    global._mongoClientPromise = _mongoClient.connect();
  }
  _mongoClientPromise = global._mongoClientPromise;
} else {
  _mongoClientPromise = _mongoClient.connect();
}
`
    case 'firestore':
      return `const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: ${resolveConfigValue(cfg.projectId, 'AUTH_FIREBASE_PROJECT_ID')},
      clientEmail: ${resolveConfigValue(cfg.clientEmail, 'AUTH_FIREBASE_CLIENT_EMAIL')},
      privateKey: ${resolveConfigValue(cfg.privateKey, 'AUTH_FIREBASE_PRIVATE_KEY')},
    }),
  });
}
const firestoreDb = admin.firestore();
`
    case 'turso':
      return `const createTursoClient = require('@libsql/client').createClient;
const tursoClient = createTursoClient({
  url: ${resolveConfigValue(cfg.url || cfg.databaseUrl, 'TURSO_DATABASE_URL')},
  authToken: ${resolveConfigValue(cfg.authToken || cfg.token, 'TURSO_AUTH_TOKEN')},
});
`
    case 'airtable':
      return `const Airtable = require('airtable');
const airtableBase = new Airtable({
  apiKey: ${resolveConfigValue(cfg.apiKey || cfg.personalAccessToken, 'AIRTABLE_API_KEY')}
}).base(${resolveConfigValue(cfg.baseId, 'AIRTABLE_BASE_ID')});
`
    default:
      return ''
  }
}

const generateSanitizeUserFunction = (): string => {
  // Preserve the native type of the id (integer vs UUID-string) — NextAuth
  // will JSON-serialize the session payload either way. Coercing with
  // \`String(rawId)\` would silently turn an integer PK into "1" and make
  // runtime comparisons against a DB-fetched \`user.id\` (still a number
  // on pages that read the row via \`getStaticProps\`) always false.
  //
  // SENSITIVE_USER_FIELDS are stripped before a user row ever reaches the
  // client session: the password hash plus every OAuth token column. The
  // single \`users\` table holds the provider linkage + tokens (see the
  // adapter), so without this strip the access/refresh tokens would be
  // serialized into /api/auth/session. \`provider\` itself is harmless and
  // kept (useful for "you signed in with Google" UI).
  return `var SENSITIVE_USER_FIELDS = {
  password: 1,
  _id: 1,
  access_token: 1,
  refresh_token: 1,
  id_token: 1,
  session_state: 1,
  expires_at: 1,
  token_type: 1,
  scope: 1,
  provider_account_id: 1,
  provider_type: 1
};
function sanitizeUser(user) {
  if (!user) return null;
  const safe = {};
  const keys = Object.keys(user);
  for (let i = 0; i < keys.length; i++) {
    if (!SENSITIVE_USER_FIELDS[keys[i]]) {
      safe[keys[i]] = user[keys[i]];
    }
  }
  const rawId = user.id != null ? user.id : user._id;
  if (rawId != null) safe.id = rawId;
  return safe;
}`
}

const generateCustomPropSqlCols = (props: UIDLCustomUserProperty[]): string => {
  if (props.length === 0) {
    return ''
  }
  return ', ' + props.map((p) => p.key).join(', ')
}

const generateCustomPropPgPlaceholders = (
  props: UIDLCustomUserProperty[],
  startIdx: number
): string => {
  if (props.length === 0) {
    return ''
  }
  return ', ' + props.map((_, i) => `$${startIdx + i}`).join(', ')
}

const generateCustomPropMysqlPlaceholders = (props: UIDLCustomUserProperty[]): string => {
  if (props.length === 0) {
    return ''
  }
  return ', ' + props.map(() => '?').join(', ')
}

const generateCustomPropValues = (props: UIDLCustomUserProperty[]): string => {
  if (props.length === 0) {
    return ''
  }
  return ', ' + props.map((p) => `userData.${p.key} != null ? userData.${p.key} : null`).join(', ')
}

const generateCustomPropDocEntries = (props: UIDLCustomUserProperty[]): string => {
  if (props.length === 0) {
    return ''
  }
  return (
    '\n' +
    props
      .map((p) => `    ${p.key}: userData.${p.key} != null ? userData.${p.key} : null,`)
      .join('\n')
  )
}

const generateCustomPropAirtableEntries = (props: UIDLCustomUserProperty[]): string => {
  if (props.length === 0) {
    return ''
  }
  return (
    '\n' +
    props
      .map((p) => `        ${p.key}: userData.${p.key} != null ? userData.${p.key} : '',`)
      .join('\n')
  )
}

const generateFindUserFunction = (
  dataSourceType: DataSourceType | null,
  customProps: UIDLCustomUserProperty[]
): string => {
  if (!dataSourceType) {
    return `async function findUserByEmail() { return null; }
async function createUser() { return null; }
async function userExistsByEmail() { return false; }`
  }

  const defaultColCount = 5
  const sqlCols = generateCustomPropSqlCols(customProps)
  const pgPlaceholders = generateCustomPropPgPlaceholders(customProps, defaultColCount + 1)
  const mysqlPlaceholders = generateCustomPropMysqlPlaceholders(customProps)
  const customValues = generateCustomPropValues(customProps)
  const docEntries = generateCustomPropDocEntries(customProps)
  const airtableEntries = generateCustomPropAirtableEntries(customProps)

  switch (dataSourceType) {
    case 'teleport':
    case 'postgresql':
    case 'cockroachdb':
      return `async function findUserByEmail(email) {
  const client = getClient();
  try {
    await client.connect();
    const result = await client.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}

async function createUser(userData) {
  const client = getClient();
  try {
    await client.connect();
    const result = await client.query(
      'INSERT INTO users (name, email, password, role, image${sqlCols}) VALUES ($1, $2, $3, $4, $5${pgPlaceholders}) RETURNING *',
      [userData.name || null, userData.email, userData.password, userData.role || 'user', userData.image || null${customValues}]
    );
    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}

async function userExistsByEmail(email) {
  const client = getClient();
  try {
    await client.connect();
    const result = await client.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
    return result.rows && result.rows.length > 0;
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}`
    case 'supabase':
      return `async function findUserByEmail(email) {
  const client = getSupabaseClient();
  const result = await client.from('users').select('*').eq('email', email).single();
  return result.data || null;
}

async function createUser(userData) {
  const client = getSupabaseClient();
  const insertData = {
    name: userData.name || null,
    email: userData.email,
    password: userData.password,
    role: userData.role || 'user',
    image: userData.image || null,${docEntries}
  };
  const result = await client.from('users').insert(insertData).select().single();
  return result.data || null;
}

async function userExistsByEmail(email) {
  const client = getSupabaseClient();
  const result = await client.from('users').select('id').eq('email', email).single();
  return !!result.data;
}`
    case 'mysql':
    case 'mariadb':
    case 'tidb':
      return `async function findUserByEmail(email) {
  const conn = await getConnection();
  try {
    const [rows] = await conn.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    return rows && rows.length > 0 ? rows[0] : null;
  } finally {
    try { await conn.end(); } catch (_e) {}
  }
}

async function createUser(userData) {
  const conn = await getConnection();
  try {
    await conn.execute(
      'INSERT INTO users (name, email, password, role, image${sqlCols}) VALUES (?, ?, ?, ?, ?${mysqlPlaceholders})',
      [userData.name || null, userData.email, userData.password, userData.role || 'user', userData.image || null${customValues}]
    );
    const [rows] = await conn.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [userData.email]);
    const created = rows && rows.length > 0 ? Object.assign({}, rows[0]) : Object.assign({}, userData);
    delete created.password;
    return created;
  } finally {
    try { await conn.end(); } catch (_e) {}
  }
}

async function userExistsByEmail(email) {
  const conn = await getConnection();
  try {
    const [rows] = await conn.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    return rows && rows.length > 0;
  } finally {
    try { await conn.end(); } catch (_e) {}
  }
}`
    case 'mongodb':
      return `async function findUserByEmail(email) {
  const client = await _mongoClientPromise;
  const db = client.db();
  return await db.collection('users').findOne({ email: email });
}

async function createUser(userData) {
  const client = await _mongoClientPromise;
  const db = client.db();
  const insertDoc = {
    name: userData.name || null,
    email: userData.email,
    password: userData.password,
    role: userData.role || 'user',
    image: userData.image || null,
    emailVerified: null,${docEntries}
  };
  const result = await db.collection('users').insertOne(insertDoc);
  const created = Object.assign({}, insertDoc, { id: result.insertedId.toString() });
  delete created.password;
  return created;
}

async function userExistsByEmail(email) {
  const client = await _mongoClientPromise;
  const db = client.db();
  const user = await db.collection('users').findOne({ email: email }, { projection: { _id: 1 } });
  return !!user;
}`
    case 'firestore':
      return `async function findUserByEmail(email) {
  const snapshot = await firestoreDb.collection('users').where('email', '==', email).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return Object.assign({ id: doc.id }, doc.data());
}

async function createUser(userData) {
  const insertDoc = {
    name: userData.name || null,
    email: userData.email,
    password: userData.password,
    role: userData.role || 'user',
    image: userData.image || null,
    emailVerified: null,${docEntries}
  };
  const docRef = await firestoreDb.collection('users').add(insertDoc);
  const created = Object.assign({}, insertDoc, { id: docRef.id });
  delete created.password;
  return created;
}

async function userExistsByEmail(email) {
  const snapshot = await firestoreDb.collection('users').where('email', '==', email).limit(1).get();
  return !snapshot.empty;
}`
    case 'turso':
      return `async function findUserByEmail(email) {
  const result = await tursoClient.execute({ sql: 'SELECT * FROM users WHERE email = ? LIMIT 1', args: [email] });
  return result.rows && result.rows.length > 0 ? result.rows[0] : null;
}

async function createUser(userData) {
  await tursoClient.execute({
    sql: 'INSERT INTO users (name, email, password, role, image${sqlCols}) VALUES (?, ?, ?, ?, ?${mysqlPlaceholders})',
    args: [userData.name || null, userData.email, userData.password, userData.role || 'user', userData.image || null${customValues}]
  });
  const fetchResult = await tursoClient.execute({ sql: 'SELECT * FROM users WHERE email = ? LIMIT 1', args: [userData.email] });
  const created = fetchResult.rows && fetchResult.rows.length > 0 ? Object.assign({}, fetchResult.rows[0]) : Object.assign({}, userData);
  delete created.password;
  return created;
}

async function userExistsByEmail(email) {
  const result = await tursoClient.execute({ sql: 'SELECT id FROM users WHERE email = ? LIMIT 1', args: [email] });
  return result.rows && result.rows.length > 0;
}`
    case 'airtable':
      return `async function findUserByEmail(email) {
  return new Promise(function(resolve, reject) {
    airtableBase('users').select({
      filterByFormula: '{email} = "' + email.replace(/"/g, '\\\\"') + '"',
      maxRecords: 1,
    }).firstPage(function(err, records) {
      if (err) { reject(err); return; }
      if (!records || records.length === 0) { resolve(null); return; }
      const rec = records[0];
      resolve(Object.assign({ id: rec.id }, rec.fields));
    });
  });
}

async function createUser(userData) {
  return new Promise(function(resolve, reject) {
    airtableBase('users').create([{
      fields: {
        name: userData.name || '',
        email: userData.email,
        password: userData.password,
        role: userData.role || 'user',
        image: userData.image || '',${airtableEntries}
      }
    }], function(err, records) {
      if (err) { reject(err); return; }
      const rec = records[0];
      resolve(Object.assign({ id: rec.id }, rec.fields));
    });
  });
}

async function userExistsByEmail(email) {
  const user = await findUserByEmail(email);
  return !!user;
}`
    default:
      return `async function findUserByEmail() { return null; }
async function createUser() { return null; }
async function userExistsByEmail() { return false; }`
  }
}

// Maps a raw DB user row (snake_case, dialect-specific id) into the shape
// NextAuth's adapter contract expects (camelCase, string id, Date
// emailVerified). DB-agnostic — the same function works for every dialect.
const generateToAdapterUserFunction = (): string => {
  return `function toAdapterUser(row) {
  if (!row) return null;
  var rawId = row.id != null ? row.id : row._id;
  var ev = row.email_verified != null ? row.email_verified : (row.emailVerified != null ? row.emailVerified : null);
  return {
    id: rawId != null ? String(rawId) : undefined,
    name: row.name != null ? row.name : null,
    email: row.email != null ? row.email : null,
    image: row.image != null ? row.image : null,
    emailVerified: ev != null ? new Date(ev) : null,
    role: row.role != null ? row.role : undefined,
    provider: row.provider != null ? row.provider : null
  };
}`
}

// OAuth/adapter data-access helpers, backed by the SAME single \`users\`
// table the credentials flow uses. The provider linkage + tokens live in
// columns ON the user row (no child \`accounts\` table) — see linkAccount,
// which is an UPDATE rather than an INSERT into a 1:N table. One OAuth
// provider linkage is retained per user (sufficient for sign-in; the
// adapter resolves the same user by email via auto-link when a second
// provider is used). All token columns are stripped from the client
// session by sanitizeUser.
const generateOAuthDbHelpers = (dataSourceType: DataSourceType | null): string => {
  switch (dataSourceType) {
    case 'teleport':
    case 'postgresql':
    case 'cockroachdb':
      return `async function oauthGetUserById(id) {
  const client = getClient();
  try {
    await client.connect();
    const result = await client.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}

async function oauthGetUserByAccount(provider, providerAccountId) {
  if (!provider || providerAccountId == null) return null;
  const client = getClient();
  try {
    await client.connect();
    const result = await client.query('SELECT * FROM users WHERE provider = $1 AND provider_account_id = $2 LIMIT 1', [provider, String(providerAccountId)]);
    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}

async function oauthCreateUser(profile) {
  // Insert only the columns the provider gave us so the table defaults
  // (role, image placeholder, unsubscribe flags) apply; password stays null.
  const cols = ['name', 'email'];
  const vals = [profile.name != null ? profile.name : null, profile.email != null ? profile.email : null];
  if (profile.emailVerified != null) { cols.push('email_verified'); vals.push(profile.emailVerified); }
  if (profile.image != null) { cols.push('image'); vals.push(profile.image); }
  const placeholders = vals.map(function (_v, i) { return '$' + (i + 1); });
  const client = getClient();
  try {
    await client.connect();
    const result = await client.query('INSERT INTO users (' + cols.join(', ') + ') VALUES (' + placeholders.join(', ') + ') RETURNING *', vals);
    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}

async function oauthUpdateUser(id, partial) {
  const map = { name: 'name', email: 'email', emailVerified: 'email_verified', image: 'image' };
  const cols = [];
  const vals = [];
  Object.keys(map).forEach(function (k) {
    if (partial[k] !== undefined) { cols.push(map[k]); vals.push(partial[k]); }
  });
  if (cols.length === 0) return await oauthGetUserById(id);
  const sets = cols.map(function (c, i) { return c + ' = $' + (i + 1); });
  vals.push(id);
  const client = getClient();
  try {
    await client.connect();
    const result = await client.query('UPDATE users SET ' + sets.join(', ') + ' WHERE id = $' + vals.length + ' RETURNING *', vals);
    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}

async function oauthLinkAccount(account) {
  // Store the provider linkage + tokens on the user row. Never null out
  // password/name/role. The provider verified the email, so mark it.
  const client = getClient();
  try {
    await client.connect();
    await client.query(
      'UPDATE users SET provider = $1, provider_account_id = $2, provider_type = $3, access_token = $4, refresh_token = $5, expires_at = $6, id_token = $7, scope = $8, session_state = $9, token_type = $10, email_verified = COALESCE(email_verified, NOW()) WHERE id = $11',
      [account.provider, String(account.providerAccountId), account.type || null, account.access_token || null, account.refresh_token || null, account.expires_at != null ? account.expires_at : null, account.id_token || null, account.scope || null, account.session_state || null, account.token_type || null, account.userId]
    );
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}

async function oauthUpdateTokens(id, tokens) {
  const cols = [];
  const vals = [];
  if (tokens.access_token !== undefined) { cols.push('access_token'); vals.push(tokens.access_token); }
  if (tokens.refresh_token !== undefined) { cols.push('refresh_token'); vals.push(tokens.refresh_token); }
  if (tokens.expires_at !== undefined) { cols.push('expires_at'); vals.push(tokens.expires_at); }
  if (cols.length === 0) return;
  const sets = cols.map(function (c, i) { return c + ' = $' + (i + 1); });
  vals.push(id);
  const client = getClient();
  try {
    await client.connect();
    await client.query('UPDATE users SET ' + sets.join(', ') + ' WHERE id = $' + vals.length, vals);
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}

async function oauthGetTokensByUserId(id) {
  const client = getClient();
  try {
    await client.connect();
    const result = await client.query('SELECT access_token, refresh_token, expires_at, provider FROM users WHERE id = $1 LIMIT 1', [id]);
    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}`
    case 'supabase':
      return `async function oauthGetUserById(id) {
  const client = getSupabaseClient();
  const result = await client.from('users').select('*').eq('id', id).single();
  return result.data || null;
}

async function oauthGetUserByAccount(provider, providerAccountId) {
  if (!provider || providerAccountId == null) return null;
  const client = getSupabaseClient();
  const result = await client.from('users').select('*').eq('provider', provider).eq('provider_account_id', String(providerAccountId)).single();
  return result.data || null;
}

async function oauthCreateUser(profile) {
  const client = getSupabaseClient();
  const insertData = { name: profile.name != null ? profile.name : null, email: profile.email != null ? profile.email : null };
  if (profile.emailVerified != null) insertData.email_verified = profile.emailVerified;
  if (profile.image != null) insertData.image = profile.image;
  const result = await client.from('users').insert(insertData).select().single();
  return result.data || null;
}

async function oauthUpdateUser(id, partial) {
  const client = getSupabaseClient();
  const map = { name: 'name', email: 'email', emailVerified: 'email_verified', image: 'image' };
  const updateData = {};
  Object.keys(map).forEach(function (k) { if (partial[k] !== undefined) updateData[map[k]] = partial[k]; });
  if (Object.keys(updateData).length === 0) return await oauthGetUserById(id);
  const result = await client.from('users').update(updateData).eq('id', id).select().single();
  return result.data || null;
}

async function oauthLinkAccount(account) {
  const client = getSupabaseClient();
  const updateData = {
    provider: account.provider,
    provider_account_id: String(account.providerAccountId),
    provider_type: account.type || null,
    access_token: account.access_token || null,
    refresh_token: account.refresh_token || null,
    expires_at: account.expires_at != null ? account.expires_at : null,
    id_token: account.id_token || null,
    scope: account.scope || null,
    session_state: account.session_state || null,
    token_type: account.token_type || null
  };
  const existing = await oauthGetUserById(account.userId);
  if (existing && existing.email_verified == null) updateData.email_verified = new Date().toISOString();
  await client.from('users').update(updateData).eq('id', account.userId);
}

async function oauthUpdateTokens(id, tokens) {
  const client = getSupabaseClient();
  const updateData = {};
  if (tokens.access_token !== undefined) updateData.access_token = tokens.access_token;
  if (tokens.refresh_token !== undefined) updateData.refresh_token = tokens.refresh_token;
  if (tokens.expires_at !== undefined) updateData.expires_at = tokens.expires_at;
  if (Object.keys(updateData).length === 0) return;
  await client.from('users').update(updateData).eq('id', id);
}

async function oauthGetTokensByUserId(id) {
  const client = getSupabaseClient();
  const result = await client.from('users').select('access_token, refresh_token, expires_at, provider').eq('id', id).single();
  return result.data || null;
}`
    case 'mysql':
    case 'mariadb':
    case 'tidb':
      return `async function oauthGetUserById(id) {
  const conn = await getConnection();
  try {
    const [rows] = await conn.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
    return rows && rows.length > 0 ? rows[0] : null;
  } finally {
    try { await conn.end(); } catch (_e) {}
  }
}

async function oauthGetUserByAccount(provider, providerAccountId) {
  if (!provider || providerAccountId == null) return null;
  const conn = await getConnection();
  try {
    const [rows] = await conn.execute('SELECT * FROM users WHERE provider = ? AND provider_account_id = ? LIMIT 1', [provider, String(providerAccountId)]);
    return rows && rows.length > 0 ? rows[0] : null;
  } finally {
    try { await conn.end(); } catch (_e) {}
  }
}

async function oauthCreateUser(profile) {
  const cols = ['name', 'email'];
  const vals = [profile.name != null ? profile.name : null, profile.email != null ? profile.email : null];
  if (profile.emailVerified != null) { cols.push('email_verified'); vals.push(profile.emailVerified); }
  if (profile.image != null) { cols.push('image'); vals.push(profile.image); }
  const conn = await getConnection();
  try {
    await conn.execute('INSERT INTO users (' + cols.join(', ') + ') VALUES (' + cols.map(function () { return '?'; }).join(', ') + ')', vals);
    const [rows] = await conn.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [profile.email]);
    return rows && rows.length > 0 ? rows[0] : null;
  } finally {
    try { await conn.end(); } catch (_e) {}
  }
}

async function oauthUpdateUser(id, partial) {
  const map = { name: 'name', email: 'email', emailVerified: 'email_verified', image: 'image' };
  const cols = [];
  const vals = [];
  Object.keys(map).forEach(function (k) { if (partial[k] !== undefined) { cols.push(map[k]); vals.push(partial[k]); } });
  const conn = await getConnection();
  try {
    if (cols.length > 0) {
      vals.push(id);
      await conn.execute('UPDATE users SET ' + cols.map(function (c) { return c + ' = ?'; }).join(', ') + ' WHERE id = ?', vals);
    }
    const [rows] = await conn.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
    return rows && rows.length > 0 ? rows[0] : null;
  } finally {
    try { await conn.end(); } catch (_e) {}
  }
}

async function oauthLinkAccount(account) {
  const conn = await getConnection();
  try {
    await conn.execute(
      'UPDATE users SET provider = ?, provider_account_id = ?, provider_type = ?, access_token = ?, refresh_token = ?, expires_at = ?, id_token = ?, scope = ?, session_state = ?, token_type = ?, email_verified = COALESCE(email_verified, NOW()) WHERE id = ?',
      [account.provider, String(account.providerAccountId), account.type || null, account.access_token || null, account.refresh_token || null, account.expires_at != null ? account.expires_at : null, account.id_token || null, account.scope || null, account.session_state || null, account.token_type || null, account.userId]
    );
  } finally {
    try { await conn.end(); } catch (_e) {}
  }
}

async function oauthUpdateTokens(id, tokens) {
  const cols = [];
  const vals = [];
  if (tokens.access_token !== undefined) { cols.push('access_token'); vals.push(tokens.access_token); }
  if (tokens.refresh_token !== undefined) { cols.push('refresh_token'); vals.push(tokens.refresh_token); }
  if (tokens.expires_at !== undefined) { cols.push('expires_at'); vals.push(tokens.expires_at); }
  if (cols.length === 0) return;
  vals.push(id);
  const conn = await getConnection();
  try {
    await conn.execute('UPDATE users SET ' + cols.map(function (c) { return c + ' = ?'; }).join(', ') + ' WHERE id = ?', vals);
  } finally {
    try { await conn.end(); } catch (_e) {}
  }
}

async function oauthGetTokensByUserId(id) {
  const conn = await getConnection();
  try {
    const [rows] = await conn.execute('SELECT access_token, refresh_token, expires_at, provider FROM users WHERE id = ? LIMIT 1', [id]);
    return rows && rows.length > 0 ? rows[0] : null;
  } finally {
    try { await conn.end(); } catch (_e) {}
  }
}`
    case 'turso':
      return `async function oauthGetUserById(id) {
  const result = await tursoClient.execute({ sql: 'SELECT * FROM users WHERE id = ? LIMIT 1', args: [id] });
  return result.rows && result.rows.length > 0 ? result.rows[0] : null;
}

async function oauthGetUserByAccount(provider, providerAccountId) {
  if (!provider || providerAccountId == null) return null;
  const result = await tursoClient.execute({ sql: 'SELECT * FROM users WHERE provider = ? AND provider_account_id = ? LIMIT 1', args: [provider, String(providerAccountId)] });
  return result.rows && result.rows.length > 0 ? result.rows[0] : null;
}

async function oauthCreateUser(profile) {
  const cols = ['name', 'email'];
  const vals = [profile.name != null ? profile.name : null, profile.email != null ? profile.email : null];
  if (profile.emailVerified != null) { cols.push('email_verified'); vals.push(profile.emailVerified); }
  if (profile.image != null) { cols.push('image'); vals.push(profile.image); }
  await tursoClient.execute({ sql: 'INSERT INTO users (' + cols.join(', ') + ') VALUES (' + cols.map(function () { return '?'; }).join(', ') + ')', args: vals });
  const fetched = await tursoClient.execute({ sql: 'SELECT * FROM users WHERE email = ? LIMIT 1', args: [profile.email] });
  return fetched.rows && fetched.rows.length > 0 ? fetched.rows[0] : null;
}

async function oauthUpdateUser(id, partial) {
  const map = { name: 'name', email: 'email', emailVerified: 'email_verified', image: 'image' };
  const cols = [];
  const vals = [];
  Object.keys(map).forEach(function (k) { if (partial[k] !== undefined) { cols.push(map[k]); vals.push(partial[k]); } });
  if (cols.length > 0) {
    vals.push(id);
    await tursoClient.execute({ sql: 'UPDATE users SET ' + cols.map(function (c) { return c + ' = ?'; }).join(', ') + ' WHERE id = ?', args: vals });
  }
  return await oauthGetUserById(id);
}

async function oauthLinkAccount(account) {
  await tursoClient.execute({
    sql: 'UPDATE users SET provider = ?, provider_account_id = ?, provider_type = ?, access_token = ?, refresh_token = ?, expires_at = ?, id_token = ?, scope = ?, session_state = ?, token_type = ?, email_verified = COALESCE(email_verified, CURRENT_TIMESTAMP) WHERE id = ?',
    args: [account.provider, String(account.providerAccountId), account.type || null, account.access_token || null, account.refresh_token || null, account.expires_at != null ? account.expires_at : null, account.id_token || null, account.scope || null, account.session_state || null, account.token_type || null, account.userId]
  });
}

async function oauthUpdateTokens(id, tokens) {
  const cols = [];
  const vals = [];
  if (tokens.access_token !== undefined) { cols.push('access_token'); vals.push(tokens.access_token); }
  if (tokens.refresh_token !== undefined) { cols.push('refresh_token'); vals.push(tokens.refresh_token); }
  if (tokens.expires_at !== undefined) { cols.push('expires_at'); vals.push(tokens.expires_at); }
  if (cols.length === 0) return;
  vals.push(id);
  await tursoClient.execute({ sql: 'UPDATE users SET ' + cols.map(function (c) { return c + ' = ?'; }).join(', ') + ' WHERE id = ?', args: vals });
}

async function oauthGetTokensByUserId(id) {
  const result = await tursoClient.execute({ sql: 'SELECT access_token, refresh_token, expires_at, provider FROM users WHERE id = ? LIMIT 1', args: [id] });
  return result.rows && result.rows.length > 0 ? result.rows[0] : null;
}`
    case 'mongodb':
      return `function toMongoId(id) {
  try {
    const ObjectId = require('mongodb').ObjectId;
    return new ObjectId(String(id));
  } catch (_e) {
    return id;
  }
}

async function oauthGetUserById(id) {
  const client = await _mongoClientPromise;
  const db = client.db();
  const user = await db.collection('users').findOne({ _id: toMongoId(id) });
  if (user && user._id != null) user.id = user._id.toString();
  return user;
}

async function oauthGetUserByAccount(provider, providerAccountId) {
  if (!provider || providerAccountId == null) return null;
  const client = await _mongoClientPromise;
  const db = client.db();
  const user = await db.collection('users').findOne({ provider: provider, provider_account_id: String(providerAccountId) });
  if (user && user._id != null) user.id = user._id.toString();
  return user;
}

async function oauthCreateUser(profile) {
  const client = await _mongoClientPromise;
  const db = client.db();
  const doc = {
    name: profile.name != null ? profile.name : null,
    email: profile.email != null ? profile.email : null,
    email_verified: profile.emailVerified != null ? profile.emailVerified : null,
    image: profile.image != null ? profile.image : null,
    role: 'user'
  };
  const result = await db.collection('users').insertOne(doc);
  return Object.assign({}, doc, { id: result.insertedId.toString() });
}

async function oauthUpdateUser(id, partial) {
  const client = await _mongoClientPromise;
  const db = client.db();
  const map = { name: 'name', email: 'email', emailVerified: 'email_verified', image: 'image' };
  const set = {};
  Object.keys(map).forEach(function (k) { if (partial[k] !== undefined) set[map[k]] = partial[k]; });
  if (Object.keys(set).length > 0) {
    await db.collection('users').updateOne({ _id: toMongoId(id) }, { $set: set });
  }
  return await oauthGetUserById(id);
}

async function oauthLinkAccount(account) {
  const client = await _mongoClientPromise;
  const db = client.db();
  const set = {
    provider: account.provider,
    provider_account_id: String(account.providerAccountId),
    provider_type: account.type || null,
    access_token: account.access_token || null,
    refresh_token: account.refresh_token || null,
    expires_at: account.expires_at != null ? account.expires_at : null,
    id_token: account.id_token || null,
    scope: account.scope || null,
    session_state: account.session_state || null,
    token_type: account.token_type || null
  };
  const existing = await db.collection('users').findOne({ _id: toMongoId(account.userId) }, { projection: { email_verified: 1 } });
  if (!existing || existing.email_verified == null) set.email_verified = new Date();
  await db.collection('users').updateOne({ _id: toMongoId(account.userId) }, { $set: set });
}

async function oauthUpdateTokens(id, tokens) {
  const client = await _mongoClientPromise;
  const db = client.db();
  const set = {};
  if (tokens.access_token !== undefined) set.access_token = tokens.access_token;
  if (tokens.refresh_token !== undefined) set.refresh_token = tokens.refresh_token;
  if (tokens.expires_at !== undefined) set.expires_at = tokens.expires_at;
  if (Object.keys(set).length === 0) return;
  await db.collection('users').updateOne({ _id: toMongoId(id) }, { $set: set });
}

async function oauthGetTokensByUserId(id) {
  const client = await _mongoClientPromise;
  const db = client.db();
  return await db.collection('users').findOne({ _id: toMongoId(id) }, { projection: { access_token: 1, refresh_token: 1, expires_at: 1, provider: 1 } });
}`
    case 'firestore':
      return `async function oauthGetUserById(id) {
  const doc = await firestoreDb.collection('users').doc(String(id)).get();
  if (!doc.exists) return null;
  return Object.assign({ id: doc.id }, doc.data());
}

async function oauthGetUserByAccount(provider, providerAccountId) {
  if (!provider || providerAccountId == null) return null;
  const snapshot = await firestoreDb.collection('users').where('provider', '==', provider).where('provider_account_id', '==', String(providerAccountId)).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return Object.assign({ id: doc.id }, doc.data());
}

async function oauthCreateUser(profile) {
  const doc = {
    name: profile.name != null ? profile.name : null,
    email: profile.email != null ? profile.email : null,
    email_verified: profile.emailVerified != null ? profile.emailVerified : null,
    image: profile.image != null ? profile.image : null,
    role: 'user'
  };
  const ref = await firestoreDb.collection('users').add(doc);
  return Object.assign({}, doc, { id: ref.id });
}

async function oauthUpdateUser(id, partial) {
  const map = { name: 'name', email: 'email', emailVerified: 'email_verified', image: 'image' };
  const set = {};
  Object.keys(map).forEach(function (k) { if (partial[k] !== undefined) set[map[k]] = partial[k]; });
  if (Object.keys(set).length > 0) {
    await firestoreDb.collection('users').doc(String(id)).update(set);
  }
  return await oauthGetUserById(id);
}

async function oauthLinkAccount(account) {
  const set = {
    provider: account.provider,
    provider_account_id: String(account.providerAccountId),
    provider_type: account.type || null,
    access_token: account.access_token || null,
    refresh_token: account.refresh_token || null,
    expires_at: account.expires_at != null ? account.expires_at : null,
    id_token: account.id_token || null,
    scope: account.scope || null,
    session_state: account.session_state || null,
    token_type: account.token_type || null
  };
  const existing = await oauthGetUserById(account.userId);
  if (!existing || existing.email_verified == null) set.email_verified = new Date();
  await firestoreDb.collection('users').doc(String(account.userId)).update(set);
}

async function oauthUpdateTokens(id, tokens) {
  const set = {};
  if (tokens.access_token !== undefined) set.access_token = tokens.access_token;
  if (tokens.refresh_token !== undefined) set.refresh_token = tokens.refresh_token;
  if (tokens.expires_at !== undefined) set.expires_at = tokens.expires_at;
  if (Object.keys(set).length === 0) return;
  await firestoreDb.collection('users').doc(String(id)).update(set);
}

async function oauthGetTokensByUserId(id) {
  return await oauthGetUserById(id);
}`
    case 'airtable':
      return `async function oauthGetUserById(id) {
  return new Promise(function (resolve, reject) {
    airtableBase('users').find(String(id), function (err, record) {
      if (err) { resolve(null); return; }
      resolve(Object.assign({ id: record.id }, record.fields));
    });
  });
}

async function oauthGetUserByAccount(provider, providerAccountId) {
  if (!provider || providerAccountId == null) return null;
  return new Promise(function (resolve, reject) {
    airtableBase('users').select({
      filterByFormula: 'AND({provider} = "' + String(provider).replace(/"/g, '\\\\"') + '", {provider_account_id} = "' + String(providerAccountId).replace(/"/g, '\\\\"') + '")',
      maxRecords: 1
    }).firstPage(function (err, records) {
      if (err) { reject(err); return; }
      if (!records || records.length === 0) { resolve(null); return; }
      const rec = records[0];
      resolve(Object.assign({ id: rec.id }, rec.fields));
    });
  });
}

async function oauthCreateUser(profile) {
  return new Promise(function (resolve, reject) {
    const fields = { name: profile.name || '', email: profile.email || '', role: 'user' };
    if (profile.emailVerified != null) fields.email_verified = String(profile.emailVerified);
    if (profile.image != null) fields.image = profile.image;
    airtableBase('users').create([{ fields: fields }], function (err, records) {
      if (err) { reject(err); return; }
      const rec = records[0];
      resolve(Object.assign({ id: rec.id }, rec.fields));
    });
  });
}

async function oauthUpdateUser(id, partial) {
  const map = { name: 'name', email: 'email', emailVerified: 'email_verified', image: 'image' };
  const fields = {};
  Object.keys(map).forEach(function (k) { if (partial[k] !== undefined) fields[map[k]] = partial[k]; });
  if (Object.keys(fields).length === 0) return await oauthGetUserById(id);
  return new Promise(function (resolve, reject) {
    airtableBase('users').update([{ id: String(id), fields: fields }], function (err, records) {
      if (err) { reject(err); return; }
      const rec = records[0];
      resolve(Object.assign({ id: rec.id }, rec.fields));
    });
  });
}

async function oauthLinkAccount(account) {
  const fields = {
    provider: account.provider,
    provider_account_id: String(account.providerAccountId),
    provider_type: account.type || '',
    access_token: account.access_token || '',
    refresh_token: account.refresh_token || '',
    expires_at: account.expires_at != null ? account.expires_at : null,
    id_token: account.id_token || '',
    scope: account.scope || '',
    session_state: account.session_state || '',
    token_type: account.token_type || ''
  };
  return new Promise(function (resolve, reject) {
    airtableBase('users').update([{ id: String(account.userId), fields: fields }], function (err) {
      if (err) { reject(err); return; }
      resolve();
    });
  });
}

async function oauthUpdateTokens(id, tokens) {
  const fields = {};
  if (tokens.access_token !== undefined) fields.access_token = tokens.access_token || '';
  if (tokens.refresh_token !== undefined) fields.refresh_token = tokens.refresh_token || '';
  if (tokens.expires_at !== undefined) fields.expires_at = tokens.expires_at;
  if (Object.keys(fields).length === 0) return;
  return new Promise(function (resolve, reject) {
    airtableBase('users').update([{ id: String(id), fields: fields }], function (err) {
      if (err) { reject(err); return; }
      resolve();
    });
  });
}

async function oauthGetTokensByUserId(id) {
  return await oauthGetUserById(id);
}`
    default:
      return `async function oauthGetUserById() { return null; }
async function oauthGetUserByAccount() { return null; }
async function oauthCreateUser() { return null; }
async function oauthUpdateUser() { return null; }
async function oauthLinkAccount() { return; }
async function oauthUpdateTokens() { return; }
async function oauthGetTokensByUserId() { return null; }`
  }
}

// Only the CredentialsProvider is imported at module scope (it always exists).
// OAuth providers are required lazily inside generateProvidersSetup.
const generateProviderImports = (auth: UIDLAuthentication): string => {
  if (!auth.passwordAuthEnabled) {
    return ''
  }
  return `const CredentialsProvider = require('next-auth/providers/credentials').default || require('next-auth/providers/credentials');`
}

// Resolves the env-var names that hold a provider's client id / secret /
// issuer. Shared by the provider setup AND the refresh-token env map so both
// reference identical keys.
const getProviderEnvKeys = (
  provider: UIDLAuthProvider
): { idKey: string; secretKey: string; issuerKey?: string } => {
  const credKeys = Object.keys(provider.credentials)
  const idKey = credKeys.find((k) => k.endsWith('_ID')) || `AUTH_${provider.id.toUpperCase()}_ID`
  const secretKey =
    credKeys.find((k) => k.endsWith('_SECRET')) || `AUTH_${provider.id.toUpperCase()}_SECRET`
  const issuerKey = credKeys.find(
    (k) => k.endsWith('_ISSUER') || k.endsWith('_DOMAIN') || k.endsWith('_TENANT_ID')
  )
  return { idKey, secretKey, issuerKey }
}

// Builds the `providers` array imperatively. Each OAuth provider is required in
// its own try/catch with a LOCAL binding, so:
//  - there is never a `const <Name>Provider` whose name could be an invalid JS
//    identifier (an id with a hyphen / leading digit would be a syntax error), and
//  - a provider whose module is missing or renamed is SKIPPED instead of
//    throwing at import time and taking down ALL authentication for the project
//    (credentials login + every other provider).
const generateProvidersSetup = (auth: UIDLAuthentication): string => {
  const lines: string[] = ['const providers = [];']

  if (auth.passwordAuthEnabled) {
    lines.push(`providers.push(CredentialsProvider({
  name: 'Credentials',
  credentials: {
    email: { label: 'Email', type: 'email' },
    password: { label: 'Password', type: 'password' }
  },
  async authorize(credentials) {
    if (!credentials || !credentials.email || !credentials.password) {
      return null;
    }
    try {
      const { verifyPassword } = require('./hash-password');
      const user = await findUserByEmail(String(credentials.email));
      if (!user) return null;
      if (!verifyPassword(String(credentials.password), user.password)) return null;
      return sanitizeUser(user);
    } catch (err) {
      console.error('Authorize error:', err);
      return null;
    }
  }
}));`)
  }

  auth.providers.forEach((provider, idx) => {
    const moduleName = PROVIDER_MODULE_OVERRIDES[provider.id] || provider.id
    const { idKey, secretKey, issuerKey } = getProviderEnvKeys(provider)

    const cfg = [
      `      clientId: process.env.${idKey}`,
      `      clientSecret: process.env.${secretKey}`,
    ]
    if (issuerKey) {
      cfg.push(`      issuer: process.env.${issuerKey}`)
    }

    const authParams = PROVIDER_AUTHORIZATION_PARAMS[provider.id]
    if (authParams) {
      const paramsStr = Object.entries(authParams)
        .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
        .join(', ')
      cfg.push(`      authorization: { params: { ${paramsStr} } }`)
    }
    // Auto-link by verified email for trusted providers so the same email
    // across credentials + this provider resolves to one user row.
    if (TRUSTED_EMAIL_VERIFYING_PROVIDERS.has(provider.id)) {
      cfg.push(`      allowDangerousEmailAccountLinking: true`)
    }

    lines.push(`try {
  var __oauth${idx} = require('next-auth/providers/${moduleName}');
  providers.push((__oauth${idx}.default || __oauth${idx})({
${cfg.join(',\n')}
  }));
} catch (__oauthErr${idx}) {
  console.error('OAuth provider "${
    provider.id
  }" is unavailable and was skipped:', __oauthErr${idx} && __oauthErr${idx}.message);
}`)
  })

  return lines.join('\n')
}

// Emits utils/auth/auth-db.js — the single data-access module shared by the
// credentials flow, the OAuth adapter, and the jwt callback. Extracting it
// keeps an acyclic require graph: auth-db (leaf) <- auth-adapter <-
// auth-options; auth-refresh (leaf) <- auth-options.
export const generateAuthDbFile = (
  auth: UIDLAuthentication,
  dataSourceConfig?: Record<string, unknown> | null
): string => {
  const customProps = auth.customUserProperties || []
  const needsOAuthPersistence = auth.providers.length > 0 && !!auth.dataSourceType
  const dbSetupCode = generateDbSetupCode(auth.dataSourceType, dataSourceConfig)
  const sanitizeUserCode = generateSanitizeUserFunction()
  const findUserCode = generateFindUserFunction(auth.dataSourceType, customProps)
  const oauthCode = needsOAuthPersistence
    ? `\n${generateToAdapterUserFunction()}\n\n${generateOAuthDbHelpers(auth.dataSourceType)}\n`
    : ''

  const exportEntries = [
    'sanitizeUser: sanitizeUser',
    'findUserByEmail: findUserByEmail',
    'createUser: createUser',
    'userExistsByEmail: userExistsByEmail',
  ]
  if (needsOAuthPersistence) {
    exportEntries.push(
      'toAdapterUser: toAdapterUser',
      'oauthGetUserById: oauthGetUserById',
      'oauthGetUserByAccount: oauthGetUserByAccount',
      'oauthCreateUser: oauthCreateUser',
      'oauthUpdateUser: oauthUpdateUser',
      'oauthLinkAccount: oauthLinkAccount',
      'oauthUpdateTokens: oauthUpdateTokens',
      'oauthGetTokensByUserId: oauthGetTokensByUserId'
    )
  }

  return `${dbSetupCode}
${sanitizeUserCode}

${findUserCode}
${oauthCode}
module.exports = {
  ${exportEntries.join(',\n  ')}
};
`
}

// Emits utils/auth/auth-adapter.js — a custom NextAuth adapter backed solely by
// the `users` table (no `accounts`/`sessions` tables). Generated only when
// OAuth providers and a data source are configured.
export const generateAuthAdapterFile = (): string => {
  return `const authDb = require('./auth-db');

// Custom NextAuth Adapter over a single \`users\` table. NextAuth does not
// require an \`accounts\`/\`sessions\` table — only this set of functions. OAuth
// provider linkage + tokens live in columns on the user row (linkAccount is an
// UPDATE, not an INSERT into a child table). Trade-off: one provider linkage
// per user — sufficient for sign-in, and combined with
// allowDangerousEmailAccountLinking the same email always resolves to one row.
// The session/verification-token methods are never invoked under the JWT
// session strategy (and no email provider is configured); they are safe no-ops
// to satisfy the adapter contract.
function createAuthAdapter() {
  return {
    async createUser(user) {
      const row = await authDb.oauthCreateUser({
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image
      });
      return authDb.toAdapterUser(row);
    },
    async getUser(id) {
      const row = await authDb.oauthGetUserById(id);
      return authDb.toAdapterUser(row);
    },
    async getUserByEmail(email) {
      if (!email) return null;
      const row = await authDb.findUserByEmail(String(email));
      return authDb.toAdapterUser(row);
    },
    async getUserByAccount(params) {
      const row = await authDb.oauthGetUserByAccount(params.provider, params.providerAccountId);
      return authDb.toAdapterUser(row);
    },
    async updateUser(user) {
      const row = await authDb.oauthUpdateUser(user.id, user);
      return authDb.toAdapterUser(row);
    },
    async linkAccount(account) {
      await authDb.oauthLinkAccount(account);
      return account;
    },
    async unlinkAccount() { return; },
    async createSession(session) { return session; },
    async getSessionAndUser() { return null; },
    async updateSession() { return null; },
    async deleteSession() { return; },
    async createVerificationToken(token) { return token; },
    async useVerificationToken() { return null; },
    async deleteUser() { return; }
  };
}

module.exports = createAuthAdapter;
`
}

// Emits utils/auth/auth-refresh.js — OAuth refresh-token rotation. Pure (no DB
// or adapter deps) so it is a leaf of the require graph. Generated only when
// OAuth providers + a data source are configured.
export const generateAuthRefreshFile = (): string => {
  return `// Token endpoints for refresh-token rotation. Only providers with a stable,
// well-known token endpoint are listed; others skip refresh (the rolling
// session JWT keeps the user logged in regardless of provider-token expiry).
const OAUTH_TOKEN_ENDPOINTS = {
  google: 'https://oauth2.googleapis.com/token',
  github: 'https://github.com/login/oauth/access_token',
  gitlab: 'https://gitlab.com/oauth/token',
  facebook: 'https://graph.facebook.com/v18.0/oauth/access_token',
  discord: 'https://discord.com/api/oauth2/token',
  spotify: 'https://accounts.spotify.com/api/token',
  twitch: 'https://id.twitch.tv/oauth2/token',
  reddit: 'https://www.reddit.com/api/v1/access_token',
  linkedin: 'https://www.linkedin.com/oauth/v2/accessToken',
  slack: 'https://slack.com/api/oauth.v2.access'
};

// Exchange a refresh token for a fresh access token. Returns
// { access_token, expires_at (absolute UNIX seconds), refresh_token? } or null.
// NEVER throws — the caller keeps the user signed in regardless of the result.
async function refreshAccessToken(provider, refreshToken, clientId, clientSecret) {
  try {
    const endpoint = OAUTH_TOKEN_ENDPOINTS[provider];
    if (!endpoint || !refreshToken) return null;
    const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
    if (clientId) body.set('client_id', clientId);
    if (clientSecret) body.set('client_secret', clientSecret);
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString()
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.access_token) return null;
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : parseInt(data.expires_in, 10);
    return {
      access_token: data.access_token,
      expires_at: !isNaN(expiresIn) ? Math.floor(Date.now() / 1000) + expiresIn : undefined,
      refresh_token: data.refresh_token || undefined
    };
  } catch (e) {
    return null;
  }
}

module.exports = { refreshAccessToken: refreshAccessToken, OAUTH_TOKEN_ENDPOINTS: OAUTH_TOKEN_ENDPOINTS };
`
}

export const generateAuthOptionsFile = (
  auth: UIDLAuthentication,
  // dataSourceConfig is consumed by generateAuthDbFile (the DB setup now lives
  // in auth-db.js); kept here so the public call signature stays stable.
  _dataSourceConfig?: Record<string, unknown> | null
): string => {
  const needsOAuthPersistence = auth.providers.length > 0 && !!auth.dataSourceType
  const providerImports = generateProviderImports(auth)
  const providersSetup = generateProvidersSetup(auth)
  const signInRoute = auth.authPages.signIn?.route || '/auth/sign-in'

  const requireLines = [
    `const authDb = require('./auth-db');`,
    `const sanitizeUser = authDb.sanitizeUser;`,
    `const findUserByEmail = authDb.findUserByEmail;`,
  ]
  if (needsOAuthPersistence) {
    requireLines.push(
      `const createAuthAdapter = require('./auth-adapter');`,
      `const refreshAccessToken = require('./auth-refresh').refreshAccessToken;`,
      `const oauthUpdateTokens = authDb.oauthUpdateTokens;`,
      `const oauthGetTokensByUserId = authDb.oauthGetTokensByUserId;`
    )
  }

  let providerEnvMap = ''
  if (needsOAuthPersistence) {
    const entries = auth.providers.map((p) => {
      const { idKey, secretKey } = getProviderEnvKeys(p)
      return `  ${JSON.stringify(p.id)}: { id: ${JSON.stringify(idKey)}, secret: ${JSON.stringify(
        secretKey
      )} }`
    })
    providerEnvMap = `\nconst OAUTH_PROVIDER_ENV = {\n${entries.join(',\n')}\n};\n`
  }

  const jwtCallback = needsOAuthPersistence
    ? `    async jwt(params) {
      const token = params.token;
      const user = params.user;
      const account = params.account;
      if (user) {
        // Sign-in: seed the token from the freshly-authorized user.
        const keys = Object.keys(user);
        for (let i = 0; i < keys.length; i++) {
          token[keys[i]] = user[keys[i]];
        }
        if (token.id == null && token.sub != null) token.id = token.sub;
        // OAuth sign-in: capture provider tokens for refresh rotation and keep
        // the persisted row fresh (NextAuth only calls linkAccount on the FIRST
        // link). Credentials sign-in has no \`account\`. Best-effort.
        if (account && account.provider && account.type !== 'credentials') {
          token.provider = account.provider;
          if (account.access_token !== undefined) token.access_token = account.access_token;
          if (account.refresh_token !== undefined) token.refresh_token = account.refresh_token;
          if (account.expires_at != null) token.expires_at = account.expires_at;
          try {
            if (token.id != null) {
              await oauthUpdateTokens(token.id, {
                access_token: account.access_token,
                refresh_token: account.refresh_token,
                expires_at: account.expires_at
              });
            }
          } catch (e) {}
        }
        return token;
      }
      // Subsequent calls: re-read the user so profile edits propagate into the
      // session. sanitizeUser strips the token columns, so they never enter the
      // token from this DB read — tokens live in the token only via the capture
      // above and the refresh below.
      try {
        if (token && token.email) {
          const fresh = await findUserByEmail(String(token.email));
          const safe = fresh ? sanitizeUser(fresh) : null;
          if (safe && typeof safe === 'object') {
            const fk = Object.keys(safe);
            for (let i = 0; i < fk.length; i++) {
              token[fk[i]] = safe[fk[i]];
            }
          }
        }
      } catch (e) {
        // Keep the existing token on any DB hiccup — never sign the user out.
      }
      if (token.id == null && token.sub != null) token.id = token.sub;
      // OAuth access-token refresh rotation: only when expired AND a refresh
      // token is available. Failure NEVER signs the user out — the rolling
      // session JWT is the source of truth for being logged in.
      try {
        if (token.provider && token.expires_at && Math.floor(Date.now() / 1000) >= Number(token.expires_at)) {
          let refreshToken = token.refresh_token;
          if (!refreshToken && token.id != null) {
            const stored = await oauthGetTokensByUserId(token.id);
            if (stored && stored.refresh_token) refreshToken = stored.refresh_token;
          }
          if (refreshToken) {
            const envKeys = OAUTH_PROVIDER_ENV[token.provider];
            const clientId = envKeys && envKeys.id ? process.env[envKeys.id] : undefined;
            const clientSecret = envKeys && envKeys.secret ? process.env[envKeys.secret] : undefined;
            const refreshed = await refreshAccessToken(token.provider, refreshToken, clientId, clientSecret);
            if (refreshed && refreshed.access_token) {
              token.access_token = refreshed.access_token;
              if (refreshed.expires_at != null) token.expires_at = refreshed.expires_at;
              if (refreshed.refresh_token) token.refresh_token = refreshed.refresh_token;
              if (token.id != null) {
                try {
                  await oauthUpdateTokens(token.id, {
                    access_token: token.access_token,
                    refresh_token: token.refresh_token,
                    expires_at: token.expires_at
                  });
                } catch (e) {}
              }
            }
          }
        }
      } catch (e) {}
      return token;
    },`
    : `    async jwt(params) {
      const token = params.token;
      const user = params.user;
      if (user) {
        // Login: seed the token from the freshly-authorized user.
        const keys = Object.keys(user);
        for (let i = 0; i < keys.length; i++) {
          token[keys[i]] = user[keys[i]];
        }
        return token;
      }
      // Subsequent calls (every /api/auth/session): re-read the user from the
      // database so profile edits — name, image, role, etc. — propagate into the
      // session. The JWT is otherwise a snapshot captured at login, which is why
      // the navbar avatar/name reverted to the old value after a refresh: the
      // navbar reads /api/auth/session, which is derived from this token.
      try {
        if (token && token.email && typeof findUserByEmail === 'function') {
          const fresh = await findUserByEmail(String(token.email));
          const safe = fresh && typeof sanitizeUser === 'function' ? sanitizeUser(fresh) : null;
          if (safe && typeof safe === 'object') {
            const fk = Object.keys(safe);
            for (let i = 0; i < fk.length; i++) {
              token[fk[i]] = safe[fk[i]];
            }
          }
        }
      } catch (e) {
        // Keep the existing token on any DB hiccup — never sign the user out.
      }
      return token;
    },`

  const sessionSkip = needsOAuthPersistence
    ? `{ iat: 1, exp: 1, jti: 1, sub: 1, access_token: 1, refresh_token: 1, expires_at: 1, id_token: 1, session_state: 1, token_type: 1, scope: 1, provider_account_id: 1, provider_type: 1 }`
    : `{ iat: 1, exp: 1, jti: 1, sub: 1 }`

  const adapterLine = needsOAuthPersistence ? `  adapter: createAuthAdapter(),\n` : ''

  return `${providerImports}
${requireLines.join('\n')}
${providerEnvMap}
${providersSetup}

const authOptions = {
${adapterLine}  providers: providers,
  pages: {
    signIn: '${signInRoute}',
  },
  callbacks: {
${jwtCallback}
    async session(params) {
      const session = params.session;
      const token = params.token;
      if (token && session.user) {
        const skip = ${sessionSkip};
        const keys = Object.keys(token);
        for (let i = 0; i < keys.length; i++) {
          if (!skip[keys[i]]) {
            session.user[keys[i]] = token[keys[i]];
          }
        }
      }
      return session;
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: 86400,
    updateAge: 3600,
  },
  secret: process.env.NEXTAUTH_SECRET,
};

module.exports = authOptions;
module.exports.sanitizeUser = authDb.sanitizeUser;
module.exports.findUserByEmail = authDb.findUserByEmail;
module.exports.createUser = authDb.createUser;
module.exports.userExistsByEmail = authDb.userExistsByEmail;
`
}

export const generateHashPasswordFile = (): string => {
  return `const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const PEPPER = process.env.AUTH_PEPPER || '';
const COST_FACTOR = 12;

function prepare(password) {
  const str = String(password);
  if (str.length > 1000) {
    throw new Error('Password exceeds maximum length');
  }
  const sha = crypto.createHash('sha256').update(str + PEPPER).digest('base64');
  return sha;
}

function hashPassword(password) {
  return bcrypt.hashSync(prepare(password), COST_FACTOR);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(prepare(password), hash);
}

module.exports = hashPassword;
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
`
}

export const generateNextAuthRouteFile = (): string => {
  return `let NextAuth = require('next-auth');
if (NextAuth.default) NextAuth = NextAuth.default;
const authOptions = require('../../../utils/auth/auth-options');

const authHandler = NextAuth(authOptions);

// NextAuth builds OAuth callback / redirect URLs from process.env.NEXTAUTH_URL.
// At build time the real deployment domain is unknown, so the generated .env
// ships a localhost default. Derive the correct origin from the incoming
// request here so OAuth works on whatever domain the project is published to —
// WITHOUT hardcoding it. An explicitly-configured (non-local) NEXTAUTH_URL is
// always respected; local dev (host = localhost) is left untouched.
module.exports = function nextAuthRoute(req, res) {
  try {
    const fwdHost = req.headers['x-forwarded-host'] || req.headers.host || '';
    const host = Array.isArray(fwdHost) ? fwdHost[0] : fwdHost;
    const hostIsLocal = host.indexOf('localhost') === 0 || host.indexOf('127.0.0.1') === 0;
    const current = process.env.NEXTAUTH_URL || '';
    const currentIsLocalOrEmpty =
      !current || current.indexOf('localhost') !== -1 || current.indexOf('127.0.0.1') !== -1;
    if (host && !hostIsLocal && currentIsLocalOrEmpty) {
      const fwdProto = req.headers['x-forwarded-proto'];
      const proto = (Array.isArray(fwdProto) ? fwdProto[0] : fwdProto) || 'https';
      process.env.NEXTAUTH_URL = proto + '://' + host;
    }
  } catch (e) {
    /* fall back to the configured NEXTAUTH_URL */
  }
  return authHandler(req, res);
};
`
}

export const generateSignupRouteFile = (auth: UIDLAuthentication): string => {
  const needsDb = !!auth.dataSourceType
  let dbImport = ''
  let createUserCall = ''

  if (needsDb) {
    dbImport = `const authUtils = require('../../../utils/auth/auth-options');
const createUser = authUtils.createUser;
const userExistsByEmail = authUtils.userExistsByEmail;
const sanitizeUser = authUtils.sanitizeUser;`
    createUserCall = `    const exists = await userExistsByEmail(email);
    if (exists) {
      res.status(409).json({ error: 'User with this email already exists' });
      return;
    }

    const userData = {
      name: name || null,
      email: email,
      password: hashedPassword,
      role: 'user',
    };
    const reservedKeys = { email: 1, password: 1, name: 1, role: 1 };
    const bodyKeys = Object.keys(body);
    for (let i = 0; i < bodyKeys.length; i++) {
      if (!reservedKeys[bodyKeys[i]]) {
        userData[bodyKeys[i]] = body[bodyKeys[i]];
      }
    }

    const newUser = await createUser(userData);

    if (!newUser) {
      res.status(500).json({ error: 'Failed to create user' });
      return;
    }

    res.status(201).json({ user: sanitizeUser(newUser) });`
  } else {
    createUserCall = `    res.status(501).json({ error: 'No data source configured for user storage' });`
  }

  return `const hashPassword = require('../../../utils/auth/hash-password');
${dbImport}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const email = body.email;
    const password = body.password;
    const name = body.name;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    if (password.length > 128) {
      res.status(400).json({ error: 'Password must not exceed 128 characters' });
      return;
    }

    const hashedPassword = hashPassword(password);

${createUserCall}
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
`
}

// A page is "self-guarded by SQL" when its UIDL carries row-owner
// metadata (rowOwnerColumn, etc.) AND it does not require a specific
// role. The page's emitted page-load workflow runs a SQL query whose
// WHERE clause filters by the active user_id OR the persistent
// anonymous-localStorage UUID, so the framework-level middleware
// would otherwise pre-empt the SQL and bounce guest buyers to
// `/sign-in` before they ever reach the order they just paid for.
// Role-gated pages are different: role membership is an absolute
// gate that the SQL cannot reproduce, so those keep the middleware
// protection regardless of row ownership.
const isRowOwnedSelfGuardedPage = (
  protection: { rowOwnerColumn?: string; allowedRoles?: string[] } | undefined
): boolean => {
  if (!protection || !protection.rowOwnerColumn) {
    return false
  }
  const roles = protection.allowedRoles || []
  return roles.length === 0
}

export const generateMiddlewareFile = (auth: UIDLAuthentication): string => {
  const protectedRoutes: Record<string, { requiresAuth: boolean; allowedRoles: string[] }> = {}

  if (auth.pageProtection) {
    for (const protection of Object.values(auth.pageProtection) as any[]) {
      if (isRowOwnedSelfGuardedPage(protection)) {
        continue
      }
      protectedRoutes[protection.route] = {
        requiresAuth: protection.requiresAuth,
        allowedRoles: protection.allowedRoles || [],
      }
    }
  }

  if (auth.folderProtection) {
    for (const folderProt of Object.values(auth.folderProtection) as any[]) {
      if (folderProt.children) {
        for (const [childId, childType] of Object.entries(folderProt.children)) {
          if (childType === 'page') {
            const pageProt = auth.pageProtection?.[childId] as any
            if (pageProt) {
              // Folder-wide role gating still applies, but only when the
              // folder actually contributes allowedRoles. For a
              // role-less folder (a generic "logged-in only" folder),
              // a row-owned page inside it stays self-guarded.
              const folderRoles = folderProt.allowedRoles || []
              if (isRowOwnedSelfGuardedPage(pageProt) && folderRoles.length === 0) {
                continue
              }
              const existingRoles = protectedRoutes[pageProt.route]?.allowedRoles || []
              const mergedRoles = Array.from(new Set([...existingRoles, ...folderRoles]))
              protectedRoutes[pageProt.route] = {
                requiresAuth: true,
                allowedRoles: mergedRoles,
              }
            }
          }
        }
      }
    }
  }

  const authRoutes: string[] = []
  if (auth.authPages.signIn) {
    authRoutes.push(auth.authPages.signIn.route)
  }
  if (auth.authPages.signUp) {
    authRoutes.push(auth.authPages.signUp.route)
  }

  for (const route of authRoutes) {
    delete protectedRoutes[route]
  }

  let sawAdminRoute = false
  let adminRoles: string[] = ['admin']
  for (const k of Object.keys(protectedRoutes)) {
    if (k === '/admin' || k.indexOf('/admin/') === 0) {
      sawAdminRoute = true
      const ar = protectedRoutes[k]?.allowedRoles
      if (ar && ar.length > 0) {
        adminRoles = ar
        break
      }
    }
  }
  if (sawAdminRoute && !protectedRoutes['/admin']) {
    protectedRoutes['/admin'] = { requiresAuth: true, allowedRoles: adminRoles }
  }

  const protectedRoutesJson = JSON.stringify(protectedRoutes, null, 2)
  const authRoutesJson = JSON.stringify(authRoutes)
  const signInRoute = auth.authPages.signIn?.route || '/auth/sign-in'

  return `import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const protectedRoutes = ${protectedRoutesJson};

const authRoutes = ${authRoutesJson};

function getUserRoleFromToken(token) {
  if (!token || typeof token !== 'object') return null;
  var r = token.role;
  if (r != null && typeof r === 'string') return r;
  if (token.roleName != null && typeof token.roleName === 'string') return token.roleName;
  if (Array.isArray(token.roles) && token.roles.length > 0 && typeof token.roles[0] === 'string') {
    return token.roles[0];
  }
  return null;
}

// Reads a single cookie value, tolerating both the Next 12 string shape and the
// newer { name, value } object shape returned by request.cookies.get().
function readCookie(request, name) {
  try {
    var c = request.cookies.get(name);
    if (!c) return null;
    return typeof c === 'string' ? c : (c.value || null);
  } catch (e) {
    return null;
  }
}

// next-auth stores the session token under a secure-prefixed cookie on https
// and a plain one on http, and splits large JWTs into ".0"/".1" chunks. The
// Edge runtime's getToken() can return null for a session the Node runtime
// considers valid (e.g. NEXTAUTH_SECRET not identical in the Edge runtime, or
// the JWE simply failing to decode at the edge), which previously redirected
// logged-in users to sign-in. So cookie PRESENCE is the source of truth for
// "is there a session"; getToken is only trusted for the optional role check.
// Server-side (getServerSideProps / API routes) remain the authoritative
// validators of the session and role.
function hasSessionCookie(request) {
  var names = [
    '__Secure-next-auth.session-token',
    'next-auth.session-token',
    '__Secure-authjs.session-token',
    'authjs.session-token'
  ];
  for (var i = 0; i < names.length; i++) {
    if (readCookie(request, names[i]) || readCookie(request, names[i] + '.0')) {
      return true;
    }
  }
  return false;
}

async function middleware(request) {
  const pathname = request.nextUrl.pathname;

  for (let i = 0; i < authRoutes.length; i++) {
    if (pathname.startsWith(authRoutes[i])) {
      return NextResponse.next();
    }
  }

  if (pathname === '/auth' || pathname.startsWith('/auth/')) {
    return NextResponse.next();
  }

  let matchedProtection = null;
  const routes = Object.keys(protectedRoutes).sort(function(a, b) {
    return b.length - a.length;
  });
  for (let r = 0; r < routes.length; r++) {
    if (pathname === routes[r] || pathname.startsWith(routes[r] + '/')) {
      matchedProtection = protectedRoutes[routes[r]];
      break;
    }
  }

  if (!matchedProtection) {
    return NextResponse.next();
  }

  // Resolve the current user for this request. Fast path: decode the session JWT
  // at the edge with getToken. That can return null in the Edge runtime even for
  // a valid session (NEXTAUTH_SECRET not identical/available in the Edge runtime,
  // or the JWE simply failing to decode there) — which previously redirected
  // logged-in users to sign-in. When getToken yields nothing but a session
  // cookie IS present, fall back to the Node /api/auth/session endpoint, which is
  // authoritative. This keeps BOTH the auth gate AND role enforcement correct
  // regardless of the edge quirk (no role checks are silently skipped).
  var sessionUser = null;
  var secret = process.env.NEXTAUTH_SECRET;
  if (secret) {
    try {
      sessionUser = await getToken({ req: request, secret: secret });
    } catch (e) {
      sessionUser = null;
    }
  }

  if (!sessionUser && hasSessionCookie(request)) {
    try {
      var sessionRes = await fetch(new URL('/api/auth/session', request.url).toString(), {
        headers: { cookie: request.headers.get('cookie') || '' },
      });
      if (sessionRes.ok) {
        var sessionJson = await sessionRes.json();
        if (sessionJson && sessionJson.user) {
          sessionUser = sessionJson.user;
        }
      }
    } catch (e) {}
  }

  if (matchedProtection.requiresAuth && !sessionUser) {
    var signInUrl = new URL('${signInRoute}', request.url);
    signInUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(signInUrl);
  }

  // Role enforcement uses whichever source resolved the user (decoded JWT or the
  // authoritative session endpoint), so admin/role gates are NEVER silently
  // bypassed when getToken fails at the edge.
  var allowedRoles = matchedProtection.allowedRoles || [];
  if (allowedRoles.length > 0) {
    if (!sessionUser) {
      var signInUrl2 = new URL('${signInRoute}', request.url);
      signInUrl2.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(signInUrl2);
    }
    var userRole = getUserRoleFromToken(sessionUser);
    if (userRole == null || allowedRoles.indexOf(userRole) < 0) {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  return NextResponse.next();
}

export default middleware;
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon\\\\.ico).*)'],
};
`
}

export const generateSessionProviderWrapper = (): string => {
  // Authored as pure ESM. _app.js imports this with an ESM default import
  // (`import AuthSessionProvider from '.../session-provider'`). When the file
  // was CommonJS (`module.exports = AuthSessionProvider` + `require('react')`),
  // SWC's CJS->ESM-default interop on a module with no `__esModule` marker
  // could resolve the default binding/factory to `undefined` after production
  // chunk-splitting on Vercel, throwing "Cannot read properties of undefined
  // (reading 'call')" at the root of every page (dev served it unminified so
  // it worked locally). Keeping a single, consistent module system removes the
  // fragile boundary. `SessionProvider` is imported by name (the SWC-safe form
  // even though next-auth/react ships CommonJS).
  return `import React from 'react'
import { SessionProvider, signIn, signOut } from 'next-auth/react'

// Bridge for the workflow account handlers (account-login / -logout / -signup /
// -social-login). Those handlers are emitted via fn.toString() and re-bundled
// inside the generated project, so a sync \`require('next-auth/react')\` inside
// them resolved to a SEPARATE module instance from this ESM import — and SWC
// production chunk-splitting could leave that copy in a chunk never loaded on
// the auth page, a dangling reference that threw "Cannot read properties of
// undefined (reading 'call')" the moment Sign In ran. This module is rendered
// in _app on every page, so publishing signIn/signOut here (from the SAME ESM
// next-auth/react that is reliably bundled into the app shell) guarantees the
// handlers can read them off \`window\` without any fragile require/import of
// their own. The assignment runs at module-eval time, before any click.
if (typeof window !== 'undefined') {
  window.__teleportNextAuth = { signIn: signIn, signOut: signOut }
}

export default function AuthSessionProvider(props) {
  return React.createElement(
    SessionProvider,
    { session: props.pageProps && props.pageProps.session ? props.pageProps.session : undefined },
    props.children
  )
}
`
}
