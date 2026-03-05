import { StringUtils } from '@teleporthq/teleport-shared'
import {
  GeneratorOptions,
  UIDLLinkNode,
  UIDLElementNode,
  UIDLAttributeValue,
  UIDLPropDefinition,
  UIDLDynamicReference,
} from '@teleporthq/teleport-types'

// Whitelist of attributes that are safe to transfer to anchor tags
const ANCHOR_SAFE_ATTRIBUTES = new Set([
  // Standard HTML attributes
  'class',
  'id',
  'style',
  'title',
  'lang',
  'dir',
  'tabindex',
  'accesskey',
  'contenteditable',
  'draggable',
  'hidden',
  'spellcheck',
  'translate',
])

// ARIA attributes safe for anchor tags (link-specific)
const ANCHOR_SAFE_ARIA_ATTRIBUTES = new Set([
  'aria-describedby', // Describes the link purpose (valid transfer)
  'aria-labelledby', // References label for the link
  'aria-expanded', // For dropdown/collapsible links
  'aria-haspopup', // For links that open menus/dialogs
  'aria-current', // For navigation state
  'aria-disabled', // For disabled links
])

const isAttributeSafeForAnchor = (attrName: string): boolean => {
  return (
    ANCHOR_SAFE_ATTRIBUTES.has(attrName) ||
    attrName.startsWith('data-') ||
    ANCHOR_SAFE_ARIA_ATTRIBUTES.has(attrName)
  )
}

export const insertLinks = (
  node: UIDLElementNode,
  options: GeneratorOptions,
  linkInParent: boolean = false,
  parentNode?: UIDLElementNode,
  propDefinitions?: Record<string, UIDLPropDefinition>
): UIDLElementNode => {
  const { abilities, children, elementType, semanticType, attrs = {} } = node.content
  const linkInNode = linkInParent || !!abilities?.link

  node.content.children = children?.map((child) => {
    if (child.type === 'element') {
      return insertLinks(child, options, linkInNode, node, propDefinitions)
    }

    if (child.type === 'repeat') {
      child.content.node = insertLinks(
        child.content.node,
        options,
        linkInNode,
        node,
        propDefinitions
      )
    }

    if (child.type === 'conditional' && child.content.node.type === 'element') {
      child.content.node = insertLinks(
        child.content.node,
        options,
        linkInNode,
        node,
        propDefinitions
      )
    }

    if (child.type === 'slot' && child.content.fallback?.type === 'element') {
      child.content.fallback = insertLinks(
        child.content.fallback,
        options,
        linkInNode,
        node,
        propDefinitions
      )
    }

    if (child.type === 'cms-list') {
      const {
        nodes: { success, error, loading },
      } = child.content

      if (success) {
        child.content.nodes.success = insertLinks(success, options, false, node, propDefinitions)
      }

      if (error) {
        child.content.nodes.error = insertLinks(error, options, false, node, propDefinitions)
      }

      if (loading) {
        child.content.nodes.loading = insertLinks(loading, options, false, node, propDefinitions)
      }
    }

    if (child.type === 'cms-list-repeater') {
      const {
        nodes: { list, empty, loading },
      } = child.content

      if (list) {
        child.content.nodes.list = insertLinks(list, options, false, node, propDefinitions)
      }

      if (empty) {
        child.content.nodes.empty = insertLinks(empty, options, false, node, propDefinitions)
      }

      if (loading) {
        child.content.nodes.loading = insertLinks(loading, options, false, node, propDefinitions)
      }
    }

    if (child.type === 'cms-mixed-type') {
      if (child.content.mappings) {
        Object.keys(child.content.mappings).forEach((key) => {
          child.content.mappings[key] = insertLinks(
            child.content.mappings[key],
            options,
            false,
            node,
            propDefinitions
          )
        })
      }

      const {
        nodes: { fallback, error },
      } = child.content
      if (fallback) {
        child.content.nodes.fallback = insertLinks(fallback, options, false, node, propDefinitions)
      }

      if (error) {
        child.content.nodes.error = insertLinks(error, options, false, node, propDefinitions)
      }
    }

    if (child.type === 'cms-item') {
      const {
        nodes: { success, error, loading },
      } = child.content

      if (success) {
        child.content.nodes.success = insertLinks(success, options, false, node, propDefinitions)
      }

      if (error) {
        child.content.nodes.error = insertLinks(error, options, false, node, propDefinitions)
      }

      if (loading) {
        child.content.nodes.loading = insertLinks(loading, options, false, node, propDefinitions)
      }
    }

    if (child.type === 'data-source-list' || child.type === 'data-source-item') {
      const {
        nodes: { success, error, loading },
      } = child.content

      if (success) {
        child.content.nodes.success = insertLinks(success, options, false, node, propDefinitions)
      }

      if (error) {
        child.content.nodes.error = insertLinks(error, options, false, node, propDefinitions)
      }

      if (loading) {
        child.content.nodes.loading = insertLinks(loading, options, false, node, propDefinitions)
      }
    }

    return child
  })

  for (const attrKey of Object.keys(attrs)) {
    const attr = attrs[attrKey]

    if (attr.type === 'element') {
      node.content.attrs[attrKey] = insertLinks(
        attr as UIDLElementNode,
        options,
        false,
        node,
        propDefinitions
      )
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

    /* Handle link-type prop references: when the link ability is a dynamic reference
       to a prop with type 'link', route it through the navlink path so frameworks
       can map it to their link component (e.g. Next.js <Link>) */
    if (
      abilities.link.type === 'dynamic' &&
      abilities.link.content.referenceType === 'prop' &&
      propDefinitions?.[abilities.link.content.id]?.type === 'link'
    ) {
      return handleLinkTypeProp(node, abilities.link as UIDLDynamicReference, parentNode)
    }

    /* We repalce buttons with link to use <a> tag's, to make the generated
    code to be semantically correct. */
    if (elementType === 'button') {
      node.content.elementType = getLinkElementType(abilities.link)
      node.content.semanticType = ''
      node.content.style = {
        textAlign: { type: 'static', content: 'center' },
        ...node.content.style,
      }
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

    if (node.type === 'element' && node.content.attrs) {
      // Filter attributes to only transfer those safe for anchor tags
      const safeAttrs: Record<string, UIDLAttributeValue> = {}
      Object.keys(node.content.attrs).forEach((attrName) => {
        if (isAttributeSafeForAnchor(attrName)) {
          safeAttrs[attrName] = { ...node.content.attrs[attrName] }
        }
      })

      linkNode.content.attrs = {
        ...linkNode.content.attrs,
        ...safeAttrs,
      }

      // Remove only the transferred attributes from the original node
      Object.keys(safeAttrs).forEach((attrName) => {
        delete node.content.attrs[attrName]
      })
    }

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

const handleLinkTypeProp = (
  node: UIDLElementNode,
  linkRef: UIDLDynamicReference,
  parentNode?: UIDLElementNode
): UIDLElementNode => {
  const { elementType, semanticType } = node.content
  const propId = linkRef.content.id

  const linkAttrs: Record<string, UIDLAttributeValue> = {
    url: {
      type: 'dynamic',
      content: {
        referenceType: 'prop',
        id: propId,
        refPath: ['url'],
      },
    } as UIDLDynamicReference,
    target: {
      type: 'expr',
      content: `props.${propId}?.['newTab'] ? '_blank' : undefined`,
    },
    rel: {
      type: 'expr',
      content: `props.${propId}?.['newTab'] ? 'noreferrer noopener' : undefined`,
    },
  }

  // For buttons: replace element type directly
  if (elementType === 'button') {
    node.content.elementType = 'prop-link'
    node.content.semanticType = ''
    node.content.style = {
      textAlign: { type: 'static', content: 'center' },
      ...node.content.style,
    }
    node.content.attrs = { ...node.content.attrs, ...linkAttrs }
    return node
  }

  // For text spans: replace element type directly
  if (elementType === 'text' && semanticType === 'span') {
    node.content.elementType = 'prop-link'
    node.content.semanticType = ''
    node.content.attrs = { ...node.content.attrs, ...linkAttrs }
    return node
  }

  // For other elements: wrap with a link node
  const linkNode: UIDLElementNode = {
    type: 'element',
    content: {
      elementType: 'prop-link',
      attrs: { ...linkAttrs },
      children: [],
    },
  }

  // Transfer safe attributes to the wrapper
  if (node.type === 'element' && node.content.attrs) {
    const safeAttrs: Record<string, UIDLAttributeValue> = {}
    Object.keys(node.content.attrs).forEach((attrName) => {
      if (isAttributeSafeForAnchor(attrName)) {
        safeAttrs[attrName] = { ...node.content.attrs[attrName] }
      }
    })

    linkNode.content.attrs = {
      ...linkNode.content.attrs,
      ...safeAttrs,
    }

    Object.keys(safeAttrs).forEach((attrName) => {
      delete node.content.attrs[attrName]
    })
  }

  linkNode.content.children.push(node)

  if (parentNode === undefined || parentNode?.content.style?.display?.content === 'flex') {
    linkNode.content.style = {
      ...linkNode.content.style,
      display: { type: 'static', content: 'contents' },
    }
  }

  return linkNode
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
