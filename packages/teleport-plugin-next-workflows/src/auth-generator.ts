import {
  UIDLAuthentication,
  UIDLAuthTableColumn,
  UIDLCustomUserProperty,
  DataSourceType,
} from '@teleporthq/teleport-types'
import {
  SUPPORTED_EMAIL_PROVIDERS,
  generateProviderSendFunction,
  generateFillTemplateFn,
  WELCOME_EMAIL_CONFIG_KEYS,
} from './transactional-email-code'

// GUI provider id → the actual next-auth v4 provider MODULE name, for the few
// cases where they differ. Everything else uses the id as the module name.
// (Providers next-auth v4 cannot supply are not offered by the GUI; if one
// ever slips through, generateProvidersSetup skips it gracefully.)
const PROVIDER_MODULE_OVERRIDES: Record<string, string> = {
  boxyhq: 'boxyhq-saml',
  duende: 'duende-identity-server6',
  identityserver4: 'identity-server4',
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

/**
 * How long (ms) a JWT may serve the profile fields it already carries before
 * the next session request re-reads the `users` row. See the generated
 * comment in `generateAuthOptionsFile` for the measurements behind it.
 */
export const USER_REFRESH_INTERVAL_MS = 60000

/**
 * Profile fields the session may always carry, even for a UIDL that ships no
 * `users` schema at all.
 *
 * `id`/`name`/`email`/`image`/`role` are the fields the `account-get-current`
 * output contract declares (workflow-schema's node-context-schemas), i.e. the
 * ones every workflow and binding addresses. `roleName`/`roles` are the two
 * alternate spellings `getUserRoleFromToken` in the generated middleware falls
 * back to, so dropping them would silently disable role-based route protection
 * for projects that use them.
 */
export const SESSION_SAFE_USER_FIELDS: readonly string[] = [
  'id',
  'name',
  'email',
  'image',
  'role',
  'roleName',
  'roles',
]

/**
 * Credentials that must never leave the server, whatever the `users` table
 * happens to declare: the OAuth single-table adapter's provider tokens plus the
 * password hash. `findUserByEmail` does `SELECT *`, so without this list they
 * ride the JWT into `session.user` and become readable by any script on the
 * page through /api/auth/session.
 *
 * Denied unconditionally, so a custom user property whose key collides with one
 * of these names cannot re-open the hole. `provider` itself is NOT here — it is
 * just the provider's name ("google"), and `account-social-login` declares it
 * as part of its output contract.
 */
export const SENSITIVE_USER_FIELDS: readonly string[] = [
  'password',
  'password_hash',
  'passwordHash',
  'access_token',
  'refresh_token',
  'id_token',
  'expires_at',
  'session_state',
  'scope',
  'token_type',
  'provider_account_id',
  'provider_type',
]

/**
 * Mongo's primary key. NOT a secret — it is excluded because `sanitizeUser`
 * already folds it into `id` (`rawId = user.id != null ? user.id : user._id`),
 * so passing it through as well would put the same value on the session twice
 * under two different names. A shape concern, not a security one, which is why
 * it is kept out of `SENSITIVE_USER_FIELDS`.
 */
const ID_ALIAS_FIELD = '_id'

/**
 * The exact set of `users` columns this project allows into the session.
 *
 * Derived from the DECLARED schema (`auth.tables.users`), which the GUI
 * composes as the canonical auth columns PLUS one column per custom account
 * property — so every property the user configured is included by
 * construction, while a column that exists in the database but not in the UIDL
 * never is. `customUserProperties` is unioned in directly rather than relied on
 * transitively, so the list stays complete for a UIDL that carries the
 * properties without a matching `tables` entry.
 */
export const buildSessionUserFields = (
  tables: Record<string, UIDLAuthTableColumn[]> | undefined,
  customProps: UIDLCustomUserProperty[]
): string[] => {
  const declared = (tables?.users || []).map((column) => column.name)
  const custom = customProps.map((prop) => prop.key)
  const denied = new Set<string>(SENSITIVE_USER_FIELDS)

  return Array.from(new Set([...SESSION_SAFE_USER_FIELDS, ...declared, ...custom])).filter(
    (field) => Boolean(field) && field !== ID_ALIAS_FIELD && !denied.has(field)
  )
}

const generateSanitizeUserFunction = (
  tables: Record<string, UIDLAuthTableColumn[]> | undefined,
  customProps: UIDLCustomUserProperty[]
): string => {
  // ALLOW-list, not a deny-list. `sanitizeUser` feeds the JWT, and the session
  // callback copies the whole token onto `session.user`, so every column the
  // `SELECT *` returned used to be readable by any script on the page. A
  // two-entry deny-list (`password`, `_id`) could never keep up with a table
  // whose shape the project controls; enumerating what the project actually
  // DECLARED is the version that stays correct as columns are added.
  //
  // Preserve the native type of the id (integer vs UUID-string) — NextAuth
  // will JSON-serialize the session payload either way. Coercing with
  // \`String(rawId)\` would silently turn an integer PK into "1" and make
  // runtime comparisons against a DB-fetched \`user.id\` (still a number
  // on pages that read the row via \`getStaticProps\`) always false.
  return `// The only \`users\` columns that may reach the browser: this project's declared
// user schema — canonical profile columns plus every custom account property —
// minus the credentials (password hash, OAuth access/refresh/id tokens), which
// stay server-side. Anything else the row carries never reaches the session.
const SESSION_USER_FIELDS = ${JSON.stringify(buildSessionUserFields(tables, customProps))};

function sanitizeUser(user) {
  if (!user) return null;
  const safe = {};
  for (let i = 0; i < SESSION_USER_FIELDS.length; i++) {
    const key = SESSION_USER_FIELDS[i];
    if (user[key] !== undefined) {
      safe[key] = user[key];
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

// Only the CredentialsProvider is imported at module scope (it always exists).
// OAuth providers are required lazily inside generateProvidersSetup.
const generateProviderImports = (auth: UIDLAuthentication): string => {
  if (!auth.passwordAuthEnabled) {
    return ''
  }
  return `const CredentialsProvider = require('next-auth/providers/credentials').default || require('next-auth/providers/credentials');`
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
  // Every failure used to \`return null\`, which NextAuth reports as the single
  // opaque code \`CredentialsSignin\` — the same answer for a wrong password, an
  // unknown email, and a database the app cannot reach. Project a62338f9 shipped
  // with a DB credential Postgres rejected, and the only thing the user (or the
  // sign-in form) ever saw was "credentialsSignin".
  //
  // NextAuth v4 surfaces a THROWN error's message as the \`error\` value, so each
  // cause now gets its own code. \`describeAuthError\` in
  // utils/auth/auth-error-messages turns them into copy; the raw cause is logged
  // server-side only.
  //
  // Unknown email and wrong password deliberately share one code: telling them
  // apart is a user-enumeration oracle.
  async authorize(credentials) {
    if (!credentials || !credentials.email || !credentials.password) {
      throw new Error('MissingCredentials');
    }
    const { verifyPassword } = require('./hash-password');
    const { classifyAuthInfrastructureError } = require('./db-health');
    let user;
    try {
      user = await findUserByEmail(String(credentials.email));
    } catch (err) {
      const kind = classifyAuthInfrastructureError(err);
      console.error('[auth] Could not reach the user store (' + kind + '):', err && err.message ? err.message : err);
      throw new Error('ServiceUnavailable');
    }
    try {
      if (!user) throw new Error('InvalidCredentials');
      if (!verifyPassword(String(credentials.password), user.password)) {
        throw new Error('InvalidCredentials');
      }
      return sanitizeUser(user);
    } catch (err) {
      if (err && err.message === 'InvalidCredentials') throw err;
      // A hashing/serialisation fault is an infrastructure problem, not a
      // wrong password — saying "check your details" would send the user
      // round in circles.
      console.error('[auth] Credential check failed:', err && err.message ? err.message : err);
      throw new Error('ServiceUnavailable');
    }
  }
}));`)
  }

  auth.providers.forEach((provider, idx) => {
    const moduleName = PROVIDER_MODULE_OVERRIDES[provider.id] || provider.id
    const credKeys = Object.keys(provider.credentials)
    const idKey = credKeys.find((k) => k.endsWith('_ID')) || `AUTH_${provider.id.toUpperCase()}_ID`
    const secretKey =
      credKeys.find((k) => k.endsWith('_SECRET')) || `AUTH_${provider.id.toUpperCase()}_SECRET`
    const issuerKey = credKeys.find(
      (k) => k.endsWith('_ISSUER') || k.endsWith('_DOMAIN') || k.endsWith('_TENANT_ID')
    )

    const cfg = [
      `      clientId: process.env.${idKey}`,
      `      clientSecret: process.env.${secretKey}`,
    ]
    if (issuerKey) {
      cfg.push(`      issuer: process.env.${issuerKey}`)
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

export const generateAuthOptionsFile = (
  auth: UIDLAuthentication,
  dataSourceConfig?: Record<string, unknown> | null
): string => {
  const customProps = auth.customUserProperties || []
  const dbSetupCode = generateDbSetupCode(auth.dataSourceType, dataSourceConfig)
  const providerImports = generateProviderImports(auth)
  const providersSetup = generateProvidersSetup(auth)
  const findUserCode = auth.passwordAuthEnabled
    ? generateFindUserFunction(auth.dataSourceType, customProps)
    : ''
  const sanitizeUserCode = generateSanitizeUserFunction(auth.tables, customProps)
  const signInRoute = auth.authPages.signIn?.route || '/auth/sign-in'

  return `${providerImports}
${dbSetupCode}
${sanitizeUserCode}

${findUserCode}

${providersSetup}

// How long a JWT may serve profile fields before the next /api/auth/session
// request re-reads the \`users\` row. \`strategy: 'jwt'\` exists precisely so a
// session costs no database round trip; refreshing on EVERY request threw that
// away — each one opened a fresh unpooled pg connection (TCP + TLS handshake)
// for a single indexed SELECT, which measured ~715ms of the ~925ms that
// /api/auth/session took on a published Vercel deployment, against ~210ms for
// the same route when the token carried no email. Profile edits still land
// immediately whenever the app calls \`useSession().update()\` (NextAuth passes
// \`trigger === 'update'\`, which bypasses the interval); the interval is the
// backstop for changes made outside this browser, e.g. an admin editing a role.
const USER_REFRESH_INTERVAL_MS = ${USER_REFRESH_INTERVAL_MS};

// Bookkeeping the refresh policy writes onto the token. It must never be copied
// onto \`session.user\` — it is not a profile field, and leaking it would put an
// internal timestamp on every binding that enumerates the user object.
const TOKEN_REFRESH_STAMP = '__userRefreshedAt';

const authOptions = {
  providers: providers,
  pages: {
    signIn: '${signInRoute}',
  },
  callbacks: {
    async jwt(params) {
      const token = params.token;
      const user = params.user;
      if (user) {
        // Login: seed the token from the freshly-authorized user.
        const keys = Object.keys(user);
        for (let i = 0; i < keys.length; i++) {
          token[keys[i]] = user[keys[i]];
        }
        // Deliberately NOT stamped. An OAuth \`user\` is the PROVIDER's profile
        // (id/name/email/image) — it carries no \`role\`, which only exists on
        // the \`users\` row. Stamping here would make the first session request
        // after an OAuth sign-in skip the database and leave the visitor
        // role-less for a whole interval, silently failing role-protected
        // routes. Leaving it unstamped means the next session request refreshes
        // exactly as it does today, and the interval applies from there on.
        return token;
      }
      // Subsequent calls (every /api/auth/session): re-read the user from the
      // database so profile edits — name, image, role, etc. — propagate into the
      // session. The JWT is otherwise a snapshot captured at login, which is why
      // the navbar avatar/name reverted to the old value after a refresh: the
      // navbar reads /api/auth/session, which is derived from this token.
      //
      // Rate-limited to USER_REFRESH_INTERVAL_MS, because that read is by far
      // the most expensive thing a session request does. \`trigger === 'update'\`
      // (fired by \`useSession().update()\`, which the auth bridge re-publishes
      // as \`window.__teleportNextAuth.refreshSession\`) always refreshes, so a
      // profile save is reflected at once rather than up to an interval later.
      const now = Date.now();
      const lastRefresh = token && typeof token[TOKEN_REFRESH_STAMP] === 'number'
        ? token[TOKEN_REFRESH_STAMP]
        : 0;
      // \`now - lastRefresh < 0\` covers a clock that moved backwards: treat the
      // stamp as stale rather than trusting it until the clock catches up.
      const isFresh = now - lastRefresh >= 0 && now - lastRefresh < USER_REFRESH_INTERVAL_MS;
      if (params.trigger !== 'update' && isFresh) {
        return token;
      }
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
      // Stamped even when the read threw, so an unreachable database costs one
      // attempt per interval instead of one per request.
      if (token) {
        token[TOKEN_REFRESH_STAMP] = now;
      }
      return token;
    },
    async session(params) {
      const session = params.session;
      const token = params.token;
      if (token && session.user) {
        const skip = { iat: 1, exp: 1, jti: 1, sub: 1 };
        skip[TOKEN_REFRESH_STAMP] = 1;
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
  },
  secret: process.env.NEXTAUTH_SECRET,
};

module.exports = authOptions;
module.exports.sanitizeUser = sanitizeUser;
${
  auth.passwordAuthEnabled
    ? `module.exports.findUserByEmail = findUserByEmail;\nmodule.exports.createUser = createUser;\nmodule.exports.userExistsByEmail = userExistsByEmail;\n`
    : ''
}
`
}

/**
 * Why a sign-in failed, in words, plus the one-line codes `authorize` throws.
 *
 * Project a62338f9 could not sign in on the published site OR in the exported
 * project, and the only signal anywhere was NextAuth's generic
 * `CredentialsSignin`. The real cause was that Postgres rejected the DB
 * credential baked into `TELEPORT_DB_CONNECTION_STRING` — a configuration
 * failure the form reported as if the user had mistyped their password.
 *
 * Every code NextAuth can produce is mapped, not just the new ones, so the form
 * never shows a machine token again.
 */
export const generateAuthErrorMessagesFile = (): string => {
  return `// Codes thrown by the credentials provider's authorize().
const AUTH_ERROR_MESSAGES = {
  // Ours.
  MissingCredentials: 'Please enter both your email and your password.',
  InvalidCredentials: 'That email and password do not match an account.',
  ServiceUnavailable:
    'We could not reach the account service. Please try again in a moment — if it keeps happening, the site owner needs to check its database configuration.',

  // NextAuth's own.
  CredentialsSignin: 'That email and password do not match an account.',
  SessionRequired: 'Please sign in to continue.',
  AccessDenied: 'This account is not allowed to sign in.',
  Verification: 'That sign-in link is no longer valid. Please request a new one.',
  Configuration:
    'Sign-in is not configured correctly for this site. The site owner needs to check its authentication settings.',
  OAuthSignin: 'We could not start sign-in with that provider. Please try again.',
  OAuthCallback: 'That provider could not complete sign-in. Please try again.',
  OAuthCreateAccount: 'We could not create an account from that provider.',
  OAuthAccountNotLinked:
    'An account with this email already exists. Sign in the way you did originally, then link this provider from your profile.',
  EmailCreateAccount: 'We could not create an account with that email address.',
  EmailSignin: 'We could not send the sign-in email. Please try again.',
  Callback: 'Sign-in could not be completed. Please try again.',
  Default: 'Something went wrong while signing in. Please try again.',
};

/**
 * Human copy for a NextAuth error code. Anything unrecognised — including a
 * message a future provider invents — falls back to the generic line rather
 * than being shown raw.
 */
function describeAuthError(code) {
  if (!code) { return ''; }
  var key = String(code);
  if (Object.prototype.hasOwnProperty.call(AUTH_ERROR_MESSAGES, key)) {
    return AUTH_ERROR_MESSAGES[key];
  }
  return AUTH_ERROR_MESSAGES.Default;
}

module.exports = describeAuthError;
module.exports.describeAuthError = describeAuthError;
module.exports.AUTH_ERROR_MESSAGES = AUTH_ERROR_MESSAGES;
`
}

/**
 * Tells a database that is UNREACHABLE from one that REFUSED the credential.
 *
 * Both surface to the user as "we could not reach the account service", but the
 * server log has to name which one: run a62338f9's published site and its
 * exported project both failed with `password authentication failed for user
 * "p_<project>_usr"`, and nothing in the app ever said so.
 */
export const generateAuthDbHealthFile = (): string => {
  return `var AUTH_DB_ERROR_KINDS = {
  AUTH_FAILED: 'db-auth-failed',
  UNREACHABLE: 'db-unreachable',
  MISCONFIGURED: 'db-misconfigured',
  UNKNOWN: 'db-unknown',
};

/** Postgres SQLSTATEs for "the server said no to these credentials". */
var AUTH_REJECTION_CODES = ['28P01', '28000', '3D000'];

function classifyAuthInfrastructureError(err) {
  if (!err) { return AUTH_DB_ERROR_KINDS.UNKNOWN; }
  var code = err.code ? String(err.code) : '';
  var message = err.message ? String(err.message).toLowerCase() : '';
  if (AUTH_REJECTION_CODES.indexOf(code) !== -1 || message.indexOf('password authentication failed') !== -1) {
    return AUTH_DB_ERROR_KINDS.AUTH_FAILED;
  }
  if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') {
    return AUTH_DB_ERROR_KINDS.UNREACHABLE;
  }
  if (message.indexOf('connection string') !== -1 || message.indexOf('client password must be a string') !== -1) {
    return AUTH_DB_ERROR_KINDS.MISCONFIGURED;
  }
  return AUTH_DB_ERROR_KINDS.UNKNOWN;
}

/**
 * True when a value is still the build-time placeholder the deploy step was
 * supposed to replace. A placeholder is WORSE than an empty value: code that
 * treats "set" as "configured" then trusts a string that means nothing.
 */
function isUnresolvedSecretPlaceholder(value) {
  return typeof value === 'string' && value.indexOf('teleporthq.secrets.') === 0;
}

/** \`NEXTAUTH_URL\` is only usable when it is an absolute http(s) origin. */
function isUsableNextAuthUrl(value) {
  if (typeof value !== 'string' || !value) { return false; }
  if (isUnresolvedSecretPlaceholder(value)) { return false; }
  return /^https?:\\/\\//i.test(value);
}

module.exports = {
  AUTH_DB_ERROR_KINDS: AUTH_DB_ERROR_KINDS,
  classifyAuthInfrastructureError: classifyAuthInfrastructureError,
  isUnresolvedSecretPlaceholder: isUnresolvedSecretPlaceholder,
  isUsableNextAuthUrl: isUsableNextAuthUrl,
};
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

// Inlined rather than required from utils/auth/db-health: this route is the
// entry point for ALL authentication, so it must not depend on a sibling module
// resolving. Three lines, and the shared copy still backs authorize().
function isUsableNextAuthUrl(value) {
  if (typeof value !== 'string' || !value) { return false; }
  if (value.indexOf('teleporthq.secrets.') === 0) { return false; }
  return /^https?:\\/\\//i.test(value);
}

// NextAuth builds OAuth callback / redirect URLs from process.env.NEXTAUTH_URL.
// At build time the real deployment domain is unknown, so the generated .env
// ships a localhost default. Derive the correct origin from the incoming
// request here so OAuth works on whatever domain the project is published to —
// WITHOUT hardcoding it. An explicitly-configured (non-local) NEXTAUTH_URL is
// always respected; local dev (host = localhost) is left untouched.
//
// "Explicitly configured" means a REAL absolute http(s) origin. Project
// a62338f9 shipped \`NEXTAUTH_URL=teleporthq.secrets.NEXTAUTH_URL\` — an
// unresolved placeholder — and the old check saw a non-empty, non-localhost
// string and refused to override it. NextAuth then normalised it to
// \`https://teleporthq.secrets.nextauth_url\`, advertised that as the sign-in
// origin and issued \`__Host-\`/\`__Secure-\` cookies against it. Treating anything
// that is not a usable URL as unset lets an already-published site self-heal on
// its next request.
module.exports = function nextAuthRoute(req, res) {
  try {
    const fwdHost = req.headers['x-forwarded-host'] || req.headers.host || '';
    const host = Array.isArray(fwdHost) ? fwdHost[0] : fwdHost;
    const hostIsLocal = host.indexOf('localhost') === 0 || host.indexOf('127.0.0.1') === 0;
    const current = process.env.NEXTAUTH_URL || '';
    if (current && !isUsableNextAuthUrl(current)) {
      console.error(
        '[auth] NEXTAUTH_URL is not a usable origin (' + current + ') — deriving it from the request instead.'
      );
    }
    const currentIsLocalOrEmpty =
      !isUsableNextAuthUrl(current) ||
      current.indexOf('localhost') !== -1 ||
      current.indexOf('127.0.0.1') !== -1;
    if (host && !hostIsLocal && currentIsLocalOrEmpty) {
      const fwdProto = req.headers['x-forwarded-proto'];
      const proto = (Array.isArray(fwdProto) ? fwdProto[0] : fwdProto) || 'https';
      process.env.NEXTAUTH_URL = proto + '://' + host;
    } else if (hostIsLocal && !isUsableNextAuthUrl(current)) {
      // Local dev with an unusable value would otherwise leave NextAuth
      // deriving \`https://…\` from the placeholder, so its cookies get the
      // \`Secure\` prefix and the browser drops them over plain http.
      process.env.NEXTAUTH_URL = 'http://' + (host || 'localhost:3000');
    }
  } catch (e) {
    /* fall back to the configured NEXTAUTH_URL */
  }
  return authHandler(req, res);
};
`
}

// The optional WELCOME email sent from the signup route after the user is
// created. Baked from the account-signup node config by the plugin. `emailProvider`
// is the id WITHOUT the `email-` prefix (e.g. `resend`); `emailSecretEnvName` is
// the env var the credential lives under (resolved from the node's secret ref).
export interface WelcomeEmailOptions {
  emailProvider?: string | null
  fromEmail?: string
  emailSecretEnvName?: string | null
  emailSubject?: string
  emailBodyHtml?: string
  siteName?: string
}

export const generateSignupRouteFile = (
  auth: UIDLAuthentication,
  welcome: WelcomeEmailOptions = {}
): string => {
  const needsDb = !!auth.dataSourceType
  const welcomeProvider =
    welcome.emailProvider && SUPPORTED_EMAIL_PROVIDERS.has(welcome.emailProvider)
      ? welcome.emailProvider
      : null
  // Reserved keys that must NOT be copied from the request body onto the new
  // user row — the auth fields plus every welcome-email config key (a stale
  // client could otherwise inject them as bogus user columns).
  const reservedKeysObj: Record<string, number> = { email: 1, password: 1, name: 1, role: 1 }
  for (const key of WELCOME_EMAIL_CONFIG_KEYS) {
    reservedKeysObj[key] = 1
  }
  let dbImport = ''
  let createUserCall = ''
  let welcomeHelpers = ''

  if (needsDb) {
    dbImport = `const authUtils = require('../../../utils/auth/auth-options');
const createUser = authUtils.createUser;
const userExistsByEmail = authUtils.userExistsByEmail;
const sanitizeUser = authUtils.sanitizeUser;`

    // Baked welcome-email helpers + config (no-op send when no provider set).
    welcomeHelpers = `
const WELCOME_EMAIL_PROVIDER = ${JSON.stringify(welcomeProvider)};
const WELCOME_EMAIL_FROM = ${JSON.stringify(welcome.fromEmail || '')};
const WELCOME_EMAIL_SECRET_ENV_NAME = ${JSON.stringify(welcome.emailSecretEnvName || '')};
const WELCOME_EMAIL_SUBJECT = ${JSON.stringify(welcome.emailSubject || 'Welcome')};
const WELCOME_EMAIL_BODY_HTML = ${JSON.stringify(welcome.emailBodyHtml || '')};
const WELCOME_EMAIL_SITE_NAME = ${JSON.stringify(welcome.siteName || '')};

${generateFillTemplateFn()}

${generateProviderSendFunction(welcomeProvider)}

async function sendWelcomeEmail(toEmail, tokenValues) {
  if (!WELCOME_EMAIL_PROVIDER || !WELCOME_EMAIL_BODY_HTML || !toEmail) { return; }
  var apiKey = WELCOME_EMAIL_SECRET_ENV_NAME ? process.env[WELCOME_EMAIL_SECRET_ENV_NAME] : '';
  if (apiKey && String(apiKey).indexOf('teleporthq.secrets.') === 0) { apiKey = ''; }
  if (!apiKey) { console.warn('[account-signup] welcome email skipped: credential not set'); return; }
  var from = WELCOME_EMAIL_FROM || process.env.EMAIL_FROM || '';
  if (!from) { console.warn('[account-signup] welcome email skipped: sender not configured'); return; }
  var subject = fillTemplate(WELCOME_EMAIL_SUBJECT, tokenValues);
  var html = fillTemplate(WELCOME_EMAIL_BODY_HTML, tokenValues);
  await __sendProviderEmail({ from: from, to: toEmail, subject: subject, html: html, apiKey: apiKey });
}
`

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
    const reservedKeys = ${JSON.stringify(reservedKeysObj)};
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

    // Best-effort welcome email — a failed send must never fail the signup.
    try {
      const __welcomeSiteName = WELCOME_EMAIL_SITE_NAME ||
        (req.headers && req.headers.host ? String(req.headers.host).replace(/^www\\./, '').split(':')[0] : '');
      await sendWelcomeEmail(email, {
        userName: name || (newUser && newUser.name) || 'there',
        userEmail: email,
        siteName: __welcomeSiteName,
      });
    } catch (welcomeErr) {
      console.error('[account-signup] welcome email failed:', welcomeErr && welcomeErr.message ? welcomeErr.message : welcomeErr);
    }

    res.status(201).json({ user: sanitizeUser(newUser) });`
  } else {
    createUserCall = `    res.status(501).json({ error: 'No data source configured for user storage' });`
  }

  return `const hashPassword = require('../../../utils/auth/hash-password');
${dbImport}
${welcomeHelpers}

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

// The exact route pattern a self-guarded page serves, e.g.
// `/orders/[order_number]`. Skipping the page from `protectedRoutes` is not
// enough on its own: platform list/details pairs deliberately share a static
// base (`/orders` listing + `/orders/[order_number]` details) so the protected
// LISTING route prefix-matches — and bounces — every details request. Knowing
// the details pattern lets the middleware waive that inherited protection for
// exactly the paths the self-guarded page owns.
//
// `routePattern` is the authoritative value; UIDLs emitted before that field
// existed are reconstructed from `route` + `rowOwnerDifferentiator`.
const selfGuardedRoutePatternOf = (protection: {
  route?: string
  routePattern?: string
  rowOwnerDifferentiator?: string
}): string => {
  if (protection.routePattern) {
    return protection.routePattern
  }
  const base = protection.route || ''
  const differentiator = protection.rowOwnerDifferentiator
  if (!base || !differentiator) {
    return base
  }
  return base === '/' ? `/[${differentiator}]` : `${base}/[${differentiator}]`
}

export const generateMiddlewareFile = (auth: UIDLAuthentication): string => {
  const protectedRoutes: Record<string, { requiresAuth: boolean; allowedRoles: string[] }> = {}
  // Page ids skipped from `protectedRoutes` because their page-load SQL is the
  // access control. Tracked by id (not by route) so the folder pass below can
  // revoke the waiver for a page that a role-gated folder pulls back under
  // middleware protection.
  const selfGuardedPageIds = new Set<string>()

  if (auth.pageProtection) {
    for (const [pageId, protection] of Object.entries(auth.pageProtection) as Array<
      [string, any]
    >) {
      if (isRowOwnedSelfGuardedPage(protection)) {
        selfGuardedPageIds.add(pageId)
        continue
      }
      // A route key can be claimed by more than one page — a list/details pair
      // deliberately shares its static base (`/orders` + `/orders/[id]`), and a
      // user can point two pages at the same custom URL. One prefix key gates
      // the whole subtree, so merge instead of letting document order decide
      // which page's rules survive.
      const existing = protectedRoutes[protection.route]
      protectedRoutes[protection.route] = {
        requiresAuth: !!existing?.requiresAuth || protection.requiresAuth,
        allowedRoles: Array.from(
          new Set([...(existing?.allowedRoles || []), ...(protection.allowedRoles || [])])
        ),
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
              // The folder imposes a role the row-level SQL cannot reproduce,
              // so this page is back under middleware protection and must not
              // keep its self-guarded waiver.
              selfGuardedPageIds.delete(childId)
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

  const selfGuardedRoutes = Array.from(
    new Set(
      Array.from(selfGuardedPageIds)
        .map((pageId) => selfGuardedRoutePatternOf((auth.pageProtection as any)[pageId]))
        .filter((pattern) => !!pattern)
    )
  )

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
  const selfGuardedRoutesJson = JSON.stringify(selfGuardedRoutes)
  const signInRoute = auth.authPages.signIn?.route || '/auth/sign-in'

  return `import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const protectedRoutes = ${protectedRoutesJson};

const authRoutes = ${authRoutesJson};

// Routes whose page-load SQL is the access control: the query filters rows by
// the visitor's user id OR the persistent anonymous-localStorage UUID, so a
// guest buyer must be allowed to reach the row they own. These pages are
// already absent from protectedRoutes, but a platform list/details pair shares
// its static base ("/orders" listing + "/orders/[order_number]" details), so
// without this list the protected LISTING route prefix-matches every details
// request and redirects the guest to sign-in.
const selfGuardedRoutes = ${selfGuardedRoutesJson};

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

// Turns a Next.js route pattern into an anchored matcher: "[param]" matches a
// single path segment, "[...param]" / "[[...param]]" match one or more. Every
// other character is escaped so a literal "." or "+" in a slug can never widen
// the match. Brackets are deliberately NOT escaped in the first pass — they are
// the placeholder syntax the second pass rewrites.
function compileRoutePattern(pattern) {
  var escaped = String(pattern).replace(/[.*+?^\${}()|\\\\]/g, '\\\\$&');
  var source = escaped
    .replace(/\\[\\[\\.\\.\\.[^\\]]*\\]\\]/g, '.+')
    .replace(/\\[\\.\\.\\.[^\\]]*\\]/g, '.+')
    .replace(/\\[[^\\]]*\\]/g, '[^/]+');
  return new RegExp('^' + source + '$');
}

const selfGuardedRouteMatchers = selfGuardedRoutes.map(compileRoutePattern);

function isSelfGuardedPath(pathname) {
  for (var i = 0; i < selfGuardedRouteMatchers.length; i++) {
    if (selfGuardedRouteMatchers[i].test(pathname)) {
      return true;
    }
  }
  return false;
}

// Where to send an authenticated user who lacks the required role. Normally the
// home page ("you don't have access, here's the public site"). But when "/" is
// itself a protected page (e.g. an admin dashboard published at the root), a
// redirect to "/" re-enters this middleware and loops forever — so fall back to
// the sign-in page (with a callbackUrl) in that case.
function roleDeniedRedirect(request, pathname) {
  if (pathname !== '/' && !protectedRoutes['/']) {
    return NextResponse.redirect(new URL('/', request.url));
  }
  var deniedUrl = new URL('${signInRoute}', request.url);
  deniedUrl.searchParams.set('callbackUrl', pathname);
  return NextResponse.redirect(deniedUrl);
}

async function middleware(request) {
  const pathname = request.nextUrl.pathname;

  for (let i = 0; i < authRoutes.length; i++) {
    // Segment-safe: an auth route like "/sign-in" must not bypass protection on
    // a same-prefix page such as "/sign-in-offers". Mirrors the protectedRoutes
    // matching below.
    if (pathname === authRoutes[i] || pathname.startsWith(authRoutes[i] + '/')) {
      return NextResponse.next();
    }
  }

  if (pathname === '/auth' || pathname.startsWith('/auth/')) {
    return NextResponse.next();
  }

  // Route keys carry no trailing slash, so neither may the path we match with.
  // Next.js serves "/orders/ORD-42/" and "/orders/ORD-42" as the same route;
  // matching the raw pathname would let the slashed form miss every exact key
  // (and every self-guarded pattern) and fall back to the ancestor prefix.
  // The ORIGINAL pathname is what goes into the sign-in callbackUrl.
  const matchPath =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.replace(/\\/+$/, '') : pathname;

  // An exact hit is the page's OWN protection and always wins. Anything else is
  // inherited from an ancestor route (a listing page, an "/admin" subtree, …).
  const exactProtection = Object.prototype.hasOwnProperty.call(protectedRoutes, matchPath)
    ? protectedRoutes[matchPath]
    : null;
  let matchedProtection = exactProtection;
  if (!matchedProtection) {
    const routes = Object.keys(protectedRoutes).sort(function(a, b) {
      return b.length - a.length;
    });
    for (let r = 0; r < routes.length; r++) {
      if (matchPath.startsWith(routes[r] + '/')) {
        matchedProtection = protectedRoutes[routes[r]];
        break;
      }
    }
  }

  if (!matchedProtection) {
    return NextResponse.next();
  }

  // Self-guarded details route reached through an ancestor's protection: let it
  // through so the page-load SQL can decide, using the visitor's user id OR
  // their anonymous UUID. Deliberately narrow — the waiver never applies to the
  // page's own exact protection, and never to an ancestor that demands a role,
  // because role membership is an absolute gate no row-level WHERE clause can
  // reproduce.
  if (
    !exactProtection &&
    (matchedProtection.allowedRoles || []).length === 0 &&
    isSelfGuardedPath(matchPath)
  ) {
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
      return roleDeniedRedirect(request, pathname);
    }
  }

  return NextResponse.next();
}

export default middleware;
export const config = {
  // The bare '/' entry is required so middleware also runs on the home page:
  // Next.js does NOT run the second (negative-lookahead) matcher for the root
  // path, which would leave a page published at "/" (e.g. a protected dashboard)
  // publicly reachable. '/' compiles to ^/$ and covers exactly the home route;
  // the second entry covers every deeper path.
  matcher: ['/', '/((?!api|_next/static|_next/image|favicon\\\\.ico).*)'],
};
`
}

// A side-effect-only module that MUST evaluate before `next-auth/react` is
// imported. It is emitted at utils/auth/nextauth-url-guard.js and imported as the
// FIRST import of session-provider.js (the only module that imports
// next-auth/react). ES module imports evaluate in source order, so this runs
// first.
//
// Why it exists: next-auth v4's `next-auth/react` builds its `__NEXTAUTH` config
// at MODULE LOAD by calling `parseUrl(process.env.NEXTAUTH_URL)` (and the
// NEXTAUTH_URL_INTERNAL / VERCEL_URL variants). `parseUrl('')` runs `new URL('')`,
// which throws "Invalid URL" — so an EMPTY-STRING env value crashes the import
// and, with it, server-side rendering for every page that mounts SessionProvider
// (the terminal shows `TypeError: Invalid URL … input: '' … page: '/products'`).
// An UNSET var is safe: next-auth defaults it to http://localhost:3000. But a
// generated `.env` can ship `NEXTAUTH_URL=` (empty), which Next.js loads into
// process.env as "" rather than undefined — the crashing case. Deleting an
// empty/whitespace value restores the safe "unset" state; a real configured
// value is left untouched. On the browser these are already undefined, so this
// is a no-op there.
export const generateNextAuthUrlGuardModule = (): string => {
  return `// GENERATED — see generateNextAuthUrlGuardModule in
// @teleporthq/teleport-plugin-next-workflows/src/auth-generator.ts.
//
// next-auth v4's \`next-auth/react\` reads \`parseUrl(process.env.NEXTAUTH_URL)\` at
// MODULE LOAD. \`new URL('')\` throws "Invalid URL", so an EMPTY-STRING value
// crashes the import — and server-side rendering for every page that mounts
// SessionProvider. An UNSET var is fine (next-auth defaults it to
// http://localhost:3000); only an empty string is fatal. A generated \`.env\` may
// ship \`NEXTAUTH_URL=\` (empty), which Next.js loads as "", not undefined.
//
// This is the FIRST import of session-provider.js — the only module that imports
// next-auth/react — and ES module imports evaluate in source order, so this runs
// before next-auth reads the value. It removes an empty / whitespace value from
// the server's process.env so next-auth falls back to its default. On the client
// these are already undefined, so it is a no-op.
if (typeof process !== 'undefined' && process && process.env) {
  var __TQ_NEXTAUTH_URL_KEYS = ['NEXTAUTH_URL', 'NEXTAUTH_URL_INTERNAL', 'VERCEL_URL']
  for (var __i = 0; __i < __TQ_NEXTAUTH_URL_KEYS.length; __i++) {
    var __k = __TQ_NEXTAUTH_URL_KEYS[__i]
    var __v = process.env[__k]
    if (typeof __v === 'string' && __v.trim() === '') {
      delete process.env[__k]
    }
  }
}

export {}
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
  //
  // The `nextauth-url-guard` import MUST stay first: it normalizes an empty
  // NEXTAUTH_URL out of process.env before `next-auth/react` evaluates and calls
  // `parseUrl('')`, which would otherwise throw "Invalid URL" at module load and
  // crash SSR. ES imports run in source order, so first = before next-auth/react.
  return `import './nextauth-url-guard'
import React from 'react'
import { SessionProvider, signIn, signOut, useSession } from 'next-auth/react'
import describeAuthError from './auth-error-messages'

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
// \`describeAuthError\` rides the same bridge for the same reason. The sign-in
// handler used to surface NextAuth's raw code — project a62338f9's users were
// shown the literal string "credentialsSignin" — and it cannot require the
// message table itself without reintroducing exactly the fragile require this
// bridge exists to avoid. Published from here, where a normal module import is
// safe, so there is ONE table rather than a copy inlined per handler.
// A stable object, assigned to \`window\` exactly once at module-eval time.
// \`SessionSnapshotBridge\` below mutates it in place, so a handler that grabbed
// \`window.__teleportNextAuth\` earlier always observes the current session.
const teleportNextAuth = {
  signIn: signIn,
  signOut: signOut,
  describeAuthError: describeAuthError,
  // The session SessionProvider is ALREADY holding in memory, republished so
  // that workflow handlers can read it synchronously instead of paying an HTTP
  // round trip to /api/auth/session for something the page has had since it
  // mounted. On a published deployment that request measured ~925ms — the
  // \`account-get-current\` node fired one on every click that resolves the
  // current user (favourites, cart, reviews, ...), strictly serial with the
  // workflow's own request. \`status\` is next-auth's: 'loading' until the
  // provider's first fetch settles, then 'authenticated' / 'unauthenticated'.
  session: null,
  status: 'loading',
  getSession: function () {
    return { status: teleportNextAuth.status, session: teleportNextAuth.session }
  },
  // \`useSession().update()\`. Calling it re-reads the user server-side (NextAuth
  // passes \`trigger: 'update'\` to the jwt callback, which bypasses the refresh
  // interval) and updates the in-memory session. This is how a profile save
  // makes its change visible immediately rather than at the next interval.
  refreshSession: function () {
    return Promise.resolve(null)
  },
}

if (typeof window !== 'undefined') {
  window.__teleportNextAuth = teleportNextAuth
}

// Renders nothing; it exists only to subscribe to the session context and mirror
// it onto the bridge. It must live INSIDE SessionProvider for useSession() to
// resolve. Mirroring happens in an effect (never during render, which React may
// discard or replay) — effects flush on the commit that follows the provider's
// fetch, long before any user click.
function SessionSnapshotBridge() {
  const sessionContext = useSession()
  const status = sessionContext ? sessionContext.status : 'loading'
  const data = sessionContext ? sessionContext.data : null
  const update = sessionContext ? sessionContext.update : null

  React.useEffect(
    function () {
      teleportNextAuth.status = status
      teleportNextAuth.session = data || null
      if (typeof update === 'function') {
        teleportNextAuth.refreshSession = update
      }
    },
    [status, data, update]
  )

  return null
}

export default function AuthSessionProvider(props) {
  return React.createElement(
    SessionProvider,
    {
      session: props.pageProps && props.pageProps.session ? props.pageProps.session : undefined,
      // Every regained window focus re-fetched /api/auth/session, and each of
      // those is a server round trip for a session the page already has. Tabbing
      // away and back was enough to trigger one. Cross-tab sign-in/sign-out
      // still propagates: next-auth broadcasts those over its storage channel,
      // which is independent of this flag.
      refetchOnWindowFocus: false,
    },
    React.createElement(SessionSnapshotBridge, { key: 'teleport-session-bridge' }),
    props.children
  )
}
`
}
