/**
 * The workflow-level cache store, shared between `cache-get` and `cache-set`.
 *
 * ## Why this is hand-rolled rather than importing the emitted runtime
 *
 * Node handlers are shipped into the generated project as runtime SOURCE (the
 * `.toString()` of a compiled function) and then run through webpack. webpack
 * rewrites `require(` in that source, so a handler cannot import anything —
 * `webpack-safe-handlers.test.ts` enforces exactly that. Every cross-handler
 * value therefore has to travel through a `globalThis` property, which is the
 * one form webpack leaves alone.
 *
 * The two handlers get separate IIFE scopes in the emitted file, so the store
 * cannot be a module-level variable either.
 *
 * Consequence worth knowing: workflow-cached values live in their OWN store,
 * not the array-mapper one. That is a feature rather than a compromise — a
 * workflow picks its own scope names, so the two could never have collided
 * meaningfully, and keeping them apart means a workflow cannot evict a list.
 */
export const CACHE_STORE_PREAMBLE = `  var g = globalThis;
  if (!g.__tqWorkflowCache) {
    g.__tqWorkflowCache = { entries: {} };
  }
  var store = g.__tqWorkflowCache.entries;
  var isBrowser = typeof window !== 'undefined';`

/**
 * Browser entries are mirrored into `sessionStorage` so they survive the full
 * page loads the navigation node performs, and are dropped on a reload for the
 * same reason the array-mapper cache is: a refresh must always be a way to get
 * fresh data.
 */
export const CACHE_STORE_HELPERS = `  function tqwStorage() {
    try {
      return isBrowser ? window.sessionStorage : null;
    } catch (e) {
      return null;
    }
  }

  function tqwFullKey(scope, key) {
    return 'tqw:' + scope + '|' + key;
  }

  function tqwRead(fullKey) {
    var entry = store[fullKey];
    if (!entry) {
      var s = tqwStorage();
      if (!s) {
        return undefined;
      }
      try {
        var raw = s.getItem(fullKey);
        if (!raw) {
          return undefined;
        }
        entry = JSON.parse(raw);
        store[fullKey] = entry;
      } catch (e) {
        return undefined;
      }
    }
    if (!entry || typeof entry !== 'object') {
      return undefined;
    }
    if (entry.e > 0 && Date.now() > entry.e) {
      delete store[fullKey];
      var s2 = tqwStorage();
      if (s2) {
        try {
          s2.removeItem(fullKey);
        } catch (e) {
          /* ignore */
        }
      }
      return undefined;
    }
    return entry;
  }`
