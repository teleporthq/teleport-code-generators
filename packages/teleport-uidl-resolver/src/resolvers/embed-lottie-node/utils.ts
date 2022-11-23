import { GeneratorOptions, UIDLAttributeValue, UIDLElementNode } from '@teleporthq/teleport-types'

export const wrapHtmlLottieNode = (
  node: UIDLElementNode,
  options: GeneratorOptions
): UIDLElementNode => {
  const { children, attrs, elementType } = node.content

  node.content.children = children?.map((child) => {
    if (child.type === 'element') {
      return wrapHtmlLottieNode(child, options)
    }

    if (child.type === 'repeat') {
      child.content.node = wrapHtmlLottieNode(child.content.node, options)
    }

    if (child.type === 'conditional' && child.content.node.type === 'element') {
      child.content.node = wrapHtmlLottieNode(child.content.node, options)
    }

    if (child.type === 'slot' && child.content.fallback?.type === 'element') {
      child.content.fallback = wrapHtmlLottieNode(child.content.fallback, options)
    }

    return child
  })

  let newNode
  if (attrs?.html) {
    newNode = createEmbedDivWrapperNode(node)
  }

  if (elementType === 'lottie-node') {
    newNode = createLottieDivWrapperNode(node)
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

export const createLottieDivWrapperNode = (node: UIDLElementNode): UIDLElementNode => {
  const LOTTIE_ANIMATION_ATTRIBUTES = [
    'autoplay',
    'background',
    'controls',
    'direction',
    'hover',
    'keepLastFrame',
    'intermission',
    'mode',
    'renderer',
    'speed',
    'loop',
    'src',
  ]

  const attrs = Object.keys(node.content.attrs).reduce(
    (acc: Record<string, UIDLAttributeValue>, attrKey: string) => {
      if (!LOTTIE_ANIMATION_ATTRIBUTES.includes(attrKey)) {
        acc[attrKey] = node.content.attrs[attrKey]

        delete node.content.attrs[attrKey]
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
      elementType: 'div',
      semanticType: 'div',
      children: [],
    },
  }
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
      elementType: 'div',
      semanticType: 'div',
      children: [],
    },
  }
}
