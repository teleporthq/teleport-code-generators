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
  ComponentPlugin,
  ComponentStructure,
  UIDLComponentOutputOptions,
  UIDLElement,
} from '@teleporthq/teleport-types'
import { join, relative } from 'path'
import { HASTBuilders, HASTUtils } from '@teleporthq/teleport-plugin-common'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { staticNode } from '@teleporthq/teleport-uidl-builders'
import { createCSSPlugin } from '@teleporthq/teleport-plugin-css'
import { DEFAULT_COMPONENT_CHUNK_NAME } from './constants'

const isValidURL = (url: string) => {
  try {
    /* tslint:disable:no-unused-expression */
    new URL(url)
    return true
  } catch (error) {
    return false
  }
}

type NodeToHTML<NodeType, ReturnType> = (
  node: NodeType,
  nodesLookup: Record<string, HastNode | HastText>,
  propDefinitions: Record<string, UIDLPropDefinition>,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  subComponentOptions: {
    externals: Record<string, ComponentUIDL>
    plugins: ComponentPlugin[]
  },
  structure: {
    chunks: ChunkDefinition[]
    dependencies: Record<string, UIDLDependency>
    options: GeneratorOptions
    outputOptions: UIDLComponentOutputOptions
  }
) => ReturnType

export const generateHtmlSyntax: NodeToHTML<UIDLNode, Promise<HastNode | HastText>> = async (
  node,
  nodesLookup,
  propDefinitions,
  stateDefinitions,
  subComponentOptions,
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
      const elementNode = await generateElementNode(
        node,
        nodesLookup,
        propDefinitions,
        stateDefinitions,
        subComponentOptions,
        structure
      )
      return elementNode

    case 'dynamic':
      const dynamicNode = await generateDynamicNode(
        node,
        nodesLookup,
        propDefinitions,
        stateDefinitions,
        subComponentOptions,
        structure
      )

      return dynamicNode

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

const generateElementNode: NodeToHTML<UIDLElementNode, Promise<HastNode | HastText>> = async (
  node,
  nodesLookup,
  propDefinitions,
  stateDefinitions,
  subComponentOptions,
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
  const { dependencies } = structure
  if (dependency && (dependency as UIDLDependency)?.type !== 'local') {
    dependencies[dependency.path] = dependency
  }

  if (dependency && (dependency as UIDLDependency)?.type === 'local') {
    for (const attrKey of Object.keys(attrs)) {
      const attr = attrs[attrKey]
      if (attr.type === 'element') {
        await generateElementNode(
          attr,
          nodesLookup,
          propDefinitions,
          stateDefinitions,
          subComponentOptions,
          structure
        )
      }
    }

    const compTag = await generateComponentContent(
      node,
      nodesLookup,
      propDefinitions,
      stateDefinitions,
      subComponentOptions,
      structure
    )

    return compTag
  }

  const elementNode = HASTBuilders.createHTMLNode(elementType)

  if (children) {
    for (const child of children) {
      const childTag = await generateHtmlSyntax(
        child,
        nodesLookup,
        propDefinitions,
        stateDefinitions,
        subComponentOptions,
        structure
      )

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

  handleAttributes(
    elementType,
    elementNode,
    attrs,
    propDefinitions,
    stateDefinitions,
    structure.options.projectRouteDefinition,
    structure.outputOptions
  )

  nodesLookup[key] = elementNode
  return elementNode
}

const generateComponentContent = async (
  node: UIDLElementNode,
  nodesLookup: Record<string, HastNode | HastText>,
  propDefinitions: Record<string, UIDLPropDefinition>,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  subComponentOptions: {
    externals: Record<string, ComponentUIDL>
    plugins: ComponentPlugin[]
  },
  structure: {
    chunks: ChunkDefinition[]
    dependencies: Record<string, UIDLDependency>
    options: GeneratorOptions
    outputOptions: UIDLComponentOutputOptions
  }
) => {
  const { externals, plugins } = subComponentOptions
  const { elementType, attrs = {}, key, children = [] } = node.content
  const { dependencies, chunks = [], options } = structure
  // "Component" will not exist when generating a component because the resolver checks for illegal class names
  const compName = elementType === 'Component' ? 'AppComponent' : elementType
  const component = externals[compName]
  if (component === undefined) {
    throw new HTMLComponentGeneratorError(`${compName} is missing from externals object`)
  }

  const componentClone = UIDLUtils.cloneObject(component) as ComponentUIDL
  let compHasSlots: boolean = false

  if (children.length) {
    compHasSlots = true
    UIDLUtils.traverseNodes(componentClone.node, (childNode, parentNode) => {
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

  const combinedProps = { ...propDefinitions, ...(componentClone?.propDefinitions || {}) }
  const propsForInstance: Record<string, UIDLPropDefinition> = {}

  for (const propKey of Object.keys(combinedProps)) {
    // If the attribute is a named-slot, then we can directly pass the value instead of just the content
    if (attrs[propKey]?.type === 'element') {
      propsForInstance[propKey] = {
        ...combinedProps[propKey],
        defaultValue: attrs[propKey],
      }
    } else if (attrs[propKey]) {
      propsForInstance[propKey] = {
        ...combinedProps[propKey],
        defaultValue: attrs[propKey]?.content || combinedProps[propKey]?.defaultValue,
      }
    } else {
      propsForInstance[propKey] = combinedProps[propKey]
    }
  }

  const combinedStates = { ...stateDefinitions, ...(componentClone?.stateDefinitions || {}) }
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

  let componentWrapper = StringUtils.camelCaseToDashCase(`${compName}-wrapper`)
  const isExistingNode = nodesLookup[componentWrapper]
  if (isExistingNode !== undefined) {
    componentWrapper = `${componentWrapper}-${StringUtils.generateRandomString()}`
  }

  const componentInstanceToGenerate: UIDLElementNode = {
    type: 'element',
    content: {
      elementType: componentWrapper,
      key: componentWrapper,
      children: [componentClone.node],
      style: {
        display: {
          type: 'static',
          content: 'contents',
        },
      },
    },
  }

  const compTag = await generateHtmlSyntax(
    componentInstanceToGenerate,
    nodesLookup,
    propsForInstance,
    statesForInstance,
    subComponentOptions,
    structure
  )

  const cssPlugin = createCSSPlugin({
    templateStyle: 'html',
    templateChunkName: DEFAULT_COMPONENT_CHUNK_NAME,
    declareDependency: 'import',
    forceScoping: true,
    chunkName: componentClone.name,
    staticPropReferences: true,
  })

  const initialStructure: ComponentStructure = {
    uidl: {
      ...componentClone,
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
          nodesLookup,
        },
      },
    ],
    dependencies,
    options,
  }

  const result = await [cssPlugin, ...plugins].reduce(
    async (previousPluginOperation: Promise<ComponentStructure>, plugin) => {
      const modifiedStructure = await previousPluginOperation
      return plugin(modifiedStructure)
    },
    Promise.resolve(initialStructure)
  )

  if (compHasSlots) {
    result.chunks.forEach((chunk) => {
      if (chunk.fileType === FileType.CSS) {
        chunks.push(chunk)
      }
    })
  } else {
    const chunk = chunks.find((item) => item.name === componentClone.name)
    if (!chunk) {
      const styleChunk = result.chunks.find(
        (item: ChunkDefinition) => item.fileType === FileType.CSS
      )
      if (!styleChunk) {
        return
      }
      chunks.push(styleChunk)
    }
  }

  nodesLookup[key] = compTag
  return compTag
}

const generateDynamicNode: NodeToHTML<UIDLDynamicReference, Promise<HastNode>> = async (
  node,
  nodesLookup,
  propDefinitions,
  stateDefinitions,
  subComponentOptions,
  structure
): Promise<HastNode> => {
  const usedReferenceValue = getValueFromReference(
    node.content.id,
    node.content.referenceType === 'prop' ? propDefinitions : stateDefinitions
  )

  if (usedReferenceValue.type === 'element' && usedReferenceValue.defaultValue) {
    const slotNode = await generateElementNode(
      usedReferenceValue.defaultValue as UIDLElementNode,
      nodesLookup,
      propDefinitions,
      stateDefinitions,
      subComponentOptions,
      structure
    )

    return slotNode as HastNode
  }

  if (usedReferenceValue.type === 'element' && usedReferenceValue.defaultValue === undefined) {
    const spanTagWrapper = HASTBuilders.createHTMLNode('span')
    const commentNode = HASTBuilders.createComment(`Content for slot ${node.content.id}`)
    HASTUtils.addChildNode(spanTagWrapper, commentNode)
    return spanTagWrapper
  }

  const spanTag = HASTBuilders.createHTMLNode('span')
  HASTUtils.addTextNode(spanTag, String(usedReferenceValue.defaultValue))
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
      const referencedValue = getValueFromReference(
        style.content.id,
        style.content.referenceType === 'prop' ? propDefinitions : stateDefinitions
      )
      if (referencedValue.type === 'string' || referencedValue.type === 'number') {
        style = String(referencedValue.defaultValue)
      }
      node.content.style[styleKey] = typeof style === 'string' ? staticNode(style) : style
    }
  })
}

const handleAttributes = (
  elementType: UIDLElement['elementType'],
  htmlNode: HastNode,
  attrs: Record<string, UIDLAttributeValue>,
  propDefinitions: Record<string, UIDLPropDefinition>,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  routeDefinitions: UIDLRouteDefinitions,
  outputOptions: UIDLComponentOutputOptions
) => {
  for (const attrKey of Object.keys(attrs)) {
    const attrValue = attrs[attrKey]
    const { type, content } = attrValue

    switch (type) {
      case 'static': {
        if (attrKey === 'href' && typeof content === 'string' && content.startsWith('/')) {
          let targetLink

          const targetRoute = (routeDefinitions?.values || []).find(
            (route) => route.pageOptions.navLink === content
          )

          if (targetRoute) {
            targetLink = targetRoute.pageOptions.navLink
          }

          if (!targetRoute && content === '/home') {
            targetLink = '/'
          }

          if (!targetLink && !targetRoute) {
            targetLink = content
          }

          const currentPageRoute = join(...(outputOptions?.folderPath || []), './')
          const localPrefix = relative(
            `/${currentPageRoute}`,
            `/${targetLink === '/' ? 'index' : targetLink}`
          )

          HASTUtils.addAttributeToNode(htmlNode, attrKey, `${localPrefix}.html`)
          break
        }

        if (typeof content === 'boolean') {
          htmlNode.properties[attrKey] = content === true ? 'true' : 'false'
        } else if (typeof content === 'string' || typeof attrValue.content === 'number') {
          let value = StringUtils.encode(String(attrValue.content))

          /*
            elementType of image is always mapped to img.
            For reference, check `html-mapping` file.
          */
          if (elementType === 'img' && attrKey === 'src' && !isValidURL(value)) {
            /*
              By default we just prefix all the asset paths with just the
              assetPrefix that is configured in the project. But for `html` generators
              we need to prefix that with the current file location.

              Because, all the other frameworks have a build setup. which serves all the
              assets from the `public` folder. But in the case of `html` here is how it works

              We load a file from `index.html` the request for the image goes from
              '...url.../public/...image...'
              If it's a nested url, then the request goes from
              '...url/nested/public/...image..'

              But the nested folder is available only on the root. With this
              The url changes prefixes to

              ../public/playground_assets/..image.. etc depending on the dept the file is in.
            */
            value = join(relative(join(...outputOptions.folderPath), './'), value)
          }

          HASTUtils.addAttributeToNode(htmlNode, attrKey, value)
        }

        break
      }

      case 'dynamic': {
        const value = getValueFromReference(
          content.id,
          content.referenceType === 'prop' ? propDefinitions : stateDefinitions
        )

        HASTUtils.addAttributeToNode(htmlNode, attrKey, String(value.defaultValue))
        break
      }

      case 'raw': {
        HASTUtils.addAttributeToNode(htmlNode, attrKey, content)
        break
      }

      case 'element':
      case 'import':
      case 'expr':
        break

      default: {
        throw new HTMLComponentGeneratorError(
          `Received ${JSON.stringify(attrValue, null, 2)} \n in handleAttributes for html`
        )
      }
    }
  }
}

const getValueFromReference = (
  key: string,
  definitions: Record<string, UIDLPropDefinition>
): UIDLPropDefinition | undefined => {
  const usedReferenceValue = definitions[key.includes('.') ? key.split('.')[0] : key]

  if (!usedReferenceValue) {
    throw new HTMLComponentGeneratorError(
      `Definition for ${key} is missing from ${JSON.stringify(definitions, null, 2)}`
    )
  }

  if (['string', 'number', 'object', 'element'].includes(usedReferenceValue?.type) === false) {
    throw new HTMLComponentGeneratorError(
      `Attribute is using dynamic value, but received of type ${JSON.stringify(
        usedReferenceValue,
        null,
        2
      )}`
    )
  }

  if (
    usedReferenceValue.type !== 'element' &&
    usedReferenceValue.hasOwnProperty('defaultValue') === false
  ) {
    throw new HTMLComponentGeneratorError(
      `Default value is missing from dynamic reference - ${JSON.stringify(
        usedReferenceValue,
        null,
        2
      )}`
    )
  }

  return usedReferenceValue
}
