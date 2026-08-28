import {
  ComponentUIDL,
  GeneratorOptions,
  UIDLElementNode,
  UIDLNode,
} from '@teleporthq/teleport-types'
import { HtmlContentModel } from '@teleporthq/teleport-shared'
import { NestingContext, NestingResolverContext } from './types'
import { nextOpenSelfNestingTags, reportUnrepairableNesting } from './diagnostics'
import {
  applyParagraphRepairPlan,
  createParagraphRepairPlan,
  recordParagraphOffender,
} from './paragraph-repair'

const {
  FOREIGN_CONTENT_ROOT_TAGS,
  PARAGRAPH_TAG,
  closesOpenParagraph,
  endsParagraphScope,
  isHtmlTagName,
} = HtmlContentModel

/**
 * Makes the generated markup parse into the tree it was rendered as.
 *
 * Server-rendered HTML is re-parsed by the browser before React hydrates it,
 * and a handful of tag combinations make the parser rewrite the tree — closing
 * a `<p>` early, hoisting a `<div>` out of a `<table>`, dropping a nested
 * `<form>`. Whatever React rendered on the server no longer matches the DOM it
 * finds on the client, hydration fails, and the page is silently re-rendered
 * from scratch: styles flash, server-computed content is thrown away, and the
 * console fills with "Hydration failed because the initial UI does not match
 * what was rendered on the server".
 *
 * The pass runs after the element mapping, so every `elementType` is already
 * the tag that will be emitted (`text`+`p` has become `p`, a navlink has become
 * `Link` wrapping an `a`). It walks the resolved tree with the same
 * `ancestorInfo` bookkeeping react-dom's `validateDOMNesting` uses, so it flags
 * exactly what React would have flagged at runtime — only early enough to do
 * something about it.
 *
 * Paragraph content is repaired in place, because a rename is enough and costs
 * nothing (see `paragraph-repair`). The rest is reported: renaming a `<form>`
 * or a `<td>` to make it parse would throw away the behaviour it was added for.
 *
 * Element types that are not HTML tags — `Link`, `Repeater`, `Fragment`,
 * `TqMotion`, custom elements — have no content model of their own. They are
 * walked THROUGH rather than treated as a boundary: `<p><Link><a><div>` is the
 * shape that shipped, and only a walk that ignores the component in the middle
 * can see it. Component INSTANCES are a real boundary and are not walked at
 * all; each one is resolved as its own UIDL.
 */
export const resolveHtmlNesting = (uidl: ComponentUIDL, options: GeneratorOptions): void => {
  const context: NestingResolverContext = {
    componentName: uidl.name || 'component',
    projectStyleSetDefinitions: options.projectStyleSet?.styleSetDefinitions,
  }

  if (uidl.node) {
    visitNode(uidl.node, createRootNestingContext(), context)
  }

  const propDefinitions = uidl.propDefinitions || {}
  Object.keys(propDefinitions).forEach((propKey) => {
    const prop = propDefinitions[propKey]
    if (prop.type === 'element' && typeof prop.defaultValue === 'object') {
      visitNode(prop.defaultValue as UIDLElementNode, createRootNestingContext(), context)
    }
  })
}

const createRootNestingContext = (): NestingContext => ({ openSelfNestingTags: {} })

const visitElement = (
  node: UIDLElementNode,
  nesting: NestingContext,
  context: NestingResolverContext
): void => {
  const tag = node.content.elementType

  // A framework component or custom element: it contributes no tag of its own
  // to the parsed document, so its children keep the surrounding context.
  if (!isHtmlTagName(tag)) {
    visitChildren(node, nesting, context)
    return
  }

  // Inside <svg> the HTML content model does not apply at all.
  if (FOREIGN_CONTENT_ROOT_TAGS.has(tag)) {
    return
  }

  reportUnrepairableNesting(node, tag, nesting, context)

  let childNesting = nesting

  if (nesting.paragraph && closesOpenParagraph(tag)) {
    const paragraphStaysOpen = recordParagraphOffender(nesting.paragraph, node, tag)
    if (!paragraphStaysOpen) {
      childNesting = { ...childNesting, paragraph: undefined }
    }
  }

  if (endsParagraphScope(tag)) {
    childNesting = { ...childNesting, paragraph: undefined }
  }

  const plan = tag === PARAGRAPH_TAG ? createParagraphRepairPlan(node) : undefined
  if (plan) {
    childNesting = { ...childNesting, paragraph: plan }
  }

  visitChildren(
    node,
    {
      ...childNesting,
      parentTag: tag,
      openSelfNestingTags: nextOpenSelfNestingTags(tag, nesting.openSelfNestingTags),
    },
    context
  )

  // Applied only once the whole subtree is known: a single offender that cannot
  // be retagged changes the repair for the entire paragraph.
  if (plan) {
    applyParagraphRepairPlan(plan, context)
  }
}

const visitChildren = (
  node: UIDLElementNode,
  nesting: NestingContext,
  context: NestingResolverContext
): void => {
  const attrs = node.content.attrs || {}
  const children = node.content.children || []

  // An element handed to a component as an attribute is rendered wherever that
  // component decides to render it, so it is inspected on its own rather than
  // against the ancestors of the node carrying it.
  Object.keys(attrs).forEach((attrKey) => {
    const attr = attrs[attrKey]
    if (attr.type === 'element') {
      visitNode(attr, createRootNestingContext(), context)
    }
  })

  children.forEach((child) => visitNode(child, nesting, context))
}

/**
 * Everything that is not an element renders its branches exactly where it sits,
 * so the nesting context passes straight through.
 */
const visitNode = (
  node: UIDLNode,
  nesting: NestingContext,
  context: NestingResolverContext
): void => {
  if (!node || !node.type) {
    return
  }

  switch (node.type) {
    case 'element': {
      // An element node can carry a data-source node in its `content`.
      const content = node.content as unknown as { type?: string }
      if (content.type === 'data-source-item' || content.type === 'data-source-list') {
        visitNode(node.content as unknown as UIDLNode, nesting, context)
        return
      }
      visitElement(node, nesting, context)
      return
    }

    case 'conditional':
      visitNode(node.content.node, nesting, context)
      return

    case 'repeat':
      visitNode(node.content.node, nesting, context)
      return

    case 'slot':
      if (node.content.fallback) {
        visitNode(node.content.fallback as UIDLNode, nesting, context)
      }
      return

    case 'cms-list':
    case 'cms-item':
      visitBranches(
        [node.content.nodes.success, node.content.nodes.error, node.content.nodes.loading],
        nesting,
        context
      )
      return

    case 'cms-list-repeater':
      visitBranches(
        [node.content.nodes.list, node.content.nodes.empty, node.content.nodes.loading],
        nesting,
        context
      )
      return

    case 'cms-mixed-type': {
      const mappings = node.content.mappings || {}
      visitBranches(
        Object.keys(mappings).map((key) => mappings[key]),
        nesting,
        context
      )
      visitBranches([node.content.nodes?.fallback, node.content.nodes?.error], nesting, context)
      return
    }

    case 'data-source-item':
    case 'data-source-list': {
      visitBranches(
        [node.content.nodes?.success, node.content.nodes?.error, node.content.nodes?.loading],
        nesting,
        context
      )
      const dataSourceChildren = node.content.children || []
      dataSourceChildren.forEach((child) => visitNode(child, nesting, context))
      return
    }

    default:
      // static / dynamic / expr / raw / inject / import — leaves, no tags.
      return
  }
}

/**
 * Sibling render branches (success / error / loading, CMS type mappings) are
 * alternatives of one another, but every one of them renders in the SAME place.
 * They therefore share the surrounding context — including the repair plan of
 * an enclosing paragraph, which has to account for whichever branch renders.
 */
const visitBranches = (
  branches: Array<UIDLElementNode | undefined>,
  nesting: NestingContext,
  context: NestingResolverContext
): void => {
  branches.forEach((branch) => {
    if (branch) {
      visitNode(branch, nesting, context)
    }
  })
}
