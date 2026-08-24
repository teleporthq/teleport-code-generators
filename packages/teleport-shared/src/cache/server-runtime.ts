import { SERVER_MAX_ENTRIES, VERSION_MEMO_MS } from './constants'

/**
 * The server half of the data cache, emitted as `utils/tq-cache/server.js`.
 *
 * ## What this is honestly worth on Vercel
 *
 * Generated projects are Next 12 pages-router on Vercel's Node serverless
 * runtime: no `next/cache`, no `revalidateTag`, and **no memory shared between
 * instances**. So this is a per-instance cache. On a warm, busy list page that
 * is most requests; on a cold or bursty one it is close to none. Every fetcher
 * opens a fresh `pg.Client` and `end()`s it per request, so a hit saves a whole
 * TCP+TLS+auth round trip rather than just a query — but the mechanism that
 * makes a busy site fast is the CDN layer above, not this.
 *
 * What this layer DOES guarantee is correctness: the version token from the
 * shared store is part of every key, so a write anywhere invalidates every
 * instance at once without any of them being told.
 *
 * ## Two rules the serverless model forces
 *
 * - **No timers.** Instances are frozen between invocations, so `setInterval`
 *   and `setTimeout` do not fire reliably. Every TTL is evaluated lazily at read.
 * - **Never await the version read on the data path.** A cold instance has an
 *   empty cache and needs no version; a warm one already has a recent one.
 *   Blocking would add a full database connect to the critical path to learn
 *   something that cannot change the answer. Refresh is opportunistic and
 *   single-flighted, and a promise frozen mid-flight is simply restarted later.
 *
 * Comparison is for INEQUALITY, so an absent version is a conservative miss and
 * clock skew between writers is irrelevant. The failure direction is always an
 * extra miss, never a stale hit.
 */
export const generateCacheServerRuntime = (): string => {
  return `/* TeleportHQ data cache — server. Generated file, do not edit. */

var versionStore = require('./version-store');

var MAX_ENTRIES = ${SERVER_MAX_ENTRIES};
var VERSION_MEMO_MS = ${VERSION_MEMO_MS};

// Map iteration order is insertion order, which is what makes delete+set an LRU.
var store = new Map();

var versionState = { at: 0, values: Object.create(null), inFlight: null, disabled: false };

function normalizeQuery(query) {
  var sp = new URLSearchParams();
  var keys = Object.keys(query || {}).sort();
  for (var i = 0; i < keys.length; i++) {
    var value = query[keys[i]];
    if (Array.isArray(value)) {
      for (var j = 0; j < value.length; j++) {
        sp.append(keys[i], value[j]);
      }
    } else if (value !== undefined) {
      sp.append(keys[i], value);
    }
  }
  sp.sort();
  return sp.toString();
}

function refreshVersions() {
  if (versionState.disabled || !versionStore.isEnabled()) {
    return;
  }
  if (Date.now() - versionState.at <= VERSION_MEMO_MS || versionState.inFlight) {
    return;
  }
  versionState.inFlight = versionStore
    .readVersions()
    .then(function (values) {
      versionState.values = values || Object.create(null);
      versionState.at = Date.now();
      versionState.inFlight = null;
    })
    .catch(function (error) {
      // The table is missing, or this database user cannot read it. Stop asking
      // for the life of this instance and fall back to plain TTL caching — a
      // data request must never fail because of the cache.
      if (error && (error.code === '42P01' || error.code === '42501' || error.code === 'ER_NO_SUCH_TABLE')) {
        versionState.disabled = true;
        console.warn('[tq-cache] version store unavailable, falling back to TTL-only caching');
      }
      versionState.at = Date.now();
      versionState.inFlight = null;
    });
}

function tqCurrentVersion(scope) {
  refreshVersions();
  return versionState.values[scope];
}

function tqServerGet(key, version) {
  var entry = store.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.e > 0 && Date.now() > entry.e) {
    store.delete(key);
    return undefined;
  }
  if (entry.ver !== version) {
    store.delete(key);
    return undefined;
  }
  store.delete(key);
  store.set(key, entry);
  return entry.v;
}

function tqServerSet(key, value, ttlSeconds, version) {
  store.set(key, {
    v: value,
    e: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0,
    ver: version,
  });
  while (store.size > MAX_ENTRIES) {
    store.delete(store.keys().next().value);
  }
}

function tqPurge(scope) {
  if (scope === '*') {
    store.clear();
    versionState.values = Object.create(null);
    versionState.at = 0;
    return;
  }
  // Both the scope's own keys (scope|...) and every SUB-scope beneath it
  // (scope:count|...). A products write clears the rows and the total together.
  // Matching on the colon cannot reach a sibling table: a longer table name
  // continues with its own characters rather than a colon.
  var prefix = scope + '|';
  var subPrefix = scope + ':';
  store.forEach(function (_entry, key) {
    if (key.indexOf(prefix) === 0 || key.indexOf(subPrefix) === 0) {
      store.delete(key);
    }
  });
}

function withVersion(payload, version) {
  if (version === undefined || !payload || typeof payload !== 'object') {
    return payload;
  }
  return Object.assign({}, payload, { version: version });
}

function applyHeaders(res, opts, state, version) {
  // Feature-detected: the same wrapper runs behind the hand-rolled req/res that
  // fetchData/fetchCount build for the getStaticProps prefetch, which implement
  // only status() and json(). Calling setHeader there would throw on every page.
  if (!res || typeof res.setHeader !== 'function') {
    return;
  }
  res.setHeader('X-TQ-Cache', state);
  if (version !== undefined) {
    res.setHeader('X-TQ-Version', String(version));
  }
  res.setHeader(
    'Cache-Control',
    opts.sMaxAge > 0
      ? 'public, s-maxage=' + opts.sMaxAge + ', stale-while-revalidate=' + (opts.swr || opts.sMaxAge * 10)
      : 'private, no-store'
  );
}

/**
 * Wraps a Next API handler. \`status(code).json(payload)\` is the entire response
 * surface every generated data-source fetcher uses, so the proxy below is
 * complete rather than approximate.
 */
function tqWithCache(handler, opts) {
  return async function tqCachedHandler(req, res) {
    if (!opts || (!opts.ttl && !opts.sMaxAge)) {
      return handler(req, res);
    }
    if (req && req.method && req.method !== 'GET') {
      return handler(req, res);
    }
    // A request that carries credentials is not a pure function of its URL, so
    // it must never populate or read an entry shared with other visitors.
    var headers = (req && req.headers) || {};
    if (headers.authorization) {
      return handler(req, res);
    }

    var version = tqCurrentVersion(opts.versionScope || opts.scope);
    var key = opts.scope + '|' + normalizeQuery(req && req.query);

    if (opts.ttl > 0) {
      var hit = tqServerGet(key, version);
      if (hit !== undefined) {
        applyHeaders(res, opts, 'HIT', version);
        return res.status(200).json(withVersion(hit, version));
      }
    }

    var statusCode = 200;
    var payload;
    var proxy = {
      status: function (code) {
        statusCode = code;
        return proxy;
      },
      json: function (data) {
        payload = data;
        return proxy;
      },
    };

    await handler(req, proxy);

    if (statusCode === 200 && payload && payload.success && opts.ttl > 0) {
      tqServerSet(key, payload, opts.ttl, version);
    }

    applyHeaders(res, opts, 'MISS', version);
    return res.status(statusCode).json(statusCode === 200 ? withVersion(payload, version) : payload);
  };
}

function tqReadVersions(scopes) {
  if (!versionStore.isEnabled()) {
    return Promise.resolve({});
  }
  return versionStore.readVersions(scopes);
}

function tqBumpVersions(scopes) {
  if (!versionStore.isEnabled()) {
    return Promise.resolve({});
  }
  return versionStore.bumpVersions(scopes);
}

module.exports = {
  tqWithCache: tqWithCache,
  tqPurge: tqPurge,
  tqCurrentVersion: tqCurrentVersion,
  tqReadVersions: tqReadVersions,
  tqBumpVersions: tqBumpVersions,
  tqServerGet: tqServerGet,
  tqServerSet: tqServerSet,
  tqNormalizeQuery: normalizeQuery,
};
`
}
