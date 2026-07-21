/**
 * Shared generated Postgres-client boilerplate (SSL handling + `getClient()`)
 * for generated API routes that talk to the project database directly. Mirrors
 * the inline block in `data-api-route-generator.ts`; kept as a reusable string
 * so the account-delete route stays byte-for-byte consistent with the data API
 * without duplicating the connection logic.
 *
 * The returned code requires `pg` and exposes a top-level `getClient()`.
 */
export const generatePgClientCode = (): string => `const { Client } = require('pg');

function getPgSslFromEnv() {
  if (process.env.TELEPORT_DB_SSL === 'false') return false;
  if (process.env.TELEPORT_DB_SSL === 'true') return { rejectUnauthorized: false };
  return undefined;
}

function normalizePostgresConnectionString(connectionString) {
  if (!connectionString || typeof connectionString !== 'string') return connectionString;
  if (/^postgresql:\\/(?!\\/)/i.test(connectionString)) {
    return connectionString.replace(/^postgresql:\\//i, 'postgresql://');
  }
  return connectionString;
}

function stripSslQueryParamsFromConnectionString(connectionString) {
  if (!connectionString || typeof connectionString !== 'string') return connectionString;
  try {
    var u = new URL(connectionString.replace(/^postgresql:/i, 'postgres:'));
    u.searchParams.delete('sslmode');
    u.searchParams.delete('ssl');
    u.searchParams.delete('sslrootcert');
    u.searchParams.delete('sslcert');
    u.searchParams.delete('sslkey');
    return u.toString().replace(/^postgres:/i, 'postgresql:');
  } catch (e) {
    return connectionString;
  }
}

const getClient = () => {
  var ssl = getPgSslFromEnv();
  var connStr = process.env.TELEPORT_DB_CONNECTION_STRING;
  if (connStr) {
    connStr = normalizePostgresConnectionString(connStr);
  }
  if (ssl === false && connStr) {
    connStr = stripSslQueryParamsFromConnectionString(connStr);
  }
  if (connStr) {
    return new Client(
      Object.assign(
        { connectionString: connStr },
        ssl !== undefined ? { ssl: ssl } : {}
      )
    );
  }
  return new Client(
    Object.assign(
      {
        host: process.env.TELEPORT_DB_HOST,
        port: parseInt(process.env.TELEPORT_DB_PORT || '5432', 10),
        user: process.env.TELEPORT_DB_USER,
        password: process.env.TELEPORT_DB_PASSWORD,
        database: process.env.TELEPORT_DB_NAME,
      },
      ssl !== undefined ? { ssl: ssl } : {}
    )
  );
};`
