import {
  UIDLNode,
  UIDLElementNode,
  HastNode,
  HTMLComponentGeneratorError,
  UIDLStaticValue,
} from '@teleporthq/teleport-types'
import { HASTBuilders, HASTUtils } from '@teleporthq/teleport-plugin-common'
import { StringUtils } from '@teleporthq/teleport-shared'

type NodeToHTML<NodeType, ReturnType> = (
  node: NodeType,
  templatesLookUp: Record<string, unknown>
) => ReturnType

export const generateHtmlSynatx = (node: UIDLNode, templatesLookUp: Record<string, unknown>) => {
  switch (node.type) {
    case 'raw':
      return node.content.toString()
    case 'static':
      return StringUtils.encode(node.content.toString())
    case 'element':
      return generatElementNode(node, templatesLookUp)
    default:
      throw new HTMLComponentGeneratorError(
        `generateHtmlSyntax encountered a node of unsupported type: ${JSON.stringify(
          node,
          null,
          2
        )} `
      )
  }
}

const generatElementNode: NodeToHTML<UIDLElementNode, HastNode> = (node, templatesLookUp) => {
  const {
    elementType,
    dependency,
    selfClosing,
    children,
    attrs,
    key,
    style,
    referencedStyles,
  } = node.content

  if (dependency) {
    throw new HTMLComponentGeneratorError(`External Components are not supported`)
  }
  const htmlNode = HASTBuilders.createHTMLNode(elementType)

  if (attrs) {
    Object.keys(attrs).forEach((attrId: string) => {
      const attr = attrs[attrId]
      if (attr.type === 'dynamic' || attr.type === 'import') {
        throw new HTMLComponentGeneratorError(
          `Dynamic values are not supported in attrs, received - ${attr}`
        )
      }
      handleAttribute(htmlNode, attrId, attr)
    })
  }

  if (style) {
    Object.values(style).forEach((styleValue) => {
      if (styleValue.type === 'dynamic') {
        throw new HTMLComponentGeneratorError(
          `Dynamic values insidee styles are not supported, received - ${style}`
        )
      }
    })
  }

  if (referencedStyles) {
    Object.values(referencedStyles).forEach((styleId) => {
      if (styleId.content.mapType === 'inlined') {
        Object.values(styleId.content.styles || {}).forEach((styleValue) => {
          if (styleValue.type === 'dynamic') {
            throw new HTMLComponentGeneratorError(
              `Dynamic values insidee styles are not supported, received - ${styleValue}`
            )
          }
        })
      }
    })
  }

  if (!selfClosing && children) {
    children.forEach((child) => {
      const childTag = generateHtmlSynatx(child, templatesLookUp)

      if (typeof childTag === 'string') {
        HASTUtils.addTextNode(htmlNode, childTag)
      } else {
        HASTUtils.addChildNode(htmlNode, childTag)
      }
    })
  }

  templatesLookUp[key] = htmlNode
  return htmlNode
}

const handleAttribute = (htmlNode: HastNode, attrKey: string, attrValue: UIDLStaticValue) => {
  if (typeof attrValue.content === 'boolean') {
    HASTUtils.addBooleanAttributeToNode(htmlNode, attrKey)
  } else if (typeof attrValue.content === 'string') {
    HASTUtils.addAttributeToNode(
      htmlNode,
      attrKey,
      StringUtils.encode(attrValue.content.toString())
    )
  } else {
    throw new HTMLComponentGeneratorError(`Unsupported attr value is passed`)
  }
}
