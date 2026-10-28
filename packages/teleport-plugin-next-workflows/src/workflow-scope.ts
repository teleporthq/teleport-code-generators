import { UIDLWorkflow, UIDLWorkflows } from '@teleporthq/teleport-types'
import { BUSINESS_EVENT_TRIGGER } from './automations/automations-scope'

/**
 * Which workflows belong to a page or a component, and which element a
 * lifecycle trigger is bound to. Shared by the workflow plugin, which emits the
 * workflows, and by the page-arrival check, which has to reach the same verdict
 * for the components a page renders.
 */

/**
 * Trigger types that run as LIFECYCLE code (no React event prop) but are still
 * bound to ONE element, so the workflow only belongs on the page that renders
 * it. Returns the DOM id to prune against, or null when the trigger is not
 * element-scoped.
 *
 * Same fallback chain as the element-trigger branch: the HTML id first, the
 * project-document node id only as a last resort.
 */
export const resolveLifecycleTriggerElementId = (
  triggerType: string,
  config: Record<string, unknown>
): string | null => {
  if (
    triggerType !== 'event-element-visible' &&
    triggerType !== 'event-chapter-reached' &&
    triggerType !== 'event-scene-scrolled-past'
  ) {
    return null
  }
  return ((config.elementHtmlId || config.nodeId) as string) || null
}

// Component-scope triggers match by emitted component name. The GUI stamps the
// name at export time, but generators may re-case or strip spaces during
// resolution, so equality is checked case/separator-insensitively.
const normalizeComponentName = (name: string): string =>
  (name || '').toLowerCase().replace(/[^a-z0-9]/g, '')

export const getRelevantWorkflows = (
  workflows: UIDLWorkflows,
  uidl: any,
  isPage: boolean
): UIDLWorkflow[] => {
  const relevant: UIDLWorkflow[] = []
  const pageId = uidl.outputOptions?.pageId || uidl.outputOptions?.fileName || uidl.name || ''

  const allWorkflows = Object.values(workflows.workflows) as UIDLWorkflow[]
  allWorkflows.forEach((wf: UIDLWorkflow) => {
    const trigger = wf.trigger

    if (trigger.type === 'event-cron-triggered') {
      return
    }

    if (trigger.type === 'event-webhook-received') {
      return
    }

    // An automation runs in a handler module of the in-app event bus.
    if (trigger.type === BUSINESS_EVENT_TRIGGER) {
      return
    }

    if (trigger.type === 'event-state-change') {
      const cfg = trigger.config || {}
      const stateDefs = cfg.stateDefinitions as
        | Array<{
            pageOrComponentId?: string
            pageOrComponentName?: string
            name?: string
            stateDefinitionId?: string
          }>
        | undefined

      let boundContainerType = cfg.boundContainerType as string | undefined
      if (!boundContainerType) {
        if (stateDefs?.some((s) => s.pageOrComponentName)) {
          boundContainerType = 'component'
        } else if (!isPage && stateDefs && stateDefs.length > 0) {
          boundContainerType = 'component'
        } else {
          boundContainerType = 'page'
        }
      }

      const matchesContainer = boundContainerType === 'page' ? isPage : !isPage
      if (!matchesContainer) {
        return
      }

      const boundFromConfig = cfg.boundPageOrComponentId as string | undefined
      const matchesByName =
        !!stateDefs &&
        stateDefs.some((sd) => sd.pageOrComponentName && sd.pageOrComponentName === uidl.name)
      const matchesById =
        boundFromConfig === pageId ||
        (!!stateDefs && stateDefs.some((sd) => sd.pageOrComponentId === pageId))

      if (matchesByName || matchesById) {
        relevant.push(wf)
      }
      return
    }

    if (trigger.type === 'event-global-state-change') {
      if (!isPage) {
        return
      }
      const selectedPages = trigger.config.selectedPages as Array<{ id: string }> | undefined
      if (
        selectedPages &&
        selectedPages.length > 0 &&
        !selectedPages.some((p) => p.id === pageId)
      ) {
        return
      }
      relevant.push(wf)
      return
    }

    if (trigger.scope === 'global') {
      return
    }

    if (trigger.scope === 'component') {
      if (isPage) {
        return
      }
      const cfg = trigger.config || {}
      const cfgName = (cfg.componentName as string) || ''
      const cfgId = (cfg.componentId as string) || ''
      const matches =
        (cfgName &&
          (cfgName === uidl.name ||
            normalizeComponentName(cfgName) === normalizeComponentName(uidl.name))) ||
        (cfgId && cfgId === pageId)
      if (matches) {
        relevant.push(wf)
      }
      return
    }

    if (trigger.scope === 'page' && isPage) {
      const triggerPageId = trigger.config.pageId as string
      const selectedPages = trigger.config.selectedPages as Array<{ id: string }> | undefined

      if (trigger.type === 'event-page-loaded') {
        const allPages = trigger.config.allPages === true
        if (allPages) {
          relevant.push(wf)
          return
        }
        // Unscoped page-loaded workflows are SKIPPED, not injected everywhere.
        // Silently fanning out to every page masks mis-scoped workflows whose
        // state target lives in a component (the setter no-ops on pages).
        if (!triggerPageId && (!selectedPages || selectedPages.length === 0)) {
          return
        }
      }

      if (triggerPageId && triggerPageId !== pageId) {
        return
      }

      if (selectedPages && !selectedPages.some((p) => p.id === pageId)) {
        return
      }

      relevant.push(wf)
      return
    }

    if (trigger.scope === 'element') {
      // If the element-scoped trigger specifies which pages it belongs to, filter by page.
      // This prevents including ALL element-scoped workflows on every page (massive bloat).
      const elementSelectedPages = trigger.config.selectedPages as Array<{ id: string }> | undefined
      if (isPage && elementSelectedPages && elementSelectedPages.length > 0) {
        if (!elementSelectedPages.some((p) => p.id === pageId)) {
          return
        }
      }

      relevant.push(wf)
      return
    }
  })

  return relevant
}
