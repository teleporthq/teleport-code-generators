import { UIDLElementNode } from '@teleporthq/teleport-types'
import { HtmlContentModel, StyleDeclarations } from '@teleporthq/teleport-shared'
import { NestingResolverContext, ParagraphRepairPlan } from './types'

const { GENERIC_FLOW_TAG, GENERIC_PHRASING_TAG, PARAGRAPH_TAG } = HtmlContentModel

/**
 * The `<p>` offenders that a tag substitution can fix without losing anything:
 * a generic wrapper carries no semantics, so `<span>` says exactly as much as
 * `<div>` did. Every other offender (a list, a heading, a form, a nested
 * paragraph) means something, and silently renaming it would trade a rendering
 * bug for a content bug.
 */
const isRetaggableParagraphChild = (tag: string): boolean => tag === GENERIC_FLOW_TAG

/**
 * Every property that can supply a paragraph's block margins. One of them
 * declared anywhere means the design already spaces this element and the UA
 * default was never in play.
 */
const BLOCK_MARGIN_PROPERTIES: string[] = [
  'margin',
  'marginTop',
  'marginBottom',
  'marginBlock',
  'marginBlockStart',
  'marginBlockEnd',
]

const setStaticStyle = (node: UIDLElementNode, property: string, value: string): void => {
  if (!node.content.style) {
    node.content.style = {}
  }
  node.content.style[property] = { type: 'static', content: value }
}

/**
 * Renames the element and keeps `semanticType` in step when it was carrying the
 * same tag — some targets (the invoice HTML renderer, the Angular module
 * builder) read `semanticType` in preference to `elementType`, so leaving a
 * stale `p` there would re-emit the tag we just removed.
 */
const retagElement = (node: UIDLElementNode, tag: string): void => {
  const previousTag = node.content.elementType
  node.content.elementType = tag
  if (node.content.semanticType === previousTag) {
    node.content.semanticType = tag
  }
}

export const createParagraphRepairPlan = (paragraph: UIDLElementNode): ParagraphRepairPlan => ({
  paragraph,
  retaggable: [],
  blockingTags: [],
})

/**
 * Files one offender against the paragraph it breaks and answers whether the
 * paragraph is still open below it.
 *
 * Once the offender becomes a `<span>` the paragraph really does stay open, so
 * anything deeper is still paragraph content and still has to be inspected. An
 * offender that cannot be retagged has already closed the paragraph, and the
 * rest of that branch is no longer inside it.
 */
export const recordParagraphOffender = (
  plan: ParagraphRepairPlan,
  node: UIDLElementNode,
  tag: string
): boolean => {
  if (isRetaggableParagraphChild(tag)) {
    plan.retaggable.push(node)
    return true
  }
  if (plan.blockingTags.indexOf(tag) === -1) {
    plan.blockingTags.push(tag)
  }
  return false
}

/**
 * `<span>` is inline where `<div>` is block, and that default is the only thing
 * lost by the rename. Restate it — but ONLY when nothing else declares a
 * display: node styles compile to a higher-specificity selector than project
 * classes, so an unconditional `display: block` would override the very class
 * it is meant to preserve.
 */
const retagAsPhrasingContent = (node: UIDLElementNode, context: NestingResolverContext): void => {
  const displayState = StyleDeclarations.findStyleDeclaration(node, ['display'], {
    projectStyleSetDefinitions: context.projectStyleSetDefinitions,
  })

  if (displayState === 'absent') {
    setStaticStyle(node, 'display', 'block')
  }

  retagElement(node, GENERIC_PHRASING_TAG)
}

/**
 * Last resort: the paragraph becomes a `<div>` so that whatever it holds is
 * legal. A `<div>` gets no margins from the UA stylesheet, so the paragraph
 * default is restated when — and only when — nothing else already spaces this
 * element.
 *
 * That restatement assumes the UA default was in effect, which holds for every
 * stylesheet this platform emits (project styles are class-scoped; there are no
 * tag-level rules). A project that adds its own reset — a Tailwind preflight,
 * say — zeroes paragraph margins, and there the 1em is spacing the design did
 * not ask for. It is still the closer of the two guesses: the alternative drops
 * spacing the design DID ask for, in the far more common un-reset case.
 */
const demoteParagraph = (node: UIDLElementNode, context: NestingResolverContext): void => {
  const marginState = StyleDeclarations.findStyleDeclaration(node, BLOCK_MARGIN_PROPERTIES, {
    projectStyleSetDefinitions: context.projectStyleSetDefinitions,
  })

  if (marginState === 'absent') {
    setStaticStyle(node, 'marginTop', '1em')
    setStaticStyle(node, 'marginBottom', '1em')
  }

  retagElement(node, GENERIC_FLOW_TAG)
}

export const applyParagraphRepairPlan = (
  plan: ParagraphRepairPlan,
  context: NestingResolverContext
): void => {
  if (plan.blockingTags.length > 0) {
    console.warn(
      `[html-nesting] ${context.componentName}: <${PARAGRAPH_TAG}> contains ` +
        `<${plan.blockingTags.join('>, <')}>, which the HTML parser cannot keep inside a ` +
        `paragraph. Emitted as <${GENERIC_FLOW_TAG}> instead so the served markup matches ` +
        `what was rendered (see nextjs.org/docs/messages/react-hydration-error).`
    )
    demoteParagraph(plan.paragraph, context)
    return
  }

  if (plan.retaggable.length === 0) {
    return
  }

  console.warn(
    `[html-nesting] ${context.componentName}: ${plan.retaggable.length} <${GENERIC_FLOW_TAG}> ` +
      `wrapper(s) inside a <${PARAGRAPH_TAG}> emitted as <${GENERIC_PHRASING_TAG}> — a ` +
      `<${GENERIC_FLOW_TAG}> there makes the parser close the paragraph and break hydration.`
  )

  plan.retaggable.forEach((node) => retagAsPhrasingContent(node, context))
}
