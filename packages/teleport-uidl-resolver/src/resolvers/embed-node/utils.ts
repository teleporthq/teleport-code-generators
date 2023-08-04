import { GeneratorOptions, UIDLAttributeValue, UIDLElementNode } from '@teleporthq/teleport-types'

export const wrapHtmlNode = (node: UIDLElementNode, options: GeneratorOptions): UIDLElementNode => {
  const { children, attrs } = node.content

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

  let newNode
  if (attrs?.html) {
    newNode = createEmbedDivWrapperNode(node)
  }

  if (newNode) {
    newNode.content.children.push(node)

    node.content.style = {}
    node.content.referencedStyles = {}
    node.content.events = {}

    return newNode
  }

  return node
}

export const createEmbedDivWrapperNode = (node: UIDLElementNode): UIDLElementNode => {
  const attrs = Object.keys(node.content.attrs).reduce(
    (acc: Record<string, UIDLAttributeValue>, attrKey: string) => {
      if (attrKey !== 'html') {
        acc[attrKey] = node.content.attrs[attrKey]
      }

      return acc
    },
    {}
  )

  return {
    type: 'element',
    content: {
      ...node.content,
      attrs,
      style: {
        display: {
          type: 'static',
          content: 'contents',
        },
      },
      elementType: 'div',
      semanticType: 'div',
      children: [],
    },
  }
}
