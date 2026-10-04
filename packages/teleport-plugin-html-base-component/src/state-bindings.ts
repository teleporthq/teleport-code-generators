import {
  GeneratorOptions,
  HastNode,
  HastText,
  UIDLConditionExpressionEntry,
  UIDLConditionExpressionGroup,
  UIDLConditionalExpression,
  UIDLDynamicReference,
  UIDLElement,
  UIDLExpressionValue,
  UIDLPropDefinition,
  UIDLReferencedStyles,
  UIDLStateDefinition,
  UIDLStateModifierEvent,
  UIDLStyleSetDefinition,
  UIDLWorkflow,
  UIDLWorkflowNode,
  UIDLWorkflows,
} from '@teleporthq/teleport-types'
import { HASTBuilders } from '@teleporthq/teleport-plugin-common'
import { StateBindings, StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'

/**
 * Compiles the editor's state-driven behaviour into the attributes a static
 * page carries for its runtime (see StateBindings in teleport-shared): which
 * branch a condition shows, what a click changes, which class a state turns
 * on. Every branch of a condition is written into the page, and the branch a
 * visitor does not start on is `hidden`, so the first paint, a visitor without
 * JavaScript and a search engine all read the page as it first loads.
 *
 * Only what the runtime can do exactly as the Next export does is compiled; a
 * condition or an action outside that is left to the generator's old
 * behaviour (resolved once, against the starting values).
 */

type StateExpression = StateBindings.StateExpression
type StateAssignment = StateBindings.StateAssignment
type StateValue = StateBindings.StateValue

/** The states one page or one component instance owns: one store in the page. */
export interface StateScope {
  name: string
  states: Record<string, UIDLStateDefinition>
  used: Set<string>
  pageId?: string
  /** Content a parent placed in this instance (slot children, element props): it reads the parent's store. */
  borrowed: HastNode[]
}

export interface BindingContext {
  scope?: StateScope
  props: Record<string, UIDLPropDefinition>
  repeater?: {
    expressions: Record<string, UIDLPropDefinition>
    currentIndex: number
  }
}

type ConditionReference = UIDLDynamicReference | UIDLExpressionValue

export const createStateScope = (
  name: string,
  states: Record<string, UIDLStateDefinition> = {},
  pageId?: string
): StateScope => ({ name, states, used: new Set(), pageId, borrowed: [] })

const SCALAR_STATE_TYPES = ['boolean', 'number', 'string']

/** A state the runtime can hold: a scalar with a starting value, under a name its language can write. */
const startingValue = (scope: StateScope, name: string): { value: StateValue } | null => {
  const definition = Object.prototype.hasOwnProperty.call(scope.states, name)
    ? scope.states[name]
    : undefined
  return definition &&
    SCALAR_STATE_TYPES.includes(definition.type) &&
    StateBindings.isStateName(name) &&
    StateBindings.isStateValue(definition.defaultValue)
    ? { value: definition.defaultValue }
    : null
}

const startingValues = (scope: StateScope): Record<string, StateValue> =>
  Object.keys(scope.states).reduce((values: Record<string, StateValue>, name) => {
    const start = startingValue(scope, name)
    if (start) {
      values[name] = start.value
    }
    return values
  }, {})

const useStates = (scope: StateScope, expression: StateExpression) =>
  StateBindings.stateNamesOf(expression).forEach((name) => scope.used.add(name))

const valueAtPath = (value: unknown, path: string[]): unknown =>
  path.reduce(
    (current: unknown, key) =>
      current !== null && typeof current === 'object'
        ? (current as Record<string, unknown>)[key]
        : undefined,
    value
  )

const literalOf = (value: unknown): StateExpression | null => {
  if (StateBindings.isStateValue(value)) {
    return StateBindings.literal(value)
  }
  const url = value !== null && typeof value === 'object' && (value as { url?: unknown }).url
  return typeof url === 'string' ? StateBindings.literal(url) : null
}

const PROP_PATH = /^props\??\.([A-Za-z_$][\w$]*)((?:\??\.[\w$]+)*)$/

const compileSource = (source: string, context: BindingContext): StateExpression | null => {
  const text = source.trim()
  if (text === 'true' || text === 'false' || text === 'null') {
    return StateBindings.literal(text === 'null' ? null : text === 'true')
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    return StateBindings.literal(Number(text))
  }
  if (text === 'index' && context.repeater) {
    return StateBindings.literal(context.repeater.currentIndex)
  }
  const propPath = PROP_PATH.exec(text)
  if (propPath) {
    const prop = context.props[propPath[1]]
    const path = propPath[2]
      .split('.')
      .map((key) => key.replace('?', ''))
      .filter(Boolean)
    return prop ? literalOf(valueAtPath(prop.defaultValue, path)) : null
  }
  return context.scope && startingValue(context.scope, text) ? StateBindings.state(text) : null
}

const compileReference = (
  reference: ConditionReference | undefined,
  context: BindingContext
): StateExpression | null => {
  if (!reference) {
    return null
  }
  if (reference.type === 'expr') {
    return compileSource(reference.content, context)
  }
  if (reference.type !== 'dynamic') {
    return null
  }
  const {
    referenceType,
    id,
    refPath = [],
  } = reference.content as {
    referenceType: string
    id: string
    refPath?: string[]
  }
  switch (referenceType) {
    case 'state':
      return refPath.length === 0 && context.scope && startingValue(context.scope, id)
        ? StateBindings.state(id)
        : null
    case 'prop': {
      const prop = context.props[id]
      return prop ? literalOf(valueAtPath(prop.defaultValue, refPath)) : null
    }
    case 'local': {
      const { repeater } = context
      if (!repeater) {
        return null
      }
      const item = Object.values(repeater.expressions || {})
        .map((expression) =>
          Array.isArray(expression?.defaultValue)
            ? expression.defaultValue[repeater.currentIndex]
            : undefined
        )
        .find((candidate) => candidate !== undefined)
      return item === undefined ? null : literalOf(valueAtPath(item, refPath))
    }
    default:
      return null
  }
}

const COLLECTION_OPERATIONS = [
  'contains',
  'notContains',
  'isEmpty',
  'isNotEmpty',
  'lengthEquals',
  'lengthGreaterThan',
  'lengthLessThan',
  'hasKey',
  'notHasKey',
]

/**
 * `=` and `==` are the editor's spellings of `===`. The JSX generators print
 * any unknown operation (`startsWith`…) as `===` as well; that is never what
 * it meant, so it is not compiled.
 */
const comparisonOf = (operation: string): StateBindings.ComparisonOperator | null => {
  switch (operation) {
    case '===':
    case '==':
    case '=':
      return '==='
    case '!==':
    case '!=':
      return '!=='
    case '<':
    case '<=':
    case '>':
    case '>=':
      return operation
    default:
      return null
  }
}

const compileEntry = (
  entry: UIDLConditionExpressionEntry,
  chainReference: ConditionReference | undefined,
  context: BindingContext
): StateExpression | null => {
  const { operation, operand, containsField } = entry
  if (containsField || COLLECTION_OPERATIONS.includes(operation)) {
    return null
  }
  const left = compileReference(entry.reference ?? chainReference, context)
  if (!left) {
    return null
  }
  if (operand === undefined) {
    return operation ? StateBindings.not(left) : left
  }
  // As in the JSX generators: `=== true` tests the value itself, `=== false` its absence.
  if (operation === '===' && operand === true) {
    return left
  }
  if (operation === '===' && operand === false) {
    return StateBindings.not(left)
  }
  const comparison = comparisonOf(operation)
  const right =
    operand !== null && typeof operand === 'object'
      ? compileReference(operand, context)
      : literalOf(operand)
  return comparison && right ? StateBindings.binary(comparison, left, right) : null
}

const compileChain = (
  chain: UIDLConditionalExpression | UIDLConditionExpressionGroup,
  reference: ConditionReference | undefined,
  context: BindingContext
): StateExpression | null => {
  const entries = (chain.conditions || []).map((entry) =>
    UIDLUtils.isUIDLConditionGroup(entry)
      ? compileChain(entry, reference, context)
      : compileEntry(entry, reference, context)
  )
  if (entries.length === 0 || entries.some((entry) => entry === null)) {
    return null
  }
  const operator = chain.matchingCriteria === 'all' ? '&&' : '||'
  return (entries as StateExpression[]).reduce((joined, entry) =>
    StateBindings.binary(operator, joined, entry)
  )
}

/**
 * A condition the runtime re-evaluates, or null when it reads no state of the
 * current scope (a prop is fixed in a static page, so it stays a build-time
 * decision) or says something the runtime cannot.
 */
export const compileCondition = (
  source: {
    reference?: ConditionReference
    condition?: UIDLConditionalExpression
    value?: string | number | boolean
  },
  context: BindingContext
): StateExpression | null => {
  const chain: UIDLConditionalExpression | undefined =
    source.value !== undefined && source.value !== null
      ? { conditions: [{ operation: '===', operand: source.value }] }
      : source.condition
  if (!chain || !context.scope) {
    return null
  }
  const expression = compileChain(chain, source.reference, context)
  return expression && StateBindings.stateNamesOf(expression).size > 0 ? expression : null
}

const appliedConditions = new WeakMap<HastNode, StateExpression>()

const conditionTarget = (content: HastNode | HastText | Array<HastNode | HastText>) => {
  if (!Array.isArray(content) && content.type === 'element') {
    return content as HastNode
  }
  const nodes = Array.isArray(content) ? content : [content]
  const visible = nodes.some(
    (node) => node.type === 'element' || (node.type === 'text' && (node as HastText).value.trim())
  )
  if (!visible) {
    return null
  }
  const wrapper = HASTBuilders.createHTMLNode(
    nodes.some((node) => node.type === 'element') ? 'div' : 'span',
    nodes
  )
  wrapper.properties.style = 'display: contents'
  return wrapper
}

/**
 * Writes a condition onto the element a conditional node produced (wrapped in
 * a `display: contents` element when it produced text), `hidden` when the
 * page does not start on it. A condition around a condition joins it with `&&`.
 */
export const bindConditionalContent = (
  content: HastNode | HastText | Array<HastNode | HastText>,
  condition: StateExpression,
  scope: StateScope
): HastNode | HastText | Array<HastNode | HastText> => {
  const target = conditionTarget(content)
  if (!target) {
    return content
  }
  const inner = appliedConditions.get(target)
  const expression = inner ? StateBindings.binary('&&', condition, inner) : condition
  appliedConditions.set(target, expression)
  target.properties[StateBindings.IF_ATTR] = StateBindings.escapeAttributeValue(
    StateBindings.printExpression(expression)
  )
  if (StateBindings.evaluateExpression(expression, startingValues(scope))) {
    delete target.properties.hidden
  } else {
    target.properties.hidden = true
  }
  useStates(scope, expression)
  return target
}

/** Mirrors the workflow runtime's `__coerceValue` for the values a scalar state takes. */
const coerceToStateType = (value: unknown, type: string): { value: StateValue } | null => {
  if (type === 'boolean') {
    return { value: value === true || value === 'true' }
  }
  if (type === 'number' && typeof value === 'string' && !Number.isNaN(Number(value))) {
    return { value: Number(value) }
  }
  return StateBindings.isStateValue(value) ? { value } : null
}

const compileStateChange = (
  event: UIDLStateModifierEvent,
  context: BindingContext
): StateAssignment | null => {
  const { scope } = context
  const name = event.modifies
  if (!scope || !startingValue(scope, name)) {
    return null
  }
  const { type } = scope.states[name]
  const current = StateBindings.state(name)
  const { newState } = event
  if (newState === '$toggle') {
    return type === 'boolean' ? { name, value: StateBindings.not(current) } : null
  }
  if (newState !== null && typeof newState === 'object') {
    const modifier = newState as { type?: string; delta?: number }
    if (modifier.type === '$increment' || modifier.type === '$decrement') {
      const delta = modifier.delta ?? 1
      if (type !== 'number' || !Number.isFinite(delta)) {
        return null
      }
      const adds = modifier.type === '$increment' ? delta >= 0 : delta < 0
      return {
        name,
        value: StateBindings.binary(
          adds ? '+' : '-',
          current,
          StateBindings.literal(Math.abs(delta))
        ),
      }
    }
    const value =
      modifier.type === 'dynamic' || modifier.type === 'expr'
        ? compileReference(newState as ConditionReference, context)
        : null
    return value ? { name, value } : null
  }
  const coerced = coerceToStateType(newState, type)
  return coerced ? { name, value: StateBindings.literal(coerced.value) } : null
}

/** A workflow value read off the clicked element: `{{Trigger.dataTabIndex}}` is its `data-tab-index`. */
const triggerData = (reference: unknown, triggerNodeId: string, hast: HastNode) => {
  const { type, nodeId, path } = reference as { type?: string; nodeId?: string; path?: unknown }
  if (type !== 'workflowContext' || nodeId !== triggerNodeId || !Array.isArray(path)) {
    return undefined
  }
  const keys = path[0] === nodeId ? path.slice(1) : path
  const key = keys.length === 1 ? keys[0] : undefined
  if (typeof key !== 'string' || !/^data[A-Z]/.test(key)) {
    return undefined
  }
  const attribute = hast.properties[StringUtils.camelCaseToDashCase(key)]
  return typeof attribute === 'string' ? attribute : undefined
}

const compileWorkflowUpdate = (
  property: unknown,
  value: unknown,
  triggerNodeId: string,
  hast: HastNode,
  context: BindingContext
): StateAssignment | null => {
  const { scope } = context
  if (typeof property !== 'string' || !scope || !startingValue(scope, property)) {
    return null
  }
  const { type } = scope.states[property]
  if (value === undefined) {
    return { name: property, value: StateBindings.literal(type === 'string' ? '' : null) }
  }
  const resolved =
    value !== null && typeof value === 'object' ? triggerData(value, triggerNodeId, hast) : value
  const coerced = resolved === undefined ? null : coerceToStateType(resolved, type)
  return coerced ? { name: property, value: StateBindings.literal(coerced.value) } : null
}

const compileWorkflowStep = (
  step: UIDLWorkflowNode,
  triggerNodeId: string,
  hast: HastNode,
  context: BindingContext
): StateAssignment[] | null => {
  const config = (step.config || {}) as Record<string, unknown>
  switch (step.type) {
    case 'state-update-local-state': {
      if (config.objectUpdateMode === 'property' || config.refreshFromDataSource) {
        return null
      }
      const update = compileWorkflowUpdate(
        config.property,
        config.value,
        triggerNodeId,
        hast,
        context
      )
      return update ? [update] : null
    }
    case 'state-batch-update': {
      const updates = (Array.isArray(config.updates) ? config.updates : []).map(
        (entry: { key?: unknown; value?: unknown }) =>
          compileWorkflowUpdate(entry?.key, entry?.value, triggerNodeId, hast, context)
      )
      return updates.length > 0 && updates.every(Boolean) ? updates : null
    }
    default:
      return null
  }
}

const isClickedBy = (workflow: UIDLWorkflow, elementId: string, scope: StateScope) => {
  const { trigger } = workflow
  if (!trigger || trigger.type !== 'event-element-clicked') {
    return false
  }
  const config = (trigger.config || {}) as Record<string, unknown>
  if ((config.elementHtmlId || config.nodeId) !== elementId) {
    return false
  }
  if (config.eventType && config.eventType !== 'click') {
    return false
  }
  // Like the Next export, an element on a page answers only the workflows bound to that page.
  const pages = config.selectedPages as Array<{ id?: string }> | undefined
  return !scope.pageId || !pages?.length || pages.some((page) => page?.id === scope.pageId)
}

/** A click workflow that only sets this scope's states, one step after the other. */
const compileClickWorkflow = (
  workflow: UIDLWorkflow,
  hast: HastNode,
  context: BindingContext
): StateAssignment[] | null => {
  const steps = [...(workflow.nodes || [])].sort((a, b) => a.stepNumber - b.stepNumber)
  const linear = steps.every(
    (step, index) => index === 0 || step.stepNumber !== steps[index - 1].stepNumber
  )
  if (steps.length === 0 || !linear) {
    return null
  }
  const assignments: StateAssignment[] = []
  for (const step of steps) {
    const compiled = compileWorkflowStep(step, workflow.trigger.nodeId, hast, context)
    if (!compiled) {
      return null
    }
    assignments.push(...compiled)
  }
  return assignments
}

const staticId = (element: UIDLElement): string | undefined => {
  const id = element.attrs?.id
  return id?.type === 'static' && id.content !== undefined ? String(id.content) : undefined
}

const compileClickActions = (
  element: UIDLElement,
  hast: HastNode,
  context: BindingContext,
  workflows: UIDLWorkflows | undefined
): StateAssignment[] => {
  const fromEvents = (element.events?.click || [])
    .map((statement) =>
      statement.type === 'stateChange' ? compileStateChange(statement, context) : null
    )
    .filter((assignment): assignment is StateAssignment => assignment !== null)
  const elementId = staticId(element)
  const { scope } = context
  const fromWorkflows =
    elementId && scope
      ? Object.values(workflows?.workflows || {})
          .filter((workflow) => isClickedBy(workflow, elementId, scope))
          .map((workflow) => compileClickWorkflow(workflow, hast, context))
          .filter((assignments): assignments is StateAssignment[] => assignments !== null)
      : []
  return fromEvents.concat(...fromWorkflows)
}

const NATIVELY_OPERABLE = ['button', 'input', 'select', 'textarea', 'summary', 'option', 'label']

const isOperable = (node: HastNode) =>
  NATIVELY_OPERABLE.includes(node.tagName) || (node.tagName === 'a' && 'href' in node.properties)

const containsOperable = (node: HastNode): boolean =>
  node.children.some(
    (child) =>
      child.type === 'element' &&
      (isOperable(child as HastNode) || containsOperable(child as HastNode))
  )

/** A clickable `div` is reached with Tab and announced as a button; the runtime answers Enter and Space. */
const makeKeyboardOperable = (hast: HastNode) => {
  if (isOperable(hast) || containsOperable(hast)) {
    return
  }
  if (!('role' in hast.properties)) {
    hast.properties.role = 'button'
  }
  if (!('tabindex' in hast.properties)) {
    hast.properties.tabindex = '0'
  }
}

const compileClassBindings = (
  referencedStyles: UIDLReferencedStyles = {},
  projectClasses: Record<string, UIDLStyleSetDefinition>,
  context: BindingContext
): StateBindings.ClassBinding[] =>
  Object.values(referencedStyles).reduce((bindings: StateBindings.ClassBinding[], styleRef) => {
    if (styleRef.content.mapType !== 'project-referenced' || !styleRef.content.condition) {
      return bindings
    }
    const { referenceId, condition } = styleRef.content
    if (!projectClasses[referenceId] || !StateBindings.isBindableClassName(referenceId)) {
      return bindings
    }
    const compiled = compileCondition(
      { reference: condition.reference, value: condition.value, condition: condition.expression },
      context
    )
    return compiled ? [...bindings, { className: referenceId, condition: compiled }] : bindings
  }, [])

/** The click actions and state classes of one generated element. */
export const bindElement = (
  element: UIDLElement,
  hast: HastNode,
  context: BindingContext,
  options: GeneratorOptions
) => {
  const { scope } = context
  if (!scope) {
    return
  }
  const actions = compileClickActions(element, hast, context, options.workflows)
  if (actions.length > 0) {
    hast.properties[StateBindings.CLICK_ATTR] = StateBindings.escapeAttributeValue(
      StateBindings.printAssignments(actions)
    )
    makeKeyboardOperable(hast)
    actions.forEach(({ name, value }) => {
      scope.used.add(name)
      useStates(scope, value)
    })
  }
  const classes = compileClassBindings(
    element.referencedStyles,
    options.projectStyleSet?.styleSetDefinitions || {},
    context
  )
  if (classes.length > 0) {
    hast.properties[StateBindings.CLASS_ATTR] = StateBindings.escapeAttributeValue(
      StateBindings.printClassBindings(classes)
    )
    classes.forEach(({ condition }) => useStates(scope, condition))
  }
}

/** Gives a page root or a component instance its store, when anything in it reads one. */
export const markStateScope = (hast: HastNode, scope: StateScope) => {
  if (scope.used.size === 0) {
    return
  }
  const values = startingValues(scope)
  const declarations = Object.keys(values)
    .filter((name) => scope.used.has(name))
    .map((name) => ({ name, value: StateBindings.literal(values[name]) }))
  hast.properties[StateBindings.SCOPE_ATTR] = StateBindings.escapeAttributeValue(scope.name)
  hast.properties[StateBindings.STATE_ATTR] = StateBindings.escapeAttributeValue(
    StateBindings.printAssignments(declarations)
  )
  scope.borrowed.forEach((root) => {
    root.properties[StateBindings.SLOT_ATTR] = ''
  })
}

const lentContent = new WeakMap<UIDLElement, { owner: StateScope; host: StateScope }>()

/** Content written in `owner` and rendered inside the instance `host`. */
export const lendToInstance = (
  content: UIDLElement,
  owner: StateScope | undefined,
  host: StateScope
) => {
  if (owner) {
    lentContent.set(content, { owner, host })
  }
}

export const lenderOf = (content: UIDLElement) => lentContent.get(content)
