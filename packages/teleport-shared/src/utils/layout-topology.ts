import {
  UIDLElementNode,
  UIDLStyleSetDefinition,
  UIDLStyleSheetContent,
  UIDLStyleValue,
} from '@teleporthq/teleport-types'

/**
 * Which UIDL nodes actually generate a layout box — and therefore which node is
 * a given element's REAL parent for layout purposes.
 *
 * This exists because the same defect keeps reappearing: a generator inserts a
 * wrapper (a link anchor, an animation wrapper, a repeater shell) between a
 * flex/grid container and its styled children. The wrapper becomes the flex/grid
 * item, the child's `flex`/`grid-area`/`align-self` silently stop applying — a
 * `flex: 0 0 340px` card collapses to content width — and the published site
 * stops matching what the editor showed. The editor never renders those
 * wrappers at all, so "what you see is what you get" quietly breaks.
 *
 * The subtle half is the ancestor walk, not the wrapper. UIDL trees are full of
 * nodes that render NOTHING: fragments, repeaters, data providers, conditional
 * shells. Asking "is my parent a flex container?" of the immediate UIDL parent
 * gets the wrong answer whenever one of those sits in between — and it usually
 * does, because cards live inside repeaters. Ask `resolveLayoutParent` instead
 * and the question is asked of the node that actually draws the box.
 *
 * Add new box-less element types HERE, once, rather than at each call site.
 */

/**
 * Element types that never produce a layout box. `fragment` renders as a React
 * `<Fragment>` on JSX targets and as a `div { display: contents }` on the HTML
 * target — either way it generates no box, so it can never be a layout parent.
 */
export const LAYOUT_TRANSPARENT_ELEMENT_TYPES = new Set(['fragment'])

export const isLayoutTransparentElement = (node?: UIDLElementNode): boolean =>
  !!node && LAYOUT_TRANSPARENT_ELEMENT_TYPES.has(node.content.elementType)

/**
 * The layout parent to hand to `node`'s children.
 *
 * Thread this through a recursive walk instead of passing the current node:
 * a box-less node passes its own layout parent straight through, so a chain of
 * fragments/repeaters collapses to the nearest ancestor that really draws a box.
 */
export const resolveLayoutParent = (
  node: UIDLElementNode,
  currentLayoutParent?: UIDLElementNode
): UIDLElementNode | undefined => (isLayoutTransparentElement(node) ? currentLayoutParent : node)

/** Display values that make a node lay its direct children out as items. */
export const FLEX_OR_GRID_DISPLAYS = new Set(['flex', 'inline-flex', 'grid', 'inline-grid'])

export const isStaticFlexOrGridDisplay = (
  display: UIDLStyleValue | UIDLStyleSheetContent | undefined
): boolean => display?.type === 'static' && FLEX_OR_GRID_DISPLAYS.has(String(display.content))

/**
 * Does this node lay its children out as flex/grid items?
 *
 * The display can come from an inline style or — far more common in generated
 * projects — from a project-referenced style class. Abilities are resolved
 * before referenced styles are flattened, so the style set has to be consulted
 * directly; pass `options.projectStyleSet?.styleSetDefinitions`.
 */
export const isFlexOrGridContainer = (
  node: UIDLElementNode | undefined,
  styleSetDefinitions?: Record<string, UIDLStyleSetDefinition>
): boolean => {
  if (!node) {
    return false
  }

  if (isStaticFlexOrGridDisplay(node.content.style?.display)) {
    return true
  }

  const referencedStyles = node.content.referencedStyles
  if (!referencedStyles || !styleSetDefinitions) {
    return false
  }

  return Object.values(referencedStyles).some((referencedStyle) => {
    if (referencedStyle.content.mapType !== 'project-referenced') {
      return false
    }
    const styleSet = styleSetDefinitions[referencedStyle.content.referenceId]
    return isStaticFlexOrGridDisplay(styleSet?.content?.display)
  })
}
