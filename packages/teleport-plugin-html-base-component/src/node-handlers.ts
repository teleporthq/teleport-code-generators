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
  ElementsLookup,
} from '@teleporthq/teleport-types'
import { join, relative } from 'path'
import { HASTBuilders, HASTUtils } from '@teleporthq/teleport-plugin-common'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { staticNode } from '@teleporthq/teleport-uidl-builders'
import { createCSSPlugin } from '@teleporthq/teleport-plugin-css'
import { generateUniqueKeys, createNodesLookup } from '@teleporthq/teleport-uidl-resolver'
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

const addNodeToLookup = (
  node: UIDLElementNode,
  tag: HastNode | HastText,
  nodesLoookup: Record<string, HastNode | HastText>,
  hierarchy: string[] = []
) => {
  // In html code-generation we combine the nodes of the component that is being consumed with the current component.
  // As html can't load the component at runtime like react or any other frameworks. So, we merge the component as a standalone
  // component in the current component.
  if (nodesLoookup[node.content.key]) {
    throw new HTMLComponentGeneratorError(
      `\n${hierarchy.join(' -> ')} \n
Duplicate key found in nodesLookup: ${node.content.key} \n

A node with the same key already exists\n
Received \n\n ${JSON.stringify(tag)}\n ${JSON.stringify(node)}
Existing \n\n ${JSON.stringify(nodesLoookup[node.content.key])} \n\n`
    )
  }

  nodesLoookup[node.content.key] = tag
}

type NodeToHTML<NodeType, ReturnType> = (
  node: NodeType,
  componentName: string,
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
  compName,
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
        compName,
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
        compName,
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
  compName,
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
  } = node.content
  const { dependencies } = structure
  if (dependency && (dependency as UIDLDependency)?.type !== 'local') {
    dependencies[dependency.path] = dependency
  }

  if (dependency && (dependency as UIDLDependency)?.type === 'local') {
    if (nodesLookup[node.content.key]) {
      return nodesLookup[node.content.key]
    }

    const compTag = await generateComponentContent(
      node,
      compName,
      nodesLookup,
      propDefinitions,
      stateDefinitions,
      subComponentOptions,
      structure
    )

    if ('tagName' in compTag) {
      compTag.children.unshift(HASTBuilders.createComment(`${node.content.semanticType} component`))
    }

    return compTag
  }

  const elementNode = HASTBuilders.createHTMLNode(elementType)

  if (children) {
    for (const child of children) {
      const childTag = await generateHtmlSyntax(
        child,
        compName,
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

  addNodeToLookup(node, elementNode, nodesLookup, [compName])
  return elementNode
}

const createLookupTable = (
  component: ComponentUIDL,
  nodesLookup: Record<string, HastNode | HastText>
): ElementsLookup => {
  const lookup: ElementsLookup = {}
  for (const node of Object.keys(nodesLookup)) {
    lookup[node] = {
      count: 1,
      nextKey: '1',
    }
  }
  createNodesLookup(component, lookup)
  return lookup
}

const generateComponentContent = async (
  node: UIDLElementNode,
  compName: string,
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
  const { elementType, attrs = {}, children = [] } = node.content
  const { dependencies, chunks = [], options } = structure
  // "Component" will not exist when generating a component because the resolver checks for illegal class names
  const componentName = elementType === 'Component' ? 'AppComponent' : elementType
  const component = externals[componentName]
  if (component === undefined) {
    throw new HTMLComponentGeneratorError(`${componentName} is missing from externals object`)
  }

  const componentClone = UIDLUtils.cloneObject<ComponentUIDL>(component)

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
              name: componentClone.name + 'slot',
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

  // In UIDL, we define only the link between a component and a page.
  // We define this link using the UIDLLocalDependency approach.
  // So, during the page resolution step, where we ideally generate the unique keys for the components.
  // We can't generate the unique keys for the components because we don't have the full UIDL of the component.
  // When we are using components in a page, the `addExternalComponents` step of the
  // html-component-generator will add the full UIDL of the component to the externals object after resolving them.
  // But when a component is used multiple number of times, we are basically using the same nodes again and again.
  // Which indivates duplication. So, we create a lookup table of all the nodes present with us in the page
  // And then pass it to the component to avoid any coilissions.
  const lookupTableForCurrentPage = createLookupTable(componentClone, nodesLookup)
  generateUniqueKeys(componentClone, lookupTableForCurrentPage)

  // We are combining props of the current component
  // with props of the component that we need to generate.
  // Refer to line 309, for element props. We either pick from the attr of the current instance of component
  // or from the propDefinitions of the component that we are generating.
  // We don't need to keep passing the props of the current component to the child component and so on
  // for the case of element nodes in attributes or propDefinitions.
  const combinedProps: Record<string, UIDLPropDefinition> = {
    ...Object.keys(propDefinitions).reduce<Record<string, UIDLPropDefinition>>(
      (acc: Record<string, UIDLPropDefinition>, propKey) => {
        if (propDefinitions[propKey]?.type === 'element') {
          return acc
        }
        acc[propKey] = propDefinitions[propKey]
        return acc
      },
      {}
    ),
    ...(componentClone?.propDefinitions || {}),
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

  const propsForInstance: Record<string, UIDLPropDefinition> = {}
  // this is where we check if the component we are conusming is actually passing any props to the instance.
  // We check if we are passing any props and pick the value from the atrrs, if not we pick the value from the propDefinitions of
  // the component instance that we are using here.
  for (const propKey of Object.keys(combinedProps)) {
    const prop = attrs[propKey]
    if (prop?.type === 'element') {
      propsForInstance[propKey] = {
        ...combinedProps[propKey],
        defaultValue: attrs[propKey],
      }
      await generateHtmlSyntax(
        attrs[propKey] as UIDLElementNode,
        component.name,
        nodesLookup,
        propDefinitions,
        stateDefinitions,
        subComponentOptions,
        structure
      )
    } else if (prop?.type === 'dynamic') {
      // When we are using a component instance in a component and the attribute
      // that is passed to the component is of dynamic reference.
      // If means, the component is redirecting the prop that is received to the prop of the component that it is consuming.
      // In this case, we need to pass the value of the prop that is received to the prop of the component that it is consuming.
      // And similary we do the same for the states.
      switch (prop.content.referenceType) {
        case 'prop':
          propsForInstance[propKey] = combinedProps[propKey]
          break
        case 'state':
          propsForInstance[propKey] = combinedStates[propKey]
          break
        default:
          throw new Error(
            `ReferenceType ${prop.content.referenceType} is not supported in HTML Export.`
          )
      }
    } else if (prop) {
      propsForInstance[propKey] = {
        ...combinedProps[propKey],
        defaultValue: attrs[propKey]?.content || combinedProps[propKey]?.defaultValue,
      }
    } else {
      const propFromCurrentComponent = combinedProps[propKey]
      if (propFromCurrentComponent.type === 'element' && propFromCurrentComponent.defaultValue) {
        await generateHtmlSyntax(
          propFromCurrentComponent.defaultValue as UIDLElementNode,
          component.name,
          nodesLookup,
          propDefinitions,
          stateDefinitions,
          subComponentOptions,
          structure
        )
      }
      propsForInstance[propKey] = propFromCurrentComponent
    }
  }

  let componentWrapper = StringUtils.camelCaseToDashCase(`${componentName}-wrapper`)
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
    component.name,
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
    chunkName: componentClone.name,
    staticPropReferences: true,
  })

  const initialStructure: ComponentStructure = {
    uidl: {
      ...componentClone,
      node: componentInstanceToGenerate,
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

  addNodeToLookup(node, compTag, nodesLookup, [compName, component.name])
  return compTag
}

const generateDynamicNode: NodeToHTML<UIDLDynamicReference, Promise<HastNode | HastText>> = async (
  node,
  /* tslint:disable variable-name */
  _compName,
  nodesLookup,
  propDefinitions,
  stateDefinitions
): Promise<HastNode | HastText> => {
  const usedReferenceValue = getValueFromReference(
    node.content.id,
    node.content.referenceType === 'prop' ? propDefinitions : stateDefinitions
  )

  if (usedReferenceValue.type === 'element' && usedReferenceValue.defaultValue) {
    const elementNode = usedReferenceValue.defaultValue as UIDLElementNode

    if (elementNode.content.key in nodesLookup) {
      return nodesLookup[elementNode.content.key]
    }

    const spanTagWrapper = HASTBuilders.createHTMLNode('span')
    const commentNode = HASTBuilders.createComment(`Content for slot ${node.content.id}`)
    HASTUtils.addChildNode(spanTagWrapper, commentNode)
    return spanTagWrapper
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
