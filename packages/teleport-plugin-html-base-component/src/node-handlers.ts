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
  UIDLRouteDefinitions,
} from '@teleporthq/teleport-types'
import { HASTBuilders, HASTUtils } from '@teleporthq/teleport-plugin-common'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { staticNode } from '@teleporthq/teleport-uidl-builders'
import { createCSSPlugin } from '@teleporthq/teleport-plugin-css'
import { DEFAULT_COMPONENT_CHUNK_NAME } from './constants'

type NodeToHTML<NodeType, ReturnType> = (
  node: NodeType,
  templatesLookUp: Record<string, unknown>,
  propDefinitions: Record<string, UIDLPropDefinition>,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  externals: Record<string, ComponentUIDL>,
  routeDefinitions: UIDLRouteDefinitions,
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
  routeDefinitions,
  structure
) => {
  switch (node.type) {
    case 'inject':
    case 'raw':
      return HASTBuilders.createTextNode(node.content.toString())

    case 'static':
      return HASTBuilders.createTextNode(StringUtils.encode(node.content.toString()))

    case 'slot':
      return HASTBuilders.createHTMLNode(node.type)

    case 'element':
      return generatElementNode(
        node,
        templatesLookUp,
        propDefinitions,
        stateDefinitions,
        externals,
        routeDefinitions,
        structure
      )

    case 'dynamic':
      return generateDynamicNode(
        node,
        templatesLookUp,
        propDefinitions,
        stateDefinitions,
        externals,
        routeDefinitions,
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
  routeDefinitions,
  structure
) => {
  const {
    elementType,
    children,
    attrs = {},
    style = {},
    referencedStyles = {},
    dependency,
    key,
  } = node.content
  const elementNode = HASTBuilders.createHTMLNode(elementType)
  templatesLookUp[key] = elementNode

  const { dependencies } = structure
  if (dependency && (dependency as UIDLDependency)?.type !== 'local') {
    dependencies[dependency.path] = dependency
  }

  if (dependency && (dependency as UIDLDependency)?.type === 'local') {
    const compTag = await generateComponentContent(
      node,
      propDefinitions,
      stateDefinitions,
      externals,
      routeDefinitions,
      structure
    )
    return compTag
  }

  if (children) {
    for (const child of children) {
      const childTag = await generateHtmlSynatx(
        child,
        templatesLookUp,
        propDefinitions,
        stateDefinitions,
        externals,
        routeDefinitions,
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
        return
      }
    })
  }

  if (Object.keys(style).length > 0) {
    handleStyles(node, style, propDefinitions, stateDefinitions)
  }

  if (Object.keys(attrs).length > 0) {
    handleAttributes(elementNode, attrs, propDefinitions, stateDefinitions, routeDefinitions)
  }

  return elementNode
}

const generateComponentContent = async (
  node: UIDLElementNode,
  propDefinitions: Record<string, UIDLPropDefinition>,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  externals: Record<string, ComponentUIDL>,
  routeDefinitions: UIDLRouteDefinitions,
  structure: {
    chunks: ChunkDefinition[]
    dependencies: Record<string, UIDLDependency>
    options: GeneratorOptions
  }
) => {
  const { elementType, attrs = {}, key, children = [] } = node.content
  const { dependencies, chunks, options } = structure
  const comp = UIDLUtils.cloneObject(externals[elementType] || {}) as ComponentUIDL
  const lookUpTemplates: Record<string, unknown> = {}
  let compHasSlots: boolean = false

  if (!comp || !comp?.node) {
    throw new HTMLComponentGeneratorError(`${elementType} is not found from the externals. \n
        Received ${JSON.stringify(Object.keys(externals), null, 2)}`)
  }

  if (children.length) {
    compHasSlots = true
    UIDLUtils.traverseNodes(comp.node, (childNode, parentNode) => {
      if (childNode.type === 'slot' && parentNode.type === 'element') {
        const nonSlotNodes = parentNode.content?.children?.filter((n) => n.type !== 'slot')
        parentNode.content.children = [
          ...nonSlotNodes,
          {
            type: 'element',
            content: {
              key: 'custom-slot',
              elementType: 'slot',
              style: {
                display: {
                  type: 'static',
                  content: 'contents',
                },
              },
              children,
            },
          },
        ]
      }
    })
    /*
      Since we don't generate direct component children in HTML. We need to reset this,
      or else the plugins like css and others try to parse and process them.
    */
    node.content.children = []
  }

  const combinedProps = { ...propDefinitions, ...(comp?.propDefinitions || {}) }
  const propsForInstance = Object.keys(combinedProps).reduce(
    (acc: Record<string, UIDLPropDefinition>, propKey) => {
      if (attrs[propKey]) {
        acc[propKey] = {
          ...combinedProps[propKey],
          defaultValue: attrs[propKey]?.content || combinedProps[propKey]?.defaultValue,
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
          defaultValue: attrs[propKey]?.content || combinedStates[propKey]?.defaultValue,
        }
      } else {
        acc[propKey] = combinedStates[propKey]
      }

      return acc
    },
    {}
  )
  const elementNode = HASTBuilders.createHTMLNode(StringUtils.camelCaseToDashCase(elementType))
  lookUpTemplates[key] = elementNode

  const compTag = (await generateHtmlSynatx(
    {
      ...comp.node,
      content: {
        ...comp.node.content,
        style: {
          ...(comp.node.content?.style || {}),
          display: {
            type: 'static',
            content: 'contents',
          },
        },
      },
    },
    lookUpTemplates,
    propsForInstance,
    statesForInstance,
    externals,
    routeDefinitions,
    structure
  )) as unknown as HastNode

  const cssPlugin = createCSSPlugin({
    templateStyle: 'html',
    templateChunkName: 'html-template',
    declareDependency: 'import',
    forceScoping: true,
    chunkName: comp.name,
    staticPropReferences: true,
  })

  const result = await cssPlugin({
    uidl: {
      ...comp,
      propDefinitions: propsForInstance,
      stateDefinitions: statesForInstance,
    },
    chunks: [
      {
        type: ChunkType.HAST,
        fileType: FileType.HTML,
        name: DEFAULT_COMPONENT_CHUNK_NAME,
        linkAfter: [],
        content: compTag,
        meta: {
          nodesLookup: lookUpTemplates,
        },
      },
    ],
    dependencies,
    options,
  })

  if (compHasSlots) {
    result.chunks.forEach((chunk) => {
      if (chunk.fileType === FileType.CSS) {
        chunks.push(chunk)
      }
    })
  } else {
    const chunk = chunks.find((item) => item.name === comp.name)
    if (!chunk) {
      const styleChunk = result.chunks.find((item: ChunkDefinition) => item.name === comp.name)
      chunks.push(styleChunk)
    }
  }

  return compTag
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
    if (style.type === 'dynamic' && style.content?.referenceType !== 'token') {
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
  stateDefinitions: Record<string, UIDLStateDefinition>,
  routeDefinitions: UIDLRouteDefinitions
) => {
  Object.keys(attrs).forEach((attrKey) => {
    let attrValue = attrs[attrKey]

    if (
      attrKey === 'href' &&
      attrValue.type === 'static' &&
      typeof attrValue.content === 'string' &&
      attrValue.content.startsWith('/')
    ) {
      attrValue =
        attrValue.content === '/' ||
        attrValue.content ===
          `/${StringUtils.camelCaseToDashCase(
            StringUtils.removeIllegalCharacters(routeDefinitions?.defaultValue || '')
          )}`
          ? staticNode('index.html')
          : staticNode(`${attrValue.content.split('/').pop()}.html`)
      HASTUtils.addAttributeToNode(htmlNode, attrKey, String(attrValue.content))
      return
    }

    if (attrValue.type === 'dynamic') {
      const value =
        attrValue.content.referenceType === 'prop'
          ? getValueFromReference(attrValue.content.id, propDefinitions)
          : getValueFromReference(attrValue.content.id, stateDefinitions)
      HASTUtils.addAttributeToNode(htmlNode, attrKey, String(value))
      return
    }

    if (attrValue.type === 'raw') {
      HASTUtils.addAttributeToNode(htmlNode, attrKey, attrValue.content)
      return
    }

    if (typeof attrValue.content === 'boolean') {
      HASTUtils.addBooleanAttributeToNode(htmlNode, attrKey)
      return
    } else if (typeof attrValue.content === 'string' || typeof attrValue.content === 'number') {
      HASTUtils.addAttributeToNode(htmlNode, attrKey, StringUtils.encode(String(attrValue.content)))
      return
    }
  })
}

const getValueFromReference = (
  key: string,
  definitions: Record<string, UIDLPropDefinition>
): string => {
  const usedReferenceValue = definitions[key.includes('.') ? key.split('.')[0] : key]

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

  if (!['string', 'number', 'object'].includes(usedReferenceValue?.type)) {
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
