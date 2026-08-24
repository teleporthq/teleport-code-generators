import { NodeHandlerGenerator } from '../types'
import { CACHE_STORE_HELPERS, CACHE_STORE_PREAMBLE } from './store'

/**
 * Reads a value a `cache-set` node stored earlier.
 *
 * One body for both environments: the store is a `globalThis` property, which
 * behaves the same in a browser bundle and in a serverless function. On the
 * server it is per-instance, exactly like the array-mapper cache, and bounded by
 * the TTL the writer chose.
 */
const BODY = `async function cache_get(config, context) {
${CACHE_STORE_PREAMBLE}

${CACHE_STORE_HELPERS}

  var scope = config.scope;
  var key = config.key;

  if (!scope || key === undefined || key === null || key === '') {
    return { hit: false, value: undefined, scope: scope, key: key };
  }

  var entry = tqwRead(tqwFullKey(scope, String(key)));
  if (!entry) {
    return { hit: false, value: undefined, scope: scope, key: String(key) };
  }

  return { hit: true, value: entry.v, scope: scope, key: String(key) };
}`

export const cacheGet: NodeHandlerGenerator = {
  nodeType: 'cache-get',
  executionEnv: 'universal',
  generateHandler(): string {
    return BODY
  },
}
