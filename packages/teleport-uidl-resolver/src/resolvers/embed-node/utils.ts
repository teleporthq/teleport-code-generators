import { GeneratorOptions, UIDLElementNode } from '@teleporthq/teleport-types'

export const wrapHtmlNode = (node: UIDLElementNode, options: GeneratorOptions): UIDLElementNode => {
  const { children } = node.content

  node.content.children = children?.map((child) => {
    if (child.type === 'element') {
      return wrapHtmlNode(child, options)
    }

    if (child.type === 'repeat') {
      child.content.node = wrapHtmlNode(child.content.node, options)
    }

    if (child.type === 'conditional' && child.content.node.type === 'element') {
      child.content.node = wrapHtmlNode(child.content.node, options)
    }

    if (child.type === 'slot' && child.content.fallback?.type === 'element') {
      child.content.fallback = wrapHtmlNode(child.content.fallback, options)
    }

    return child
  })

  const { elementType, attrs = {} } = node.content
  if (elementType !== 'html-node') {
    return node
  }

  // Separate data-* attributes to transfer to outer wrapper
  const dataAttrs: Record<string, any> = {}
  const innerAttrs: Record<string, any> = {}

  Object.keys(attrs).forEach((attrKey) => {
    if (attrKey.startsWith('data')) {
      dataAttrs[attrKey] = attrs[attrKey]
    } else {
      innerAttrs[attrKey] = attrs[attrKey]
    }
  })

  return {
    type: 'element',
    content: {
      elementType: 'container',
      attrs: dataAttrs,
      style: node.content.style,
      referencedStyles: node.content.referencedStyles,
      events: node.content.events,
      children: [
        {
          type: 'element',
          content: {
            elementType: 'container',
            referencedStyles: {},
            style: {
              display: {
                type: 'static',
                content: 'contents',
              },
            },
            children: [
              {
                type: 'element',
                content: {
                  ...node.content,
                  attrs: innerAttrs,
                  events: {},
                  referencedStyles: {},
                  style: {},
                },
              },
            ],
          },
        },
      ],
    },
  }
}
