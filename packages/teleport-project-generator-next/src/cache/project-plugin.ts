import {
  FileType,
  ProjectPlugin,
  ProjectPluginStructure,
  ProjectUIDL,
} from '@teleporthq/teleport-types'
import { DataCache } from '@teleporthq/teleport-shared'
import { generatePgClientCode } from '@teleporthq/teleport-plugin-next-workflows'

/** Node types that reach the cache runtime from inside a workflow. */
const CACHE_NODE_TYPES = new Set(['cache-get', 'cache-set', 'cache-invalidate'])

/**
 * Does any array mapper in this project cache its results?
 *
 * Walks the raw UIDL rather than the component chunks because this plugin runs
 * at project level, after components have already been generated.
 */
const hasCachedArrayMapper = (uidl: ProjectUIDL): boolean => {
  let found = false

  // tslint:disable-next-line:no-any
  const walk = (node: any): void => {
    if (found || !node || typeof node !== 'object') {
      return
    }
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (node.type === 'cms-list-repeater' && node.content?.cache?.enabled === true) {
      found = true
      return
    }
    Object.keys(node).forEach((key) => walk(node[key]))
  }

  walk(uidl.root)
  Object.values(uidl.components || {}).forEach(walk)

  return found
}

const usesCacheWorkflowNode = (uidl: ProjectUIDL): boolean => {
  const workflows = uidl.workflows?.workflows || {}
  const customNodes = uidl.workflows?.customNodes || {}

  // tslint:disable-next-line:no-any
  const anyNodeIsCache = (nodes: any[]): boolean =>
    (nodes || []).some((node) => CACHE_NODE_TYPES.has(node?.type))

  return (
    Object.values(workflows).some((workflow) => anyNodeIsCache(workflow.nodes)) ||
    Object.values(customNodes).some((customNode) => anyNodeIsCache(customNode.nodes))
  )
}

/**
 * Picks the database the invalidation counter lives in.
 *
 * It does NOT have to be the source being cached — any Postgres this app can
 * already reach will do, and on a TeleportHQ-hosted project that is always the
 * platform database the fetchers already connect to. Everything else gets the
 * no-op store and falls back to TTL-only expiry, which the editor's inspector
 * states rather than implying.
 */
const hasVersionStoreDataSource = (uidl: ProjectUIDL): boolean =>
  Object.values(uidl.dataSources || {}).some((dataSource) =>
    DataCache.VERSION_STORE_TYPES.includes(dataSource.type)
  )

/**
 * Emits the data-cache runtime, exactly once per project.
 *
 * Two generators reference these files — the array-mapper plugin and the
 * workflow cache nodes — so ownership sits here instead: component plugins only
 * ever emit `import`s against fixed paths, and two plugins can never race to
 * write the same file.
 */
export class NextCacheRuntimePlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { uidl, files } = structure

    if (!hasCachedArrayMapper(uidl) && !usesCacheWorkflowNode(uidl)) {
      return structure
    }

    files.set('tq-cache-client', {
      path: DataCache.CACHE_RUNTIME_DIR,
      files: [
        {
          name: DataCache.CACHE_CLIENT_MODULE,
          fileType: FileType.JS,
          content: DataCache.generateCacheClientRuntime(),
        },
      ],
    })

    files.set('tq-cache-server', {
      path: DataCache.CACHE_RUNTIME_DIR,
      files: [
        {
          name: DataCache.CACHE_SERVER_MODULE,
          fileType: FileType.JS,
          content: DataCache.generateCacheServerRuntime(),
        },
      ],
    })

    // Always emitted, as a no-op when there is nothing to bump: Next resolves
    // `require` at build time, so a conditionally-absent module is a build
    // failure rather than a runtime fallback.
    files.set('tq-cache-version-store', {
      path: DataCache.CACHE_RUNTIME_DIR,
      files: [
        {
          name: DataCache.CACHE_VERSION_STORE_MODULE,
          fileType: FileType.JS,
          content: DataCache.generateVersionStore(
            hasVersionStoreDataSource(uidl) ? { clientCode: generatePgClientCode() } : {}
          ),
        },
      ],
    })

    files.set('tq-cache-api-routes', {
      path: DataCache.CACHE_API_DIR,
      files: [
        {
          name: DataCache.CACHE_VERSION_ROUTE,
          fileType: FileType.JS,
          content: DataCache.generateCacheVersionRoute(),
        },
        {
          name: DataCache.CACHE_INVALIDATE_ROUTE,
          fileType: FileType.JS,
          content: DataCache.generateCacheInvalidateRoute(),
        },
      ],
    })

    // Registered as a secret placeholder so the deploy step resolves it from the
    // project secret store. Without it the invalidate route answers 401 to
    // everyone, which is the correct failure direction — a missing secret must
    // never mean "no authentication required".
    if (!uidl.globals.env) {
      uidl.globals.env = {}
    }
    if (!uidl.globals.env[DataCache.CACHE_SECRET_ENV]) {
      uidl.globals.env[
        DataCache.CACHE_SECRET_ENV
      ] = `teleporthq.secrets.${DataCache.CACHE_SECRET_ENV}`
    }

    return structure
  }
}
