import {
  ComponentUIDL,
  UIDLElement,
  UIDLNode,
  UIDLWorkflow,
  UIDLWorkflows,
} from '@teleporthq/teleport-types'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import { getRelevantWorkflows, resolveLifecycleTriggerElementId } from './workflow-scope'

/**
 * Lifecycle triggers that fire because the page appeared. They run when the
 * page or component carrying them mounts, so the page has to remount on every
 * arrival (see `PageArrival.remountPageOnArrival`).
 */
const PAGE_ARRIVAL_TRIGGER_TYPES = new Set([
  'event-page-loaded',
  'event-element-visible',
  'event-component-loaded',
])

export const isPageArrivalWorkflow = (workflow: UIDLWorkflow): boolean =>
  PAGE_ARRIVAL_TRIGGER_TYPES.has(workflow.trigger.type)

/** Every static `id` in a node tree — the ids an element-visible trigger can observe. */
const collectStaticElementIds = (node: UIDLNode): Set<string> => {
  const ids = new Set<string>()
  UIDLUtils.traverseElements(node, (element) => {
    const id = element.attrs?.id
    if (id?.type === 'static' && typeof id.content === 'string') {
      ids.add(id.content)
    }
  })
  return ids
}

/**
 * The project component a node renders. Local dependencies are resolved before
 * the pages are generated, which rewrites `semanticType` to the component's
 * class name — the original key still matches a component that was not renamed.
 */
const findRenderedComponent = (
  element: UIDLElement,
  projectComponents: Record<string, ComponentUIDL>
): ComponentUIDL | undefined => {
  if (element.dependency?.type !== 'local') {
    return undefined
  }
  const reference = element.semanticType || element.elementType
  return (
    projectComponents[reference] ||
    Object.values(projectComponents).find(
      (component) => UIDLUtils.getComponentClassName(component) === reference
    )
  )
}

/** The components a node tree renders, directly or through other components. */
const collectRenderedComponents = (
  node: UIDLNode,
  projectComponents: Record<string, ComponentUIDL>,
  rendered: Set<ComponentUIDL>
): Set<ComponentUIDL> => {
  UIDLUtils.traverseElements(node, (element) => {
    const component = findRenderedComponent(element, projectComponents)
    if (component && !rendered.has(component)) {
      rendered.add(component)
      collectRenderedComponents(component.node, projectComponents, rendered)
    }
  })
  return rendered
}

/**
 * Mirrors what the workflow plugin emits into the component: the workflows it
 * finds relevant, with an element-visible trigger kept only when the observed
 * element is rendered by the component itself.
 */
const componentRunsOnArrival = (component: ComponentUIDL, workflows: UIDLWorkflows): boolean => {
  const arrivalWorkflows = getRelevantWorkflows(workflows, component, false).filter(
    isPageArrivalWorkflow
  )
  if (arrivalWorkflows.length === 0) {
    return false
  }
  const elementIds = collectStaticElementIds(component.node)
  return arrivalWorkflows.some((workflow) => {
    const targetId = resolveLifecycleTriggerElementId(
      workflow.trigger.type,
      (workflow.trigger.config || {}) as Record<string, unknown>
    )
    return (
      workflow.trigger.type !== 'event-element-visible' ||
      (targetId !== null && elementIds.has(targetId))
    )
  })
}

/**
 * True when a component the page renders runs a workflow when it appears — an
 * element-visible trigger on one of its elements, a component-loaded trigger.
 * The component mounts again only when the page around it does, so such a page
 * remounts on every arrival even when it has no arrival trigger of its own.
 */
export const pageRendersArrivalComponent = (
  pageNode: UIDLNode,
  workflows: UIDLWorkflows,
  projectComponents?: Record<string, ComponentUIDL>
): boolean => {
  if (!projectComponents) {
    return false
  }
  const rendered = collectRenderedComponents(pageNode, projectComponents, new Set())
  return Array.from(rendered).some((component) => componentRunsOnArrival(component, workflows))
}
