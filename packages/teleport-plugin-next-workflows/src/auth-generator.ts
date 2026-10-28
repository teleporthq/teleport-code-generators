import type {
  UIDLAuthentication,
  UIDLAuthTableColumn,
  UIDLCustomUserProperty,
  UIDLLocalizedEmailTemplates,
  DataSourceType,
} from '@teleporthq/teleport-types'
import {
  SUPPORTED_EMAIL_PROVIDERS,
  generateProviderSendFunction,
  generateFillTemplateFn,
  generateEmailLocaleRequire,
  generateLocalizedEmailCopyFn,
  EXISTING_ACCOUNT_EMAIL,
  SET_PASSWORD_EMAIL,
  WELCOME_EMAIL_CONFIG_KEYS,
} from './transactional-email-code'
import {
  PASSWORD_RESET_TOKEN_TTL_SECONDS,
  TRUSTED_ORIGIN_CODE,
  resolveResetPagePath,
} from './password-reset-route-generator'
import { AccountFields, SessionCookieResolver, TableAccess } from '@teleporthq/teleport-shared'
import { generateSessionTokenResolverCode } from './session-cookie-resolver'
import { AUTOMATIONS_PATH } from './automations/automations-scope'
import { SESSION_REVOCATION_FILE_NAME, SESSION_STAMP_KEY } from './session-revocation-generator'
import { securityRuntimeSpecifier } from './security-runtime/security-runtime-code'

/**
 * Credentials sign-in throttle: a visitor's next sign-in for an email is
 * refused (429) once this many failures for it are in the window, or once it
 * was tried SIGN_IN_ATTEMPT_LIMIT times in the window whatever the outcome.
 */
export const SIGN_IN_FAILURE_LIMIT = 10
export const SIGN_IN_ATTEMPT_LIMIT = 30
export const SIGN_IN_WINDOW_SECONDS = 900
/** Failed sign-ins one visitor may make across every email in the window. */
export const SIGN_IN_VISITOR_FAILURE_LIMIT = 50
/** Sign-ups per visitor per hour. */
export const SIGN_UP_LIMIT = 10
/**
 * "You already have an account" (or, for an address without a password,
 * "Set your password") emails one address can be sent per hour.
 */
export const EXISTING_ACCOUNT_EMAIL_LIMIT = 3
export const SIGN_UP_WINDOW_SECONDS = 3600

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
 * The Newsletter's own `users` columns (`newsletter_status`, …). A sign-in
 * snapshot of them goes stale the moment the person confirms or unsubscribes,
 * so they never reach the session: a page reads the row.
 */
const NEWSLETTER_COLUMN_PREFIX = 'newsletter_'

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
  const declared = (tables?.users || [])
    .map((column) => column.name)
    .filter((name) => !name.startsWith(NEWSLETTER_COLUMN_PREFIX))
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

/**
 * The `users` columns a sign-up writes itself, never from its form: where the
 * person came from (`source = 'signup'`) and their consent as given
 * (`marketing_consent`, from the "Email me news and offers" box). On the
 * Postgres family `createUser` writes each one it is given, and creates the
 * account without them on a users table made before they existed.
 */
export const SIGNUP_OWN_COLUMNS: readonly string[] = ['source', 'marketing_consent']

/**
 * `findSignupUserByEmail(email)`: the sign-up's own existence check, blind to
 * letter case, so `Ava@site.test` signing up reaches the `ava@site.test` row
 * (a subscriber, a guest, an account) instead of making a second one. The
 * exact address first; else the one row equal to it in any case, none when
 * that is ambiguous. Sign-in keeps its exact `findUserByEmail`. On the other
 * stores it is that exact lookup.
 */
const generateSignupLookupFunction = (dataSourceType: DataSourceType | null): string => {
  switch (dataSourceType) {
    case 'teleport':
    case 'postgresql':
    case 'cockroachdb':
      return `async function findSignupUserByEmail(email) {
  const client = getClient();
  try {
    await client.connect();
    const exact = await client.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
    if (exact.rows && exact.rows.length > 0) return exact.rows[0];
    const anyCase = await client.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 2', [email]);
    return anyCase.rows && anyCase.rows.length === 1 ? anyCase.rows[0] : null;
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}`
    default:
      return `async function findSignupUserByEmail(email) {
  return findUserByEmail(email);
}`
  }
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
  // A declared account property of the same name is already one of the columns.
  const customKeys = new Set(customProps.map((prop) => prop.key))
  const signupOwnColumns = SIGNUP_OWN_COLUMNS.filter((column) => !customKeys.has(column))

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

// What a sign-up writes besides its form (where the person came from, their
// consent as given), each when it is given. A users table made before one of
// them lacks it (the column is added when a feature that reads it is switched
// on): the account is then created without them.
const SIGNUP_OWN_COLUMNS = ${JSON.stringify(signupOwnColumns)};

async function createUser(userData) {
  const client = getClient();
  try {
    await client.connect();
    const values = [userData.name || null, userData.email, userData.password, userData.role || 'user', userData.image || null${customValues}];
    const insert = function (extra) {
      let columns = '';
      let placeholders = '';
      for (let i = 0; i < extra.length; i++) {
        columns += ', ' + extra[i];
        placeholders += ', $' + (values.length + i + 1);
      }
      return client.query(
        'INSERT INTO users (name, email, password, role, image${sqlCols}' + columns + ') VALUES ($1, $2, $3, $4, $5${pgPlaceholders}' + placeholders + ') RETURNING *',
        values.concat(extra.map(function (column) { return userData[column]; }))
      );
    };
    let extra = SIGNUP_OWN_COLUMNS.filter(function (column) { return userData[column] !== undefined; });
    let result = null;
    while (!result) {
      try {
        result = await insert(extra);
      } catch (err) {
        // 42703 names a column the table does not have. Only that one is left
        // out, and only when it is one of these: the others are still written.
        const named = err && err.code === '42703' ? /column "([^"]+)"/.exec(String(err.message || '')) : null;
        const missing = named ? named[1] : '';
        if (!missing || extra.indexOf(missing) === -1) { throw err; }
        console.warn('[auth] the users table has no ' + missing + ' column yet: the account is created without it');
        extra = extra.filter(function (column) { return column !== missing; });
      }
    }
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

/** Where the password-reset links live: hashed, single-use, per account id. */
export const PASSWORD_RESETS_TABLE = 'teleport_password_resets'

const PG_PASSWORD_RESET_FUNCTIONS = `
// Password-reset links (pages/api/auth/forgot-password + reset-password). Only
// the SHA-256 of a link's token is stored, bound to the account id, with its
// expiry; the table is created on first use. The earlier password_reset_tokens
// table and its rows are never read.
var PASSWORD_RESETS_TABLE = '${PASSWORD_RESETS_TABLE}';
var __passwordResetsTableReady = false;

async function ensurePasswordResetsTable(client) {
  if (__passwordResetsTableReady) return;
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [PASSWORD_RESETS_TABLE]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS ' + PASSWORD_RESETS_TABLE + ' (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, ' +
        'expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())'
    );
    await client.query('CREATE INDEX IF NOT EXISTS ' + PASSWORD_RESETS_TABLE + '_user_id_idx ON ' + PASSWORD_RESETS_TABLE + ' (user_id)');
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_e) {}
    throw err;
  }
  __passwordResetsTableReady = true;
}

// One live link per account: a new one ends the ones sent before it.
async function storePasswordReset(userId, tokenHash, ttlSeconds) {
  const client = getClient();
  try {
    await client.connect();
    await ensurePasswordResetsTable(client);
    await client.query(
      'UPDATE ' + PASSWORD_RESETS_TABLE + ' SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
      [String(userId)]
    );
    await client.query(
      'INSERT INTO ' + PASSWORD_RESETS_TABLE + " (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 second'))",
      [tokenHash, String(userId), ttlSeconds]
    );
    await client.query(
      'DELETE FROM ' + PASSWORD_RESETS_TABLE + " WHERE expires_at < NOW() - INTERVAL '1 day'"
    );
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}

// Spends the link and sets the password in ONE statement: the link must be
// unspent and unexpired, and is spent by this call alone (a second call with the
// same token finds it used). Returns the account it was for, or null.
async function consumePasswordReset(tokenHash, passwordHash) {
  const client = getClient();
  try {
    await client.connect();
    const result = await client.query(
      'WITH consumed AS (' +
        ' UPDATE ' + PASSWORD_RESETS_TABLE + ' SET used_at = NOW()' +
        ' WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()' +
        ' RETURNING user_id' +
        '), changed AS (' +
        ' UPDATE users SET password = $2 FROM consumed WHERE users.id::text = consumed.user_id' +
        ' RETURNING users.id, users.email' +
        ') SELECT id, email FROM changed',
      [tokenHash, passwordHash]
    );
    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
  } catch (err) {
    // 42P01: no link was ever sent, so the table is not there yet.
    if (err && err.code === '42P01') return null;
    throw err;
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}

async function passwordResetIsLive(tokenHash) {
  const client = getClient();
  try {
    await client.connect();
    const result = await client.query(
      'SELECT 1 FROM ' + PASSWORD_RESETS_TABLE + ' WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() LIMIT 1',
      [tokenHash]
    );
    return !!(result.rows && result.rows.length > 0);
  } catch (err) {
    if (err && err.code === '42P01') return false;
    throw err;
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}

const PASSWORD_RESET_SUPPORTED = true;`

const UNSUPPORTED_PASSWORD_RESET_FUNCTIONS = `
// Password-reset links need a Postgres database; this project's user store is
// not one, so the reset routes answer without ever sending a link.
async function storePasswordReset() { throw new Error('Password reset needs a Postgres database'); }
async function consumePasswordReset() { return null; }
async function passwordResetIsLive() { return false; }
const PASSWORD_RESET_SUPPORTED = false;`

/**
 * `updateUserPasswordHash(user, newHash, oldHash)` — the sign-in moving a hash
 * onto the project's own pepper. It writes only over the hash it verified, so a
 * reset that landed in between is never undone. Plus the password-reset link
 * store (Postgres family only).
 */
const generatePasswordStoreFunctions = (dataSourceType: DataSourceType | null): string => {
  switch (dataSourceType) {
    case 'teleport':
    case 'postgresql':
    case 'cockroachdb':
      return `// The account a stamped session was issued for (session-revocation). A value
// that is not an id of this table's type (22P02) is no account; any other
// error is thrown, so the session check fails closed.
async function findUserById(id) {
  const client = getClient();
  try {
    await client.connect();
    const result = await client.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
  } catch (err) {
    if (err && err.code === '22P02') return null;
    throw err;
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}

async function updateUserPasswordHash(user, newHash, oldHash) {
  const client = getClient();
  try {
    await client.connect();
    const result = await client.query('UPDATE users SET password = $1 WHERE id = $2 AND password = $3', [newHash, user.id, oldHash]);
    return !!(result && result.rowCount > 0);
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}
${PG_PASSWORD_RESET_FUNCTIONS}`
    case 'supabase':
      return `async function findUserById(id) {
  const client = getSupabaseClient();
  const result = await client.from('users').select('*').eq('id', id).maybeSingle();
  if (result.error) throw new Error(result.error.message || 'users lookup failed');
  return result.data || null;
}

async function updateUserPasswordHash(user, newHash, oldHash) {
  const client = getSupabaseClient();
  const result = await client.from('users').update({ password: newHash }).eq('id', user.id).eq('password', oldHash).select('id');
  return !!(result.data && result.data.length > 0);
}
${UNSUPPORTED_PASSWORD_RESET_FUNCTIONS}`
    case 'mysql':
    case 'mariadb':
    case 'tidb':
      return `async function findUserById(id) {
  const conn = await getConnection();
  try {
    const [rows] = await conn.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
    return rows && rows.length > 0 ? rows[0] : null;
  } finally {
    try { await conn.end(); } catch (_e) {}
  }
}

async function updateUserPasswordHash(user, newHash, oldHash) {
  const conn = await getConnection();
  try {
    const [result] = await conn.execute('UPDATE users SET password = ? WHERE id = ? AND password = ?', [newHash, user.id, oldHash]);
    return !!(result && result.affectedRows > 0);
  } finally {
    try { await conn.end(); } catch (_e) {}
  }
}
${UNSUPPORTED_PASSWORD_RESET_FUNCTIONS}`
    case 'mongodb':
      return `async function findUserById(id) {
  const client = await _mongoClientPromise;
  const db = client.db();
  const ObjectId = require('mongodb').ObjectId;
  if (!ObjectId.isValid(String(id))) return null;
  return await db.collection('users').findOne({ _id: new ObjectId(String(id)) });
}

async function updateUserPasswordHash(user, newHash, oldHash) {
  const client = await _mongoClientPromise;
  const db = client.db();
  const result = await db.collection('users').updateOne({ _id: user._id, password: oldHash }, { $set: { password: newHash } });
  return !!(result && result.modifiedCount > 0);
}
${UNSUPPORTED_PASSWORD_RESET_FUNCTIONS}`
    case 'firestore':
      return `async function findUserById(id) {
  const snap = await firestoreDb.collection('users').doc(String(id)).get();
  return snap.exists ? Object.assign({ id: snap.id }, snap.data()) : null;
}

async function updateUserPasswordHash(user, newHash, oldHash) {
  const ref = firestoreDb.collection('users').doc(String(user.id));
  return firestoreDb.runTransaction(async function (tx) {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().password !== oldHash) return false;
    tx.update(ref, { password: newHash });
    return true;
  });
}
${UNSUPPORTED_PASSWORD_RESET_FUNCTIONS}`
    case 'turso':
      return `async function findUserById(id) {
  const result = await tursoClient.execute({ sql: 'SELECT * FROM users WHERE id = ? LIMIT 1', args: [id] });
  return result.rows && result.rows.length > 0 ? result.rows[0] : null;
}

async function updateUserPasswordHash(user, newHash, oldHash) {
  const result = await tursoClient.execute({ sql: 'UPDATE users SET password = ? WHERE id = ? AND password = ?', args: [newHash, user.id, oldHash] });
  return !!(result && result.rowsAffected > 0);
}
${UNSUPPORTED_PASSWORD_RESET_FUNCTIONS}`
    case 'airtable':
      return `async function findUserById(id) {
  return new Promise(function(resolve, reject) {
    airtableBase('users').find(String(id), function(err, rec) {
      if (err && (err.statusCode === 404 || err.error === 'NOT_FOUND')) { resolve(null); return; }
      if (err) { reject(err); return; }
      resolve(rec ? Object.assign({ id: rec.id }, rec.fields) : null);
    });
  });
}

async function updateUserPasswordHash(user, newHash, oldHash) {
  const current = await findUserByEmail(user.email);
  if (!current || current.password !== oldHash) return false;
  await new Promise(function(resolve, reject) {
    airtableBase('users').update(String(user.id), { password: newHash }, function(err) { if (err) { reject(err); } else { resolve(); } });
  });
  return true;
}
${UNSUPPORTED_PASSWORD_RESET_FUNCTIONS}`
    default:
      return `async function findUserById() { return null; }
async function updateUserPasswordHash() { return false; }
${UNSUPPORTED_PASSWORD_RESET_FUNCTIONS}`
  }
}

/** Microsoft provider ids whose email claim is only trusted for one tenant. */
const MICROSOFT_PROVIDER_IDS = new Set(['azure-ad', 'microsoft-entra-id'])

/** The credential key naming a Microsoft provider's tenant (`*_TENANT_ID`, or Entra's `*_ISSUER`). */
const microsoftTenantKeyOf = (provider: { id: string; credentials: Record<string, string> }) =>
  Object.keys(provider.credentials || {}).find(
    (key) => key.endsWith('_TENANT_ID') || key.endsWith('_ISSUER')
  )

/** provider id → env var of its configured tenant, for each Microsoft provider. */
const microsoftTenantEnvKeys = (auth: UIDLAuthentication): Record<string, string> => {
  const keys: Record<string, string> = {}
  for (const provider of auth.providers || []) {
    const key = MICROSOFT_PROVIDER_IDS.has(provider.id) ? microsoftTenantKeyOf(provider) : undefined
    if (key) {
      keys[provider.id] = key
    }
  }
  return keys
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
  async authorize(credentials, req) {
    if (!credentials || !credentials.email || !credentials.password) {
      throw new Error('MissingCredentials');
    }
    const { checkPassword, hashPassword } = require('./hash-password');
    const { classifyAuthInfrastructureError } = require('./db-health');
    let user;
    try {
      user = await findUserByEmail(String(credentials.email));
    } catch (err) {
      const kind = classifyAuthInfrastructureError(err);
      console.error('[auth] Could not reach the user store (' + kind + '):', err && err.message ? err.message : err);
      throw new Error('ServiceUnavailable');
    }
    let verdict;
    try {
      // No account, or one without a password, is checked too (against a
      // stand-in hash): every failure costs what a wrong password costs.
      verdict = checkPassword(String(credentials.password), user ? user.password : null);
    } catch (err) {
      // A hashing/serialisation fault is an infrastructure problem, not a
      // wrong password — saying "check your details" would send the user
      // round in circles.
      console.error('[auth] Credential check failed:', err && err.message ? err.message : err);
      throw new Error('ServiceUnavailable');
    }
    if (!verdict.ok) {
      await countSignInFailure(req, credentials.email);
      throw new Error('InvalidCredentials');
    }
    // A hash still made with the old pepper moves onto the project's own.
    let storedHash = user.password;
    if (verdict.needsRehash) {
      try {
        const rehashed = hashPassword(String(credentials.password));
        if (await updateUserPasswordHash(user, rehashed, storedHash)) {
          storedHash = rehashed;
        }
      } catch (err) {
        console.error('[auth] Could not move the password onto the current pepper:', err && err.message ? err.message : err);
      }
    }
    return withSessionStamp(sanitizeUser(user), Object.assign({}, user, { password: storedHash }));
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
    if (provider.id === 'azure-ad' && issuerKey && issuerKey.endsWith('_TENANT_ID')) {
      // next-auth's Azure AD provider takes the tenant as tenantId ("common",
      // every tenant, when absent).
      cfg.push(`      tenantId: process.env.${issuerKey} || undefined`)
    } else if (issuerKey) {
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
    ? `${generateFindUserFunction(auth.dataSourceType, customProps)}

${generateSignupLookupFunction(auth.dataSourceType)}`
    : ''
  const sanitizeUserCode = generateSanitizeUserFunction(auth.tables, customProps)
  const signInRoute = auth.authPages.signIn?.route || '/auth/sign-in'
  // Password sign-in brings the local account a session can be revoked from;
  // with an OAuth provider beside it, an OAuth sign-in may become that account.
  const withPassword = !!auth.passwordAuthEnabled
  // Every OAuth project checks whether the provider vouches for the email: an
  // unvouched email never is the visitor's identity, whether or not a local
  // account could be adopted (R15).
  const withOAuthBinding = (auth.providers || []).length > 0
  const passwordSessionCode = withPassword
    ? `${generatePasswordStoreFunctions(auth.dataSourceType)}

${CREDENTIAL_SESSION_HELPERS}
`
    : ''
  const oauthBindingCode = withOAuthBinding
    ? `${generateOAuthEmailVerificationHelpers(auth)}\n`
    : ''

  return `${providerImports}
${dbSetupCode}
${sanitizeUserCode}

${findUserCode}
${passwordSessionCode}${oauthBindingCode}
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
${
  withOAuthBinding
    ? `        // An OAuth sign-in becomes the local account with its email only when
        // the provider vouches for that email; otherwise it stays a session of
        // its own, without the account's id or role.
        if (params.account && params.account.type !== 'credentials') {
          if (!(await oauthEmailIsVerified(params.account, params.profile, token))) {
            asDistinctOAuthIdentity(token, params.account);
          }${
            withPassword
              ? ` else {
            // Vouched for: the next refresh adopts the local account with that
            // email (its id and role). Until then — and for good when there is
            // none — the id is the provider's, namespaced where it could equal
            // a local id.
            namespaceOAuthId(token, params.account);
          }`
              : ''
          }
        }
`
    : ''
}        // Deliberately NOT stamped. An OAuth \`user\` is the PROVIDER's profile
        // (id/name/email/image) — it carries no \`role\`, which only exists on
        // the \`users\` row. Stamping here would make the first session request
        // after an OAuth sign-in skip the database and leave the visitor
        // role-less for a whole interval, silently failing role-protected
        // routes. Leaving it unstamped means the next session request refreshes
        // exactly as it does today, and the interval applies from there on.
        return token;
      }
${
  withOAuthBinding
    ? `      // A session the provider did not vouch for never takes a local account.
      if (token && token[OAUTH_UNVERIFIED]) {
        return token;
      }
`
    : ''
}      // Subsequent calls (every /api/auth/session): re-read the user from the
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
${withPassword ? PASSWORD_REFRESH_CODE : PLAIN_REFRESH_CODE}      } catch (e) {
        // Keep the existing token on any DB hiccup — never sign the user out.
      }
${
  withPassword
    ? `      if (revoked) {
        // NextAuth answers a jwt callback that throws by clearing the session
        // cookie: the visitor is signed out.
        throw new Error('SessionRevoked');
      }
`
    : ''
}      // Stamped even when the read threw, so an unreachable database costs one
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
${withPassword ? `        skip['${SESSION_STAMP_KEY}'] = 1;\n` : ''}${
    withOAuthBinding ? '        skip[OAUTH_UNVERIFIED] = 1;\n' : ''
  }        const keys = Object.keys(token);
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

// On https the session token and the callback-url cookie are "__Host-" cookies
// (Path=/, Secure, HttpOnly, SameSite=Lax, no Domain): only this site can set
// them. Published sites share a parent domain that is not a public suffix, so a
// sibling site could otherwise plant a session cookie this site reads (cookie
// tossing: the visitor silently signed in to someone else's account). Every
// reader in the app reads this one name (session-cookie-resolver). NextAuth
// reads the option on every request, after the auth route has set
// NEXTAUTH_URL to the request's origin; on http (a local server) its defaults stay.
var SECURE_SESSION_COOKIES = {
  sessionToken: {
    name: '${SessionCookieResolver.SECURE_SESSION_COOKIE_NAME}',
    options: { httpOnly: true, sameSite: 'lax', path: '/', secure: true },
  },
  callbackUrl: {
    name: '${SessionCookieResolver.SECURE_CALLBACK_URL_COOKIE_NAME}',
    options: { httpOnly: true, sameSite: 'lax', path: '/', secure: true },
  },
};
Object.defineProperty(authOptions, 'cookies', {
  enumerable: true,
  get: function () {
    return String(process.env.NEXTAUTH_URL || '').indexOf('https://') === 0 ? SECURE_SESSION_COOKIES : undefined;
  },
});

module.exports = authOptions;
module.exports.sanitizeUser = sanitizeUser;
${
  auth.passwordAuthEnabled
    ? `module.exports.findUserByEmail = findUserByEmail;\nmodule.exports.findSignupUserByEmail = findSignupUserByEmail;\nmodule.exports.createUser = createUser;\nmodule.exports.userExistsByEmail = userExistsByEmail;\n`
    : ''
}${
    withPassword
      ? `module.exports.findUserById = findUserById;
module.exports.checkSignInAllowed = checkSignInAllowed;
module.exports.countSignInFailure = countSignInFailure;
module.exports.SIGN_IN_VISITOR_HEADER = SIGN_IN_VISITOR_HEADER;
module.exports.storePasswordReset = storePasswordReset;
module.exports.consumePasswordReset = consumePasswordReset;
module.exports.passwordResetIsLive = passwordResetIsLive;
module.exports.PASSWORD_RESET_SUPPORTED = PASSWORD_RESET_SUPPORTED;
`
      : ''
  }
`
}

// The jwt callback's refresh without password sign-in (no local lookup exists).
const PLAIN_REFRESH_CODE = `      try {
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
`

// With password sign-in: a stamped session follows its account BY ID (the key
// every consumer acts on), so a deleted account or a changed password ends it
// even after an email change; an unstamped one (an OAuth sign-in, a token from
// before stamps) adopts the local account by its email.
const PASSWORD_REFRESH_CODE = `      let revoked = false;
      try {
        const stamped = !!token && typeof token['${SESSION_STAMP_KEY}'] === 'string';
        const accountId = token && (token.id != null ? token.id : token.sub);
        let fresh = null;
        let looked = false;
        if (stamped && typeof findUserById === 'function') {
          fresh = accountId != null ? await findUserById(String(accountId)) : null;
          looked = true;
        } else if (token && token.email && typeof findUserByEmail === 'function') {
          fresh = await findUserByEmail(String(token.email));
          looked = true;
        }
        if (looked) {
          // The account's password (or session_version) changed since this
          // token was stamped, or the account is gone: the session is over.
          // Otherwise the token takes the stamp of the account as it is now.
          revoked = sessionStampCheck(token, fresh) === 'revoked';
          const safe = !revoked && fresh && typeof sanitizeUser === 'function' ? sanitizeUser(fresh) : null;
          if (safe && typeof safe === 'object') {
            const fk = Object.keys(safe);
            for (let i = 0; i < fk.length; i++) {
              token[fk[i]] = safe[fk[i]];
            }
          }
        }
`

/**
 * auth-options helpers for password sign-in: the sign-in throttle (failures
 * per visitor and email, counted after a wrong password, checked by the
 * NextAuth route before the next attempt) and the session stamp
 * (`utils/auth/session-revocation.js`).
 */
const CREDENTIAL_SESSION_HELPERS = `// Sign-in throttle. The NextAuth route refuses a visitor's next sign-in for an
// email once SIGN_IN_FAILURE_LIMIT failures for it are in the window, once the
// visitor has SIGN_IN_VISITOR_FAILURE_LIMIT failures across all emails, or once
// they tried it SIGN_IN_ATTEMPT_LIMIT times (so a burst of parallel guesses
// cannot all start before the first failure is counted). The route writes who
// the visitor is on the request (SIGN_IN_VISITOR_HEADER, replacing whatever the
// request carried), because NextAuth hands authorize() the headers only.
var SIGN_IN_VISITOR_HEADER = 'x-teleport-signin-visitor';
var SIGN_IN_FAILURE_SCOPE = 'auth-signin-failures';
var SIGN_IN_FAILURE_LIMIT = ${SIGN_IN_FAILURE_LIMIT};
var SIGN_IN_ATTEMPT_SCOPE = 'auth-signin-attempts';
var SIGN_IN_ATTEMPT_LIMIT = ${SIGN_IN_ATTEMPT_LIMIT};
var SIGN_IN_WINDOW_SECONDS = ${SIGN_IN_WINDOW_SECONDS};
// Failures one visitor may make across every email (credential stuffing tries
// many addresses once each), counted the same way: after a failure only.
var SIGN_IN_VISITOR_FAILURE_SCOPE = 'auth-signin-visitor-failures';
var SIGN_IN_VISITOR_FAILURE_LIMIT = ${SIGN_IN_VISITOR_FAILURE_LIMIT};

function signInVisitorRequest(req) {
  var headers = (req && req.headers) || {};
  var visitor = headers[SIGN_IN_VISITOR_HEADER];
  return { headers: {}, socket: { remoteAddress: typeof visitor === 'string' ? visitor : '' } };
}

function signInEmailKey(email) {
  return String(email == null ? '' : email).trim().toLowerCase();
}

// { allowed, retryAfter } for the sign-in the request is about to make.
async function checkSignInAllowed(req) {
  var security = require('../security-runtime');
  var visitor = signInVisitorRequest(req);
  var email = signInEmailKey(req && req.body ? req.body.email : '');
  var failures = await security.peekRateLimitRequest(visitor, {
    scope: SIGN_IN_FAILURE_SCOPE,
    limit: SIGN_IN_FAILURE_LIMIT,
    windowSeconds: SIGN_IN_WINDOW_SECONDS,
    keyParts: [email],
  });
  if (!failures.allowed) {
    return failures;
  }
  var visitorFailures = await security.peekRateLimitRequest(visitor, {
    scope: SIGN_IN_VISITOR_FAILURE_SCOPE,
    limit: SIGN_IN_VISITOR_FAILURE_LIMIT,
    windowSeconds: SIGN_IN_WINDOW_SECONDS,
  });
  if (!visitorFailures.allowed) {
    return visitorFailures;
  }
  var attemptAllowed = await security.rateLimitRequest(visitor, null, {
    scope: SIGN_IN_ATTEMPT_SCOPE,
    limit: SIGN_IN_ATTEMPT_LIMIT,
    windowSeconds: SIGN_IN_WINDOW_SECONDS,
    keyParts: [email],
  });
  if (!attemptAllowed) {
    var nowSec = Math.floor(Date.now() / 1000);
    return { allowed: false, retryAfter: Math.max(1, SIGN_IN_WINDOW_SECONDS - (nowSec % SIGN_IN_WINDOW_SECONDS)) };
  }
  return { allowed: true, retryAfter: 0 };
}

async function countSignInFailure(req, email) {
  try {
    var security = require('../security-runtime');
    var visitor = signInVisitorRequest(req);
    await security.rateLimitRequest(visitor, null, {
      scope: SIGN_IN_FAILURE_SCOPE,
      limit: SIGN_IN_FAILURE_LIMIT,
      windowSeconds: SIGN_IN_WINDOW_SECONDS,
      keyParts: [signInEmailKey(email)],
    });
    await security.rateLimitRequest(visitor, null, {
      scope: SIGN_IN_VISITOR_FAILURE_SCOPE,
      limit: SIGN_IN_VISITOR_FAILURE_LIMIT,
      windowSeconds: SIGN_IN_WINDOW_SECONDS,
    });
  } catch (err) {
    console.error('[auth] Could not count a failed sign-in:', err && err.message ? err.message : err);
  }
}

// The shared session-stamp check (utils/auth/session-revocation.js).
function sessionRevocationModule() {
  try {
    var revocation = require('./${SESSION_REVOCATION_FILE_NAME}');
    return revocation && typeof revocation.stampVerdict === 'function' ? revocation : null;
  } catch (e) {
    return null;
  }
}

// A signed-in user's session carries the stamp of the account it was issued for.
function withSessionStamp(safeUser, row) {
  var revocation = sessionRevocationModule();
  var stamp = revocation ? revocation.credentialStamp(row) : null;
  if (safeUser && stamp) {
    safeUser[revocation.SESSION_STAMP_KEY] = stamp;
  }
  return safeUser;
}

// 'revoked' when the stored account no longer matches the token's stamp;
// otherwise the token takes the account's current stamp.
function sessionStampCheck(token, row) {
  var revocation = sessionRevocationModule();
  if (!revocation) {
    return 'unchecked';
  }
  var verdict = revocation.stampVerdict(token, row || null);
  if (verdict !== 'revoked' && row) {
    var stamp = revocation.credentialStamp(row);
    if (stamp) {
      token[revocation.SESSION_STAMP_KEY] = stamp;
    }
  }
  return verdict;
}`

/**
 * The user stores whose own account ids can never equal an OAuth provider's id:
 * MongoDB (`_id`, a 24-hex ObjectId), Airtable (`rec…` record ids) and
 * Firestore (20-character auto ids). Read from `auth.dataSourceType`, the same
 * value that picks the auth driver.
 */
const STORES_WITH_DISJOINT_IDS = new Set(['mongodb', 'airtable', 'firestore'])

/**
 * Whether an OAuth session's id must be namespaced (`oauth:<provider>:<id>`)
 * because the provider's raw account id could equal another account's id:
 * - the project has more than one OAuth provider: two providers' id spaces
 *   can collide, whatever the store;
 * - otherwise a store whose ids are its own (STORES_WITH_DISJOINT_IDS) keeps
 *   the raw id;
 * - any other store (SQL or not) is decided by the declared `users` id type:
 *   a UUID keeps the raw id; any other type (a provider's integer id can equal
 *   a local integer id on every owner rule), or none declared, namespaces.
 * The editor declares the type the database reported for its `users` table
 * (teleport-gui `liveUsersIdType`), and no type when none was recorded.
 * Where the raw id stays it never equals a local id, and every record a
 * published site wrote under it (entitlements, cart, favourites, chats,
 * downloads) stays the visitor's. Wherever a collision cannot be ruled out the
 * id is namespaced: a collision hands one person another's records, which no
 * later fix undoes; lost continuity leaves the records in place under the old
 * id.
 */
export const oauthIdsNeedNamespace = (auth: UIDLAuthentication): boolean => {
  if ((auth.providers || []).length > 1) {
    return true
  }
  if (auth.dataSourceType && STORES_WITH_DISJOINT_IDS.has(auth.dataSourceType)) {
    return false
  }
  const idColumn = ((auth.tables && auth.tables.users) || []).find(
    (column) => !!column && String(column.name || '').toLowerCase() === 'id'
  )
  return !(idColumn && /^\s*uuid\b/i.test(String(idColumn.type || '')))
}

/**
 * auth-options helpers for a project with password sign-in AND an OAuth
 * provider: whether the provider vouches for the email an OAuth sign-in
 * presents. Only then may that sign-in become the local account with the same
 * email (its id and role); otherwise it is a session of its own.
 */
const generateOAuthEmailVerificationHelpers = (auth: UIDLAuthentication): string => {
  const tenants = microsoftTenantEnvKeys(auth)
  const tenantEntries = Object.keys(tenants)
    .map((id) => `${JSON.stringify(id)}: process.env.${tenants[id]}`)
    .join(', ')
  return `// Providers that only ever hand out an email its owner proved. Any other
// provider must say so in the profile (email_verified); an explicit "not
// verified" outweighs the list.
var VERIFIED_EMAIL_PROVIDERS = { google: true, apple: true };
var OAUTH_UNVERIFIED = '__oauthUnverified';
// A provider's raw account id could equal another account's id here (see
// oauthIdsNeedNamespace in the code generator): sessions without a local
// account take the provider's id as "oauth:<provider>:<id>".
var OAUTH_IDS_NAMESPACED = ${JSON.stringify(oauthIdsNeedNamespace(auth))};

// Microsoft (Azure AD / Entra ID) tokens carry no email_verified, and on the
// multi-tenant endpoint the email claim is whatever the signing-in tenant's
// administrator set (the "nOAuth" class). An email counts only when the token
// says its domain is verified (xms_edov), or when the provider is configured
// for one specific tenant (an id or a domain, never common / organizations /
// consumers): the site owner's own directory.
var MICROSOFT_PROVIDERS = { 'azure-ad': true, 'microsoft-entra-id': true };
var MICROSOFT_TENANTS = { ${tenantEntries} };
var MICROSOFT_TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The one tenant a Microsoft provider is configured for, or '' (multi-tenant).
function microsoftTenantOf(value) {
  var raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw || raw.indexOf('teleporthq.secrets.') === 0) {
    return '';
  }
  var fromIssuer = /^https:\\/\\/login\\.microsoftonline\\.com\\/([^\\/?#]+)/.exec(raw);
  var tenant = fromIssuer ? fromIssuer[1] : raw;
  if (tenant === 'common' || tenant === 'organizations' || tenant === 'consumers') {
    return '';
  }
  return MICROSOFT_TENANT_ID.test(tenant) || /^[a-z0-9-]+(\\.[a-z0-9-]+)+$/.test(tenant) ? tenant : '';
}

function microsoftEmailIsVerified(provider, claims) {
  if (claims.xms_edov === true || claims.xms_edov === 'true' || claims.xms_edov === 1) {
    return true;
  }
  var tenant = microsoftTenantOf(MICROSOFT_TENANTS[provider]);
  if (!tenant) {
    return false;
  }
  // A tenant given by id must be the one the token was issued in.
  if (MICROSOFT_TENANT_ID.test(tenant) && claims.tid != null && String(claims.tid).toLowerCase() !== tenant) {
    return false;
  }
  return true;
}

// GitHub's profile email is not always a verified one: ask GitHub (the
// provider requests the user:email scope) whether this address is.
async function githubEmailIsVerified(account, email) {
  if (!account || !account.access_token || !email) {
    return false;
  }
  try {
    var res = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: 'Bearer ' + account.access_token,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'teleporthq-auth',
      },
    });
    if (!res.ok) {
      return false;
    }
    var list = await res.json();
    var wanted = String(email).toLowerCase();
    return Array.isArray(list) && list.some(function (entry) {
      return !!entry && entry.verified === true && String(entry.email || '').toLowerCase() === wanted;
    });
  } catch (e) {
    return false;
  }
}

async function oauthEmailIsVerified(account, profile, token) {
  var claims = profile || {};
  if (claims.email_verified === false || claims.email_verified === 'false') {
    return false;
  }
  if (claims.email_verified === true || claims.email_verified === 'true') {
    return true;
  }
  var provider = String((account && account.provider) || '');
  if (provider === 'github') {
    return githubEmailIsVerified(account, token && token.email);
  }
  if (MICROSOFT_PROVIDERS[provider] === true) {
    return microsoftEmailIsVerified(provider, claims);
  }
  return VERIFIED_EMAIL_PROVIDERS[provider] === true;
}

// The provider's own account id as "oauth:<provider>:<id>": a namespace no
// local account id can share (a provider's integer ids would otherwise match
// local integer ids on owner rules). Where no id can collide, the raw id stays.
function namespaceOAuthId(token, account) {
  if (!OAUTH_IDS_NAMESPACED) {
    return;
  }
  var accountId = String((account && account.providerAccountId) || token.sub || token.id || '');
  var id = 'oauth:' + String((account && account.provider) || 'provider') + ':' + accountId;
  token.id = id;
  token.sub = id;
}

// Not vouched for: the visitor keeps a session under an id no local account can
// have (namespaced where one could), with no email to be matched by and no role.
function asDistinctOAuthIdentity(token, account) {
  namespaceOAuthId(token, account);
  delete token.email;
  delete token.role;
  delete token.roleName;
  delete token.roles;
  token[OAUTH_UNVERIFIED] = true;
}`
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
  TooManyAttempts: 'Too many sign-in attempts. Please wait a few minutes and try again.',

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

/** The password a site accepts when one is set (sign-up, reset, a change). */
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_BYTES = 128

export const generateHashPasswordFile = (): string => {
  return `const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const COST_FACTOR = 12;
const MIN_PASSWORD_LENGTH = ${MIN_PASSWORD_LENGTH};
const MAX_PASSWORD_BYTES = ${MAX_PASSWORD_BYTES};

// Two peppers. AUTH_PEPPER_SECRET is the project's own random secret, which the
// deploy step provisions; every new hash uses it. AUTH_PEPPER (the project id,
// no secret) is the one every hash was made with before it existed: such a hash
// still verifies, and the sign-in replaces it. Without the secret, hashing and
// verifying stay on the old pepper — never on none.
function pepperSecret() {
  var value = process.env.AUTH_PEPPER_SECRET;
  return typeof value === 'string' && value && value.indexOf('teleporthq.secrets.') !== 0 ? value : '';
}

function legacyPepper() {
  return process.env.AUTH_PEPPER || '';
}

// SHA-256 first, so bcrypt (which reads at most 72 bytes) sees all of it.
function prepare(password, pepper) {
  const str = String(password);
  if (str.length > 1000) {
    throw new Error('Password exceeds maximum length');
  }
  return crypto.createHash('sha256').update(str + pepper).digest('base64');
}

function hashPassword(password) {
  return bcrypt.hashSync(prepare(password, pepperSecret() || legacyPepper()), COST_FACTOR);
}

// A hash no password matches, made once per process with the project pepper
// at the same cost. An address without an account, or a row without a
// password (a subscriber, a guest), is checked against it, so every failed
// sign-in does the bcrypt work a wrong password does: the time never tells
// them apart.
var __standInHash = null;
function standInHash() {
  if (!__standInHash) {
    __standInHash = bcrypt.hashSync(prepare(crypto.randomBytes(32).toString('hex'), pepperSecret() || legacyPepper()), COST_FACTOR);
  }
  return __standInHash;
}

// { ok, needsRehash }: ok when the password matches; needsRehash when it
// matched through the old pepper while the project has its own.
function checkPassword(password, hash) {
  var known = typeof hash === 'string' && hash !== '';
  var against = known ? hash : standInHash();
  var secret = pepperSecret();
  if (secret && bcrypt.compareSync(prepare(password, secret), against) && known) {
    return { ok: true, needsRehash: false };
  }
  // Run on every miss, whatever the hash was.
  if (bcrypt.compareSync(prepare(password, legacyPepper()), against) && known) {
    return { ok: true, needsRehash: !!secret };
  }
  return { ok: false, needsRehash: false };
}

function verifyPassword(password, hash) {
  return checkPassword(password, hash).ok;
}

// Why a password may not be set, or '' when it may.
function passwordPolicyError(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return 'Password must be at least ' + MIN_PASSWORD_LENGTH + ' characters';
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return 'Password is too long (at most ' + MAX_PASSWORD_BYTES + ' bytes)';
  }
  return '';
}

module.exports = hashPassword;
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
module.exports.checkPassword = checkPassword;
module.exports.passwordPolicyError = passwordPolicyError;
`
}

export interface NextAuthRouteOptions {
  /** Credentials sign-in is on: the route throttles it (see checkSignInAllowed). */
  passwordAuthEnabled?: boolean
}

// Answered to a credentials sign-in the throttle refuses, in the shape
// next-auth/react's signIn() reads (it parses \`url\` for the error code, which
// describeAuthError turns into copy).
const SIGN_IN_THROTTLE_CODE = `var __security = require('${securityRuntimeSpecifier('../../..')}');

function isCredentialsSignIn(req) {
  var parts = req && req.query ? req.query.nextauth : null;
  return (
    req && req.method === 'POST' && Array.isArray(parts) && parts[0] === 'callback' && parts[1] === 'credentials'
  );
}

function refuseSignIn(res, status, code, message, retryAfter) {
  var origin = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  var url;
  try {
    url = new URL('/api/auth/error?error=' + code, origin).toString();
  } catch (e) {
    url = 'http://localhost:3000/api/auth/error?error=' + code;
  }
  if (retryAfter) {
    res.setHeader('Retry-After', String(retryAfter));
  }
  res.status(status).json({ url: url, error: message });
}

// Too many failed (or attempted) sign-ins for this email from this visitor:
// refused before the password is even looked at.
async function throttleCredentialsSignIn(req, res) {
  if (req && req.headers) {
    delete req.headers[authOptions.SIGN_IN_VISITOR_HEADER];
  }
  if (!isCredentialsSignIn(req)) {
    return false;
  }
  req.headers[authOptions.SIGN_IN_VISITOR_HEADER] = __security.clientIp(req);
  var verdict;
  try {
    verdict = await authOptions.checkSignInAllowed(req);
  } catch (err) {
    console.error('[auth] The sign-in throttle failed:', err && err.message ? err.message : err);
    refuseSignIn(res, 503, 'ServiceUnavailable', 'Sign-in is unavailable right now. Please try again in a moment.', 0);
    return true;
  }
  if (verdict && verdict.allowed) {
    return false;
  }
  refuseSignIn(
    res,
    429,
    'TooManyAttempts',
    'Too many sign-in attempts. Try again later.',
    verdict && verdict.retryAfter ? verdict.retryAfter : ${SIGN_IN_WINDOW_SECONDS}
  );
  return true;
}

`

export const generateNextAuthRouteFile = (options: NextAuthRouteOptions = {}): string => {
  const throttled = options.passwordAuthEnabled === true
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
// always respected; a local host gets its own plain-http origin.
//
// "Explicitly configured" means a REAL absolute http(s) origin. Project
// a62338f9 shipped \`NEXTAUTH_URL=teleporthq.secrets.NEXTAUTH_URL\` — an
// unresolved placeholder — and the old check saw a non-empty, non-localhost
// string and refused to override it. NextAuth then normalised it to
// \`https://teleporthq.secrets.nextauth_url\`, advertised that as the sign-in
// origin and issued \`__Host-\`/\`__Secure-\` cookies against it. Treating anything
// that is not a usable URL as unset lets an already-published site self-heal on
// its next request.
//
// The origin is decided PER REQUEST, from the value the deployment configured —
// read once, here, before any request could have rewritten it. It used to be
// written back into process.env and kept: one request through a tunnel (an
// ngrok URL forwarding webhooks to a local dev server) made every later
// localhost request run under the tunnel's https origin, so NextAuth issued
// "__Secure-" cookies on localhost beside the plain ones it had issued before,
// and the middleware — reading the plain, stale one — refused a signed-in admin.
// NextAuth reads process.env.NEXTAUTH_URL synchronously when the handler is
// entered, so setting it right before the call is exact for this request.
//
// The configured value is kept on globalThis, once per process: a dev server
// re-evaluates this module on every change, and by then process.env holds
// whatever the last request set — capturing it again would make that request's
// host look configured.
const CONFIGURED_NEXTAUTH_URL = (function () {
  const store = globalThis;
  if (typeof store.__tqConfiguredNextAuthUrl !== 'string') {
    const raw = process.env.NEXTAUTH_URL;
    store.__tqConfiguredNextAuthUrl = isUsableNextAuthUrl(raw) ? raw : '';
    if (raw && !store.__tqConfiguredNextAuthUrl) {
      console.error(
        '[auth] NEXTAUTH_URL is not a usable origin (' + raw + ') — deriving it from each request instead.'
      );
    }
  }
  return store.__tqConfiguredNextAuthUrl;
})();

function isLocalHost(host) {
  const name = String(host || '').toLowerCase();
  return (
    name.indexOf('localhost') === 0 ||
    name.indexOf('127.0.0.1') === 0 ||
    name.indexOf('[::1]') === 0 ||
    name.indexOf('0.0.0.0') === 0
  );
}

function firstHeaderValue(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.split(',')[0].trim() : '';
}

// The origin NextAuth builds its URLs and cookie names from for THIS request:
// the configured one when it names a real (non-local) domain, else the
// request's own host and protocol — plain http for a local host.
function resolveRequestOrigin(req) {
  const configuredIsLocal =
    CONFIGURED_NEXTAUTH_URL.indexOf('localhost') !== -1 ||
    CONFIGURED_NEXTAUTH_URL.indexOf('127.0.0.1') !== -1;
  if (CONFIGURED_NEXTAUTH_URL && !configuredIsLocal) {
    return CONFIGURED_NEXTAUTH_URL;
  }
  const headers = (req && req.headers) || {};
  const host = firstHeaderValue(headers['x-forwarded-host']) || firstHeaderValue(headers.host);
  if (!host) {
    return CONFIGURED_NEXTAUTH_URL || 'http://localhost:3000';
  }
  const proto =
    firstHeaderValue(headers['x-forwarded-proto']) || (isLocalHost(host) ? 'http' : 'https');
  return proto + '://' + host;
}

${throttled ? SIGN_IN_THROTTLE_CODE : ''}module.exports = ${
    throttled ? 'async ' : ''
  }function nextAuthRoute(req, res) {
  try {
    process.env.NEXTAUTH_URL = resolveRequestOrigin(req);
  } catch (e) {
    /* fall back to whatever NEXTAUTH_URL holds */
  }
${
  throttled
    ? `  if (await throttleCredentialsSignIn(req, res)) {
    return;
  }
`
    : ''
}  return authHandler(req, res);
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
  // Per-language copies of the subject/body (main language excluded); the
  // route sends the copy matching the language the signup came from.
  localizedTemplates?: UIDLLocalizedEmailTemplates
  siteName?: string
}

/** The business events an account route records (spec §5.1). */
export interface AccountEventOptions {
  /** The project has the in-app event bus (`hasAutomationsBus`). */
  withAutomations?: boolean
}

/**
 * `recordAccountEvent(type, user, source, req)`, for the account routes of a
 * project with automations: records `user-signed-up` / `user-deleted` on the
 * in-app event bus, which writes the `teleport_events` row and wakes the
 * automations off the request path, on the app's own origin as `req` reached
 * it. Only the profile fields go into the event, never a credential. It never
 * throws, so the event cannot fail the request it records. `relativePrefix`
 * leads from the route to the project root.
 */
export const generateAccountEventRecorder = (options: {
  relativePrefix: string
  logTag: string
}): string => `
// The project has automations: the account event wakes them. Best effort,
// like the emails: recording it can never fail the request.
function accountEventTime(value) {
  var date = value ? new Date(value) : new Date();
  return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

async function recordAccountEvent(type, user, source, req) {
  try {
    var userId = user ? user.id || user._id : null;
    if (!userId) { return; }
    var id = String(userId);
    var email = user.email ? String(user.email) : '';
    var bus = require('${options.relativePrefix}/${AUTOMATIONS_PATH.join('/')}/event-bus');
    await bus.emitBusinessEvent({
      type: type,
      entityType: 'user',
      entityId: id,
      payload: {
        user: {
          id: id,
          email: email || null,
          name: user.name || null,
          role: user.role || null,
          source: source || user.source || null,
          createdAt: accountEventTime(user.created_at || user.createdAt),
        },
      },
      actor: email,
      actorType: 'customer',
      dedupeKey: type + ':' + id,
    }, req);
  } catch (eventErr) {
    var reason = eventErr && eventErr.message ? eventErr.message : eventErr;
    console.error('${options.logTag} could not record the ' + type + ' event:', reason);
  }
}
`

/**
 * A user column that grants something — a role, an admin or staff flag, a
 * verified email, credit, a plan or an entitlement — in any spelling
 * (`is_admin`, `isAdmin`, `Email-Verified`). Only the server sets these; a
 * sign-up never takes them from the visitor. The one shared rule
 * (`AccountFields.isPrivilegedAccountField`).
 */
export const isPrivilegedUserField = (key: string): boolean =>
  AccountFields.isPrivilegedAccountField(key)

/** Config keys of an `account-signup` node that are not user fields. */
const SIGNUP_NODE_NON_FIELD_KEYS = new Set<string>([
  'email',
  'password',
  'name',
  'image',
  'role',
  ...WELCOME_EMAIL_CONFIG_KEYS,
])

/**
 * The fields a sign-up may write besides email, password and name: the avatar
 * (`image`) and each declared custom account property that a sign-up form of
 * the project collects (a key of an `account-signup` node), never a
 * privileged one.
 */
export const resolveSignupFields = (
  auth: UIDLAuthentication,
  signupNodeConfigs: Array<Record<string, unknown>>
): string[] => {
  const declared = new Set((auth.customUserProperties || []).map((prop) => prop.key))
  const collected = new Set<string>()
  for (const config of signupNodeConfigs) {
    for (const key of Object.keys(config || {})) {
      if (
        !SIGNUP_NODE_NON_FIELD_KEYS.has(key) &&
        declared.has(key) &&
        !isPrivilegedUserField(key)
      ) {
        collected.add(key)
      }
    }
  }
  return ['image', ...Array.from(collected).sort()]
}

export interface SignupRouteOptions {
  /** `resolveSignupFields` — what a sign-up may write besides email, password, name. */
  fields?: string[]
  /**
   * The page the set-password link opens and where it carries its token: the
   * project's reset link (`resetLinkOf`). Default: `/reset-password`, `?token=`.
   */
  resetPagePath?: string
  tokenInFragment?: boolean
  /**
   * The forgot-password node's sender (`resetEmailSenderOf`): the emails to an
   * address the site already knows go through it when the sign-up node has no
   * email provider.
   */
  noticeEmail?: KnownAddressEmailSender
  /**
   * The project has the newsletter, and the sign-up form's box joins it: a
   * ticked box (consent) also subscribes the new account through the
   * newsletter helper (`subscribeNewsletterPerson`, sign-up point `signup`).
   */
  newsletter?: boolean
}

/**
 * After a new account with a ticked consent box: the newsletter helper adds it
 * (double opt-in, the `newsletter-subscribed` event, the newsletter's welcome
 * unless the account's own went out). Best effort, like the welcome email.
 */
const SIGNUP_NEWSLETTER_CODE = `    // The ticked box also subscribes the person to the newsletter.
    if (userData.marketing_consent) {
      try {
        const __newsletter = require('../../../utils/newsletter/newsletter');
        await __newsletter.withNewsletterDb(function (db) {
          return __newsletter.subscribeNewsletterPerson({ db: db, email: email, signUpPoint: 'signup', req: req });
        });
      } catch (newsletterErr) {
        console.error('[account-signup] newsletter sign-up failed:', newsletterErr && newsletterErr.message ? newsletterErr.message : newsletterErr);
      }
    }
`

/** An email sender baked into a route: provider id without `email-`, sender, credential env var. */
export interface KnownAddressEmailSender {
  emailProvider?: string | null
  fromEmail?: string
  emailSecretEnvName?: string | null
}

/**
 * The answer to a sign-up for an address the site already knows (an account,
 * or a row without a password) takes at least this long, as the
 * forgot-password answer does: the two are answered alike, and the time must
 * not tell them apart either.
 */
export const KNOWN_ADDRESS_MIN_RESPONSE_MS = 1200

/**
 * The sign-up route's emails to an address the site already knows, sent
 * through `sender` (the sign-up node's, else the forgot-password node's):
 * `sendAccountNotice(emailType, msg, logged)`, which sends and records the
 * email under its own purpose (with what the log may keep), and
 * `sendSetPasswordEmail(user, siteName, req)`, the link for an address without
 * a password, built on the forgot-password token flow (a CSPRNG token whose
 * SHA-256 alone is stored against the account, the same lifetime, origin rule
 * and reset page).
 */
const generateKnownAddressEmailCode = (options: {
  sender: { provider: string | null; from: string; secretEnv: string }
  pagePath: string
  tokenInFragment: boolean
}): string => {
  const { sender } = options
  const senderConstants = `
// Who sends the emails to an address the site already knows: the sign-up
// node's email settings, else the forgot-password node's.
const NOTICE_EMAIL_PROVIDER = ${JSON.stringify(sender.provider)};
const NOTICE_EMAIL_FROM = ${JSON.stringify(sender.from)};
const NOTICE_EMAIL_SECRET_ENV_NAME = ${JSON.stringify(sender.secretEnv)};`
  if (!sender.provider) {
    return `${senderConstants}

// No email provider: nothing is sent to an address the site already knows.
async function sendAccountNotice() {}

// A sign-up for an address the site knows without a password mails its owner
// a link to set one; this project has no email provider, so none is sent.
async function sendSetPasswordEmail() {
  console.warn('[account-signup] set-password link not sent: no email provider is configured');
}`
  }
  const ttlMinutes = Math.round(PASSWORD_RESET_TOKEN_TTL_SECONDS / 60)
  // Where the link carries the token, as the forgot-password link does.
  const tokenLinkPrefix = options.tokenInFragment ? '#token=' : '?token='
  const noticeSend = generateProviderSendFunction(sender.provider).replace(
    'async function __sendProviderEmail(',
    'async function __sendNoticeEmail('
  )
  return `${senderConstants}

${noticeSend}

var __noticeEmailLog = require('../../../utils/email/sent-email-log');

// Sends one of these emails and records it under its own purpose, with what
// the log may keep of it (\`logged\`: a link's token hidden).
async function sendAccountNotice(emailType, msg, logged) {
  var failure = null;
  try {
    await __sendNoticeEmail(msg);
  } catch (err) {
    failure = err;
  }
  __noticeEmailLog.recordSentEmail({
    emailType: emailType,
    audience: 'customer',
    to: msg.to,
    from: msg.from,
    subject: logged.subject,
    html: logged.html,
    payload: logged.payload,
    provider: NOTICE_EMAIL_PROVIDER,
    status: failure ? 'failed' : 'sent',
    error: failure ? (failure.message || String(failure)) : null,
    source: 'signup',
    sourceRef: 'api/auth/signup',
    userId: msg.userId,
  });
  if (failure) { throw failure; }
}

// A sign-up for an address the site knows without a password (a newsletter
// subscriber, a checkout or booking guest, a contact the owner added) never
// takes that row: whoever typed the address may not own it. Its owner is mailed
// a link to set a password instead, a password-reset link minted and stored as
// the forgot-password route mints it, at most ${EXISTING_ACCOUNT_EMAIL_LIMIT} an hour per address
// (counted with the "already have an account" email).
var SET_PASSWORD_SUBJECT = 'Set your password to finish creating your account';
var SET_PASSWORD_BODY_HTML =
  '<p>Someone, hopefully you, tried to create an account{{siteNameSuffix}} with this email address.</p>' +
  '<p>This address is already known here (from a newsletter sign-up or an order, for example), but it has no password yet. Set one to finish creating your account:</p>' +
  '<p><a href="{{resetUrl}}">Set your password</a></p>' +
  '<p>The link works for ${ttlMinutes} minutes. If this was not you, you can ignore this email: nothing has changed.</p>';
var SET_PASSWORD_PAGE_PATH = ${JSON.stringify(options.pagePath)};
var SET_PASSWORD_TOKEN_LINK_PREFIX = ${JSON.stringify(tokenLinkPrefix)};
var SET_PASSWORD_TOKEN_TTL_SECONDS = ${PASSWORD_RESET_TOKEN_TTL_SECONDS};

${TRUSTED_ORIGIN_CODE}

// The token, wherever it appears, for what the sent-email log keeps: whoever
// can read the log must not be able to set the password with it.
function hideToken(text, token) {
  return String(text == null ? '' : text).split(token).join('[hidden]');
}

async function sendSetPasswordEmail(user, siteName, req) {
  var toEmail = String(user.email || '');
  var userId = user.id != null ? user.id : user._id;
  var apiKey = NOTICE_EMAIL_SECRET_ENV_NAME ? process.env[NOTICE_EMAIL_SECRET_ENV_NAME] : '';
  if (apiKey && String(apiKey).indexOf('teleporthq.secrets.') === 0) { apiKey = ''; }
  var from = NOTICE_EMAIL_FROM || process.env.EMAIL_FROM || '';
  if (!apiKey || !from) { console.warn('[account-signup] set-password link not sent: the email credential or sender is not set'); return; }
  if (!toEmail || userId == null) { return; }
  var allowed = await __security.rateLimit({
    key: 'auth-signup-existing:' + toEmail.trim().toLowerCase(),
    limit: ${EXISTING_ACCOUNT_EMAIL_LIMIT},
    windowSeconds: 3600,
  });
  if (!allowed.allowed) { return; }
  var crypto = require('crypto');
  var token = crypto.randomBytes(32).toString('hex');
  await authUtils.storePasswordReset(userId, crypto.createHash('sha256').update(token).digest('hex'), SET_PASSWORD_TOKEN_TTL_SECONDS);
  var resetUrl = trustedOrigin(req) + SET_PASSWORD_PAGE_PATH + SET_PASSWORD_TOKEN_LINK_PREFIX + token;
  var html = fillTemplate(SET_PASSWORD_BODY_HTML, { siteNameSuffix: siteName ? ' on ' + siteName : '', resetUrl: resetUrl });
  await sendAccountNotice(
    ${JSON.stringify(SET_PASSWORD_EMAIL)},
    { from: from, to: toEmail, subject: SET_PASSWORD_SUBJECT, html: html, apiKey: apiKey, userId: userId },
    {
      subject: SET_PASSWORD_SUBJECT,
      html: hideToken(html, token),
      payload: { resetUrl: hideToken(resetUrl, token), recipientEmail: toEmail },
    }
  );
}`
}

export const generateSignupRouteFile = (
  auth: UIDLAuthentication,
  welcome: WelcomeEmailOptions = {},
  events: AccountEventOptions = {},
  signup: SignupRouteOptions = {}
): string => {
  const needsDb = !!auth.dataSourceType
  const recordsSignup = needsDb && events.withAutomations === true
  const welcomeProvider =
    welcome.emailProvider && SUPPORTED_EMAIL_PROVIDERS.has(welcome.emailProvider)
      ? welcome.emailProvider
      : null
  // An ALLOW-list: the only body keys copied onto the new user row. Whatever
  // else the body carries (a role, `is_admin`, `email_verified`, credits, a
  // plan, a welcome-email config key) never reaches createUser. The columns
  // the route sets itself (source, consent) are never copied from it either.
  const signupFields = (signup.fields || ['image']).filter(
    (field) => field && !isPrivilegedUserField(field) && SIGNUP_OWN_COLUMNS.indexOf(field) === -1
  )
  const setPasswordPagePath = resolveResetPagePath(signup.resetPagePath)
  // The emails to an address the site already knows go through the sign-up
  // node's sender, else the forgot-password node's.
  const fallbackSender = signup.noticeEmail || {}
  const noticeSender = welcomeProvider
    ? {
        provider: welcomeProvider,
        from: welcome.fromEmail || '',
        secretEnv: welcome.emailSecretEnvName || '',
      }
    : {
        provider:
          fallbackSender.emailProvider &&
          SUPPORTED_EMAIL_PROVIDERS.has(fallbackSender.emailProvider)
            ? fallbackSender.emailProvider
            : null,
        from: fallbackSender.fromEmail || '',
        secretEnv: fallbackSender.emailSecretEnvName || '',
      }
  let dbImport = ''
  let createUserCall = ''
  let welcomeHelpers = ''

  if (needsDb) {
    dbImport = `const authUtils = require('../../../utils/auth/auth-options');
const createUser = authUtils.createUser;
const findSignupUserByEmail = authUtils.findSignupUserByEmail;`

    // Baked welcome-email helpers + config (no-op send when no provider set).
    welcomeHelpers = `
const WELCOME_EMAIL_PROVIDER = ${JSON.stringify(welcomeProvider)};
const WELCOME_EMAIL_FROM = ${JSON.stringify(welcome.fromEmail || '')};
const WELCOME_EMAIL_SECRET_ENV_NAME = ${JSON.stringify(welcome.emailSecretEnvName || '')};
const WELCOME_EMAIL_SUBJECT = ${JSON.stringify(welcome.emailSubject || 'Welcome')};
const WELCOME_EMAIL_BODY_HTML = ${JSON.stringify(welcome.emailBodyHtml || '')};
const WELCOME_EMAIL_LOCALIZED = ${JSON.stringify(welcome.localizedTemplates || {})};
const WELCOME_EMAIL_SITE_NAME = ${JSON.stringify(welcome.siteName || '')};
${generateEmailLocaleRequire('../../..')}

${generateFillTemplateFn()}

${generateLocalizedEmailCopyFn({
  fnName: 'resolveWelcomeEmailCopy',
  subjectConst: 'WELCOME_EMAIL_SUBJECT',
  bodyConst: 'WELCOME_EMAIL_BODY_HTML',
  localizedConst: 'WELCOME_EMAIL_LOCALIZED',
})}

${generateProviderSendFunction(welcomeProvider, {
  emailType: 'welcome',
  source: 'signup',
  sourceRef: 'api/auth/signup',
  relativePrefix: '../../..',
})}

// \`locale\` is the language of the signup page (see resolveRequestLocale);
// the email goes out in that language's copy when the template has one.
async function sendWelcomeEmail(toEmail, tokenValues, userId, locale) {
  if (!WELCOME_EMAIL_PROVIDER || !WELCOME_EMAIL_BODY_HTML || !toEmail) { return; }
  var apiKey = WELCOME_EMAIL_SECRET_ENV_NAME ? process.env[WELCOME_EMAIL_SECRET_ENV_NAME] : '';
  if (apiKey && String(apiKey).indexOf('teleporthq.secrets.') === 0) { apiKey = ''; }
  if (!apiKey) { console.warn('[account-signup] welcome email skipped: credential not set'); return; }
  var from = WELCOME_EMAIL_FROM || process.env.EMAIL_FROM || '';
  if (!from) { console.warn('[account-signup] welcome email skipped: sender not configured'); return; }
  var copy = resolveWelcomeEmailCopy(locale);
  var subject = fillSubjectTemplate(copy.subject, tokenValues);
  var html = fillTemplate(copy.body, tokenValues);
  await __sendProviderEmail({ from: from, to: toEmail, subject: subject, html: html, apiKey: apiKey, tokenValues: tokenValues, userId: userId });
}

// A sign-up for an address that already has an account gets the same status,
// body and headers as a new one; its time differs from a new address's, which
// the account a new sign-up makes reveals anyway. The address's owner is told
// by email instead (only the mailbox owner reads it), at most
// ${EXISTING_ACCOUNT_EMAIL_LIMIT} times an hour per address, through the known-address sender.
var EXISTING_ACCOUNT_SUBJECT = 'You already have an account';
var EXISTING_ACCOUNT_BODY_HTML =
  '<p>Someone, hopefully you, tried to create an account{{siteNameSuffix}} with this email address.</p>' +
  '<p>You already have one. Sign in with your password, or use "Forgot password" on the sign-in page to choose a new one.</p>' +
  '<p>If this was not you, you can ignore this email: nothing has changed.</p>';

async function sendExistingAccountEmail(toEmail, siteName, userId) {
  if (!NOTICE_EMAIL_PROVIDER || !toEmail) { return; }
  var apiKey = NOTICE_EMAIL_SECRET_ENV_NAME ? process.env[NOTICE_EMAIL_SECRET_ENV_NAME] : '';
  if (apiKey && String(apiKey).indexOf('teleporthq.secrets.') === 0) { apiKey = ''; }
  var from = NOTICE_EMAIL_FROM || process.env.EMAIL_FROM || '';
  if (!apiKey || !from) { return; }
  var allowed = await __security.rateLimit({
    key: 'auth-signup-existing:' + String(toEmail).trim().toLowerCase(),
    limit: ${EXISTING_ACCOUNT_EMAIL_LIMIT},
    windowSeconds: 3600,
  });
  if (!allowed.allowed) { return; }
  var tokenValues = { siteNameSuffix: siteName ? ' on ' + siteName : '' };
  var html = fillTemplate(EXISTING_ACCOUNT_BODY_HTML, tokenValues);
  await sendAccountNotice(
    ${JSON.stringify(EXISTING_ACCOUNT_EMAIL)},
    { from: from, to: toEmail, subject: EXISTING_ACCOUNT_SUBJECT, html: html, apiKey: apiKey, userId: userId },
    { subject: EXISTING_ACCOUNT_SUBJECT, html: html, payload: tokenValues }
  );
}
${generateKnownAddressEmailCode({
  sender: noticeSender,
  pagePath: setPasswordPagePath,
  tokenInFragment: signup.tokenInFragment === true,
})}

function waitUntilElapsed(startedAt, ms) {
  var left = ms - (Date.now() - startedAt);
  return left > 0 ? new Promise(function (resolve) { setTimeout(resolve, left); }) : Promise.resolve();
}
${
  recordsSignup
    ? generateAccountEventRecorder({ relativePrefix: '../../..', logTag: '[account-signup]' })
    : ''
}`

    createUserCall = `    // The answer is the same for a new account and for an address that already
    // has one (see sendExistingAccountEmail): built from what the visitor sent.
    const answer = { user: { email: email, name: name || null } };
    const __siteName = WELCOME_EMAIL_SITE_NAME ||
      (req.headers && req.headers.host ? String(req.headers.host).replace(/^www\\./, '').split(':')[0] : '');
    // In any letter case: \`Ava@site.test\` is the \`ava@site.test\` row.
    const existing = await findSignupUserByEmail(email);
    if (existing) {
      // A newsletter subscriber, a checkout or booking guest or a contact the
      // owner added has a row but no password (and no OAuth sign-in). Signing
      // up must not hand that row — and what the site knows about the person —
      // to whoever types the address first: its owner is mailed a link to set
      // a password, which proves the mailbox is theirs. An account's owner is
      // told it already has one. Either way the page is answered alike, so it
      // never tells a subscriber or a guest from an account.
      const knownEmail = String(existing.email || email);
      const existingId = existing.id != null ? existing.id : existing._id;
      try {
        if (!existing.password && !existing.provider && authUtils.PASSWORD_RESET_SUPPORTED) {
          await sendSetPasswordEmail(existing, __siteName, req);
        } else {
          // An account; or a row without a password where the store cannot
          // keep reset links (not Postgres): told it is already known here.
          await sendExistingAccountEmail(knownEmail, __siteName, existingId);
        }
      } catch (existingErr) {
        console.error('[account-signup] existing-account email failed:', existingErr && existingErr.message ? existingErr.message : existingErr);
      }
${
  noticeSender.provider
    ? `      await __noticeEmailLog.settleSentEmailLog();
`
    : ''
}      // At least ${KNOWN_ADDRESS_MIN_RESPONSE_MS} ms, like the forgot-password answer: the time tells
      // neither which email went out nor whether one did.
      await waitUntilElapsed(startedAt, ${KNOWN_ADDRESS_MIN_RESPONSE_MS});
      res.status(201).json(answer);
      return;
    }

    const userData = {
      name: name || null,
      email: email,
      password: hashedPassword,
      role: 'user',
      // Where the person came from, and their consent as they gave it: the
      // "Email me news and offers" box ticked ('true') or not. Never assumed.
      source: 'signup',
      marketing_consent: body.marketing_consent === 'true',
    };
    // Only the fields this project's sign-up forms collect.
    const signupFields = ${JSON.stringify(signupFields)};
    for (let i = 0; i < signupFields.length; i++) {
      if (Object.prototype.hasOwnProperty.call(body, signupFields[i])) {
        userData[signupFields[i]] = body[signupFields[i]];
      }
    }

    const newUser = await createUser(userData);

    if (!newUser) {
      res.status(500).json({ error: 'Failed to create user' });
      return;
    }

    // Best-effort welcome email — a failed send must never fail the signup.
    try {
      await sendWelcomeEmail(email, {
        userName: name || (newUser && newUser.name) || 'there',
        userEmail: email,
        siteName: __siteName,
      }, newUser && newUser.id, __emailLocale.resolveRequestLocale(req));
    } catch (welcomeErr) {
      console.error('[account-signup] welcome email failed:', welcomeErr && welcomeErr.message ? welcomeErr.message : welcomeErr);
    }
${
  welcomeProvider
    ? `    // Land the welcome email's ledger row before replying.
    if (typeof __sentEmailLog !== 'undefined') { await __sentEmailLog.settleSentEmailLog(); }
`
    : ''
}${
      recordsSignup
        ? `    // The account exists: the last thing the signup does is record it.
    await recordAccountEvent('user-signed-up', newUser, 'signup', req);
`
        : ''
    }${signup.newsletter === true ? SIGNUP_NEWSLETTER_CODE : ''}
    res.status(201).json(answer);`
  } else {
    createUserCall = `    res.status(501).json({ error: 'No data source configured for user storage' });`
  }

  return `const hashPassword = require('../../../utils/auth/hash-password');
const __security = require('${securityRuntimeSpecifier('../../..')}');
${dbImport}
${welcomeHelpers}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // ${SIGN_UP_LIMIT} sign-ups per visitor per hour.
  if (!(await __security.rateLimitRequest(req, res, { scope: 'auth-signup', limit: ${SIGN_UP_LIMIT}, windowSeconds: ${SIGN_UP_WINDOW_SECONDS} }))) {
    return;
  }
${needsDb ? '  const startedAt = Date.now();\n' : ''}
  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) || {};
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const name = typeof body.name === 'string' ? body.name : '';

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    const policyError = hashPassword.passwordPolicyError(password);
    if (policyError) {
      res.status(400).json({ error: policyError });
      return;
    }

    const hashedPassword = hashPassword(password);

${createUserCall}
  } catch (error) {
    __security.sendClientError(res, 500, 'Sign-up failed. Please try again.', error);
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
  protection:
    | { rowOwnerColumn?: string; allowedRoles?: string[]; requiresSubscription?: boolean }
    | undefined
): boolean => {
  if (!protection || !protection.rowOwnerColumn) {
    return false
  }
  // A subscription is an entitlement the row-level SQL cannot reproduce
  // either, so a subscriber-only page keeps its middleware protection.
  if (protection.requiresSubscription) {
    return false
  }
  const roles = protection.allowedRoles || []
  return roles.length === 0
}

interface ProtectedRouteEntry {
  requiresAuth: boolean
  allowedRoles: string[]
  requiresSubscription?: boolean
  subscriptionProductIds?: string[]
}

const subscriptionFieldsOf = (
  protection: { requiresSubscription?: boolean; subscriptionProductIds?: string[] } | undefined
): Pick<ProtectedRouteEntry, 'requiresSubscription' | 'subscriptionProductIds'> => {
  if (!protection || !protection.requiresSubscription) {
    return {}
  }
  return {
    requiresSubscription: true,
    subscriptionProductIds: Array.from(
      new Set((protection.subscriptionProductIds || []).map((id) => String(id).trim()))
    ).filter((id) => id.length > 0),
  }
}

// Two pages on one route key merge the way roles merge — permissively: the
// key is subscriber-gated only when EVERY page claiming it is, and the product
// list is the union (an "any subscription" page makes it "any").
const mergeSubscriptionFields = (
  existing: ProtectedRouteEntry | undefined,
  incoming: { requiresSubscription?: boolean; subscriptionProductIds?: string[] } | undefined
): Pick<ProtectedRouteEntry, 'requiresSubscription' | 'subscriptionProductIds'> => {
  const next = subscriptionFieldsOf(incoming)
  if (!existing) {
    return next
  }
  if (!existing.requiresSubscription || !next.requiresSubscription) {
    return {}
  }
  const existingIds = existing.subscriptionProductIds || []
  const nextIds = next.subscriptionProductIds || []
  return {
    requiresSubscription: true,
    subscriptionProductIds:
      existingIds.length === 0 || nextIds.length === 0
        ? []
        : Array.from(new Set([...existingIds, ...nextIds])),
  }
}

export interface MiddlewareOptions {
  // Where a signed-in visitor without the subscription lands when the
  // subscriber-access route names no product page: the products listing when
  // the store has one, else the home page. Defaults to "/".
  subscriptionFallbackRoute?: string
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

/** The same-site path the project redirects `/` to, or null (absent, `/` itself, or off-site). */
const resolveHomeRedirect = (auth: UIDLAuthentication): string | null => {
  const value = typeof auth.homeRedirect === 'string' ? auth.homeRedirect : ''
  const path = value.split('?')[0].split('#')[0]
  if (!path.startsWith('/') || path.startsWith('//') || path.indexOf('\\') !== -1) {
    return null
  }
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path
  return normalized === '/' ? null : normalized
}

/**
 * Where a signed-in visitor without the role a page asks for lands. A project
 * whose home page is not redirected keeps the code it always had. One that
 * redirects `/` (e.g. to an admin dashboard) only sends a visitor home when
 * that page admits them; otherwise to sign-in, saying why.
 */
const generateRoleDeniedRedirectCode = (
  signInRoute: string,
  homeRedirect: string | null
): string => {
  if (!homeRedirect) {
    return `// Where to send an authenticated user who lacks the required role. Normally the
// home page ("you don't have access, here's the public site"). But when "/" is
// itself a protected page (e.g. an admin dashboard published at the root), a
// redirect to "/" re-enters this middleware and loops forever — so fall back to
// the sign-in page (with a callbackUrl) in that case.
function roleDeniedRedirect(request, pathname) {
  if (pathname !== '/' && !protectedRoutes['/']) {
    return redirectWithinLocale(request, '/');
  }
  return redirectWithinLocale(request, '${signInRoute}', pathname);
}`
  }
  return `// The project redirects "/" here before this middleware ever runs.
var homeRedirect = ${JSON.stringify(homeRedirect)};

// Whether "/" is a way out for this visitor: the page it redirects to is not
// the one being left, and admits their role. Otherwise sending them home would
// land them right back on a page that refuses them — a redirect loop.
function homeAdmitsRole(pathname, userRole) {
  var landing = normalizeMatchPath(homeRedirect);
  if (landing === normalizeMatchPath(pathname)) return false;
  var protection = resolveProtection(landing).matched;
  if (!protection) return true;
  if (protection.requiresSubscription) return false;
  var roles = protection.allowedRoles || [];
  return roles.length === 0 || roles.indexOf(userRole) >= 0;
}

// Where to send an authenticated user who lacks the required role: home when
// home admits them, else the sign-in page, which is told why (error=forbidden)
// and keeps a callbackUrl for an account that may open the page.
function roleDeniedRedirect(request, pathname, userRole) {
  if (pathname !== '/' && !protectedRoutes['/'] && homeAdmitsRole(pathname, userRole)) {
    return redirectWithinLocale(request, '/');
  }
  var target = new URL(localizePathname(request, '${signInRoute}'), request.url);
  target.searchParams.set('callbackUrl', localizePathname(request, pathname));
  target.searchParams.set('error', 'forbidden');
  return NextResponse.redirect(target);
}`
}

export const generateMiddlewareFile = (
  auth: UIDLAuthentication,
  options: MiddlewareOptions = {}
): string => {
  const protectedRoutes: Record<string, ProtectedRouteEntry> = {}
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
        ...mergeSubscriptionFields(existing, protection),
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
              const existingEntry = protectedRoutes[pageProt.route]
              const existingRoles = existingEntry?.allowedRoles || []
              const mergedRoles = Array.from(new Set([...existingRoles, ...folderRoles]))
              protectedRoutes[pageProt.route] = {
                requiresAuth: true,
                allowedRoles: mergedRoles,
                // The folder adds a role; the page's own subscription
                // requirement is not the folder's to lift.
                ...(existingEntry
                  ? subscriptionFieldsOf(existingEntry)
                  : subscriptionFieldsOf(pageProt)),
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

  // `/admin` itself, and every admin page the map has no entry for (one an
  // owner added without protection), admit the admin panel's own roles — its
  // folder's — never the first admin route's, which may also admit another
  // role (a staff dashboard).
  const sawAdminRoute = Object.keys(protectedRoutes).some(
    (k) => k === '/admin' || k.indexOf('/admin/') === 0
  )
  if (sawAdminRoute && !protectedRoutes['/admin']) {
    const panelRoles = TableAccess.resolveAdminPanelRoles(auth)
    protectedRoutes['/admin'] = {
      requiresAuth: true,
      allowedRoles: panelRoles.length > 0 ? panelRoles : ['admin'],
    }
  }

  const protectedRoutesJson = JSON.stringify(protectedRoutes, null, 2)
  const authRoutesJson = JSON.stringify(authRoutes)
  const selfGuardedRoutesJson = JSON.stringify(selfGuardedRoutes)
  const signInRoute = auth.authPages.signIn?.route || '/auth/sign-in'
  const subscriptionFallbackRoute =
    options.subscriptionFallbackRoute && options.subscriptionFallbackRoute.startsWith('/')
      ? options.subscriptionFallbackRoute
      : '/'
  const homeRedirect = resolveHomeRedirect(auth)

  return `import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

${generateSessionTokenResolverCode()}
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

// The session token lives in the "__Host-" cookie on https and the plain one on
// http (see the auth options), split into ".0"/".1" chunks when large. The
// Edge runtime's getToken() can return null for a session the Node runtime
// considers valid (e.g. NEXTAUTH_SECRET not identical in the Edge runtime, or
// the JWE simply failing to decode at the edge), which previously redirected
// logged-in users to sign-in. So cookie PRESENCE is the source of truth for
// "is there a session"; getToken is only trusted for the optional role check.
// Only the cookie the request's protocol allows counts — the same one
// __tqSessionTokenCandidates names: a cookie a sibling site planted under
// another name is never a session. Server-side (getServerSideProps / API
// routes) remain the authoritative validators of the session and role.
function hasSessionCookie(request) {
  return __tqSessionTokenCandidates(request).length > 0;
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

// The visitor's language is a prefix on the request path that Next.js strips
// before this middleware runs: for "/es/orders" \`nextUrl.pathname\` is
// "/orders" and \`nextUrl.locale\` is "es". A redirect built from the bare
// pathname would drop the visitor onto the default-language page, so every
// redirect — and the callbackUrl it carries — puts the prefix back. The
// default language is served unprefixed; a project without languages has no
// locale at all and keeps the path as it is.
function localizePathname(request, pathname) {
  var locale = request.nextUrl.locale;
  var defaultLocale = request.nextUrl.defaultLocale;
  if (!locale || !defaultLocale || locale === defaultLocale) return pathname;
  return '/' + locale + (pathname === '/' ? '' : pathname);
}

function redirectWithinLocale(request, pathname, callbackPath) {
  var target = new URL(localizePathname(request, pathname), request.url);
  if (callbackPath) {
    target.searchParams.set('callbackUrl', localizePathname(request, callbackPath));
  }
  return NextResponse.redirect(target);
}

${generateRoleDeniedRedirectCode(signInRoute, homeRedirect)}

// Route keys carry no trailing slash, so neither may the path we match with.
// Next.js serves "/orders/ORD-42/" and "/orders/ORD-42" as the same route;
// matching the raw pathname would let the slashed form miss every exact key
// (and every self-guarded pattern) and fall back to the ancestor prefix.
function normalizeMatchPath(pathname) {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.replace(/\\/+$/, '') : pathname;
}

// The protection a path falls under. An exact hit is the page's OWN protection
// and always wins. Anything else is inherited from an ancestor route (a listing
// page, an "/admin" subtree, …).
function resolveProtection(matchPath) {
  var exact = Object.prototype.hasOwnProperty.call(protectedRoutes, matchPath)
    ? protectedRoutes[matchPath]
    : null;
  var matched = exact;
  if (!matched) {
    var routes = Object.keys(protectedRoutes).sort(function(a, b) {
      return b.length - a.length;
    });
    for (var r = 0; r < routes.length; r++) {
      if (matchPath.startsWith(routes[r] + '/')) {
        matched = protectedRoutes[routes[r]];
        break;
      }
    }
  }
  return { exact: exact, matched: matched };
}

// Where a signed-in visitor without the subscription lands: the subscriber-
// access route's own suggestion (the first product's page) when it made one,
// else the store's products listing, else the home page.
var subscriptionFallbackRoute = ${JSON.stringify(subscriptionFallbackRoute)};

// Asks the app (the Edge runtime has no database) whether the visitor behind
// this cookie holds an entitled subscription to one of the products — any
// product when the list is empty. The route is under /api, which the matcher
// never sends through this middleware, so the call cannot re-enter it. Any
// failure — network, a non-2xx answer, a malformed body — reads as "not
// entitled": the page fails closed.
async function checkSubscriberAccess(request, productIds) {
  try {
    var url = new URL('/api/auth/subscriber-access', request.url);
    if (productIds.length > 0) {
      url.searchParams.set('products', productIds.join(','));
    }
    var accessRes = await fetch(url.toString(), {
      headers: { cookie: request.headers.get('cookie') || '' },
    });
    if (!accessRes.ok) {
      return { entitled: false, redirectTo: null };
    }
    var accessJson = await accessRes.json();
    return {
      entitled: !!(accessJson && accessJson.entitled === true),
      redirectTo: accessJson && typeof accessJson.redirectTo === 'string' ? accessJson.redirectTo : null,
    };
  } catch (e) {
    return { entitled: false, redirectTo: null };
  }
}

// A candidate landing page must be a same-origin path, not the page being
// left, and not itself subscriber-gated — or the redirect would re-enter this
// check forever. When every candidate is gated, sign-in (with a callbackUrl)
// is the same last resort the role denial uses.
function subscriptionRequiredRedirect(request, pathname, redirectTo) {
  var candidates = [redirectTo, subscriptionFallbackRoute, '/'];
  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    if (typeof candidate !== 'string' || candidate.charAt(0) !== '/' || candidate.indexOf('//') === 0) {
      continue;
    }
    var candidatePath = candidate.split('?')[0].split('#')[0];
    if (!candidatePath || normalizeMatchPath(candidatePath) === normalizeMatchPath(pathname)) {
      continue;
    }
    var candidateProtection = resolveProtection(normalizeMatchPath(candidatePath)).matched;
    if (candidateProtection && candidateProtection.requiresSubscription) {
      continue;
    }
    var target = new URL(localizePathname(request, candidatePath), request.url);
    target.searchParams.set('subscription_required', '1');
    return NextResponse.redirect(target);
  }
  return redirectWithinLocale(request, '${signInRoute}', pathname);
}

async function middleware(request) {
  const pathname = request.nextUrl.pathname;

  // The matcher already leaves /api alone; kept explicit so the subscriber-
  // access call above can never loop back through this middleware.
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

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

  // The ORIGINAL pathname is what goes into the sign-in callbackUrl.
  const matchPath = normalizeMatchPath(pathname);
  const resolved = resolveProtection(matchPath);
  const exactProtection = resolved.exact;
  const matchedProtection = resolved.matched;

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
  // at the edge, telling getToken which cookie the request actually carries —
  // left to its own defaults it derives the cookie name from
  // process.env.NEXTAUTH_URL, which this deployment ships as a localhost value,
  // so on https it looked for the non-secure cookie and returned null for every
  // valid session. That is what made this fast path miss and sent logged-in
  // users to sign-in.
  //
  // The /api/auth/session fallback below stays as a genuine last resort (a
  // custom cookie name, or a secret unavailable at the edge): cookie PRESENCE
  // decides whether it is worth a round trip, and the endpoint is authoritative
  // for BOTH the auth gate and the role check, so no role is silently skipped.
  var sessionUser = null;
  var secret = process.env.NEXTAUTH_SECRET;
  if (secret) {
    try {
      sessionUser = await __tqResolveSessionToken(getToken, request, secret);
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
    return redirectWithinLocale(request, '${signInRoute}', pathname);
  }

  // Role enforcement uses whichever source resolved the user (decoded JWT or the
  // authoritative session endpoint), so admin/role gates are NEVER silently
  // bypassed when getToken fails at the edge.
  var allowedRoles = matchedProtection.allowedRoles || [];
  if (allowedRoles.length > 0) {
    if (!sessionUser) {
      return redirectWithinLocale(request, '${signInRoute}', pathname);
    }
    var userRole = getUserRoleFromToken(sessionUser);
    if (userRole == null || allowedRoles.indexOf(userRole) < 0) {
      return roleDeniedRedirect(request, pathname${homeRedirect ? ', userRole' : ''});
    }
  }

  // Subscriber-only page: decided last, once the session and the role are
  // settled, by the app's own subscriber-access route (see checkSubscriberAccess).
  if (matchedProtection.requiresSubscription) {
    if (!sessionUser) {
      return redirectWithinLocale(request, '${signInRoute}', pathname);
    }
    var subscriptionProductIds = matchedProtection.subscriptionProductIds || [];
    var subscriberAccess = await checkSubscriberAccess(request, subscriptionProductIds);
    if (!subscriberAccess.entitled) {
      return subscriptionRequiredRedirect(request, pathname, subscriberAccess.redirectTo);
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
  // the second entry covers every deeper path. Only the API routes are left
  // out — "/api" and "/api/..." — never a page whose path merely starts with
  // "api" (a protected "/api-keys" page).
  matcher: ['/', '/((?!api(?:/|$)|_next/static|_next/image|favicon\\\\.ico).*)'],
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
