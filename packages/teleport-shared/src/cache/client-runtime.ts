import { CLIENT_MAX_ENTRIES, CLIENT_MAX_ENTRY_BYTES, CACHE_VERSION_ROUTE } from './constants'

/**
 * The browser half of the data cache, emitted as `utils/tq-cache/client.js`.
 *
 * ## Why `sessionStorage` AND an in-memory mirror
 *
 * The product requirement is "cached for the session, cleared when the visitor
 * refreshes". Neither store gives that on its own:
 *
 *  - `sessionStorage` SURVIVES a reload and only dies with the tab, so it is
 *    wrong in one direction;
 *  - plain module memory dies on every full page load — and the workflow
 *    `navigation-go-to-page` node is a full page load (`window.location.href`) —
 *    so it is wrong in the other.
 *
 * So: `sessionStorage` is the substrate, and the module purges it at load time
 * when the Navigation Timing API says this load was a reload. The visitor gets a
 * cache that survives in-tab navigation, dies with the tab, and that a refresh
 * always clears — which is what a refresh is for.
 *
 * ## Three properties that are load-bearing, not incidental
 *
 * 1. **Identity stability.** `DataProvider` runs
 *    `useEffect(() => setData(initialData), [initialData])`. A fresh array on
 *    every render is an infinite loop, so the `memory` Map is the single owner
 *    of every parsed value and hands back the SAME reference each time.
 * 2. **The hydration latch.** Reads return `undefined` until the first client
 *    effect calls `tqMarkHydrated()`, so the hydration render is byte-identical
 *    to the server render. Every case the cache exists for — a key-driven
 *    remount, a client-side route change — happens after that.
 * 3. **Sticky entries.** Once a value has been handed to a mounted provider as
 *    `initialData`, TTL expiry must not flip it back to `undefined`: the
 *    provider would blank the list and NOT refetch, because `params` did not
 *    change.
 *
 * Cross-tab sharing is deliberately not attempted — `sessionStorage` is per-tab
 * by definition. Only INVALIDATION propagates, and the `storage` event only
 * fires for `localStorage`, so a `localStorage` signal key is the fallback when
 * `BroadcastChannel` is unavailable.
 */
export const generateCacheClientRuntime = (): string => {
  return `/* TeleportHQ data cache — browser. Generated file, do not edit. */

var NS = 'tqc:';
var SIGNAL_KEY = 'tqc:signal';
var MAX_ENTRIES = ${CLIENT_MAX_ENTRIES};
var MAX_ENTRY_BYTES = ${CLIENT_MAX_ENTRY_BYTES};

var memory = new Map();
var versions = Object.create(null);
var handedOut = new Set();
var hydrated = false;
// Every scope this page has asked about, so returning to the tab can re-ask.
var watchedScopes = [];
var lastRevalidateAt = 0;
var channel = null;

function hasWindow() {
  return typeof window !== 'undefined';
}

function store() {
  try {
    return hasWindow() ? window.sessionStorage : null;
  } catch (e) {
    return null;
  }
}

function fullKey(scope, key) {
  return NS + scope + '|' + key;
}

/**
 * Derived from the SAME object the request is built from, then sorted, so the
 * cache key and the request identity cannot drift: an \`undefined\` stringifies
 * to "undefined" on both sides, and property order stops mattering.
 */
function tqCacheKey(params) {
  try {
    var sp = new URLSearchParams(params || {});
    sp.sort();
    return sp.toString();
  } catch (e) {
    return null;
  }
}

function tqMarkHydrated() {
  hydrated = true;
}

function tqCacheGet(scope, key, opts) {
  if (!hasWindow() || !hydrated || !key) {
    return undefined;
  }

  var k = fullKey(scope, key);
  var entry = memory.get(k);

  if (!entry) {
    var raw = null;
    var s = store();
    if (s) {
      try {
        raw = s.getItem(k);
      } catch (e) {
        raw = null;
      }
    }
    if (!raw) {
      return undefined;
    }
    try {
      entry = JSON.parse(raw);
    } catch (e) {
      tqCacheDelete(scope, key);
      return undefined;
    }
    if (!entry || typeof entry !== 'object' || !('v' in entry)) {
      tqCacheDelete(scope, key);
      return undefined;
    }
    memory.set(k, entry);
  }

  var sticky = !!(opts && opts.sticky) && handedOut.has(k);
  if (!sticky) {
    if (typeof entry.e === 'number' && entry.e > 0 && Date.now() > entry.e) {
      tqCacheDelete(scope, key);
      return undefined;
    }
    var known = versions[scope];
    if (known !== undefined && entry.ver !== undefined && entry.ver !== known) {
      tqCacheDelete(scope, key);
      return undefined;
    }
  }

  entry.t = Date.now();
  if (opts && opts.sticky) {
    handedOut.add(k);
  }
  return entry.v;
}

function tqCacheSet(scope, key, value, ttlSeconds, version) {
  if (!hasWindow() || !key || value === undefined) {
    return value;
  }

  var k = fullKey(scope, key);
  var entry = {
    v: value,
    e: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0,
    ver: version,
    t: Date.now(),
  };
  memory.set(k, entry);

  if (version !== undefined) {
    versions[scope] = version;
  }

  var s = store();
  if (!s) {
    evict(0);
    return value;
  }

  var raw;
  try {
    raw = JSON.stringify(entry);
  } catch (e) {
    return value;
  }
  if (raw.length > MAX_ENTRY_BYTES) {
    return value;
  }

  try {
    s.setItem(k, raw);
  } catch (e) {
    evict(Math.ceil(MAX_ENTRIES / 3));
    try {
      s.setItem(k, raw);
    } catch (e2) {
      /* memory-only from here; never throw out of a fetch */
    }
  }

  evict(0);
  return value;
}

function evict(extra) {
  var limit = MAX_ENTRIES - extra;
  if (memory.size <= limit) {
    return;
  }
  var entries = [];
  memory.forEach(function (entry, key) {
    entries.push([key, entry.t || 0]);
  });
  entries.sort(function (a, b) {
    return a[1] - b[1];
  });
  var s = store();
  for (var i = 0; i < entries.length && memory.size > limit; i++) {
    var key = entries[i][0];
    memory.delete(key);
    handedOut.delete(key);
    if (s) {
      try {
        s.removeItem(key);
      } catch (e) {
        /* ignore */
      }
    }
  }
}

function tqCacheDelete(scope, key) {
  var k = fullKey(scope, key);
  memory.delete(k);
  handedOut.delete(k);
  var s = store();
  if (s) {
    try {
      s.removeItem(k);
    } catch (e) {
      /* ignore */
    }
  }
}

function tqCachePurge(scope) {
  var prefix = scope === '*' ? NS : NS + scope + '|';
  // Sub-scopes (scope:count|...) belong to the same write. A '*' purge already
  // covers everything, so it needs no second prefix.
  var subPrefix = scope === '*' ? null : NS + scope + ':';
  var matches = function (key) {
    return key.indexOf(prefix) === 0 || (subPrefix !== null && key.indexOf(subPrefix) === 0);
  };
  memory.forEach(function (_entry, key) {
    if (matches(key)) {
      memory.delete(key);
      handedOut.delete(key);
    }
  });

  var s = store();
  if (!s) {
    return;
  }
  var doomed = [];
  try {
    for (var i = 0; i < s.length; i++) {
      var key = s.key(i);
      if (key && matches(key)) {
        doomed.push(key);
      }
    }
    for (var j = 0; j < doomed.length; j++) {
      s.removeItem(doomed[j]);
    }
  } catch (e) {
    /* ignore */
  }
}

function tqCacheSetVersion(scope, version) {
  if (version === undefined || version === null || versions[scope] === version) {
    return;
  }
  versions[scope] = version;
  tqCachePurge(scope);
  signal(scope, version);
}

/**
 * One request per page load / tab focus, for EVERY scope on the page at once.
 *
 * This is what closes the "the browser had a hit, so it never talked to the
 * server, so it never learned about the write" hole. Fails open on purpose: a
 * failed revalidation must never block a render or empty a working cache.
 */
function tqCacheRevalidate(scopes) {
  if (!hasWindow() || !scopes || !scopes.length) {
    return;
  }
  for (var s = 0; s < scopes.length; s++) {
    if (watchedScopes.indexOf(scopes[s]) < 0) {
      watchedScopes.push(scopes[s]);
    }
  }
  fetch('/api/tq-cache/${CACHE_VERSION_ROUTE}?scope=' + encodeURIComponent(scopes.join(',')))
    .then(function (res) {
      return res.json();
    })
    .then(function (body) {
      var next = (body && body.versions) || {};
      Object.keys(next).forEach(function (scope) {
        tqCacheSetVersion(scope, next[scope]);
      });
    })
    .catch(function () {
      /* fail open */
    });
}

function signal(scope, version) {
  try {
    if (channel) {
      channel.postMessage({ scope: scope, version: version });
    }
  } catch (e) {
    /* ignore */
  }
  try {
    window.localStorage.setItem(
      SIGNAL_KEY,
      JSON.stringify({ scope: scope, version: version, at: Date.now() })
    );
  } catch (e) {
    /* ignore */
  }
}

if (hasWindow()) {
  // "Cleared when the visitor refreshes" — sessionStorage alone would NOT do
  // this, it survives a reload and only dies with the tab.
  try {
    var navEntries =
      typeof performance !== 'undefined' && performance.getEntriesByType
        ? performance.getEntriesByType('navigation')
        : null;
    var reloaded =
      navEntries && navEntries.length
        ? navEntries[0].type === 'reload'
        : typeof performance !== 'undefined' &&
          performance.navigation &&
          performance.navigation.type === 1;
    if (reloaded) {
      tqCachePurge('*');
    }
  } catch (e) {
    /* ignore */
  }

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('tq-cache');
      channel.onmessage = function (event) {
        if (event && event.data) {
          tqCacheSetVersion(event.data.scope, event.data.version);
        }
      };
    }
  } catch (e) {
    /* ignore */
  }

  // Coming BACK to a tab is the moment a visitor is most likely to be looking at
  // rows that changed while they were away. Without this the browser would sit
  // on its own hits and never learn about a write until its TTL ran out, which
  // is the exact hole the shared version exists to close. Throttled so a flurry
  // of focus events costs one request.
  var doc = typeof document !== 'undefined' ? document : null;
  var revalidateWatched = function () {
    if (!watchedScopes.length || (doc && doc.visibilityState === 'hidden')) {
      return;
    }
    if (Date.now() - lastRevalidateAt < 1000) {
      return;
    }
    lastRevalidateAt = Date.now();
    tqCacheRevalidate(watchedScopes);
  };
  try {
    if (doc && doc.addEventListener) {
      doc.addEventListener('visibilitychange', revalidateWatched);
    }
    window.addEventListener('focus', revalidateWatched);
  } catch (e) {
    /* ignore */
  }

  // The storage event only ever fires for localStorage, which is why the signal
  // key lives there while the cache itself lives in sessionStorage.
  window.addEventListener('storage', function (event) {
    if (event.key !== SIGNAL_KEY || !event.newValue) {
      return;
    }
    try {
      var payload = JSON.parse(event.newValue);
      tqCacheSetVersion(payload.scope, payload.version);
    } catch (e) {
      /* ignore */
    }
  });
}

module.exports = {
  tqCacheKey: tqCacheKey,
  tqMarkHydrated: tqMarkHydrated,
  tqCacheGet: tqCacheGet,
  tqCacheSet: tqCacheSet,
  tqCacheDelete: tqCacheDelete,
  tqCachePurge: tqCachePurge,
  tqCacheSetVersion: tqCacheSetVersion,
  tqCacheRevalidate: tqCacheRevalidate,
};
`
}
