import { StringUtils } from '@teleporthq/teleport-shared'
import { GeneratorOptions, UIDLLinkDefinition, UIDLElementNode } from '@teleporthq/teleport-types'

export const insertLinks = (
  node: UIDLElementNode,
  options: GeneratorOptions,
  linkInParent: boolean = false
): UIDLElementNode => {
  const { abilities, children } = node.content
  const linkInNode = linkInParent || !!abilities?.link

  // TODO: think of a way to reuse the traversal that modifies the tree
  node.content.children = children?.map((child) => {
    if (child.type === 'element') {
      return insertLinks(child, options, linkInNode)
    }

    if (child.type === 'repeat') {
      child.content.node = insertLinks(child.content.node, options, linkInNode)
    }

    if (child.type === 'conditional' && child.content.node.type === 'element') {
      child.content.node = insertLinks(child.content.node, options, linkInNode)
    }

    if (child.type === 'slot' && child.content.fallback?.type === 'element') {
      child.content.fallback = insertLinks(child.content.fallback, options, linkInNode)
    }

    return child
  })

  if (abilities?.link) {
    if (linkInParent) {
      console.warn('parent node has a link capability, nesting links is illegal')
      return node
    }

    const linkNode = createLinkNode(abilities.link, options)
    // console.log('link node inserted', JSON.stringify(linkNode, null, 2))

    linkNode.content.children.push(node)
    return linkNode
  }

  return node
}

export const createLinkNode = (
  link: UIDLLinkDefinition,
  options: GeneratorOptions
): UIDLElementNode => {
  switch (link.type) {
    case 'url': {
      return {
        type: 'element',
        content: {
          elementType: 'link',
          attrs: {
            url: link.options.url,
            ...(link.options.newTab
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
          },
          children: [],
        },
      }
    }

    case 'section': {
      return {
        type: 'element',
        content: {
          elementType: 'link',
          attrs: {
            url: {
              type: 'static',
              content: `#${link.options.id}`,
            },
          },
          children: [],
        },
      }
    }

    case 'navlink': {
      return {
        type: 'element',
        content: {
          elementType: 'navlink',
          attrs: {
            transitionTo: {
              type: 'static',
              content: resolveNavlink(link.options.routeName, options),
            },
          },
          children: [],
        },
      }
    }

    case 'mail': {
      let mailUrl = `mailto:${link.options.mail}?subject=${link.options.subject ?? ''}`
      if (link.options.body) {
        mailUrl = mailUrl + `&body=${link.options.body}`
      }

      return {
        type: 'element',
        content: {
          elementType: 'link',
          attrs: {
            url: { type: 'static', content: mailUrl },
          },
          children: [],
        },
      }
    }

    case 'phone': {
      return {
        type: 'element',
        content: {
          elementType: 'link',
          attrs: {
            url: { type: 'static', content: `tel:${link.options.phone}` },
          },
          children: [],
        },
      }
    }

    default:
      throw new Error(
        `createLinkNode called with invalid link type '${(link as UIDLLinkDefinition).type}'`
      )
  }
}

const resolveNavlink = (routeName: string, options: GeneratorOptions) => {
  if (options.skipNavlinkResolver) {
    return routeName
  }

  if (routeName.startsWith('/')) {
    // attribute was explicitly set as a custom navlink
    return routeName
  }

  const friendlyURL = StringUtils.camelCaseToDashCase(
    StringUtils.removeIllegalCharacters(routeName)
  )

  const transitionRoute = options.projectRouteDefinition
    ? options.projectRouteDefinition.values.find((route) => route.value === routeName)
    : null

  if (!transitionRoute) {
    return `/${friendlyURL}`
  }

  return transitionRoute?.pageOptions?.navLink ?? `/${friendlyURL}`
}
