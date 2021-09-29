import {
  UIDLNode,
  UIDLElementNode,
  HastNode,
  HTMLComponentGeneratorError,
  UIDLAttributeValue,
  UIDLPropDefinition,
  UIDLStateDefinition,
  UIDLDynamicReference,
  UIDLStyleDefinitions,
  HastText,
  ComponentUIDL,
} from '@teleporthq/teleport-types'
import { HASTBuilders, HASTUtils } from '@teleporthq/teleport-plugin-common'
import { StringUtils } from '@teleporthq/teleport-shared'
import { staticNode } from '@teleporthq/teleport-uidl-builders'

type NodeToHTML<NodeType, ReturnType> = (
  node: NodeType,
  templatesLookUp: Record<string, unknown>,
  propDefinitions: Record<string, UIDLPropDefinition>,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  externals: Record<string, ComponentUIDL>
) => ReturnType

export const generateHtmlSynatx: NodeToHTML<UIDLNode, HastNode | HastText> = (
  node,
  templatesLookUp,
  propDefinitions,
  stateDefinitions,
  externals
) => {
  switch (node.type) {
    case 'raw':
      return HASTBuilders.createTextNode(node.content.toString())

    case 'static':
      return HASTBuilders.createTextNode(StringUtils.encode(node.content.toString()))

    case 'element':
      return generatElementNode(node, templatesLookUp, propDefinitions, stateDefinitions, externals)

    case 'dynamic':
      return generateDynamicNode(
        node,
        templatesLookUp,
        propDefinitions,
        stateDefinitions,
        externals
      )

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

const generatElementNode: NodeToHTML<UIDLElementNode, HastNode | HastText> = (
  node,
  templatesLookUp,
  propDefinitions,
  stateDefinitions,
  externals
) => {
  const {
    elementType,
    children,
    key,
    attrs = {},
    style = {},
    referencedStyles = {},
    dependency,
  } = node.content
  if (dependency && dependency?.type === 'local') {
    const comp = externals[StringUtils.dashCaseToUpperCamelCase(elementType)]

    if (!comp) {
      throw new HTMLComponentGeneratorError(
        `External component that is referred is missing. Received ${JSON.stringify(
          dependency,
          null,
          2
        )} with ${elementType} \n
        But received externals ${Object.keys(externals)}`
      )
    }

    const compTag = generateHtmlSynatx(
      comp.node,
      templatesLookUp,
      { ...propDefinitions, ...comp.propDefinitions },
      { ...stateDefinitions, ...comp.stateDefinitions },
      externals
    )

    return compTag
  }

  const elementNode = HASTBuilders.createHTMLNode(elementType)

  if (children) {
    children.forEach((child) => {
      const childTag = generateHtmlSynatx(
        child,
        templatesLookUp,
        propDefinitions,
        stateDefinitions,
        externals
      )

      if (!childTag) {
        return
      }

      if (typeof childTag === 'string') {
        HASTUtils.addTextNode(elementNode, childTag)
      } else {
        HASTUtils.addChildNode(elementNode, childTag as HastNode)
      }
    })
  }

  if (referencedStyles) {
    Object.keys(referencedStyles).forEach((styleRef) => {
      const refStyle = referencedStyles[styleRef]
      if (refStyle.content.mapType === 'inlined') {
        handleStyles(node, refStyle.content.styles, propDefinitions, stateDefinitions)
      }
    })
  }

  if (style) {
    handleStyles(node, style, propDefinitions, stateDefinitions)
  }

  if (attrs) {
    handleAttributes(elementNode, attrs, propDefinitions, stateDefinitions)
  }

  templatesLookUp[key] = elementNode
  return elementNode
}

const generateDynamicNode: NodeToHTML<UIDLDynamicReference, HastNode> = (
  node,
  templateLookup,
  propDefinitions,
  stateDefinitions
) => {
  const spanTag = HASTBuilders.createHTMLNode('span')
  const usedReferenceValue = propDefinitions[node.content.id] || stateDefinitions[node.content.id]

  if (!usedReferenceValue?.defaultValue) {
    throw new HTMLComponentGeneratorError(
      `Dynamic node which i used don't have a defaultValue, received ${JSON.stringify(
        usedReferenceValue,
        null,
        1
      )}`
    )
  }

  if (usedReferenceValue.type === 'string' || usedReferenceValue.type === 'number') {
    HASTUtils.addTextNode(spanTag, String(usedReferenceValue.defaultValue))
  }

  templateLookup[`span-${node.content.id}`] = spanTag
  return spanTag
}

const handleStyles = (
  node: UIDLElementNode,
  style: UIDLStyleDefinitions,
  propDefinitions: Record<string, UIDLPropDefinition>,
  stateDefinitions: Record<string, UIDLStateDefinition>
) => {
  Object.keys(style).forEach((styleKey) => {
    const value = style[styleKey]
    if (value.type === 'dynamic' && value.content.referenceType === 'prop') {
      const usedReferenceValue =
        propDefinitions[value.content.id] || stateDefinitions[value.content.id]

      if (!usedReferenceValue.hasOwnProperty('defaultValue')) {
        throw new HTMLComponentGeneratorError(
          `Default value is missing from dynamic reference - ${JSON.stringify(
            usedReferenceValue,
            null,
            2
          )}`
        )
      }

      if (!['string', 'number'].includes(usedReferenceValue.type)) {
        throw new HTMLComponentGeneratorError(
          `Dynamic value used for ${styleKey} is not supported. Recieved ${JSON.stringify(
            usedReferenceValue,
            null,
            2
          )}`
        )
      }
      node.content.style[styleKey] = staticNode(String(usedReferenceValue.defaultValue))
    }
  })
}

const handleAttributes = (
  htmlNode: HastNode,
  attrs: Record<string, UIDLAttributeValue>,
  propDefinitions: Record<string, UIDLPropDefinition>,
  stateDefinitions: Record<string, UIDLStateDefinition>
) => {
  Object.keys(attrs).forEach((attrKey) => {
    const attrValue = attrs[attrKey]

    if (attrValue.type === 'dynamic') {
      const usedReferenceValue =
        propDefinitions[attrValue.content.id] || stateDefinitions[attrValue.content.id]

      if (!usedReferenceValue.hasOwnProperty('defaultValue')) {
        throw new HTMLComponentGeneratorError(
          `Default value is missing from dynamic reference - ${JSON.stringify(
            usedReferenceValue,
            null,
            2
          )}`
        )
      }

      if (!['string', 'number'].includes(usedReferenceValue?.type)) {
        throw new HTMLComponentGeneratorError(
          `Attribute is using dynamic value, but received of type ${JSON.stringify(
            usedReferenceValue,
            null,
            2
          )}`
        )
      }

      HASTUtils.addAttributeToNode(htmlNode, attrKey, String(usedReferenceValue.defaultValue))
      return
    }

    if (typeof attrValue.content === 'boolean') {
      HASTUtils.addBooleanAttributeToNode(htmlNode, attrKey)
    } else if (typeof attrValue.content === 'string' || typeof attrValue.content === 'number') {
      HASTUtils.addAttributeToNode(htmlNode, attrKey, StringUtils.encode(String(attrValue.content)))
    }
  })
}
