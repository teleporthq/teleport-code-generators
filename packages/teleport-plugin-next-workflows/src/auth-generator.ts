import {
  UIDLAuthentication,
  UIDLCustomUserProperty,
  DataSourceType,
} from '@teleporthq/teleport-types'

const PROVIDER_IMPORT_MAP: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  facebook: 'Facebook',
  auth0: 'Auth0',
  apple: 'Apple',
  azure: 'AzureAD',
  discord: 'Discord',
  dropbox: 'Dropbox',
  gitlab: 'GitLab',
  instagram: 'Instagram',
  keycloak: 'Keycloak',
  linkedin: 'LinkedIn',
  okta: 'Okta',
  reddit: 'Reddit',
  slack: 'Slack',
  spotify: 'Spotify',
  twitch: 'Twitch',
  twitter: 'Twitter',
  zoom: 'Zoom',
  cognito: 'Cognito',
  battlenet: 'BattleNet',
  box: 'Box',
  bungie: 'Bungie',
  coinbase: 'Coinbase',
  figma: 'Figma',
  foursquare: 'Foursquare',
  freshbooks: 'Freshbooks',
  fusionauth: 'FusionAuth',
  hubspot: 'Hubspot',
  kakao: 'Kakao',
  line: 'Line',
  mailchimp: 'Mailchimp',
  notion: 'Notion',
  osso: 'Osso',
  osu: 'Osu',
  patreon: 'Patreon',
  pinterest: 'Pinterest',
  pipedrive: 'Pipedrive',
  salesforce: 'Salesforce',
  strava: 'Strava',
  tiktok: 'TikTok',
  todoist: 'Todoist',
  trakt: 'Trakt',
  workos: 'WorkOS',
  wordpress: 'WordPress',
  yandex: 'Yandex',
  zitadel: 'Zitadel',
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

const generateProviderImports = (auth: UIDLAuthentication): string => {
  const lines: string[] = []

  if (auth.passwordAuthEnabled) {
    lines.push(
      `const CredentialsProvider = require('next-auth/providers/credentials').default || require('next-auth/providers/credentials');`
    )
  }

  for (const provider of auth.providers) {
    const importName = PROVIDER_IMPORT_MAP[provider.id] || capitalize(provider.id)
    lines.push(
      `const ${importName}Provider = require('next-auth/providers/${provider.id}').default || require('next-auth/providers/${provider.id}');`
    )
  }

  return lines.join('\n')
}

const generateProviderConfig = (auth: UIDLAuthentication): string => {
  const providers: string[] = []

  if (auth.passwordAuthEnabled) {
    providers.push(`    CredentialsProvider({
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
    })`)
  }

  for (const provider of auth.providers) {
    const importName = PROVIDER_IMPORT_MAP[provider.id] || capitalize(provider.id)
    const credKeys = Object.keys(provider.credentials)
    const idKey = credKeys.find((k) => k.endsWith('_ID'))
    const secretKey = credKeys.find((k) => k.endsWith('_SECRET'))
    const issuerKey = credKeys.find(
      (k) => k.endsWith('_ISSUER') || k.endsWith('_DOMAIN') || k.endsWith('_TENANT_ID')
    )

    let configStr = `      clientId: process.env.${
      idKey || `AUTH_${provider.id.toUpperCase()}_ID`
    },\n      clientSecret: process.env.${secretKey || `AUTH_${provider.id.toUpperCase()}_SECRET`}`

    if (issuerKey) {
      configStr += `,\n      issuer: process.env.${issuerKey}`
    }

    providers.push(`    ${importName}Provider({\n${configStr}\n    })`)
  }

  return providers.join(',\n')
}

export const generateAuthOptionsFile = (
  auth: UIDLAuthentication,
  dataSourceConfig?: Record<string, unknown> | null
): string => {
  const customProps = auth.customUserProperties || []
  const dbSetupCode = generateDbSetupCode(auth.dataSourceType, dataSourceConfig)
  const providerImports = generateProviderImports(auth)
  const providerConfig = generateProviderConfig(auth)
  const findUserCode = auth.passwordAuthEnabled
    ? generateFindUserFunction(auth.dataSourceType, customProps)
    : ''
  const sanitizeUserCode = generateSanitizeUserFunction()
  const signInRoute = auth.authPages.signIn?.route || '/auth/sign-in'

  return `${providerImports}
${dbSetupCode}
${sanitizeUserCode}

${findUserCode}

const authOptions = {
  providers: [
${providerConfig}
  ],
  pages: {
    signIn: '${signInRoute}',
  },
  callbacks: {
    async jwt(params) {
      const token = params.token;
      const user = params.user;
      if (user) {
        const keys = Object.keys(user);
        for (let i = 0; i < keys.length; i++) {
          token[keys[i]] = user[keys[i]];
        }
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

module.exports = NextAuth(authOptions);
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

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    console.error('[auth middleware] NEXTAUTH_SECRET is not set; blocking protected route.');
    var signInUrlMissing = new URL('${signInRoute}', request.url);
    signInUrlMissing.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(signInUrlMissing);
  }

  var token = await getToken({ req: request, secret: secret });

  if (matchedProtection.requiresAuth && !token) {
    var signInUrl = new URL('${signInRoute}', request.url);
    signInUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(signInUrl);
  }

  var allowedRoles = matchedProtection.allowedRoles || [];
  if (allowedRoles.length > 0) {
    if (!token) {
      var signInUrl2 = new URL('${signInRoute}', request.url);
      signInUrl2.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(signInUrl2);
    }
    var userRole = getUserRoleFromToken(token);
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
  return `const React = require('react');
const SessionProvider = require('next-auth/react').SessionProvider;

function AuthSessionProvider(props) {
  return React.createElement(
    SessionProvider,
    { session: props.pageProps && props.pageProps.session ? props.pageProps.session : undefined },
    props.children
  );
}

module.exports = AuthSessionProvider;
`
}

const capitalize = (str: string): string => {
  if (!str) {
    return str
  }
  return str.charAt(0).toUpperCase() + str.slice(1)
}
