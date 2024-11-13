import { StringUtils } from '@teleporthq/teleport-shared'
import {
  GeneratorOptions,
  UIDLLinkNode,
  UIDLElementNode,
  UIDLAttributeValue,
} from '@teleporthq/teleport-types'

export const insertLinks = (
  node: UIDLElementNode,
  options: GeneratorOptions,
  linkInParent: boolean = false,
  parentNode?: UIDLElementNode
): UIDLElementNode => {
  const { abilities, children, elementType, semanticType, attrs = {} } = node.content
  const linkInNode = linkInParent || !!abilities?.link

  node.content.children = children?.map((child) => {
    if (child.type === 'element') {
      return insertLinks(child, options, linkInNode, node)
    }

    if (child.type === 'repeat') {
      child.content.node = insertLinks(child.content.node, options, linkInNode, node)
    }

    if (child.type === 'conditional' && child.content.node.type === 'element') {
      child.content.node = insertLinks(child.content.node, options, linkInNode, node)
    }

    if (child.type === 'slot' && child.content.fallback?.type === 'element') {
      child.content.fallback = insertLinks(child.content.fallback, options, linkInNode, node)
    }

    if (child.type === 'cms-list') {
      const {
        nodes: { success, error, loading },
      } = child.content

      if (success) {
        insertLinks(success, options, false, node)
      }

      if (error) {
        insertLinks(error, options, false, node)
      }

      if (loading) {
        insertLinks(loading, options, false, node)
      }
    }

    if (child.type === 'cms-list-repeater') {
      const {
        nodes: { list, empty },
      } = child.content

      if (list) {
        insertLinks(list, options, false, node)
      }

      if (empty) {
        insertLinks(empty, options, false, node)
      }
    }

    if (child.type === 'cms-mixed-type') {
      if (child.content.mappings) {
        Object.values(child.content.mappings).forEach((mapping) => {
          insertLinks(mapping, options, false, node)
        })
      }

      const {
        nodes: { fallback, error },
      } = child.content
      if (fallback) {
        insertLinks(fallback, options, false, node)
      }

      if (error) {
        insertLinks(error, options, false, node)
      }
    }

    if (child.type === 'cms-item') {
      const {
        nodes: { success, error, loading },
      } = child.content

      if (success) {
        insertLinks(success, options, false, node)
      }

      if (error) {
        insertLinks(error, options, false, node)
      }

      if (loading) {
        insertLinks(loading, options, false, node)
      }
    }

    return child
  })

  for (const attrKey of Object.keys(attrs)) {
    const attr = attrs[attrKey]

    if (attr.type === 'element') {
      node.content.attrs[attrKey] = insertLinks(attr as UIDLElementNode, options, false, node)
    }
  }

  if (abilities?.link) {
    if (linkInParent) {
      console.warn('parent node has a link capability, nesting links is illegal')
      return node
    }

    /* type attribute is not valid for `anchor` tags */
    if (node.content?.attrs?.type) {
      delete node.content.attrs.type
    }

    /* We repalce buttons with link to use <a> tag's, to make the generated
    code to be semantically correct. */
    if (elementType === 'button') {
      node.content.elementType = getLinkElementType(abilities.link)
      node.content.semanticType = ''
      node.content.attrs = {
        ...node.content.attrs,
        ...createLinkAttributes(abilities.link, options),
      }
      return node
    }

    /* a text node (span) on which we added a link gets transformed into an <a>
     the rest of the text elements get wrapped with an <a> tag */
    if (elementType === 'text' && semanticType === 'span') {
      node.content.elementType = getLinkElementType(abilities.link)
      node.content.semanticType = ''
      node.content.attrs = {
        ...node.content.attrs,
        ...createLinkAttributes(abilities.link, options),
      }

      return node
    }

    const linkNode = createLinkNode(abilities.link, options)
    linkNode.content.children.push(node)

    if (parentNode === undefined || parentNode?.content.style?.display?.content === 'flex') {
      linkNode.content.style = {
        ...linkNode.content.style,
        display: { type: 'static', content: 'contents' },
      }
    }

    return linkNode
  }

  return node
}

export const createLinkNode = (link: UIDLLinkNode, options: GeneratorOptions): UIDLElementNode => {
  return {
    type: 'element',
    content: {
      elementType: getLinkElementType(link),
      attrs: createLinkAttributes(link, options),
      children: [],
    },
  }
}

const getLinkElementType = (link: UIDLLinkNode): string => {
  // for now I'm making all dynamic links local.
  // Maybe navlinks could have a dynamic reference,
  // not just a staic on in the future, but for now
  // (for the CMS demo) the navlink was too robust
  // to change
  return link.type === 'navlink' || link.type === 'dynamic' ? 'navlink' : 'link'
}

const createLinkAttributes = (
  link: UIDLLinkNode,
  options: GeneratorOptions
): Record<string, UIDLAttributeValue> => {
  switch (link.type) {
    case 'url': {
      return {
        url: link.content.url,
        ...(link.content.newTab
          ? {
              target: {
                type: 'static',
                content: '_blank',
              },
              rel: {
                type: 'static',
                content: 'noreferrer noopener',
              },
            }
          : {}),
      }
    }

    case 'section': {
      if (link.content.section.type === 'static') {
        return {
          url: {
            type: 'static',
            content: `#${link.content.section.content}`,
          },
        }
      }

      if (link.content.section.type === 'expr') {
        return {
          url: {
            type: 'expr',
            content: '`#${' + link.content.section.content + '}`',
          },
        }
      }

      return
    }

    case 'dynamic':
      return {
        transitionTo: link,
      }

    case 'navlink': {
      return {
        transitionTo: resolveNavlink(link.content.routeName, options),
      }
    }

    case 'mail': {
      let mailUrl = `mailto:${link.content.mail}?subject=${link.content.subject ?? ''}`
      if (link.content.body) {
        mailUrl = mailUrl + `&body=${link.content.body}`
      }

      return {
        url: { type: 'static', content: mailUrl },
      }
    }

    case 'phone': {
      return {
        url: { type: 'static', content: `tel:${link.content.phone}` },
      }
    }

    default:
      throw new Error(
        `createLinkNode called with invalid link type '${(link as UIDLLinkNode).type}'`
      )
  }
}

const resolveNavlink = (
  route: UIDLAttributeValue,
  options: GeneratorOptions
): UIDLAttributeValue => {
  if (options.skipNavlinkResolver) {
    return route
  }

  const { type, content: routeName } = route

  if (type !== 'static') {
    return route
  }

  if (routeName.toString().startsWith('/')) {
    // attribute was explicitly set as a custom navlink
    return route
  }

  const friendlyURL = StringUtils.camelCaseToDashCase(
    StringUtils.removeIllegalCharacters(routeName.toString())
  )

  const transitionRoute = options.projectRouteDefinition
    ? options.projectRouteDefinition.values.find((routeItem) => routeItem.value === routeName)
    : null

  if (!transitionRoute) {
    return {
      type: 'static',
      content: `/${friendlyURL}`,
    }
  }

  if (transitionRoute?.pageOptions?.navLink === '/') {
    return {
      type: 'static',
      content: transitionRoute.pageOptions.navLink,
    }
  }

  const { pageOptions } = transitionRoute

  return {
    type: 'static',
    content: pageOptions.navLink ?? `/${friendlyURL}`,
  }
}
