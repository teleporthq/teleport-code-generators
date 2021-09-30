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
  ChunkType,
  FileType,
  ChunkDefinition,
  UIDLDependency,
  UIDLStyleValue,
  GeneratorOptions,
} from '@teleporthq/teleport-types'
import { HASTBuilders, HASTUtils } from '@teleporthq/teleport-plugin-common'
import { StringUtils } from '@teleporthq/teleport-shared'
import { staticNode } from '@teleporthq/teleport-uidl-builders'
import { createCSSPlugin } from '@teleporthq/teleport-plugin-css'
import { DEFAULT_COMPONENT_CHUNK_NAME } from './constants'

type NodeToHTML<NodeType, ReturnType> = (
  node: NodeType,
  templatesLookUp: Record<string, unknown>,
  propDefinitions: Record<string, UIDLPropDefinition>,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  externals: Record<string, ComponentUIDL>,
  structure: {
    chunks: ChunkDefinition[]
    dependencies: Record<string, UIDLDependency>
    options: GeneratorOptions
  }
) => ReturnType

export const generateHtmlSynatx: NodeToHTML<UIDLNode, Promise<HastNode | HastText>> = async (
  node,
  templatesLookUp,
  propDefinitions,
  stateDefinitions,
  externals,
  structure
) => {
  switch (node.type) {
    case 'raw':
      return HASTBuilders.createTextNode(node.content.toString())

    case 'static':
      return HASTBuilders.createTextNode(StringUtils.encode(node.content.toString()))

    case 'element':
      return generatElementNode(
        node,
        templatesLookUp,
        propDefinitions,
        stateDefinitions,
        externals,
        structure
      )

    case 'dynamic':
      return generateDynamicNode(
        node,
        templatesLookUp,
        propDefinitions,
        stateDefinitions,
        externals,
        structure
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

const generatElementNode: NodeToHTML<UIDLElementNode, Promise<HastNode | HastText>> = async (
  node,
  templatesLookUp,
  propDefinitions,
  stateDefinitions,
  externals,
  structure
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
  const { dependencies, chunks, options } = structure

  if (dependency && dependency?.type !== 'local') {
    dependencies[dependency.path] = dependency
  }

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

    const combinedProps = { ...propDefinitions, ...(comp?.propDefinitions || {}) }
    const propsForInstance = Object.keys(combinedProps).reduce(
      (acc: Record<string, UIDLPropDefinition>, propKey) => {
        if (attrs[propKey]) {
          acc[propKey] = {
            ...combinedProps[propKey],
            defaultValue: attrs[propKey].content,
          }
        } else {
          acc[propKey] = combinedProps[propKey]
        }

        return acc
      },
      {}
    )

    const combinedStates = { ...stateDefinitions, ...(comp?.stateDefinitions || {}) }
    const statesForInstance = Object.keys(combinedStates).reduce(
      (acc: Record<string, UIDLStateDefinition>, propKey) => {
        if (attrs[propKey]) {
          acc[propKey] = {
            ...combinedStates[propKey],
            defaultValue: attrs[propKey].content,
          }
        } else {
          acc[propKey] = combinedStates[propKey]
        }

        return acc
      },
      {}
    )

    const compTag = await generateHtmlSynatx(
      comp.node,
      templatesLookUp,
      propsForInstance,
      statesForInstance,
      externals,
      structure
    )
    templatesLookUp[key] = compTag

    const chunk = chunks.find((item) => item.name === comp.name)
    if (!chunk) {
      const cssPlugin = createCSSPlugin({
        templateChunkName: 'html-template',
        declareDependency: 'import',
        forceScoping: true,
        chunkName: comp.name,
      })
      const result = await cssPlugin({
        uidl: comp,
        chunks: [
          {
            type: ChunkType.HAST,
            fileType: FileType.HTML,
            name: DEFAULT_COMPONENT_CHUNK_NAME,
            linkAfter: [],
            content: compTag,
            meta: {
              nodesLookup: templatesLookUp,
            },
          },
        ],
        dependencies,
        options,
      })
      const styleChunk = result.chunks.find((item: ChunkDefinition) => item.name === comp.name)
      chunks.push(styleChunk)
    }

    return compTag
  }

  const elementNode = HASTBuilders.createHTMLNode(elementType)
  templatesLookUp[key] = elementNode

  if (children) {
    for (const child of children) {
      const childTag = await generateHtmlSynatx(
        child,
        templatesLookUp,
        propDefinitions,
        stateDefinitions,
        externals,
        structure
      )

      if (!childTag) {
        return
      }

      if (typeof childTag === 'string') {
        HASTUtils.addTextNode(elementNode, childTag)
      } else {
        HASTUtils.addChildNode(elementNode, childTag as HastNode)
      }
    }
  }

  if (Object.keys(referencedStyles).length > 0) {
    Object.keys(referencedStyles).forEach((styleRef) => {
      const refStyle = referencedStyles[styleRef]
      if (refStyle.content.mapType === 'inlined') {
        handleStyles(node, refStyle.content.styles, propDefinitions, stateDefinitions)
      }
    })
  }

  if (Object.keys(style).length > 0) {
    handleStyles(node, style, propDefinitions, stateDefinitions)
  }

  if (Object.keys(attrs).length > 0) {
    handleAttributes(elementNode, attrs, propDefinitions, stateDefinitions)
  }

  return elementNode
}

const generateDynamicNode: NodeToHTML<UIDLDynamicReference, HastNode> = (
  node,
  _,
  propDefinitions,
  stateDefinitions
) => {
  const spanTag = HASTBuilders.createHTMLNode('span')
  const usedReferenceValue =
    node.content.referenceType === 'prop'
      ? getValueFromReference(node.content.id, propDefinitions)
      : getValueFromReference(node.content.id, stateDefinitions)

  HASTUtils.addTextNode(spanTag, String(usedReferenceValue))
  return spanTag
}

const handleStyles = (
  node: UIDLElementNode,
  styles: UIDLStyleDefinitions,
  propDefinitions: Record<string, UIDLPropDefinition>,
  stateDefinitions: Record<string, UIDLStateDefinition>
) => {
  Object.keys(styles).forEach((styleKey) => {
    let style: string | UIDLStyleValue = styles[styleKey]
    if (style.type === 'dynamic') {
      if (style.content.referenceType === 'prop') {
        style = getValueFromReference(style.content.id, propDefinitions)
      } else if (style.content.referenceType === 'state') {
        style = getValueFromReference(style.content.id, stateDefinitions)
      }
      node.content.style[styleKey] = typeof style === 'string' ? staticNode(style) : style
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
      const value =
        attrValue.content.referenceType === 'prop'
          ? getValueFromReference(attrValue.content.id, propDefinitions)
          : getValueFromReference(attrValue.content.id, stateDefinitions)
      HASTUtils.addAttributeToNode(htmlNode, attrKey, String(value))
      return
    }

    if (typeof attrValue.content === 'boolean') {
      HASTUtils.addBooleanAttributeToNode(htmlNode, attrKey)
    } else if (typeof attrValue.content === 'string' || typeof attrValue.content === 'number') {
      HASTUtils.addAttributeToNode(htmlNode, attrKey, StringUtils.encode(String(attrValue.content)))
    }
  })
}

const getValueFromReference = (
  key: string,
  definitions: Record<string, UIDLPropDefinition>
): string => {
  const usedReferenceValue = definitions[key]

  if (!usedReferenceValue) {
    throw new HTMLComponentGeneratorError(
      `Definition for ${key} is missing from ${JSON.stringify(definitions, null, 2)}`
    )
  }

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

  return String(usedReferenceValue.defaultValue)
}
