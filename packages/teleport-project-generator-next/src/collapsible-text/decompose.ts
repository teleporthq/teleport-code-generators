import {
  ProjectPluginStructure,
  UIDLAttributeValue,
  UIDLConditionalNode,
  UIDLElement,
  UIDLElementNode,
  UIDLNode,
  UIDLStyleDefinitions,
  UIDLStyleValue,
} from '@teleporthq/teleport-types'
import { traverseProjectElements } from '../uidl-element-traversal'

/**
 * Codegen-side decomposition of the Collapsible Text primitive.
 *
 * The GUI's `collapsibleTextNodeToUIDL` mapper is *supposed* to bake the
 * clamp + overflow markers into the exported UIDL, but a project can be exported
 * without that decomposition (the primitive then arrives as the raw
 * `collapsible-text` element carrying only its content paragraph and the two
 * toggle labels). Doing the decomposition here as well means the generated app
 * clamps + gates the "Show more" toggle no matter how the UIDL was produced —
 * and stays idempotent when the UIDL *is* already decomposed.
 *
 * `state → style` is not expressible in the generated code, so instead of
 * toggling a line-clamp the body is emitted as TWO mutually-exclusive views of
 * the same content: a *collapsed* view carrying a static `-webkit-line-clamp`
 * (rendered when `expanded === false`) and an *expanded* view without it. Only
 * one mounts at runtime. The collapsed view is tagged `data-tq-collapsible-clamp`
 * and the Show more label `data-tq-collapsible-more` so the shipped
 * `TqCollapsibleTextOverflow` helper can measure real overflow and hide the
 * toggle when the text already fits.
 */

export const COLLAPSIBLE_TEXT_ELEMENT_TYPE = 'collapsible-text'
export const DEFAULT_COLLAPSIBLE_TRUNCATE_LINES = 3

const ROOT_MARKER = 'data-tq-collapsible-root'
const CLAMP_MARKER = 'data-tq-collapsible-clamp'
const MORE_MARKER = 'data-tq-collapsible-more'
// Optional hint the GUI can stamp on the raw element so a custom line count
// survives even when the full decomposition mapper did not run. Consumed and
// stripped here so it never reaches the DOM.
const LINES_ATTR = 'data-tq-collapsible-lines'

// Deterministic, collision-free keys for the wrapper `<div>`s across one run.
let bodyKeyCounter = 0

const staticAttr = (content: string): UIDLAttributeValue => ({ type: 'static', content })

const staticStyle = (content: string): UIDLStyleValue => ({ type: 'static', content })

const deepCloneNode = (node: UIDLNode): UIDLNode => JSON.parse(JSON.stringify(node)) as UIDLNode

const readTruncateLines = (element: UIDLElement): number => {
  const raw = element.attrs?.[LINES_ATTR]?.content
  const parsed =
    typeof raw === 'string' || typeof raw === 'number' ? parseInt(String(raw), 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COLLAPSIBLE_TRUNCATE_LINES
}

const makeContentWrapper = (
  inner: UIDLNode,
  style: UIDLStyleDefinitions,
  markClamp: boolean
): UIDLElementNode => {
  bodyKeyCounter += 1
  const content: UIDLElement = {
    elementType: 'container',
    semanticType: 'div',
    key: `collapsible-body-${bodyKeyCounter}`,
    children: [inner],
  }
  if (Object.keys(style).length > 0) {
    content.style = style
  }
  if (markClamp) {
    content.attrs = { [CLAMP_MARKER]: staticAttr('true') }
  }
  return { type: 'element', content }
}

/**
 * Builds a body view that gates on the SAME condition as `labelNode` (Show more
 * → `expanded === false`, See less → `expanded === true`), wrapping `content` in
 * a `<div>` that carries `extraStyle` (the line-clamp for the collapsed view).
 * Handles both shapes: a `conditional` wrapper (what the generator emits) or an
 * element with inline `renderingConditions`.
 */
const wrapContentWithLabelCondition = (
  labelNode: UIDLNode,
  content: UIDLNode,
  extraStyle: UIDLStyleDefinitions,
  markClamp: boolean
): UIDLNode => {
  const wrapper = makeContentWrapper(content, extraStyle, markClamp)

  if (labelNode.type === 'conditional') {
    return {
      type: 'conditional',
      content: {
        ...(labelNode as UIDLConditionalNode).content,
        node: wrapper,
      },
    }
  }

  if (labelNode.type === 'element' && labelNode.content.renderingConditions) {
    wrapper.content.renderingConditions = JSON.parse(
      JSON.stringify(labelNode.content.renderingConditions)
    )
    return wrapper
  }

  // Label wasn't conditionally wrapped as expected — fall back to always-visible
  // so the content still renders (the labels then govern the toggle affordance).
  return wrapper
}

/**
 * Tags the Show more label (bare element or `conditional` wrapper) so the runtime
 * overflow helper can hide it when the clamped text does not actually overflow.
 */
const addMarkerAttr = (node: UIDLNode, key: string): void => {
  const target = node.type === 'conditional' ? (node as UIDLConditionalNode).content.node : node
  if (target && target.type === 'element') {
    target.content.attrs = {
      ...(target.content.attrs ?? {}),
      [key]: staticAttr('true'),
    }
  }
}

/**
 * Decomposes a single `collapsible-text` element IN PLACE. No-op when the element
 * is already decomposed (root marker present) or isn't the expected
 * content + Show more + See less shape.
 */
export const decomposeCollapsibleTextElement = (element: UIDLElement): void => {
  // Already decomposed by the GUI mapper — only strip the transient line hint so
  // it never reaches the DOM, then leave the structure untouched.
  if (element.attrs?.[ROOT_MARKER]) {
    if (element.attrs[LINES_ATTR]) {
      delete element.attrs[LINES_ATTR]
    }
    return
  }

  const children = element.children ?? []
  const contentNode = children[0]
  const showMoreNode = children[1]
  const seeLessNode = children[2]
  if (!contentNode || !showMoreNode || !seeLessNode) {
    return
  }

  const truncateLines = readTruncateLines(element)
  const clampStyle: UIDLStyleDefinitions = {
    display: staticStyle('-webkit-box'),
    overflow: staticStyle('hidden'),
    ['-webkit-line-clamp']: staticStyle(String(truncateLines)),
    ['-webkit-box-orient']: staticStyle('vertical'),
  }

  const collapsedView = wrapContentWithLabelCondition(showMoreNode, contentNode, clampStyle, true)
  const expandedView = wrapContentWithLabelCondition(
    seeLessNode,
    deepCloneNode(contentNode),
    {},
    false
  )

  addMarkerAttr(showMoreNode, MORE_MARKER)

  const attrs = { ...(element.attrs ?? {}) }
  delete attrs[LINES_ATTR]
  attrs[ROOT_MARKER] = staticAttr('true')
  element.attrs = attrs
  element.children = [collapsedView, expandedView, showMoreNode, seeLessNode]
}

/**
 * Walks every page + component in the project UIDL and decomposes each
 * `collapsible-text` element. Returns true if the primitive was used anywhere.
 */
export const decomposeCollapsibleTextInProject = (
  uidl: ProjectPluginStructure['uidl']
): boolean => {
  let found = false
  traverseProjectElements(uidl, (element) => {
    if (element.elementType === COLLAPSIBLE_TEXT_ELEMENT_TYPE) {
      found = true
      decomposeCollapsibleTextElement(element)
    }
  })
  return found
}
