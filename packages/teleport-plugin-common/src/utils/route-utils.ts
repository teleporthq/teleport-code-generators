import { UIDLWorkflows } from '@teleporthq/teleport-types'
import { RoutePaths } from '@teleporthq/teleport-shared'

/**
 * True when this UIDL component's output route contains a Next.js dynamic
 * segment (`[id]`, `[slug]`, ...) anywhere in its folder path or file name.
 */
export const isDynamicRoute = (uidl: {
  outputOptions?: { folderPath?: string[]; fileName?: string }
}): boolean => {
  const { folderPath = [], fileName = '' } = uidl.outputOptions || {}
  return [...folderPath, fileName].some(
    (segment) => segment.startsWith('[') && segment.endsWith(']')
  )
}

/**
 * Reading a route TEMPLATE (`/event-details/[id]`) rather than a URL. Defined in
 * teleport-shared because the navlink resolver needs the same two functions and
 * lives in a package that does not depend on this one; re-exported here so
 * `RouteUtils` stays the single import for route questions in the plugins.
 */
export const { pathHasDynamicSegment, parseDynamicPathSegments } = RoutePaths

const MUTATION_NODE_TYPES = new Set(['data-create-item', 'data-update-item'])

/**
 * True when this page both reads one specific database row via its own
 * getStaticProps (`detailsPageInfo.tableName` — present on every details
 * page, feature/admin/generic alike, regardless of the project's visual nav
 * layout) AND has a workflow scoped to this page/an element on it that
 * writes to that SAME table. That combination is the actual ISR hazard: a
 * form on this page can just have written the exact row this page's own
 * getStaticProps reads, and ISR would keep serving the pre-write snapshot
 * for up to `cache.revalidate` seconds — a real, successful save silently
 * looking "unsaved" on reload (the "Edit Press Item" bug). This is a
 * data-correctness signal tied to what the page actually does, not a proxy
 * for it — unlike a project-wide "dashboard vs standard" nav-layout choice,
 * which has no bearing on whether any single page both reads and writes the
 * same row (a `standard`-layout marketplace's "Edit Listing" page carries
 * the identical risk; a `dashboard`-layout read-only report page carries
 * none of it).
 *
 * Shared by `teleport-plugin-next-static-props` (decides getStaticProps vs
 * getServerSideProps) and `teleport-plugin-next-static-paths` (decides
 * whether to skip getStaticPaths) — both plugins must reach the exact same
 * verdict for a given page, so the check lives here once instead of as two
 * independently-maintained copies.
 */
export const pageHasSameTableMutationWorkflow = (
  uidl: {
    name?: string
    outputOptions?: {
      pageId?: string
      fileName?: string
      detailsPageInfo?: { tableName?: string }
    }
  },
  workflows?: UIDLWorkflows
): boolean => {
  const tableName = uidl.outputOptions?.detailsPageInfo?.tableName
  if (!tableName || !workflows?.workflows) {
    return false
  }

  const pageId = uidl.outputOptions?.pageId || uidl.outputOptions?.fileName || uidl.name || ''

  return Object.values(workflows.workflows).some((wf) => {
    const trigger = wf.trigger
    if (!trigger || (trigger.scope !== 'page' && trigger.scope !== 'element')) {
      return false
    }

    // Same page-matching semantics the runtime workflow plugin already uses
    // (workflow-component-plugin.ts's getRelevantWorkflows): an empty/absent
    // `selectedPages` means the trigger fires on every page it's attached to,
    // a non-empty one restricts it to those pages.
    const triggerPageId = trigger.config?.pageId as string | undefined
    const selectedPages = trigger.config?.selectedPages as Array<{ id: string }> | undefined
    const isScopedToThisPage =
      trigger.scope === 'page'
        ? !triggerPageId || triggerPageId === pageId
        : !selectedPages || selectedPages.length === 0 || selectedPages.some((p) => p.id === pageId)

    if (!isScopedToThisPage) {
      return false
    }

    return wf.nodes.some(
      (node) => MUTATION_NODE_TYPES.has(node.type) && node.config?.tableName === tableName
    )
  })
}
