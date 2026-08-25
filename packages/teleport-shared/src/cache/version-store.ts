import { CACHE_VERSIONS_TABLE } from './constants'

/**
 * The shared invalidation counter, emitted as `utils/tq-cache/version-store.js`.
 *
 * ## Why a version row rather than a prefix scan
 *
 * "Clear every entry for this table" is tempting to implement as a
 * scan-and-delete over a key prefix. That works on an in-memory `Map` and
 * nowhere else: a serverless instance cannot enumerate its siblings' memory,
 * and a CDN cannot be enumerated at all. So the version goes INTO the key
 * instead. One row write orphans every stale key at once, across every instance
 * and every browser, with nothing to enumerate and nothing to keep in sync.
 *
 * It also means neither writer needs to know anything about the deployment: the
 * TeleportHQ editor and the published admin panel both just bump a row in the
 * database they are already writing to. No deployment URL, no webhook, no
 * secret, no knowledge of how many instances exist.
 *
 * ## Always emitted
 *
 * A project with no supported database still gets this file, as a no-op store.
 * Next bundles API routes with webpack, so a `require` of a file that might not
 * exist is a build failure, not a runtime fallback — the no-op variant is what
 * keeps the conditional out of the emitted code.
 */
export const generateVersionStore = (params: { clientCode?: string } = {}): string => {
  if (!params.clientCode) {
    return `/* TeleportHQ data cache — version store (disabled). Generated file, do not edit. */

/*
 * This project has no database this app can bump an invalidation counter in, so
 * cached entries expire on their TTL alone. Emitted as a no-op rather than
 * omitted because Next resolves \`require\` at build time.
 */

module.exports = {
  isEnabled: function () {
    return false;
  },
  readVersions: function () {
    return Promise.resolve({});
  },
  bumpVersions: function () {
    return Promise.resolve({});
  },
};
`
  }

  return `/* TeleportHQ data cache — version store. Generated file, do not edit. */

${params.clientCode}

var TABLE = '${CACHE_VERSIONS_TABLE}';

function isEnabled() {
  return !!(process.env.TELEPORT_DB_CONNECTION_STRING || process.env.TELEPORT_DB_HOST);
}

async function withClient(run) {
  var client = getClient();
  try {
    await client.connect();
    return await run(client);
  } finally {
    try {
      await client.end();
    } catch (e) {
      /* ignore */
    }
  }
}

function toVersionMap(rows) {
  var out = Object.create(null);
  for (var i = 0; i < (rows || []).length; i++) {
    out[rows[i].scope] = Number(rows[i].version);
  }
  return out;
}

/**
 * Reads every scope, or just the ones asked for. The table holds one tiny row
 * per cached table, so the unfiltered read is a handful of rows.
 */
async function readVersions(scopes) {
  if (!isEnabled()) {
    return {};
  }
  return withClient(async function (client) {
    if (scopes && scopes.length) {
      var filtered = await client.query(
        'SELECT scope, version FROM ' + TABLE + ' WHERE scope = ANY($1::text[])',
        [scopes]
      );
      return toVersionMap(filtered.rows);
    }
    var all = await client.query('SELECT scope, version FROM ' + TABLE);
    return toVersionMap(all.rows);
  });
}

/**
 * Bumps each scope by one and returns the new values.
 *
 * The increment is done by the database (\`version + 1\`), not read-then-write,
 * so two concurrent writers can never land on the same number and lose one
 * another's invalidation.
 */
async function bumpVersions(scopes) {
  if (!isEnabled() || !scopes || !scopes.length) {
    return {};
  }
  return withClient(async function (client) {
    var result = await client.query(
      'INSERT INTO ' +
        TABLE +
        ' (scope, version, updated_at) ' +
        'SELECT s, 1, NOW() FROM unnest($1::text[]) AS s ' +
        'ON CONFLICT (scope) DO UPDATE SET version = ' +
        TABLE +
        '.version + 1, updated_at = NOW() ' +
        'RETURNING scope, version',
      [scopes]
    );
    return toVersionMap(result.rows);
  });
}

module.exports = {
  isEnabled: isEnabled,
  readVersions: readVersions,
  bumpVersions: bumpVersions,
};
`
}
