import {
  ComponentPlugin,
  ComponentPluginFactory,
  ChunkType,
  FileType,
  UIDLWorkflow,
  UIDLWorkflows,
  UIDLWorkflowNode,
  UIDLWorkflowEdge,
  UIDLStateDefinition,
  UIDLGlobalStateDefinition,
  UIDLCustomWorkflowNode,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import { StringUtils } from '@teleporthq/teleport-shared'
import { splitIntoSegments } from './segment-splitter'
import { getAPIRouteFileName, hasStreamingAINode } from './api-route-generator'
import { REALTIME_TRIGGER_TYPES, REALTIME_NODE_TYPES } from './graph-utils'
import { neutraliseIsLoggedInGates } from './is-logged-in-gate'
import { formControlPropertyReads } from './trigger-generator'

interface WorkflowPluginConfig {
  isPage?: boolean
}

interface ElementTriggerInfo {
  workflow: UIDLWorkflow
  elementId: string
  reactProp: string
  triggerConfig: Record<string, unknown>
}

const DOM_TO_REACT_EVENT: Record<string, string> = {
  mousedown: 'onMouseDown',
  mouseup: 'onMouseUp',
  mousemove: 'onMouseMove',
  mouseenter: 'onMouseEnter',
  mouseleave: 'onMouseLeave',
  mouseover: 'onMouseOver',
  mouseout: 'onMouseOut',
  contextmenu: 'onContextMenu',
  dblclick: 'onDoubleClick',
  touchstart: 'onTouchStart',
  touchend: 'onTouchEnd',
  touchmove: 'onTouchMove',
  touchcancel: 'onTouchCancel',
  keydown: 'onKeyDown',
  keyup: 'onKeyUp',
  keypress: 'onKeyPress',
  pointerdown: 'onPointerDown',
  pointerup: 'onPointerUp',
  pointermove: 'onPointerMove',
  pointerenter: 'onPointerEnter',
  pointerleave: 'onPointerLeave',
  pointercancel: 'onPointerCancel',
  animationstart: 'onAnimationStart',
  animationend: 'onAnimationEnd',
  animationiteration: 'onAnimationIteration',
  transitionend: 'onTransitionEnd',
  compositionstart: 'onCompositionStart',
  compositionend: 'onCompositionEnd',
  compositionupdate: 'onCompositionUpdate',
  drop: 'onDrop',
  dragover: 'onDragOver',
  dragenter: 'onDragEnter',
  dragleave: 'onDragLeave',
  dragstart: 'onDragStart',
  dragend: 'onDragEnd',
  drag: 'onDrag',
}

const getReactEventProp = (triggerType: string, config: Record<string, unknown>): string | null => {
  switch (triggerType) {
    case 'event-element-clicked':
      return 'onClick'
    case 'event-form-submitted':
      return 'onSubmit'
    case 'event-input-updated':
      return 'onChange'
    case 'event-element-event': {
      const eventType = (config.eventType as string) || 'click'
      if (DOM_TO_REACT_EVENT[eventType]) {
        return DOM_TO_REACT_EVENT[eventType]
      }
      return 'on' + eventType.charAt(0).toUpperCase() + eventType.slice(1)
    }
    default:
      return null
  }
}

const getDOMEventName = (triggerType: string, config: Record<string, unknown>): string => {
  switch (triggerType) {
    case 'event-element-clicked':
      return (config.eventType as string) || 'click'
    case 'event-form-submitted':
      return 'submit'
    case 'event-input-updated':
      return 'input'
    case 'event-element-event':
      return (config.eventType as string) || 'click'
    default:
      return 'click'
  }
}

// Recursively check whether `nodes` — or the body of any `general-custom-node`
// they invoke, resolved via `customNodes` — contains a node with the given
// type. Used to decide when a page needs to wire up a dependency (e.g. the
// `teleportProductFavourites` setter for `state-update-global-state`) whose
// actual use is nested inside a shared custom-node workflow.
const hasNodeTypeTransitively = (
  nodes: UIDLWorkflowNode[],
  targetType: string,
  customNodes: Record<string, UIDLCustomWorkflowNode> | undefined,
  visited: Set<string>
): boolean => {
  for (const node of nodes) {
    if (node.type === targetType) {
      return true
    }
    if (node.type === 'general-custom-node' && customNodes) {
      const customNodeId = ((node.config || {}) as Record<string, unknown>).customNodeId as
        | string
        | undefined
      if (customNodeId && !visited.has(customNodeId)) {
        visited.add(customNodeId)
        const cn = customNodes[customNodeId]
        if (
          cn &&
          Array.isArray(cn.nodes) &&
          hasNodeTypeTransitively(cn.nodes, targetType, customNodes, visited)
        ) {
          return true
        }
      }
    }
  }
  return false
}

// State names that live in GlobalContext (useGlobalContext) rather than in the
// per-page or GlobalStateProvider registry. When a workflow reads or writes
// any of these via state-{get,update}-global-state, the page must bridge the
// GlobalContext setter/value into its stateSetters/stateValues maps so the
// runtime handler can actually mutate the React state that Navigation and
// other components read from.
const GLOBAL_CONTEXT_STATE_NAMES = new Set<string>(['currentUser'])

const hasGlobalContextStateRefTransitively = (
  nodes: UIDLWorkflowNode[],
  customNodes: Record<string, UIDLCustomWorkflowNode> | undefined,
  visited: Set<string>
): boolean => {
  for (const node of nodes) {
    if (node.type === 'state-update-global-state' || node.type === 'state-get-global-state') {
      const prop = (node.config as { property?: unknown } | undefined)?.property
      if (typeof prop === 'string' && GLOBAL_CONTEXT_STATE_NAMES.has(prop)) {
        return true
      }
    }
    if (node.type === 'general-custom-node' && customNodes) {
      const customNodeId = ((node.config || {}) as Record<string, unknown>).customNodeId as
        | string
        | undefined
      if (customNodeId && !visited.has(customNodeId)) {
        visited.add(customNodeId)
        const cn = customNodes[customNodeId]
        if (
          cn &&
          Array.isArray(cn.nodes) &&
          hasGlobalContextStateRefTransitively(cn.nodes, customNodes, visited)
        ) {
          return true
        }
      }
    }
  }
  return false
}

export const createNextWorkflowPlugin: ComponentPluginFactory<WorkflowPluginConfig> = (config) => {
  const { isPage = false } = config || {}

  const workflowPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, options, dependencies } = structure
    const workflows = options.workflows as UIDLWorkflows | undefined

    if (!workflows || !workflows.workflows) {
      return structure
    }

    const relevantWorkflows = getRelevantWorkflows(workflows, uidl, isPage)

    if (relevantWorkflows.length === 0) {
      return structure
    }

    const jsxComponent = chunks.find(
      (chunk) =>
        chunk.name === 'jsx-component' &&
        typeof chunk.content === 'object' &&
        'type' in chunk.content &&
        (chunk.content as any).type === 'VariableDeclaration'
    )

    if (!jsxComponent) {
      return structure
    }

    const stateDefinitions: Record<string, UIDLStateDefinition> =
      (uidl as any).stateDefinitions || {}

    // Classify triggers into element-bound vs lifecycle
    const elementTriggers: ElementTriggerInfo[] = []
    const lifecycleWorkflows: UIDLWorkflow[] = []
    const stateChangeWorkflows: UIDLWorkflow[] = []
    const globalStateChangeWorkflows: UIDLWorkflow[] = []

    for (const wf of relevantWorkflows) {
      const trigger = wf.trigger
      const triggerConfig = (trigger.config || {}) as Record<string, unknown>

      if (trigger.type === 'event-state-change') {
        const triggerStateDefs = triggerConfig.stateDefinitions as
          | Array<{ name: string }>
          | undefined
        if (triggerStateDefs && triggerStateDefs.length > 0) {
          stateChangeWorkflows.push(wf)
        }
        continue
      }

      if (trigger.type === 'event-global-state-change') {
        const gsDefs = triggerConfig.globalStateDefinitions as
          | Array<{ globalStateId: string; name: string }>
          | undefined
        if (gsDefs && gsDefs.length > 0) {
          globalStateChangeWorkflows.push(wf)
        }
        continue
      }

      const reactProp = getReactEventProp(trigger.type, triggerConfig)

      if (reactProp) {
        const elementId = (triggerConfig.elementHtmlId ||
          triggerConfig.nodeId ||
          triggerConfig.formNodeId) as string
        if (elementId) {
          elementTriggers.push({ workflow: wf, elementId, reactProp, triggerConfig })
        } else {
          lifecycleWorkflows.push(wf)
        }
      } else {
        lifecycleWorkflows.push(wf)
      }
    }

    // Pre-scan: find which element triggers can be matched to JSX elements
    const componentBody = (
      (
        (jsxComponent.content as types.VariableDeclaration)
          .declarations[0] as types.VariableDeclarator
      ).init as types.ArrowFunctionExpression
    ).body as types.BlockStatement

    const returnStatement = componentBody.body.find((s) => s.type === 'ReturnStatement') as
      | types.ReturnStatement
      | undefined

    let matchedElements = new Map<string, types.JSXOpeningElement>()
    const matchedElementTriggers: ElementTriggerInfo[] = []
    const unmatchedElementTriggers: ElementTriggerInfo[] = []

    if (returnStatement && returnStatement.argument && elementTriggers.length > 0) {
      const targetIds = new Set(elementTriggers.map((t) => t.elementId))
      matchedElements = findJSXElementsById(returnStatement.argument, targetIds)

      for (const et of elementTriggers) {
        if (matchedElements.has(et.elementId)) {
          matchedElementTriggers.push(et)
        }
        // If the element is not found in this page's JSX tree, skip it.
        // Elements on this page have their id set in attrs.id and will be found by
        // findJSXElementsById. Elements on other pages won't be found and would
        // produce dead-code fallback handlers (document.getElementById returns null).
      }
    }

    // Collect only workflows that have at least one active trigger on this page
    const activeWorkflowIds = new Set<string>()
    for (const et of matchedElementTriggers) {
      activeWorkflowIds.add(et.workflow.id)
    }
    for (const et of unmatchedElementTriggers) {
      activeWorkflowIds.add(et.workflow.id)
    }
    for (const wf of lifecycleWorkflows) {
      activeWorkflowIds.add(wf.id)
    }
    for (const wf of stateChangeWorkflows) {
      activeWorkflowIds.add(wf.id)
    }
    for (const wf of globalStateChangeWorkflows) {
      activeWorkflowIds.add(wf.id)
    }
    const activeWorkflows = relevantWorkflows.filter((wf) => activeWorkflowIds.has(wf.id))

    const AUTH_NODE_TYPES = new Set([
      'account-login',
      'account-signup',
      'account-logout',
      'account-social-login',
    ])
    const hasAuthNodes = activeWorkflows.some((wf) =>
      wf.nodes.some((n) => AUTH_NODE_TYPES.has(n.type))
    )

    // Broader flag: also fires when any workflow reads or writes a
    // GlobalContext-managed state (currently `currentUser`) via
    // state-{get,update}-global-state. Non-auth pages (e.g. /profile/[id])
    // that update the logged-in user's record need the same
    // stateSetters.currentUser → useGlobalContext().setCurrentUser bridge
    // that auth pages already get — otherwise the workflow handler silently
    // no-ops because stateSetters.currentUser is undefined.
    const hasCurrentUserGlobalRefs = activeWorkflows.some((wf) =>
      hasGlobalContextStateRefTransitively(wf.nodes, workflows.customNodes, new Set<string>())
    )
    // Node configs may also reference the logged-in user via a literal
    // {{Current User.id}} template token (resolved at runtime from the
    // __stateValues.currentUser bridge) — those pages need the same
    // GlobalContext plumbing even without a state-get/update node.
    const hasCurrentUserToken = activeWorkflows.some((wf) =>
      wf.nodes.some((n) => JSON.stringify(n.config || {}).includes('{{Current User.'))
    )
    const needsGlobalContextBridge = hasAuthNodes || hasCurrentUserGlobalRefs || hasCurrentUserToken

    const hasAudioNodes = activeWorkflows.some((wf) =>
      wf.nodes.some((n) => n.type === 'audio-play' || n.type === 'audio-stop')
    )

    const hasCustomNodes = activeWorkflows.some((wf) =>
      wf.nodes.some((n) => n.type === 'general-custom-node')
    )

    // Walk into referenced custom-node workflows as well: the Add/Remove
    // favourites flows (and similar shared logic) update global state from
    // inside a `general-custom-node`, not directly on the page. Without the
    // transitive check the page would skip plumbing the setter through
    // `__createWorkflowHandlers`, and the workflow would mutate only the
    // workflow's own context while the React state — and therefore the
    // heart-icon toggle — stayed stale.
    const hasGlobalStateUpdateNodes = activeWorkflows.some((wf) =>
      hasNodeTypeTransitively(
        wf.nodes,
        'state-update-global-state',
        workflows.customNodes,
        new Set<string>()
      )
    )
    const hasGlobalStateChangeTriggers = globalStateChangeWorkflows.length > 0
    const needsGlobalState = hasGlobalStateUpdateNodes || hasGlobalStateChangeTriggers
    const globalStateDefs = (options.globalStateDefinitions || {}) as Record<
      string,
      UIDLGlobalStateDefinition
    >

    const hasRealtimeUsage = activeWorkflows.some(
      (wf) =>
        REALTIME_TRIGGER_TYPES.has(wf.trigger.type) ||
        wf.nodes.some((n: UIDLWorkflowNode) => REALTIME_NODE_TYPES.has(n.type))
    )

    const outputOptionsForHydration = (uidl as any).outputOptions ?? {}
    const initialPropsForHydration = outputOptionsForHydration.initialPropsData
    const formDataStateKeyForHydration = Object.keys(stateDefinitions).find((key) => {
      const def = stateDefinitions[key]
      return (
        def.type === 'object' &&
        typeof def.defaultValue === 'object' &&
        def.defaultValue !== null &&
        !Array.isArray(def.defaultValue) &&
        Object.keys(def.defaultValue as Record<string, unknown>).length > 0
      )
    })
    const needsAdminFormHydration = !!(
      initialPropsForHydration?.exposeAs?.name && formDataStateKeyForHydration
    )

    // Row-owned self-guarded pages: the page-load SQL filters by
    // user_id OR anonymous-localStorage UUID, so guest checkout
    // buyers MUST be allowed through the workflow's
    // `isLoggedIn === true` gate. See
    // `neutraliseIsLoggedInGates` for the precise pattern this
    // recognises and rewires; the source-of-truth row-owner flag is
    // surfaced from the project UIDL via `options.auth`.
    const pageIdForAuth = (uidl as any).outputOptions?.pageId as string | undefined
    const pageProtection =
      pageIdForAuth && options.auth?.pageProtection
        ? (options.auth.pageProtection as Record<string, any>)[pageIdForAuth]
        : undefined
    const isRowOwnedSelfGuardedPage = !!(
      pageProtection &&
      pageProtection.rowOwnerColumn &&
      (!pageProtection.allowedRoles || pageProtection.allowedRoles.length === 0)
    )

    const dynamicRouteAttributeRaw = (uidl as any).outputOptions?.dynamicRouteAttribute as
      | string
      | undefined
    const dynamicRouteAttribute =
      typeof dynamicRouteAttributeRaw === 'string' &&
      /^[A-Za-z_][A-Za-z0-9_-]*$/.test(dynamicRouteAttributeRaw)
        ? dynamicRouteAttributeRaw
        : undefined

    const moduleCode = generateModuleLevelCode(
      activeWorkflows,
      matchedElementTriggers,
      unmatchedElementTriggers,
      lifecycleWorkflows,
      stateChangeWorkflows,
      globalStateChangeWorkflows,
      hasAudioNodes,
      needsAdminFormHydration,
      isRowOwnedSelfGuardedPage,
      dynamicRouteAttribute
    )

    if (moduleCode) {
      chunks.push({
        type: ChunkType.STRING,
        name: 'workflow-module',
        fileType: FileType.JS,
        content: moduleCode,
        linkAfter: ['import-local'],
      })

      const hasLifecycleOrFallback =
        lifecycleWorkflows.length > 0 || unmatchedElementTriggers.length > 0 || hasAudioNodes
      const hasStateChangeTriggers = stateChangeWorkflows.length > 0

      injectWorkflowCode(
        componentBody,
        stateDefinitions,
        matchedElementTriggers,
        matchedElements,
        hasLifecycleOrFallback,
        needsGlobalContextBridge,
        stateChangeWorkflows,
        needsGlobalState ? globalStateDefs : undefined,
        globalStateChangeWorkflows
      )

      // For update/detail pages: initialize form state from props
      const initialPropsData = uidl.outputOptions?.initialPropsData
      if (initialPropsData?.exposeAs?.name && formDataStateKeyForHydration) {
        const propName = initialPropsData.exposeAs.name
        const formDataStateKey = formDataStateKeyForHydration
        const setterName = StringUtils.createStateStoringFunction(formDataStateKey)

        // Find the corresponding selected item ID state key
        // Convention: if form data key is "usersSelectedItemData", ID key is "usersSelectedItemId"
        const idStateKey = formDataStateKey.replace(/Data$/, 'Id')
        const hasIdState = idStateKey !== formDataStateKey && stateDefinitions[idStateKey]
        const idSetterName = hasIdState ? StringUtils.createStateStoringFunction(idStateKey) : null

        const defaultVal = stateDefinitions[formDataStateKey]?.defaultValue ?? {}
        // Build the if-body statements
        const ifBodyStatements: types.Statement[] = [
          types.expressionStatement(
            types.callExpression(types.identifier(setterName), [
              types.callExpression(types.identifier('__normalizeAdminFormRow'), [
                types.memberExpression(types.identifier('props'), types.identifier(propName)),
                defaultValueToLiteral(defaultVal),
              ]),
            ])
          ),
        ]

        // Also set the selected item ID from props[propName].id
        if (idSetterName) {
          ifBodyStatements.push(
            types.expressionStatement(
              types.callExpression(types.identifier(idSetterName), [
                types.callExpression(types.identifier('String'), [
                  types.memberExpression(
                    types.memberExpression(types.identifier('props'), types.identifier(propName)),
                    types.identifier('id')
                  ),
                ]),
              ])
            )
          )
        }

        // Also hydrate a sibling "initial" snapshot state if one exists by
        // convention (e.g. `initialAccountFormData` paired with
        // `accountFormData`). The auth account-form uses this snapshot as
        // the baseline for its dirty-check workflow; without seeding the
        // snapshot from props, `accountFormData` reflects the real user on
        // first render while the snapshot is still the empty default, so
        // the dirty check fires and the Update Account button is stuck on
        // `changed`. Setting both in the same effect keeps the button
        // accurately `idle` until the user actually edits a field.
        const initialStateKey =
          'initial' + formDataStateKey.charAt(0).toUpperCase() + formDataStateKey.slice(1)
        if (initialStateKey !== formDataStateKey && stateDefinitions[initialStateKey]) {
          const initialSetterName = StringUtils.createStateStoringFunction(initialStateKey)
          const initialDefaultVal = stateDefinitions[initialStateKey]?.defaultValue ?? defaultVal
          ifBodyStatements.push(
            types.expressionStatement(
              types.callExpression(types.identifier(initialSetterName), [
                types.callExpression(types.identifier('__normalizeAdminFormRow'), [
                  types.memberExpression(types.identifier('props'), types.identifier(propName)),
                  defaultValueToLiteral(initialDefaultVal),
                ]),
              ])
            )
          )
        }

        // Generate: useEffect(() => { if (props[propName]) { setter(props[propName]); idSetter(String(props[propName].id)) } }, [])
        const useEffectCall = types.expressionStatement(
          types.callExpression(types.identifier('useEffect'), [
            types.arrowFunctionExpression(
              [],
              types.blockStatement([
                types.ifStatement(
                  types.memberExpression(types.identifier('props'), types.identifier(propName)),
                  types.blockStatement(ifBodyStatements)
                ),
              ])
            ),
            types.arrayExpression([]),
          ])
        )

        // Insert useEffect after the workflow ref initialization (before the return statement)
        const returnIdx = componentBody.body.findIndex((stmt) => types.isReturnStatement(stmt))
        if (returnIdx > -1) {
          componentBody.body.splice(returnIdx, 0, useEffectCall)
        }

        dependencies.useEffect = {
          type: 'library',
          path: 'react',
          version: '>=16.8.0',
          meta: { namedImport: true },
        }
      }

      dependencies.useRef = {
        type: 'library',
        path: 'react',
        version: '>=16.8.0',
        meta: { namedImport: true },
      }

      if (hasLifecycleOrFallback || hasStateChangeTriggers || hasGlobalStateChangeTriggers) {
        dependencies.useEffect = {
          type: 'library',
          path: 'react',
          version: '>=16.8.0',
          meta: { namedImport: true },
        }
      }

      const folderDepth = (uidl.outputOptions?.folderPath || []).length
      const pathPrefix = '../'.repeat(1 + folderDepth)

      dependencies.workflowRuntime = {
        type: 'local',
        path: `${pathPrefix}utils/workflows/runtime`,
      }

      // Router singleton for {{urlDifferentiator}}-style token resolution in
      // __execWf (route params are only reachable client-side at call time).
      dependencies.Router = {
        type: 'library',
        path: 'next/router',
        version: '12.1.0',
      }

      dependencies.workflowClientHandlers = {
        type: 'local',
        path: `${pathPrefix}utils/workflows/node-handlers-client`,
      }

      if (hasCustomNodes) {
        dependencies.workflowCustomNodes = {
          type: 'local',
          path: `${pathPrefix}utils/workflows/custom-nodes`,
        }
      }

      if (needsGlobalContextBridge) {
        dependencies.useGlobalContext = {
          type: 'local',
          path: '@/global-context',
          meta: { namedImport: true },
        }
      }

      if (needsGlobalState && Object.keys(globalStateDefs).length > 0) {
        dependencies.useGlobalState = {
          type: 'local',
          path: '@/global-state-context',
          meta: { namedImport: true },
        }
      }

      if (hasRealtimeUsage) {
        dependencies.__realtimeClient = {
          type: 'local',
          path: `${pathPrefix}utils/realtime/client`,
        }
      }
    }

    return structure
  }

  return workflowPlugin
}

const defaultValueToLiteral = (val: unknown): types.Expression => {
  if (val === null) {
    return types.nullLiteral()
  }
  if (typeof val === 'string') {
    return types.stringLiteral(val)
  }
  if (typeof val === 'number') {
    return types.numericLiteral(val)
  }
  if (typeof val === 'boolean') {
    return types.booleanLiteral(val)
  }
  if (Array.isArray(val)) {
    return types.arrayExpression(val.map((item) => defaultValueToLiteral(item)))
  }
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>
    return types.objectExpression(
      Object.keys(o).map((k) =>
        types.objectProperty(types.stringLiteral(k), defaultValueToLiteral(o[k]))
      )
    )
  }
  return types.nullLiteral()
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const resolveStateDefinitionKey = (
  rawName: string,
  stateDefinitions: Record<string, UIDLStateDefinition>
): string | undefined => {
  if (stateDefinitions[rawName]) {
    return rawName
  }
  const normalized = StringUtils.createStateOrPropStoringValue(rawName)
  if (stateDefinitions[normalized]) {
    return normalized
  }
  return undefined
}

const injectWorkflowCode = (
  componentBody: types.BlockStatement,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  matchedTriggers: ElementTriggerInfo[],
  matchedElements: Map<string, types.JSXOpeningElement>,
  hasLifecycleOrFallback: boolean,
  needsGlobalContextBridge?: boolean,
  stateChangeWorkflows?: UIDLWorkflow[],
  globalStateDefinitions?: Record<string, UIDLGlobalStateDefinition>,
  globalStateChangeWorkflows?: UIDLWorkflow[]
): void => {
  const stateSetterProperties: types.ObjectProperty[] = []
  const stateTypeProperties: types.ObjectProperty[] = []
  const stateValueProperties: types.ObjectProperty[] = []

  for (const [key, def] of Object.entries(stateDefinitions)) {
    const setterName = StringUtils.createStateStoringFunction(key)
    stateSetterProperties.push(
      types.objectProperty(types.identifier(key), types.identifier(setterName))
    )
    stateTypeProperties.push(
      types.objectProperty(types.identifier(key), types.stringLiteral(def.type || 'string'))
    )
    stateValueProperties.push(types.objectProperty(types.identifier(key), types.identifier(key)))
  }

  const globalStateStatements: types.Statement[] = []
  if (globalStateDefinitions && Object.keys(globalStateDefinitions).length > 0) {
    const destructuredProps: types.ObjectProperty[] = []
    for (const def of Object.values(globalStateDefinitions)) {
      const setterName = `set${capitalize(def.name)}`
      destructuredProps.push(
        types.objectProperty(types.identifier(def.name), types.identifier(def.name), false, true)
      )
      destructuredProps.push(
        types.objectProperty(
          types.identifier(setterName),
          types.identifier(setterName),
          false,
          true
        )
      )
      stateSetterProperties.push(
        types.objectProperty(types.identifier(def.name), types.identifier(setterName))
      )
      stateTypeProperties.push(
        types.objectProperty(types.identifier(def.name), types.stringLiteral(def.type || 'string'))
      )
      stateValueProperties.push(
        types.objectProperty(types.identifier(def.name), types.identifier(def.name))
      )
    }

    // Always destructure refreshGlobalState for refreshFromDataSource support.
    // If no data source bindings exist, the context won't provide it, but
    // destructuring it will safely produce `undefined` rather than a ReferenceError.
    destructuredProps.push(
      types.objectProperty(
        types.identifier('refreshGlobalState'),
        types.identifier('refreshGlobalState'),
        false,
        true
      )
    )

    const gsDecl = types.variableDeclaration('const', [
      types.variableDeclarator(
        types.objectPattern(destructuredProps),
        types.callExpression(types.identifier('useGlobalState'), [])
      ),
    ])
    globalStateStatements.push(gsDecl)
  }

  const authStatements: types.Statement[] = []
  if (needsGlobalContextBridge) {
    // const __globalCtx = useGlobalContext()
    const globalCtxDecl = types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('__globalCtx'),
        types.callExpression(types.identifier('useGlobalContext'), [])
      ),
    ])
    authStatements.push(globalCtxDecl)

    stateSetterProperties.push(
      types.objectProperty(
        types.identifier('currentUser'),
        types.memberExpression(types.identifier('__globalCtx'), types.identifier('setCurrentUser'))
      )
    )
    stateTypeProperties.push(
      types.objectProperty(types.identifier('currentUser'), types.stringLiteral('object'))
    )
    // Bridge the value too: state-get-global-state reads from __stateValues
    // (seeded by stateValuesRef.current), so it needs currentUser here for
    // workflows that merge the freshly-updated row with the previous snapshot.
    // Use `__globalCtx.currentUser` rather than the `currentUser` shorthand to
    // avoid depending on the locale-mapper-component plugin having already
    // destructured it into page scope.
    stateValueProperties.push(
      types.objectProperty(
        types.identifier('currentUser'),
        types.memberExpression(types.identifier('__globalCtx'), types.identifier('currentUser'))
      )
    )
  }

  // const __wfRef = useRef(null)
  const useRefDecl = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('__wfRef'),
      types.callExpression(types.identifier('useRef'), [types.nullLiteral()])
    ),
  ])

  // const __wfStateRef = useRef({})
  const stateRefDecl = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('__wfStateRef'),
      types.callExpression(types.identifier('useRef'), [types.objectExpression([])])
    ),
  ])

  // __wfStateRef.current = { isLoading, searchQuery, countries, ... }
  const stateRefUpdate = types.expressionStatement(
    types.assignmentExpression(
      '=',
      types.memberExpression(types.identifier('__wfStateRef'), types.identifier('current')),
      types.objectExpression(stateValueProperties)
    )
  )

  const createHandlersArgs: types.Expression[] = [
    types.objectExpression(stateSetterProperties),
    types.objectExpression(stateTypeProperties),
    types.identifier('__wfStateRef'),
  ]

  // if (!__wfRef.current) { __wfRef.current = __createWorkflowHandlers({...}, {...}, __wfStateRef) }
  const initBlock = types.ifStatement(
    types.unaryExpression(
      '!',
      types.memberExpression(types.identifier('__wfRef'), types.identifier('current'))
    ),
    types.blockStatement([
      types.expressionStatement(
        types.assignmentExpression(
          '=',
          types.memberExpression(types.identifier('__wfRef'), types.identifier('current')),
          types.callExpression(types.identifier('__createWorkflowHandlers'), createHandlersArgs)
        )
      ),
    ])
  )

  const statementsToInsert: types.Statement[] = [
    ...globalStateStatements,
    ...authStatements,
    useRefDecl,
    stateRefDecl,
  ]

  const needsMountRef =
    (stateChangeWorkflows && stateChangeWorkflows.length > 0) ||
    (globalStateChangeWorkflows && globalStateChangeWorkflows.length > 0)
  if (needsMountRef) {
    statementsToInsert.push(
      types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('__wfMountRef'),
          types.callExpression(types.identifier('useRef'), [types.objectExpression([])])
        ),
      ])
    )
  }

  statementsToInsert.push(stateRefUpdate, initBlock)

  if (hasLifecycleOrFallback) {
    const useEffectStatement = types.expressionStatement(
      types.callExpression(types.identifier('useEffect'), [
        types.arrowFunctionExpression(
          [],
          types.blockStatement([
            types.returnStatement(
              types.callExpression(
                types.memberExpression(
                  types.memberExpression(types.identifier('__wfRef'), types.identifier('current')),
                  types.identifier('setupLifecycleTriggers')
                ),
                []
              )
            ),
          ])
        ),
        types.arrayExpression([]),
      ])
    )
    statementsToInsert.push(useEffectStatement)
  }

  if (stateChangeWorkflows && stateChangeWorkflows.length > 0) {
    for (const wf of stateChangeWorkflows) {
      const safeId = wf.id.replace(/[^a-zA-Z0-9]/g, '_')
      const triggerConfig = (wf.trigger.config || {}) as Record<string, unknown>
      const triggerStateDefs = triggerConfig.stateDefinitions as Array<{ name: string }> | undefined

      if (!triggerStateDefs || triggerStateDefs.length === 0) {
        continue
      }

      const validStateNames = triggerStateDefs
        .map((sd) => resolveStateDefinitionKey(sd.name, stateDefinitions))
        .filter((name): name is string => name !== undefined)

      if (validStateNames.length === 0) {
        continue
      }

      const stateChangeEffect = types.expressionStatement(
        types.callExpression(types.identifier('useEffect'), [
          types.arrowFunctionExpression(
            [],
            types.blockStatement([
              types.ifStatement(
                types.unaryExpression(
                  '!',
                  types.memberExpression(
                    types.memberExpression(
                      types.identifier('__wfMountRef'),
                      types.identifier('current')
                    ),
                    types.stringLiteral(safeId),
                    true
                  )
                ),
                types.blockStatement([
                  types.expressionStatement(
                    types.assignmentExpression(
                      '=',
                      types.memberExpression(
                        types.memberExpression(
                          types.identifier('__wfMountRef'),
                          types.identifier('current')
                        ),
                        types.stringLiteral(safeId),
                        true
                      ),
                      types.booleanLiteral(true)
                    )
                  ),
                  types.returnStatement(null),
                ])
              ),
              types.expressionStatement(
                types.callExpression(
                  types.memberExpression(
                    types.memberExpression(
                      types.memberExpression(
                        types.identifier('__wfRef'),
                        types.identifier('current')
                      ),
                      types.identifier('stateChangeTriggers')
                    ),
                    types.stringLiteral(safeId),
                    true
                  ),
                  []
                )
              ),
            ])
          ),
          types.arrayExpression(validStateNames.map((name) => types.identifier(name))),
        ])
      )

      statementsToInsert.push(stateChangeEffect)
    }
  }

  if (globalStateChangeWorkflows && globalStateChangeWorkflows.length > 0) {
    for (const wf of globalStateChangeWorkflows) {
      const safeId = wf.id.replace(/[^a-zA-Z0-9]/g, '_')
      const triggerConfig = (wf.trigger.config || {}) as Record<string, unknown>
      const gsDefs = triggerConfig.globalStateDefinitions as
        | Array<{
            globalStateId: string
            name: string
          }>
        | undefined

      if (!gsDefs || gsDefs.length === 0) {
        continue
      }

      const gsKey = `gs_${safeId}`
      const watchedNames = gsDefs.map((d) => d.name)

      const makeCurrentValuesObj = () =>
        types.objectExpression(
          gsDefs.map((d) =>
            types.objectProperty(types.identifier(d.name), types.identifier(d.name))
          )
        )

      const gsChangeEffect = types.expressionStatement(
        types.callExpression(types.identifier('useEffect'), [
          types.arrowFunctionExpression(
            [],
            types.blockStatement([
              types.ifStatement(
                types.unaryExpression(
                  '!',
                  types.memberExpression(
                    types.memberExpression(
                      types.identifier('__wfMountRef'),
                      types.identifier('current')
                    ),
                    types.stringLiteral(gsKey),
                    true
                  )
                ),
                types.blockStatement([
                  types.expressionStatement(
                    types.assignmentExpression(
                      '=',
                      types.memberExpression(
                        types.memberExpression(
                          types.identifier('__wfMountRef'),
                          types.identifier('current')
                        ),
                        types.stringLiteral(gsKey),
                        true
                      ),
                      makeCurrentValuesObj()
                    )
                  ),
                  types.returnStatement(null),
                ])
              ),
              types.expressionStatement(
                types.callExpression(
                  types.memberExpression(
                    types.memberExpression(
                      types.identifier('__wfRef'),
                      types.identifier('current')
                    ),
                    types.identifier('onGlobalStateUpdate')
                  ),
                  [
                    types.stringLiteral(gsKey),
                    types.memberExpression(
                      types.identifier('__wfMountRef'),
                      types.identifier('current')
                    ),
                    makeCurrentValuesObj(),
                  ]
                )
              ),
            ])
          ),
          types.arrayExpression(watchedNames.map((name) => types.identifier(name))),
        ])
      )

      statementsToInsert.push(gsChangeEffect)
    }
  }

  const returnIndex = componentBody.body.findIndex(
    (s: types.Statement) => s.type === 'ReturnStatement'
  )
  if (returnIndex !== -1) {
    componentBody.body.splice(returnIndex, 0, ...statementsToInsert)
  } else {
    componentBody.body.push(...statementsToInsert)
  }

  // Inject React event props on matched JSX elements
  if (matchedTriggers.length > 0) {
    const triggersByElement = new Map<string, ElementTriggerInfo[]>()
    for (const trigger of matchedTriggers) {
      const list = triggersByElement.get(trigger.elementId) || []
      list.push(trigger)
      triggersByElement.set(trigger.elementId, list)
    }

    for (const [elementId, openingElement] of matchedElements) {
      const triggers = triggersByElement.get(elementId) || []

      const byProp = new Map<string, ElementTriggerInfo[]>()
      for (const t of triggers) {
        const list = byProp.get(t.reactProp) || []
        list.push(t)
        byProp.set(t.reactProp, list)
      }

      for (const [reactProp] of byProp) {
        // __wfRef.current.elementTriggers['elementId']['reactProp']
        const wfHandlerExpr = types.memberExpression(
          types.memberExpression(
            types.memberExpression(
              types.memberExpression(types.identifier('__wfRef'), types.identifier('current')),
              types.identifier('elementTriggers')
            ),
            types.stringLiteral(elementId),
            true
          ),
          types.stringLiteral(reactProp),
          true
        )

        const existingAttrIndex = openingElement.attributes.findIndex(
          (attr) =>
            types.isJSXAttribute(attr) &&
            types.isJSXIdentifier(attr.name) &&
            attr.name.name === reactProp
        )

        if (existingAttrIndex !== -1) {
          // Element already has this event prop — combine both handlers
          const existingAttr = openingElement.attributes[existingAttrIndex] as types.JSXAttribute
          let existingExpr: types.Expression

          if (
            types.isJSXExpressionContainer(existingAttr.value) &&
            types.isExpression(existingAttr.value.expression)
          ) {
            existingExpr = existingAttr.value.expression
          } else {
            continue
          }

          // (event) => { existingHandler(event); __wfRef.current.elementTriggers[...](event); }
          const eventParam = types.identifier('event')
          const combinedBody = types.blockStatement([
            types.expressionStatement(types.callExpression(existingExpr, [eventParam])),
            types.expressionStatement(types.callExpression(wfHandlerExpr, [eventParam])),
          ])
          const combinedHandler = types.arrowFunctionExpression([eventParam], combinedBody)

          openingElement.attributes[existingAttrIndex] = types.jSXAttribute(
            types.jSXIdentifier(reactProp),
            types.jSXExpressionContainer(combinedHandler)
          )
        } else {
          // No existing prop — add directly
          openingElement.attributes.push(
            types.jSXAttribute(
              types.jSXIdentifier(reactProp),
              types.jSXExpressionContainer(wfHandlerExpr)
            )
          )
        }
      }
    }
  }
}

const findJSXElementsById = (
  node: types.Node,
  targetIds: Set<string>
): Map<string, types.JSXOpeningElement> => {
  const results = new Map<string, types.JSXOpeningElement>()

  const traverse = (n: any): void => {
    if (!n || typeof n !== 'object') {
      return
    }

    if (types.isJSXOpeningElement(n)) {
      for (const attr of n.attributes) {
        if (
          types.isJSXAttribute(attr) &&
          types.isJSXIdentifier(attr.name) &&
          attr.name.name === 'id' &&
          types.isStringLiteral(attr.value) &&
          targetIds.has(attr.value.value)
        ) {
          results.set(attr.value.value, n)
        }
      }
    }

    const keys = Object.keys(n)
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') {
        continue
      }
      const child = n[key]
      if (Array.isArray(child)) {
        for (let j = 0; j < child.length; j++) {
          if (child[j] && typeof child[j] === 'object' && child[j].type) {
            traverse(child[j])
          }
        }
      } else if (child && typeof child === 'object' && child.type) {
        traverse(child)
      }
    }
  }

  traverse(node)
  return results
}

const generateModuleLevelCode = (
  allWorkflows: UIDLWorkflow[],
  matchedElementTriggers: ElementTriggerInfo[],
  unmatchedElementTriggers: ElementTriggerInfo[],
  lifecycleWorkflows: UIDLWorkflow[],
  stateChangeWorkflows: UIDLWorkflow[],
  globalStateChangeWorkflows: UIDLWorkflow[],
  hasAudioNodes?: boolean,
  includeAdminFormHydrationHelper?: boolean,
  isRowOwnedSelfGuardedPage?: boolean,
  dynamicRouteAttribute?: string
): string => {
  if (allWorkflows.length === 0) {
    return ''
  }

  const adminFormHydrationPrelude = includeAdminFormHydrationHelper
    ? `function __normalizeTagsForFormInput(v) {
  if (v == null) return ''
  if (Array.isArray(v)) return v.map(String).join(', ')
  if (typeof v === 'string') {
    var s = v.trim()
    if (s[0] === '{' && s[s.length - 1] === '}') {
      var inner = s.slice(1, -1)
      if (!inner) return ''
      return inner.split(',').map(function(part) {
        var t = part.trim()
        if (t[0] === '"' && t[t.length - 1] === '"') return t.slice(1, -1).replace(/""/g, '"')
        return t
      }).filter(Boolean).join(', ')
    }
    return v
  }
  return String(v)
}
function __normalizeAdminFormRow(row, defaults) {
  if (row == null || typeof row !== 'object') return defaults
  var out = {}
  var keys = Object.keys(defaults)
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i]
    var camel = k.replace(/_([a-z])/g, function(_, ch) { return ch.toUpperCase() })
    var v = row[k]
    if (v === undefined) v = row[camel]
    if (k === 'tags') {
      v = __normalizeTagsForFormInput(v)
    }
    if (k === 'gallery_images' || k === 'additional_image_urls') {
      if (Array.isArray(v)) v = v.map(String).join(String.fromCharCode(10))
      else if (v != null && typeof v === 'object') v = JSON.stringify(v)
      else if (typeof v !== 'string') v = v == null ? '' : String(v)
    }
    out[k] = v !== undefined && v !== null ? v : defaults[k]
  }
  return out
}

`
    : ''

  const configLines: string[] = []
  const elementHandlerLines: string[] = []
  const lifecycleLines: string[] = []

  // Lifecycle workflows on row-owned self-guarded pages — see the
  // signal carrying that label in `createNextWorkflowPlugin`. The
  // AI-generated page-load workflow for a details page typically
  // looks like:
  //   resolve-user → evaluate-auth → IF (isLoggedIn === true)
  //     TRUE  → SQL fetch (filtered by user_id OR anonymousUserId)
  //     FALSE → navigation-go-to-page (home / sign-in)
  // For guest checkout we WANT the SQL to run so the
  // anonymousUserId fallback in its WHERE clause can match the
  // order. Rewiring the IF's FALSE branch to the TRUE branch's
  // target turns the gate into a no-op without removing the IF
  // node itself (the runtime still evaluates it; the redirect
  // target just stops being reachable for that path).
  const lifecycleIdSet = new Set(lifecycleWorkflows.map((w) => w.id))

  for (const wf of allWorkflows) {
    const safeId = wf.id.replace(/[^a-zA-Z0-9]/g, '_')
    const segments = splitIntoSegments(wf)
    const serverSegments = segments.filter((s) => s.env === 'server')
    const serverUrls: Record<string, string> = {}
    serverSegments.forEach((seg) => {
      serverUrls[seg.id] = `/api/workflows/${getAPIRouteFileName(wf.id, seg.id, wf.name)}`
    })

    if (isRowOwnedSelfGuardedPage && lifecycleIdSet.has(wf.id)) {
      neutraliseIsLoggedInGates(wf, segments)
    }

    const segmentsJson = JSON.stringify(
      segments.map((s) => ({
        id: s.id,
        env: s.env,
        hasStreamingAI: hasStreamingAINode(s),
        nodes: s.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          config: n.config,
          stepNumber: n.stepNumber,
          label: n.label,
        })),
        edges: s.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
          data: e.data,
        })),
      }))
    )
    const nodesJson = JSON.stringify(
      wf.nodes.map((n: UIDLWorkflowNode) => ({
        id: n.id,
        type: n.type,
        config: n.config,
        stepNumber: n.stepNumber,
        label: n.label,
      }))
    )
    const edgesJson = JSON.stringify(
      wf.edges.map((e: UIDLWorkflowEdge) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        data: e.data,
      }))
    )

    configLines.push(
      `const __wfConfig_${safeId} = {\n` +
        `  triggerNodeId: '${wf.trigger.nodeId}',\n` +
        `  segments: ${segmentsJson},\n` +
        (wf.errorHandler ? `  errorHandlerNodeId: '${wf.errorHandler.nodeId}',\n` : '') +
        `  nodes: ${nodesJson},\n` +
        `  edges: ${edgesJson}\n` +
        `};\n` +
        `const __wfServerUrls_${safeId} = ${JSON.stringify(serverUrls)};`
    )
  }

  // Group matched element triggers by elementId → reactProp → handlers
  const byElement = new Map<string, Map<string, ElementTriggerInfo[]>>()
  for (const et of matchedElementTriggers) {
    if (!byElement.has(et.elementId)) {
      byElement.set(et.elementId, new Map())
    }
    const propMap = byElement.get(et.elementId)!
    if (!propMap.has(et.reactProp)) {
      propMap.set(et.reactProp, [])
    }
    propMap.get(et.reactProp)!.push(et)
  }

  for (const [elementId, propMap] of byElement) {
    const propEntries: string[] = []
    for (const [reactProp, triggers] of propMap) {
      if (triggers.length === 1) {
        const handler = generateElementHandler(triggers[0])
        propEntries.push(`    ${reactProp}: ${handler}`)
      } else {
        const handlerDefs = triggers.map((t) => {
          const sid = t.workflow.id.replace(/[^a-zA-Z0-9]/g, '_')
          return `      const __h_${sid} = ${generateElementHandler(t)};`
        })
        const handlerCalls = triggers.map((t) => {
          const sid = t.workflow.id.replace(/[^a-zA-Z0-9]/g, '_')
          return `        await __h_${sid}(event);`
        })
        propEntries.push(
          `    ${reactProp}: (function() {\n` +
            handlerDefs.join('\n') +
            '\n' +
            `      return async function(event) {\n` +
            handlerCalls.join('\n') +
            '\n' +
            `      };\n` +
            `    })()`
        )
      }
    }
    elementHandlerLines.push(
      `  elementTriggers['${elementId}'] = {\n${propEntries.join(',\n')}\n  };`
    )
  }

  // Unmatched element triggers → addEventListener fallback in setupLifecycleTriggers
  for (const et of unmatchedElementTriggers) {
    const safeId = et.workflow.id.replace(/[^a-zA-Z0-9]/g, '_')
    const code = generateUnmatchedElementFallback(et, safeId)
    if (code) {
      lifecycleLines.push(code)
    }
  }

  // Lifecycle triggers
  for (const wf of lifecycleWorkflows) {
    const safeId = wf.id.replace(/[^a-zA-Z0-9]/g, '_')
    const code = generateLifecycleTrigger(wf, safeId)
    if (code) {
      lifecycleLines.push(code)
    }
  }

  // State change trigger handlers
  const stateChangeHandlerLines: string[] = []
  for (const wf of stateChangeWorkflows) {
    const safeId = wf.id.replace(/[^a-zA-Z0-9]/g, '_')
    stateChangeHandlerLines.push(
      `  stateChangeTriggers['${safeId}'] = function() {\n` +
        `    const triggerContext = { timestamp: Date.now() };\n` +
        `    __execWf(__wfConfig_${safeId}, triggerContext, __wfServerUrls_${safeId});\n` +
        `  };`
    )
  }

  // Global state change trigger handlers
  const globalStateChangeHandlerLines: string[] = []
  for (const wf of globalStateChangeWorkflows) {
    const safeId = wf.id.replace(/[^a-zA-Z0-9]/g, '_')
    const gsKey = `gs_${safeId}`
    const triggerConfig = (wf.trigger.config || {}) as Record<string, unknown>
    const gsDefs = triggerConfig.globalStateDefinitions as
      | Array<{
          globalStateId: string
          name: string
        }>
      | undefined

    if (!gsDefs || gsDefs.length === 0) {
      continue
    }

    const defsJson = JSON.stringify(
      gsDefs.map((d) => ({ globalStateId: d.globalStateId, name: d.name }))
    )

    globalStateChangeHandlerLines.push(
      `  globalStateChangeTriggers['${gsKey}'] = function(prev, current) {\n` +
        `    const defs = ${defsJson};\n` +
        `    for (let i = 0; i < defs.length; i++) {\n` +
        `      const d = defs[i];\n` +
        `      if (current[d.name] !== prev[d.name]) {\n` +
        `        __execWf(__wfConfig_${safeId}, {\n` +
        `          globalStateId: d.globalStateId,\n` +
        `          globalStateName: d.name,\n` +
        `          previousValue: prev[d.name],\n` +
        `          newValue: current[d.name],\n` +
        `          timestamp: Date.now()\n` +
        `        }, __wfServerUrls_${safeId});\n` +
        `      }\n` +
        `    }\n` +
        `  };`
    )
  }

  return `${adminFormHydrationPrelude}
// --- Workflow Configuration (auto-generated) ---
${configLines.join('\n\n')}

function __createWorkflowHandlers(stateSetters, stateTypes, stateValuesRef) {
  const __handlers = Object.assign({}, workflowClientHandlers);

  var __stateNameMap = {};
  var __setterKeys = Object.keys(stateSetters);
  for (var __i = 0; __i < __setterKeys.length; __i++) {
    __stateNameMap[__setterKeys[__i]] = __setterKeys[__i];
    var __snake = __setterKeys[__i].replace(/[A-Z]/g, function(l) { return '_' + l.toLowerCase(); });
    if (__snake !== __setterKeys[__i]) __stateNameMap[__snake] = __setterKeys[__i];
  }
  function __resolveName(name) { return __stateNameMap[name] || name; }

  function __coerceValue(value, property) {
    const type = stateTypes[property];
    // Defensive unwrap for a recurring AI-wiring bug: workflows
    // sometimes bind a setter input straight to the output of a
    // "state-get-local-state" node instead of dereferencing its
    // ".value" field. The documented output shape is
    // { value, key } — forwarding that object to setState makes
    // React crash with "Objects are not valid as a React child
    // (found: object with keys {value, key})". When the shape is
    // unambiguous (exactly two keys, "value" and "key") AND the
    // target state is not declared as an object type (objects can
    // legitimately carry such a structure), unwrap to .value so the
    // setter receives the primitive the workflow author intended.
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      type !== 'object' &&
      'value' in value &&
      'key' in value &&
      Object.keys(value).length === 2
    ) {
      value = value.value;
    }
    // Array-typed states must never receive a non-array payload — one
    // poisoned write (e.g. a ref resolving to a custom-js node's whole
    // { result: [...] } return object instead of its array property)
    // bricks every downstream consumer: the mapper renders nothing and
    // the next add-row spread throws "is not iterable". Mirrors the
    // GUI-side guard: unwrap an object with a single array-valued
    // property, otherwise fall back to an empty array.
    if (type === 'array' && !Array.isArray(value)) {
      console.warn(
        '[workflow] non-array value written to array state "' + property + '"; coercing',
        value
      );
      if (value && typeof value === 'object') {
        var arrayKeys = Object.keys(value);
        if (arrayKeys.length === 1 && Array.isArray(value[arrayKeys[0]])) {
          return value[arrayKeys[0]];
        }
      }
      return [];
    }
    if (type === 'boolean') return value === 'true' || value === true;
    if (type === 'number' && typeof value === 'string') {
      const parsed = Number(value);
      if (!isNaN(parsed)) return parsed;
    }
    return value;
  }

  function __defaultValueForType(type) {
    // Empty default for an unset state-update value, keyed off the state's
    // declared type: string -> '', array -> [], object -> {}, every other
    // (number, boolean, ...) -> null.
    if (type === 'array') return [];
    if (type === 'object') return {};
    if (type === 'string') return '';
    return null;
  }

  function __stateUpdateHandler(config, context) {
    var prop = __resolveName(config.property);

    if (config.refreshFromDataSource && typeof refreshGlobalState === 'function') {
      refreshGlobalState(prop);
      return Promise.resolve({ success: true, property: prop, refreshFromDataSource: true });
    }

    if (config.objectUpdateMode === 'property' && config.objectPropertyPath) {
      const propValue = __coerceValue(config.value, prop);
      const currentObj = (context && context.__stateValues && context.__stateValues[prop] != null)
        ? context.__stateValues[prop]
        : (stateValuesRef.current[prop] || {});
      if (currentObj[config.objectPropertyPath] === propValue) {
        return Promise.resolve({ success: true, property: prop, value: currentObj });
      }
      const newObj = Object.assign({}, currentObj);
      newObj[config.objectPropertyPath] = propValue;
      if (context && context.__stateValues) context.__stateValues[prop] = newObj;
      if (stateSetters[prop]) stateSetters[prop](newObj);
      return Promise.resolve({ success: true, property: prop, value: newObj });
    }
    // A node wired without any value (the config has no \`value\` at all) falls
    // back to the state type's empty default so the setter never receives
    // undefined (which would flip a controlled input to uncontrolled). An
    // explicit/resolved null is a real value and is passed through unchanged.
    const value = config.value === undefined
      ? __defaultValueForType(stateTypes[prop])
      : __coerceValue(config.value, prop);
    var prevValue = (context && context.__stateValues) ? context.__stateValues[prop] : stateValuesRef.current[prop];
    if (prevValue === value) {
      return Promise.resolve({ success: true, property: prop, value: value });
    }
    if (context && context.__stateValues) context.__stateValues[prop] = value;
    if (stateSetters[prop]) stateSetters[prop](value);
    return Promise.resolve({ success: true, property: prop, value: value });
  }

  __handlers['state-update-local-state'] = __stateUpdateHandler;
  __handlers['state-update-global-state'] = __stateUpdateHandler;

  __handlers['state-get-local-state'] = function(config, context) {
    var prop = __resolveName(config.property);
    // Always read the LATEST committed state from stateValuesRef.current
    // instead of the trigger-time snapshot in context.__stateValues. React
    // 17 (which the generated app pins to) does not batch setState calls
    // fired from useEffect or .then chains, so a single state-change can
    // produce two renders that each fire the trigger with a different
    // snapshot. The async invocations race to the final stateSetters
    // write, and the stale-snapshot one can win — leaving the Update
    // Account button stuck on 'changed' even when current and initial
    // form data are equal. Reading latest makes every invocation converge
    // to the same result so the race is harmless. Server segments still
    // use the snapshot from their request body (this handler is the
    // client implementation only).
    var live = (stateValuesRef && stateValuesRef.current) || (context && context.__stateValues) || {};
    // The schema declares state-get-local-state output as { value, key } —
    // emit both so workflows that bind to .key (the configured property
    // name) don't silently resolve to undefined. We return the original
    // config.property the user typed in the editor, not the resolved
    // camelCase variant from __resolveName, so the binding matches what
    // the GUI showed at edit time.
    return Promise.resolve({ value: live[prop], key: config.property });
  };

  __handlers['state-batch-update'] = function(config, context) {
    var updates = config.updates || [];
    var updatedKeys = [];
    for (var i = 0; i < updates.length; i++) {
      var u = updates[i];
      var key = __resolveName(u.key);
      var val = u.value === undefined
        ? __defaultValueForType(stateTypes[key])
        : __coerceValue(u.value, key);
      if (context && context.__stateValues) context.__stateValues[key] = val;
      if (stateSetters[key]) stateSetters[key](val);
      updatedKeys.push(key);
    }
    return Promise.resolve({ updatedKeys: updatedKeys, updateCount: updatedKeys.length });
  };

  function __execWf(config, triggerContext, serverUrls) {
    triggerContext.__stateValues = Object.assign({}, stateValuesRef.current);
    // Route context for {{urlDifferentiator}} / {{Current Page Entity.id}}
    // template tokens in node configs — resolved by the shared runtime's
    // resolveTemplateTokenString. Read at call time (not render time) so the
    // handlers survive client-side navigation between dynamic routes.
    if (typeof window !== 'undefined' && Router && Router.router && Router.router.query) {
      triggerContext.__routeParams = Object.assign({}, Router.router.query);
    }
${
  dynamicRouteAttribute
    ? `    triggerContext.__dynamicRouteParam = '${dynamicRouteAttribute}';\n`
    : ''
}
    var fullConfig = typeof workflowCustomNodes !== 'undefined'
      ? Object.assign({}, config, { customNodes: workflowCustomNodes })
      : config;
    return workflowRuntime.executeWorkflowWithSegments(fullConfig, triggerContext, __handlers, serverUrls)
      .then(function(ctx) {
        if (ctx && ctx.__previousNodeResult && ctx.__previousNodeResult.checkoutUrl) {
          window.location.href = ctx.__previousNodeResult.checkoutUrl;
        }
        return ctx;
      })
      .catch(function(err) { console.error('[workflow]', err); });
  }

  if (stateSetters.currentUser) {
    const __wrapAuth = function(nodeType, extractUser) {
      const orig = __handlers[nodeType];
      if (!orig) return;
      __handlers[nodeType] = async function(config, context) {
        const result = await orig(config, context);
        const user = extractUser(result);
        if (user !== undefined) stateSetters.currentUser(user);
        return result;
      };
    };
    __wrapAuth('account-login', function(r) { return r && r.success ? r.user || null : undefined; });
    __wrapAuth('account-signup', function(r) { return r && r.success ? r.user || null : undefined; });
    __wrapAuth('account-logout', function(r) { return r && r.success ? null : undefined; });
  }

  const elementTriggers = {};
${elementHandlerLines.join('\n')}

  const setupLifecycleTriggers = function() {
    const cleanups = [];
${lifecycleLines.join('\n')}
${
  hasAudioNodes
    ? `    cleanups.push(function() {
      var instances = typeof window !== 'undefined' && window.__teleportAudioInstances;
      if (instances) {
        instances.forEach(function(audio) { try { audio.pause(); audio.currentTime = 0; } catch(e) {} });
        instances.clear();
      }
    });`
    : ''
}
    return function() {
      cleanups.forEach(function(fn) { if (typeof fn === 'function') fn(); });
    };
  };

  const stateChangeTriggers = {};
${stateChangeHandlerLines.join('\n')}

  const globalStateChangeTriggers = {};
${globalStateChangeHandlerLines.join('\n')}

  function __onGlobalStateUpdate(key, mountRef, currentValues) {
    const prev = mountRef[key];
    const trigger = globalStateChangeTriggers[key];
    if (prev && trigger) trigger(prev, currentValues);
    mountRef[key] = Object.assign({}, currentValues);
  }

  return {
    elementTriggers: elementTriggers,
    setupLifecycleTriggers: setupLifecycleTriggers,
    stateChangeTriggers: stateChangeTriggers,
    onGlobalStateUpdate: __onGlobalStateUpdate
  };
}
// --- End Workflow Configuration ---
`
}

const generateElementHandler = (et: ElementTriggerInfo): string => {
  const safeId = et.workflow.id.replace(/[^a-zA-Z0-9]/g, '_')
  const config = et.triggerConfig
  const elementId = et.elementId

  switch (et.workflow.trigger.type) {
    case 'event-element-clicked': {
      const preventDefault = config.preventDefault as boolean
      const stopPropagation = config.stopPropagation as boolean
      const debounce = config.debounce as number | undefined

      let body = ''
      if (preventDefault) {
        body += '    event.preventDefault();\n'
      }
      if (stopPropagation) {
        body += '    event.stopPropagation();\n'
      }
      // Use `currentTarget` (the element the listener is attached to) instead
      // of `target` (the deepest child clicked) so workflows reading
      // `previousContext.element.dataset.*` still see the data attributes on
      // the bound element when the user clicks a child — e.g. the payment
      // provider row sets `data-provider-name` on the row div, but a click
      // on the inner label span would otherwise resolve to an empty dataset.
      body +=
        `    const __te = event.currentTarget || event.target;\n` +
        `    const triggerContext = { elementId: '${elementId}', triggerElement: __te, element: __te, timestamp: Date.now(), clientX: event.clientX, clientY: event.clientY };\n` +
        `    return __execWf(__wfConfig_${safeId}, triggerContext, __wfServerUrls_${safeId});`

      if (debounce) {
        return (
          `(function() {\n` +
          `      let timer = null;\n` +
          `      return function(event) {\n` +
          `        clearTimeout(timer);\n` +
          `        timer = setTimeout(async function() {\n` +
          `    ${body}\n` +
          `        }, ${debounce});\n` +
          `      };\n` +
          `    })()`
        )
      }

      return `async function(event) {\n${body}\n  }`
    }

    case 'event-form-submitted': {
      const preventDefault = config.preventDefault !== false
      return (
        `async function(event) {\n` +
        (preventDefault ? '    event.preventDefault();\n' : '') +
        `    const formData = {};\n` +
        `    const fd = new FormData(event.target);\n` +
        `    fd.forEach(function(v, k) { formData[k] = v; });\n` +
        `    const triggerContext = { formData: formData, formId: '${elementId}', triggerElement: event.target, element: event.target, timestamp: Date.now() };\n` +
        `    return __execWf(__wfConfig_${safeId}, triggerContext, __wfServerUrls_${safeId});\n` +
        `  }`
      )
    }

    case 'event-input-updated': {
      const debounce = config.debounce as number | undefined

      if (debounce) {
        // Plan v35 D4 — the debounce wraps the WORKFLOW execution, but the
        // generated handler MUST also dispatch a custom `__wfDebouncedInput`
        // event so the controlled-input wrapper can update React state
        // IMMEDIATELY (before the debounce fires). Without this, the input's
        // `value={…}` prop only changes after the 300ms delay, the user sees
        // a frozen text field, and the workflow never gets a chance to run
        // because every keystroke clears the timer.
        return (
          `(function() {\n` +
          `      let timer = null;\n` +
          `      return function(event) {\n` +
          `        const value = event.target.value;\n` +
          `        // Plan v35 D4 — dispatch IMMEDIATELY so the controlled-input mirror\n` +
          `        // state updates without waiting for the workflow debounce.\n` +
          `        try {\n` +
          `          event.target.dispatchEvent(new CustomEvent('__wfDebouncedInput', { detail: { value: value, elementId: '${elementId}' }, bubbles: true }));\n` +
          `        } catch (e) { /* non-fatal */ }\n` +
          `        clearTimeout(timer);\n` +
          `        timer = setTimeout(async function() {\n` +
          `          const triggerContext = { value: value, elementId: '${elementId}', triggerElement: event.target, element: event.target, timestamp: Date.now() };\n` +
          `          __execWf(__wfConfig_${safeId}, triggerContext, __wfServerUrls_${safeId});\n` +
          `        }, ${debounce});\n` +
          `      };\n` +
          `    })()`
        )
      }

      return (
        `async function(event) {\n` +
        `    const triggerContext = { value: event.target.value, elementId: '${elementId}', triggerElement: event.target, element: event.target, timestamp: Date.now() };\n` +
        `    return __execWf(__wfConfig_${safeId}, triggerContext, __wfServerUrls_${safeId});\n` +
        `  }`
      )
    }

    case 'event-element-event': {
      const preventDefault = config.preventDefault as boolean
      const stopPropagation = config.stopPropagation as boolean
      const eventType = (config.eventType as string) || 'click'
      const isDropEvent = eventType === 'drop'
      return (
        `async function(event) {\n` +
        (preventDefault ? '    event.preventDefault();\n' : '') +
        (stopPropagation ? '    event.stopPropagation();\n' : '') +
        `    const __te = event.currentTarget || event.target;\n` +
        // `formControlPropertyReads(...)` injects `value`, `checked`, `files`
        // so dropdown/input/checkbox/file-picker `change` events surface the
        // user's choice as `triggerContext.value` (etc.) — without this every
        // `state-update-local-state` node bound to `Trigger.value` writes
        // `undefined` and the picker becomes a no-op.
        `    const triggerContext = { elementId: '${elementId}', eventType: '${eventType}', triggerElement: __te, element: __te, timestamp: Date.now(), clientX: event.clientX, clientY: event.clientY, offsetX: event.offsetX, offsetY: event.offsetY, button: event.button, deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, key: event.key, ${formControlPropertyReads(
          '__te'
        )} };\n` +
        (isDropEvent
          ? '    if (event.dataTransfer && event.dataTransfer.files) { triggerContext.files = Array.from(event.dataTransfer.files); }\n'
          : '') +
        `    return __execWf(__wfConfig_${safeId}, triggerContext, __wfServerUrls_${safeId});\n` +
        `  }`
      )
    }

    default:
      return (
        `async function(event) {\n` +
        `    const __te = event.currentTarget || event.target;\n` +
        `    const triggerContext = { elementId: '${elementId}', triggerElement: __te, element: __te, timestamp: Date.now() };\n` +
        `    return __execWf(__wfConfig_${safeId}, triggerContext, __wfServerUrls_${safeId});\n` +
        `  }`
      )
  }
}

const generateUnmatchedElementFallback = (et: ElementTriggerInfo, safeId: string): string => {
  const config = et.triggerConfig
  const elementId = et.elementId
  const domEvent = getDOMEventName(et.workflow.trigger.type, config)
  const preventDefault = config.preventDefault as boolean
  const stopPropagation = config.stopPropagation as boolean
  const debounce = config.debounce as number | undefined
  const isForm = et.workflow.trigger.type === 'event-form-submitted'
  const isInput = et.workflow.trigger.type === 'event-input-updated'

  let handlerBody = ''
  if (preventDefault || isForm) {
    handlerBody += '        event.preventDefault();\n'
  }
  if (stopPropagation) {
    handlerBody += '        event.stopPropagation();\n'
  }

  if (isForm) {
    handlerBody +=
      `        const formData = {};\n` +
      `        const fd = new FormData(event.target);\n` +
      `        fd.forEach(function(v, k) { formData[k] = v; });\n` +
      `        const triggerContext = { formData: formData, formId: '${elementId}', triggerElement: event.target, element: event.target, timestamp: Date.now() };\n`
  } else if (isInput) {
    handlerBody += `        const triggerContext = { value: event.target.value, elementId: '${elementId}', triggerElement: event.target, element: event.target, timestamp: Date.now() };\n`
  } else if (et.workflow.trigger.type === 'event-element-event') {
    // See `event-element-event` in `generateElementHandler` for why we
    // include `value`/`checked`/`files` unconditionally.
    handlerBody += `        const triggerContext = { elementId: '${elementId}', eventType: '${domEvent}', triggerElement: event.target, element: event.target, timestamp: Date.now(), clientX: event.clientX, clientY: event.clientY, offsetX: event.offsetX, offsetY: event.offsetY, button: event.button, deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, key: event.key, ${formControlPropertyReads(
      'event.target'
    )} };\n`
    if (domEvent === 'drop') {
      handlerBody += `        if (event.dataTransfer && event.dataTransfer.files) { triggerContext.files = Array.from(event.dataTransfer.files); }\n`
    }
  } else {
    handlerBody += `        const triggerContext = { elementId: '${elementId}', triggerElement: event.target, element: event.target, timestamp: Date.now(), clientX: event.clientX, clientY: event.clientY };\n`
  }

  handlerBody += `        __execWf(__wfConfig_${safeId}, triggerContext, __wfServerUrls_${safeId});`

  let handlerCode: string
  if (debounce) {
    handlerCode =
      `(function() {\n` +
      `        let timer = null;\n` +
      `        return function(event) {\n` +
      `          clearTimeout(timer);\n` +
      `          timer = setTimeout(function() {\n` +
      `    ${handlerBody}\n` +
      `          }, ${debounce});\n` +
      `        };\n` +
      `      })()`
  } else {
    handlerCode = `function(event) {\n` + `${handlerBody}\n` + `      }`
  }

  return (
    `    // Fallback: ${et.workflow.name || et.workflow.id} → ${domEvent} on '${elementId}'\n` +
    `    const __el_${safeId} = document.getElementById('${elementId}');\n` +
    `    if (__el_${safeId}) {\n` +
    `      const __h_${safeId} = ${handlerCode};\n` +
    `      __el_${safeId}.addEventListener('${domEvent}', __h_${safeId});\n` +
    `      cleanups.push(function() { __el_${safeId}.removeEventListener('${domEvent}', __h_${safeId}); });\n` +
    `    }`
  )
}

const normalizeKeyName = (key: string): string => {
  const keyMap: Record<string, string> = { space: ' ' }
  return keyMap[key] || key
}

const generateLifecycleTrigger = (wf: UIDLWorkflow, safeId: string): string => {
  const trigger = wf.trigger
  const config = (trigger.config || {}) as Record<string, unknown>
  const execCall = `__execWf(__wfConfig_${safeId}, triggerContext, __wfServerUrls_${safeId})`

  switch (trigger.type) {
    case 'event-page-loaded': {
      const delay = config.delay as number | undefined
      return (
        `    // Page loaded (${wf.name || wf.id})\n` +
        `    {\n` +
        `      const triggerContext = { url: window.location.href, timestamp: Date.now(), referrer: document.referrer };\n` +
        (delay
          ? `      setTimeout(function() { ${execCall}; }, ${delay});\n`
          : `      ${execCall};\n`) +
        `    }`
      )
    }

    case 'event-element-visible': {
      const nodeId = config.nodeId as string
      const threshold = (config.threshold as number) || 0
      const once = config.once as boolean
      return (
        `    // Element visible (${wf.name || wf.id})\n` +
        `    const __visEl_${safeId} = document.getElementById('${nodeId}');\n` +
        `    if (__visEl_${safeId}) {\n` +
        `      const __obs_${safeId} = new IntersectionObserver(function(entries) {\n` +
        `        entries.forEach(function(entry) {\n` +
        `          if (entry.isIntersecting) {\n` +
        `            const triggerContext = { elementId: '${nodeId}', timestamp: Date.now(), intersectionRatio: entry.intersectionRatio };\n` +
        `            ${execCall};\n` +
        (once ? `            __obs_${safeId}.disconnect();\n` : '') +
        `          }\n` +
        `        });\n` +
        `      }, { threshold: ${threshold} });\n` +
        `      __obs_${safeId}.observe(__visEl_${safeId});\n` +
        `      cleanups.push(function() { __obs_${safeId}.disconnect(); });\n` +
        `    }`
      )
    }

    case 'event-user-logged-in':
    case 'event-user-logged-out': {
      const eventName =
        trigger.type === 'event-user-logged-in'
          ? 'workflow:user-logged-in'
          : 'workflow:user-logged-out'
      return (
        `    // ${trigger.type} (${wf.name || wf.id})\n` +
        `    const __h_${safeId} = function(event) {\n` +
        `      const triggerContext = event.detail || {};\n` +
        `      triggerContext.timestamp = Date.now();\n` +
        `      ${execCall};\n` +
        `    };\n` +
        `    window.addEventListener('${eventName}', __h_${safeId});\n` +
        `    cleanups.push(function() { window.removeEventListener('${eventName}', __h_${safeId}); });`
      )
    }

    case 'event-unhandled-error':
      return (
        `    // Unhandled error (${wf.name || wf.id})\n` +
        `    const __h_${safeId} = function(event) {\n` +
        `      const triggerContext = { message: event.message, stack: event.error ? event.error.stack : '', filename: event.filename, lineno: event.lineno, colno: event.colno };\n` +
        `      ${execCall};\n` +
        `    };\n` +
        `    window.addEventListener('error', __h_${safeId});\n` +
        `    cleanups.push(function() { window.removeEventListener('error', __h_${safeId}); });`
      )

    case 'event-custom-triggered': {
      const eventName = config.eventName as string
      return (
        `    // Custom event '${eventName}' (${wf.name || wf.id})\n` +
        `    const __h_${safeId} = function(event) {\n` +
        `      const triggerContext = { eventName: '${eventName}', eventData: event.detail, timestamp: Date.now() };\n` +
        `      ${execCall};\n` +
        `    };\n` +
        `    window.addEventListener('workflow:custom:${eventName}', __h_${safeId});\n` +
        `    cleanups.push(function() { window.removeEventListener('workflow:custom:${eventName}', __h_${safeId}); });`
      )
    }

    case 'event-data-item-added':
    case 'event-data-item-updated':
    case 'event-data-item-deleted': {
      const eventName = `workflow:data:${trigger.type.replace('event-data-item-', '')}`
      return (
        `    // ${trigger.type} (${wf.name || wf.id})\n` +
        `    const __h_${safeId} = function(event) {\n` +
        `      if (event.detail && event.detail.dataSourceId === '${config.dataSourceId}' && event.detail.tableName === '${config.tableName}') {\n` +
        `        const triggerContext = event.detail;\n` +
        `        triggerContext.timestamp = Date.now();\n` +
        `        ${execCall};\n` +
        `      }\n` +
        `    };\n` +
        `    window.addEventListener('${eventName}', __h_${safeId});\n` +
        `    cleanups.push(function() { window.removeEventListener('${eventName}', __h_${safeId}); });`
      )
    }

    case 'event-key-pressed': {
      const rawKey = config.key as string
      const key = normalizeKeyName(rawKey)
      const ignoreRepeat = config.ignoreRepeat as boolean
      const kpPreventDefault = config.preventDefault as boolean
      const kpElementId = config.elementHtmlId as string | undefined
      return (
        `    // Key pressed '${rawKey}' (${wf.name || wf.id})\n` +
        `    const __kpHandler_${safeId} = function(event) {\n` +
        `      if (event.key !== '${key}') return;\n` +
        (ignoreRepeat ? `      if (event.repeat) return;\n` : '') +
        (kpPreventDefault ? `      event.preventDefault();\n` : '') +
        `      const triggerContext = {\n` +
        `        key: event.key, code: event.code, repeat: event.repeat,\n` +
        `        shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey,\n` +
        `        timestamp: Date.now()\n` +
        `      };\n` +
        `      ${execCall};\n` +
        `    };\n` +
        (kpElementId
          ? `    const __kpTarget_${safeId} = document.getElementById('${kpElementId}');\n` +
            `    if (__kpTarget_${safeId}) {\n` +
            `      __kpTarget_${safeId}.addEventListener('keydown', __kpHandler_${safeId});\n` +
            `      cleanups.push(function() { __kpTarget_${safeId}.removeEventListener('keydown', __kpHandler_${safeId}); });\n` +
            `    }`
          : `    document.addEventListener('keydown', __kpHandler_${safeId});\n` +
            `    cleanups.push(function() { document.removeEventListener('keydown', __kpHandler_${safeId}); });`)
      )
    }

    case 'event-key-released': {
      const rawKrKey = config.key as string
      const krKey = normalizeKeyName(rawKrKey)
      const krElementId = config.elementHtmlId as string | undefined
      return (
        `    // Key released '${rawKrKey}' (${wf.name || wf.id})\n` +
        `    const __krHandler_${safeId} = function(event) {\n` +
        `      if (event.key !== '${krKey}') return;\n` +
        `      const triggerContext = {\n` +
        `        key: event.key, code: event.code,\n` +
        `        shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey,\n` +
        `        timestamp: Date.now()\n` +
        `      };\n` +
        `      ${execCall};\n` +
        `    };\n` +
        (krElementId
          ? `    const __krTarget_${safeId} = document.getElementById('${krElementId}');\n` +
            `    if (__krTarget_${safeId}) {\n` +
            `      __krTarget_${safeId}.addEventListener('keyup', __krHandler_${safeId});\n` +
            `      cleanups.push(function() { __krTarget_${safeId}.removeEventListener('keyup', __krHandler_${safeId}); });\n` +
            `    }`
          : `    document.addEventListener('keyup', __krHandler_${safeId});\n` +
            `    cleanups.push(function() { document.removeEventListener('keyup', __krHandler_${safeId}); });`)
      )
    }

    case 'event-interval': {
      const intervalMs = config.intervalMs as number
      const autoStart = config.autoStart !== false
      const controlEventName = config.controlEventName as string | undefined
      const maxTicks = config.maxTicks as number | undefined
      const runWhileHidden = config.runWhileHidden as boolean

      let intervalCode =
        `    // Interval ${intervalMs}ms (${wf.name || wf.id})\n` +
        `    var __iv_tickNum_${safeId} = 0;\n` +
        `    var __iv_startTime_${safeId} = 0;\n` +
        `    var __iv_lastTick_${safeId} = 0;\n` +
        `    var __iv_id_${safeId} = null;\n` +
        `    var __iv_running_${safeId} = false;\n` +
        `    var __iv_destroyed_${safeId} = false;\n` +
        `    function __iv_tick_${safeId}() {\n` +
        `      __iv_tickNum_${safeId}++;\n` +
        `      var now = Date.now();\n` +
        `      var triggerContext = {\n` +
        `        tickNumber: __iv_tickNum_${safeId},\n` +
        `        deltaTime: __iv_lastTick_${safeId} ? now - __iv_lastTick_${safeId} : ${intervalMs},\n` +
        `        elapsedTime: now - __iv_startTime_${safeId},\n` +
        `        timestamp: now,\n` +
        `        isFirstTick: __iv_tickNum_${safeId} === 1\n` +
        `      };\n` +
        `      __iv_lastTick_${safeId} = now;\n` +
        (maxTicks && maxTicks > 0
          ? `      if (__iv_tickNum_${safeId} >= ${maxTicks}) { __iv_stop_${safeId}(); }\n`
          : '') +
        `      ${execCall};\n` +
        `    }\n` +
        `    function __iv_start_${safeId}() {\n` +
        `      if (__iv_id_${safeId} || __iv_destroyed_${safeId}) return;\n` +
        `      if (__iv_startTime_${safeId} === 0) {\n` +
        `        __iv_startTime_${safeId} = Date.now();\n` +
        `        __iv_lastTick_${safeId} = __iv_startTime_${safeId};\n` +
        `        __iv_tickNum_${safeId} = 0;\n` +
        `      }\n` +
        `      __iv_id_${safeId} = setInterval(__iv_tick_${safeId}, ${intervalMs});\n` +
        `      __iv_running_${safeId} = true;\n` +
        `    }\n` +
        `    function __iv_stop_${safeId}() {\n` +
        `      if (__iv_id_${safeId}) clearInterval(__iv_id_${safeId});\n` +
        `      __iv_id_${safeId} = null;\n` +
        `      __iv_running_${safeId} = false;\n` +
        `    }\n`

      if (!runWhileHidden) {
        intervalCode +=
          `    var __iv_wasRunning_${safeId} = false;\n` +
          `    var __iv_visHandler_${safeId} = function() {\n` +
          `      if (__iv_destroyed_${safeId}) return;\n` +
          `      if (document.hidden) {\n` +
          `        __iv_wasRunning_${safeId} = __iv_running_${safeId};\n` +
          `        if (__iv_running_${safeId}) __iv_stop_${safeId}();\n` +
          `      } else if (__iv_wasRunning_${safeId}) {\n` +
          `        __iv_start_${safeId}();\n` +
          `        __iv_wasRunning_${safeId} = false;\n` +
          `      }\n` +
          `    };\n` +
          `    document.addEventListener('visibilitychange', __iv_visHandler_${safeId});\n`
      }

      if (controlEventName) {
        intervalCode +=
          `    var __iv_ctrlHandler_${safeId} = function() {\n` +
          `      if (__iv_running_${safeId}) { __iv_stop_${safeId}(); }\n` +
          `      else { __iv_start_${safeId}(); }\n` +
          `    };\n` +
          `    window.addEventListener('${controlEventName}', __iv_ctrlHandler_${safeId});\n`
      }

      if (autoStart) {
        intervalCode += `    __iv_start_${safeId}();\n`
      }

      intervalCode +=
        `    cleanups.push(function() {\n` +
        `      __iv_destroyed_${safeId} = true;\n` +
        `      __iv_stop_${safeId}();\n` +
        (!runWhileHidden
          ? `      document.removeEventListener('visibilitychange', __iv_visHandler_${safeId});\n`
          : '') +
        (controlEventName
          ? `      window.removeEventListener('${controlEventName}', __iv_ctrlHandler_${safeId});\n`
          : '') +
        `    });`

      return intervalCode
    }

    case 'event-window-resize': {
      const wrMinWidth = config.minWidth as number | null | undefined
      const wrMaxWidth = config.maxWidth as number | null | undefined
      const wrMinHeight = config.minHeight as number | null | undefined
      const wrMaxHeight = config.maxHeight as number | null | undefined
      const wrDebounce = (config.debounceMs as number) || 150
      const wrHasThresholds =
        wrMinWidth != null || wrMaxWidth != null || wrMinHeight != null || wrMaxHeight != null

      const wrMeetsConds = [
        wrMinWidth != null ? `w >= ${wrMinWidth}` : null,
        wrMaxWidth != null ? `w <= ${wrMaxWidth}` : null,
        wrMinHeight != null ? `h >= ${wrMinHeight}` : null,
        wrMaxHeight != null ? `h <= ${wrMaxHeight}` : null,
      ].filter(Boolean)

      const wrPrevMeetsConds = [
        wrMinWidth != null ? `pw >= ${wrMinWidth}` : null,
        wrMaxWidth != null ? `pw <= ${wrMaxWidth}` : null,
        wrMinHeight != null ? `ph >= ${wrMinHeight}` : null,
        wrMaxHeight != null ? `ph <= ${wrMaxHeight}` : null,
      ].filter(Boolean)

      let wrCode =
        `    // Window resize (${wf.name || wf.id})\n` +
        `    var __wr_prevW_${safeId} = window.innerWidth;\n` +
        `    var __wr_prevH_${safeId} = window.innerHeight;\n` +
        `    var __wr_timer_${safeId} = null;\n` +
        `    var __wr_handler_${safeId} = function() {\n` +
        `      clearTimeout(__wr_timer_${safeId});\n` +
        `      __wr_timer_${safeId} = setTimeout(function() {\n` +
        `        var w = window.innerWidth;\n` +
        `        var h = window.innerHeight;\n` +
        `        var pw = __wr_prevW_${safeId};\n` +
        `        var ph = __wr_prevH_${safeId};\n`

      if (wrHasThresholds) {
        wrCode +=
          `        var meets = ${wrMeetsConds.join(' && ')};\n` +
          `        var prevMet = ${wrPrevMeetsConds.join(' && ')};\n` +
          `        var crossedBreakpoint = meets !== prevMet;\n` +
          `        if (meets) {\n` +
          `          var triggerContext = { width: w, height: h, previousWidth: pw, previousHeight: ph, crossedBreakpoint: crossedBreakpoint, timestamp: Date.now() };\n` +
          `          ${execCall};\n` +
          `        }\n`
      } else {
        wrCode +=
          `        var triggerContext = { width: w, height: h, previousWidth: pw, previousHeight: ph, crossedBreakpoint: false, timestamp: Date.now() };\n` +
          `        ${execCall};\n`
      }

      wrCode +=
        `        __wr_prevW_${safeId} = w;\n` +
        `        __wr_prevH_${safeId} = h;\n` +
        `      }, ${wrDebounce});\n` +
        `    };\n` +
        `    window.addEventListener('resize', __wr_handler_${safeId});\n` +
        `    cleanups.push(function() {\n` +
        `      window.removeEventListener('resize', __wr_handler_${safeId});\n` +
        `      clearTimeout(__wr_timer_${safeId});\n` +
        `    });`

      return wrCode
    }

    case 'realtime-on-channel-message':
    case 'realtime-on-channel-event':
    case 'realtime-on-user-joined-channel':
    case 'realtime-on-user-left-channel': {
      const channelName = config.channelName as string
      return generateRealtimeLifecycleTrigger(
        trigger.type,
        channelName,
        config,
        execCall,
        safeId,
        wf
      )
    }

    default:
      return ''
  }
}

const generateRealtimeLifecycleTrigger = (
  triggerType: string,
  channelName: string,
  config: Record<string, unknown>,
  execCall: string,
  safeId: string,
  wf: UIDLWorkflow
): string => {
  const subscribeCode = generateRealtimeSubscribeCode(
    triggerType,
    channelName,
    config,
    execCall,
    safeId
  )
  const unsubscribeCode = generateRealtimeUnsubscribeCode(triggerType, safeId, config)

  return (
    `    // ${triggerType} (${wf.name || wf.id})\n` +
    `    let __rtActive_${safeId} = true;\n` +
    `    let __rtCleanupFn_${safeId} = null;\n` +
    `    const __rt_${safeId} = typeof window !== 'undefined' ? window.__teleportRealtime : null;\n` +
    `    if (__rt_${safeId}) {\n` +
    `      const __rtClient_${safeId} = __rt_${safeId}.getAblyClient();\n` +
    `      if (__rtClient_${safeId}) {\n` +
    `        __rt_${safeId}.whenReady().then(function() {\n` +
    `          if (!__rtActive_${safeId}) return;\n` +
    `          const nsChannel = __rt_${safeId}.getNamespacedChannelName('${channelName}');\n` +
    `          const channel = __rtClient_${safeId}.channels.get(nsChannel);\n` +
    `          __rt_${safeId}.incrementChannelRef(nsChannel);\n` +
    subscribeCode +
    `          __rtCleanupFn_${safeId} = function() {\n` +
    unsubscribeCode +
    `            __rt_${safeId}.decrementChannelRef(nsChannel);\n` +
    `          };\n` +
    `        });\n` +
    `      }\n` +
    `    }\n` +
    `    cleanups.push(function() {\n` +
    `      __rtActive_${safeId} = false;\n` +
    `      if (__rtCleanupFn_${safeId}) __rtCleanupFn_${safeId}();\n` +
    `    });`
  )
}

const generateRealtimeSubscribeCode = (
  triggerType: string,
  channelName: string,
  config: Record<string, unknown>,
  execCall: string,
  safeId: string
): string => {
  switch (triggerType) {
    case 'realtime-on-channel-message':
      return (
        `          const __msgH_${safeId} = function(message) {\n` +
        `            if (message.name !== 'message') return;\n` +
        `            const d = message.data || {};\n` +
        `            const triggerContext = {\n` +
        `              channelName: d.channelName || '${channelName}',\n` +
        `              message: d.message || '',\n` +
        `              messageData: d.messageData || null,\n` +
        `              senderId: d.senderId || '',\n` +
        `              senderName: d.senderName || '',\n` +
        `              messageId: d.messageId || '',\n` +
        `              timestamp: d.timestamp || Date.now()\n` +
        `            };\n` +
        `            ${execCall};\n` +
        `          };\n` +
        `          channel.subscribe('message', __msgH_${safeId});\n`
      )
    case 'realtime-on-channel-event': {
      const eventName = (config.eventName as string) || ''
      const ablyEventName = `event:${eventName}`
      return (
        `          const __evtH_${safeId} = function(message) {\n` +
        `            const d = message.data || {};\n` +
        `            const triggerContext = {\n` +
        `              channelName: d.channelName || '${channelName}',\n` +
        `              eventName: d.eventName || '${eventName}',\n` +
        `              eventData: d.eventData || null,\n` +
        `              senderId: d.senderId || '',\n` +
        `              senderName: d.senderName || '',\n` +
        `              timestamp: d.timestamp || Date.now()\n` +
        `            };\n` +
        `            ${execCall};\n` +
        `          };\n` +
        `          channel.subscribe('${ablyEventName}', __evtH_${safeId});\n`
      )
    }
    case 'realtime-on-user-joined-channel':
      return (
        `          const __presH_${safeId} = function(presenceMessage) {\n` +
        `            const pd = presenceMessage.data || {};\n` +
        `            const triggerContext = {\n` +
        `              channelName: '${channelName}',\n` +
        `              userId: pd.userId || presenceMessage.clientId || '',\n` +
        `              userName: pd.userName || '',\n` +
        `              userData: pd.userData || null,\n` +
        `              timestamp: presenceMessage.timestamp || Date.now()\n` +
        `            };\n` +
        `            ${execCall};\n` +
        `          };\n` +
        `          channel.presence.subscribe('enter', __presH_${safeId});\n`
      )
    case 'realtime-on-user-left-channel':
      return (
        `          const __presH_${safeId} = function(presenceMessage) {\n` +
        `            const pd = presenceMessage.data || {};\n` +
        `            const triggerContext = {\n` +
        `              channelName: '${channelName}',\n` +
        `              userId: pd.userId || presenceMessage.clientId || '',\n` +
        `              userName: pd.userName || '',\n` +
        `              timestamp: presenceMessage.timestamp || Date.now()\n` +
        `            };\n` +
        `            ${execCall};\n` +
        `          };\n` +
        `          channel.presence.subscribe('leave', __presH_${safeId});\n`
      )
    default:
      return ''
  }
}

const generateRealtimeUnsubscribeCode = (
  triggerType: string,
  safeId: string,
  config?: Record<string, unknown>
): string => {
  switch (triggerType) {
    case 'realtime-on-channel-message':
      return `            channel.unsubscribe('message', __msgH_${safeId});\n`
    case 'realtime-on-channel-event': {
      const eventName = (config?.eventName as string) || ''
      const ablyEventName = `event:${eventName}`
      return `            channel.unsubscribe('${ablyEventName}', __evtH_${safeId});\n`
    }
    case 'realtime-on-user-joined-channel':
      return `            channel.presence.unsubscribe('enter', __presH_${safeId});\n`
    case 'realtime-on-user-left-channel':
      return `            channel.presence.unsubscribe('leave', __presH_${safeId});\n`
    default:
      return ''
  }
}

const getRelevantWorkflows = (
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

    if (trigger.scope === 'page' && isPage) {
      const triggerPageId = trigger.config.pageId as string
      const selectedPages = trigger.config.selectedPages as Array<{ id: string }> | undefined

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
