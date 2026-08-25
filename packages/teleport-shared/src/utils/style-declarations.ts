import {
  UIDLElementNode,
  UIDLStyleSetDefinition,
  UIDLStyleSheetContent,
  UIDLStyleValue,
} from '@teleporthq/teleport-types'

/**
 * Answers one question about a node: does anything declare CSS property X for
 * it?
 *
 * A generator that has to change an element's TAG (for example to make markup
 * parse the way it was rendered) needs this, because the tag is where a browser
 * gets its default `display`, `margin`, … from. Retagging a `div` to a `span`
 * only preserves the layout if the element carries its own `display` — and the
 * ONLY safe time to add one is when nothing else declares it. Adding
 * `display: block` next to a class that says `display: flex` would break the
 * layout instead of preserving it, because node styles compile to a
 * higher-specificity selector than project classes.
 *
 * Hence three answers rather than two: `unknown` means "a style source exists
 * that this pass cannot read", and callers must treat it exactly like
 * `declared` — leave the element alone.
 */
export type StyleDeclarationState = 'declared' | 'absent' | 'unknown'

export interface StyleSetLookup {
  /** `options.projectStyleSet?.styleSetDefinitions` — the project stylesheet. */
  projectStyleSetDefinitions?: Record<string, UIDLStyleSetDefinition>
}

const isDeclared = (value: UIDLStyleValue | UIDLStyleSheetContent | undefined): boolean =>
  value !== undefined && value !== null

const styleSetDeclares = (
  styleSet: UIDLStyleSetDefinition | undefined,
  properties: string[]
): boolean => {
  if (!styleSet) {
    return false
  }
  const declaredInBase = properties.some((property) => isDeclared(styleSet.content?.[property]))
  if (declaredInBase) {
    return true
  }
  // A property declared only inside a media query / element state still means
  // the element is styled for it, and a node-level value would override that
  // condition at every breakpoint. Treat it as declared.
  return (styleSet.conditions || []).some((condition) =>
    properties.some((property) => isDeclared(condition.content?.[property]))
  )
}

/**
 * Whether any of `properties` is declared for `node` by its own style, its
 * referenced styles or the project style sets those point at.
 *
 * Pass every property that contributes to the value you care about — the block
 * margins of a paragraph, for instance, can come from `margin`, `marginTop`,
 * `marginBlock`, … — because a single one of them declared anywhere makes the
 * element "already styled" for that concern.
 */
export const findStyleDeclaration = (
  node: UIDLElementNode,
  properties: string[],
  lookup: StyleSetLookup = {}
): StyleDeclarationState => {
  const { style, referencedStyles, dynamicStyleBindings } = node.content

  if (properties.some((property) => isDeclared(style?.[property]))) {
    return 'declared'
  }

  if (dynamicStyleBindings && properties.some((property) => !!dynamicStyleBindings[property])) {
    return 'declared'
  }

  let unresolved = false
  let declared = false

  Object.keys(referencedStyles || {}).forEach((styleId) => {
    const { content } = referencedStyles[styleId]

    switch (content.mapType) {
      case 'inlined':
        if (properties.some((property) => isDeclared(content.styles?.[property]))) {
          declared = true
        }
        return

      case 'project-referenced': {
        const styleSet = lookup.projectStyleSetDefinitions?.[content.referenceId]
        if (!styleSet) {
          // The definition lives in a stylesheet this pass was not handed.
          unresolved = true
          return
        }
        if (styleSetDeclares(styleSet, properties)) {
          declared = true
        }
        return
      }

      default:
        // `component-referenced` resolves through the component's own style set
        // variants (and, for prop references, through a runtime value). Neither
        // is a plain lookup, so it is reported as unreadable rather than guessed.
        unresolved = true
        return
    }
  })

  if (declared) {
    return 'declared'
  }
  return unresolved ? 'unknown' : 'absent'
}
