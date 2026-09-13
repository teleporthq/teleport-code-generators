import {
  FileType,
  ProjectPlugin,
  ProjectPluginStructure,
  ProjectUIDL,
} from '@teleporthq/teleport-types'
import { DataCache, PageRevalidate } from '@teleporthq/teleport-shared'

const PAGE_REVALIDATE_NODE_TYPE = 'page-revalidate'

/**
 * Does any workflow in this project refresh a published page?
 *
 * Custom nodes are walked too: a `page-revalidate` step buried in one is just as
 * dependent on the route existing, and a missing route would surface only as the
 * node's warning — never as a build or runtime failure — so nothing would say
 * out loud that the site had stopped refreshing.
 */
const usesPageRevalidateNode = (uidl: ProjectUIDL): boolean => {
  const workflows = uidl.workflows?.workflows || {}
  const customNodes = uidl.workflows?.customNodes || {}

  // tslint:disable-next-line:no-any
  const anyNodeRevalidates = (nodes: any[]): boolean =>
    (nodes || []).some((node) => node?.type === PAGE_REVALIDATE_NODE_TYPE)

  return (
    Object.values(workflows).some((workflow) => anyNodeRevalidates(workflow.nodes)) ||
    Object.values(customNodes).some((customNode) => anyNodeRevalidates(customNode.nodes))
  )
}

/**
 * Emits `pages/api/tq-revalidate`, the one route in a generated project that can
 * call `res.revalidate`.
 *
 * Separate from `NextCacheRuntimePlugin` because it answers a different question:
 * that plugin emits the DATA cache (its runtime, its version store, its routes)
 * for projects that cache queries, while this one emits a single route for
 * projects whose workflows rebuild static pages. A project can want either
 * without the other. What they do share is the secret, so this registers the
 * same placeholder — the cache plugin may not have run.
 */
export class NextPageRevalidatePlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { uidl, files } = structure

    if (!usesPageRevalidateNode(uidl)) {
      return structure
    }

    files.set('tq-revalidate-api-route', {
      path: PageRevalidate.REVALIDATE_API_DIR,
      files: [
        {
          name: PageRevalidate.REVALIDATE_ROUTE,
          fileType: FileType.JS,
          content: PageRevalidate.generatePageRevalidateRoute(),
        },
      ],
    })

    // Registered as a secret placeholder so the deploy step resolves it from the
    // project secret store. Without it the route answers 401 to everyone, which
    // is the correct failure direction — a missing secret must never mean "no
    // authentication required".
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
