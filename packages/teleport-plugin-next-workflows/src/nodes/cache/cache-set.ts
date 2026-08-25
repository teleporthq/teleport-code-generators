import { NodeHandlerGenerator } from '../types'
import { CACHE_STORE_HELPERS, CACHE_STORE_PREAMBLE } from './store'

const DEFAULT_TTL_SECONDS = 300
const MAX_ENTRIES = 200

/**
 * Stores a value in the workflow cache for a set duration.
 *
 * Entry count is capped because a workflow can key by anything — a user id, a
 * search term — and an unbounded store on a warm serverless instance is a slow
 * memory leak rather than a cache.
 *
 * ⛔ Reports `stored`, never `success: false` — the runtime treats that as FATAL
 * and would halt the workflow because a CACHE write was misconfigured.
 */
const BODY = `async function cache_set(config, context) {
${CACHE_STORE_PREAMBLE}

${CACHE_STORE_HELPERS}

  var scope = config.scope;
  var key = config.key;

  if (!scope || key === undefined || key === null || key === '') {
    return { stored: false, scope: scope, key: key };
  }

  var ttl = Number(config.ttlSeconds);
  if (!isFinite(ttl) || ttl <= 0) {
    ttl = ${DEFAULT_TTL_SECONDS};
  }

  var fullKey = tqwFullKey(scope, String(key));
  var entry = { v: config.value, e: Date.now() + ttl * 1000 };
  store[fullKey] = entry;

  var keys = Object.keys(store);
  if (keys.length > ${MAX_ENTRIES}) {
    keys
      .map(function (k) {
        return [k, store[k] && store[k].e ? store[k].e : 0];
      })
      .sort(function (a, b) {
        return a[1] - b[1];
      })
      .slice(0, keys.length - ${MAX_ENTRIES})
      .forEach(function (pair) {
        delete store[pair[0]];
      });
  }

  var s = tqwStorage();
  if (s) {
    try {
      s.setItem(fullKey, JSON.stringify(entry));
    } catch (e) {
      /* memory-only; a full quota must never fail the workflow */
    }
  }

  return { stored: true, scope: scope, key: String(key) };
}`

export const cacheSet: NodeHandlerGenerator = {
  nodeType: 'cache-set',
  executionEnv: 'universal',
  generateHandler(): string {
    return BODY
  },
}
