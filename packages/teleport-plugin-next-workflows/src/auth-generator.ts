import {
  UIDLAuthentication,
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
  return `function sanitizeUser(user) {
  if (!user) return null;
  const safe = {};
  const keys = Object.keys(user);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== 'password' && keys[i] !== '_id') {
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
  const sanitizeUserCode = generateSanitizeUserFunction()
  const signInRoute = auth.authPages.signIn?.route || '/auth/sign-in'

  return `${providerImports}
${dbSetupCode}
${sanitizeUserCode}

${findUserCode}

${providersSetup}

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
    },
    async session(params) {
      const session = params.session;
      const token = params.token;
      if (token && session.user) {
        const skip = { iat: 1, exp: 1, jti: 1, sub: 1 };
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
