import * as types from '@babel/types'
import { UIDLWorkflow, UIDLWorkflowNode } from '@teleporthq/teleport-types'

/**
 * Restoring `value=` on a `<select>` whose only change handler comes from a
 * workflow.
 *
 * ## The defect
 *
 * `makeControlUncontrolledWhenNoChangeHandler` (teleport-plugin-common's
 * node-to-jsx pass) demotes `value` → `defaultValue` on any form control that
 * carries no change handler. That is right for an entity-bound display field,
 * which React would otherwise FREEZE. But it runs while the JSX is generated,
 * and workflow triggers are attached afterwards, by this plugin — so a control
 * whose handler comes from a workflow was demoted no matter how legitimately
 * controlled it is. (The helper's own contract says it "must run AFTER all
 * attributes and event handlers have been added to the tag"; nothing was
 * enforcing that across the plugin boundary.)
 *
 * `defaultValue` is read once, at mount. The bound state then has no route to
 * the DOM, so a `<select>` whose state is established AFTER hydration — from a
 * URL search param, say — keeps showing whatever the server rendered while the
 * rest of the page follows the real value. The products-list sort shipped that
 * way: `/products?sortBy=price-asc` listed products by the discounted price
 * under a dropdown still reading "Name (A-Z)".
 *
 * ## Why only `<select>`, and only with proof
 *
 * A controlled control is frozen unless its handler writes the state its value
 * reads. Two conditions make that safe here, and both are checked:
 *
 * 1. **It is a `<select>`.** A select changes in discrete, deliberate steps, so
 *    a controlled one survives the workflow being async — a late state write
 *    costs at most a frame. A text `<input>`/`<textarea>` accumulates one
 *    keystroke at a time and needs the state written back SYNCHRONOUSLY on
 *    every one; a workflow is an async pipeline and cannot promise that, and a
 *    controlled input whose state lags drops characters and jumps the caret.
 *    That is a far worse defect than a stale initial value, so text controls
 *    stay uncontrolled. `checked` is left alone for the same reason: a checkbox
 *    that bounces back before an async handler resolves reads as broken.
 *
 * 2. **The handler demonstrably writes that state.** The bound value has to be
 *    a bare identifier (a state name — `value={props.item?.category}` is an
 *    entity field with no state behind it), and one of the workflows on this
 *    element's `onChange` has to carry a state-update node targeting it. A
 *    select whose change handler does something unrelated keeps `defaultValue`
 *    and stays uncontrolled, exactly as before.
 */

/** The prop that makes a `<select>` controllable. */
const CHANGE_PROP = 'onChange'

/**
 * Node types that write a page/global state property.
 *
 * `state-batch-update` keeps its targets in `config.updates[].key` rather than
 * `config.property`, so both shapes are read.
 */
const STATE_WRITE_NODE_TYPES = new Set([
  'state-update-local-state',
  'state-update-global-state',
  'state-batch-update',
])

const readAttribute = (
  openingElement: types.JSXOpeningElement,
  name: string
): { attr: types.JSXAttribute; index: number } | null => {
  const index = openingElement.attributes.findIndex(
    (attr) =>
      types.isJSXAttribute(attr) && types.isJSXIdentifier(attr.name) && attr.name.name === name
  )
  return index === -1
    ? null
    : { attr: openingElement.attributes[index] as types.JSXAttribute, index }
}

/** Every state property a workflow's graph writes. */
export const collectWrittenStateProperties = (workflow: UIDLWorkflow): Set<string> => {
  const written = new Set<string>()
  const nodes: UIDLWorkflowNode[] = Array.isArray(workflow?.nodes) ? workflow.nodes : []

  for (const node of nodes) {
    if (!node || !STATE_WRITE_NODE_TYPES.has(node.type)) {
      continue
    }
    const config = (node.config || {}) as Record<string, unknown>

    if (typeof config.property === 'string' && config.property.length > 0) {
      written.add(config.property)
    }

    const updates = config.updates
    if (Array.isArray(updates)) {
      for (const update of updates) {
        const key = (update as { key?: unknown })?.key
        if (typeof key === 'string' && key.length > 0) {
          written.add(key)
        }
      }
    }
  }

  return written
}

/**
 * The state name a `defaultValue` binding reads, or `null` when it is not a
 * plain state reference.
 *
 * Only a bare identifier counts. `defaultValue={props.item?.category}` is an
 * entity column with no state mirror — the very case the demotion exists for —
 * and a member expression can never be matched against a state-update target
 * with any confidence.
 */
export const readBoundStateName = (attr: types.JSXAttribute): string | null => {
  if (!attr.value || !types.isJSXExpressionContainer(attr.value)) {
    return null
  }
  const expression = attr.value.expression
  return types.isIdentifier(expression) ? expression.name : null
}

/**
 * Turns `defaultValue` back into `value` on a `<select>` that a workflow makes
 * genuinely controlled. Mutates the opening element in place; idempotent, and a
 * no-op for every element that does not meet BOTH conditions above.
 *
 * @param workflows The workflows wired to this element's `onChange`.
 */
export const restoreControlledSelectValue = (
  openingElement: types.JSXOpeningElement,
  workflows: UIDLWorkflow[]
): void => {
  if (!types.isJSXIdentifier(openingElement.name) || openingElement.name.name !== 'select') {
    return
  }
  if (!readAttribute(openingElement, CHANGE_PROP)) {
    return
  }

  const defaultValue = readAttribute(openingElement, 'defaultValue')
  if (!defaultValue) {
    return
  }

  // Already controlled: drop the stale `defaultValue` rather than shipping both,
  // which React warns about and resolves unpredictably.
  if (readAttribute(openingElement, 'value')) {
    openingElement.attributes.splice(defaultValue.index, 1)
    return
  }

  const stateName = readBoundStateName(defaultValue.attr)
  if (!stateName) {
    return
  }

  const writesTheBoundState = workflows.some((workflow) =>
    collectWrittenStateProperties(workflow).has(stateName)
  )
  if (!writesTheBoundState) {
    return
  }

  defaultValue.attr.name = types.jsxIdentifier('value')
}
