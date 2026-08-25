import { UIDLElementNode } from '@teleporthq/teleport-types'
import { HtmlContentModel } from '@teleporthq/teleport-shared'
import { NestingContext, NestingResolverContext } from './types'

const { SELF_NESTING_TAGS, acceptsChildTag, isHeadingTag, endsInlineScope } = HtmlContentModel

const HYDRATION_DOC = 'nextjs.org/docs/messages/react-hydration-error'

const warn = (context: NestingResolverContext, message: string): void => {
  console.warn(`[html-nesting] ${context.componentName}: ${message} (see ${HYDRATION_DOC})`)
}

/**
 * `<div>` alone rarely tells anyone which node to open. The UIDL `name` is the
 * element's identity in the editor, so it is quoted whenever it adds anything.
 */
const describeElement = (node: UIDLElementNode, tag: string): string => {
  const { name } = node.content
  return name && name !== tag ? `<${tag}> "${name}"` : `<${tag}>`
}

/**
 * The DOM-restructuring nestings that have no lossless repair.
 *
 * Every one of them either removes an element the page needs (`<form>` inside
 * `<form>` — the inner one is never created) or moves it somewhere else
 * (`<div>` inside `<tbody>` is foster-parented out of the table). Renaming a
 * tag to make the markup parse would silently drop the behaviour the element
 * was added for, so these are reported rather than rewritten: the fix belongs
 * in whatever produced the tree.
 *
 * Paragraph content is deliberately absent — it IS repairable losslessly, and
 * `paragraph-repair` handles it.
 */
export const reportUnrepairableNesting = (
  node: UIDLElementNode,
  tag: string,
  nesting: NestingContext,
  context: NestingResolverContext
): void => {
  const element = describeElement(node, tag)

  if (SELF_NESTING_TAGS.has(tag) && nesting.openSelfNestingTags[tag]) {
    warn(
      context,
      `${element} nested inside another <${tag}>. The parser refuses to nest them and ` +
        `closes or drops one of the two`
    )
  }

  const { parentTag } = nesting
  if (!parentTag) {
    return
  }

  if (!acceptsChildTag(parentTag, tag)) {
    warn(
      context,
      `${element} is not valid content for <${parentTag}>. The parser moves or drops it`
    )
  }

  if (isHeadingTag(tag) && isHeadingTag(parentTag)) {
    warn(context, `${element} nested inside <${parentTag}>. The parser closes the outer heading`)
  }
}

/**
 * `ancestorInfo` bookkeeping for the tags whose duplicates the parser rejects.
 * `<a>`, `<button>` and `<nobr>` stop counting past a scope boundary (a table
 * cell, an `<object>`, …); the form pointer has no such boundary.
 */
export const nextOpenSelfNestingTags = (
  tag: string,
  current: Record<string, boolean>
): Record<string, boolean> => {
  let next = current

  if (endsInlineScope(tag)) {
    next = { ...next, a: false, button: false, nobr: false }
  }

  if (SELF_NESTING_TAGS.has(tag)) {
    next = { ...next, [tag]: true }
  }

  return next
}
