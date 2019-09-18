import {
  prefixAssetsPath,
  traverseElements,
  traverseNodes,
  traverseRepeats,
  cloneObject,
} from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import { ASSETS_IDENTIFIER } from '@teleporthq/teleport-shared/dist/cjs/constants'
import {
  UIDLEventDefinitions,
  UIDLElement,
  UIDLNode,
  UIDLDependency,
  UIDLStyleDefinitions,
  UIDLRepeatContent,
  UIDLAttributeValue,
  Mapping,
  UIDLStateDefinition,
  GeneratorOptions,
  ComponentUIDL,
} from '@teleporthq/teleport-types'
import { camelCaseToDashCase } from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'
import deepmerge from 'deepmerge'

const STYLE_PROPERTIES_WITH_URL = ['background', 'backgroundImage']

type ElementsLookup = Record<string, { count: number; nextKey: string }>

export const mergeMappings = (oldMapping: Mapping, newMapping?: Mapping, deepMerge = false) => {
  if (!newMapping) {
    return oldMapping
  }

  if (deepMerge === true) {
    return deepmerge(oldMapping, newMapping)
  }

  return {
    elements: { ...oldMapping.elements, ...newMapping.elements },
    events: { ...oldMapping.events, ...newMapping.events },
    attributes: { ...oldMapping.attributes, ...newMapping.attributes },
  }
}

// Finds all the navlink elements and converts the content of the transitionTo attribute
// to the actual route value that is defined in the project UIDL, in the routing definition
export const resolveNavlinks = (uidlNode: UIDLNode, routesDefinition: UIDLStateDefinition) => {
  traverseElements(uidlNode, (element) => {
    if (element.elementType === 'navlink') {
      const transitionAttribute = element.attrs.transitionTo
      if (transitionAttribute.type !== 'static') {
        throw new Error(
          `Navlink does not support dynamic 'transitionTo' attributes\n ${JSON.stringify(
            transitionAttribute,
            null,
            2
          )}`
        )
      }

      const transitionState = transitionAttribute.content.toString()
      const transitionRoute = routesDefinition.values.find(
        (route) => route.value === transitionState
      )

      if (transitionState.startsWith('/')) {
        // attribute was explicitly set as a custom navlink
        return
      }

      if (transitionRoute && transitionRoute.pageOptions && transitionRoute.pageOptions.navLink) {
        transitionAttribute.content = transitionRoute.pageOptions.navLink
      } else {
        transitionAttribute.content = `/${transitionState}`
        console.warn(
          `No navlink was defined for router state: '${transitionState}'. Falling back to '${transitionAttribute.content}'`
        )
      }
    }
  })
}

export const resolveMetaTags = (uidl: ComponentUIDL, options: GeneratorOptions) => {
  if (!uidl.seo || !uidl.seo.metaTags || !options.assetsPrefix) {
    return
  }

  uidl.seo.metaTags.forEach((tag) => {
    Object.keys(tag).forEach((key) => {
      tag[key] = prefixAssetsPath(options.assetsPrefix, tag[key])
    })
  })
}

export const resolveNode = (uidlNode: UIDLNode, options: GeneratorOptions) => {
  traverseNodes(uidlNode, (node, parentNode) => {
    if (node.type === 'element') {
      resolveElement(node.content, options)
    }

    if (node.type === 'repeat') {
      resolveRepeat(node.content, parentNode)
    }
  })
}

export const resolveElement = (element: UIDLElement, options: GeneratorOptions) => {
  const { mapping, localDependenciesPrefix, assetsPrefix } = options
  const {
    events: eventsMapping,
    elements: elementsMapping,
    attributes: attributesMapping,
  } = mapping
  const originalElement = element
  const mappedElement = elementsMapping[originalElement.elementType] || {
    elementType: originalElement.elementType, // identity mapping
  }

  // Setting up the name of the node based on the type, if it is not supplied
  originalElement.name = originalElement.name || originalElement.elementType

  // Mapping the type according to the elements mapping
  originalElement.elementType = mappedElement.elementType

  // Resolve dependency with the UIDL having priority
  if (originalElement.dependency || mappedElement.dependency) {
    originalElement.dependency = resolveDependency(
      mappedElement,
      originalElement.dependency,
      localDependenciesPrefix
    )
  }

  // Resolve assets prefix inside style (ex: background-image)
  if (originalElement.style && assetsPrefix) {
    originalElement.style = prefixAssetURLs(originalElement.style, assetsPrefix)
  }

  // Map events separately
  if (originalElement.events && eventsMapping) {
    originalElement.events = resolveEvents(originalElement.events, eventsMapping)
  }

  // Prefix the attributes which may point to local assets
  if (originalElement.attrs && assetsPrefix) {
    Object.keys(originalElement.attrs).forEach((attrKey) => {
      const attrValue = originalElement.attrs[attrKey]
      if (attrValue.type === 'static' && typeof attrValue.content === 'string') {
        originalElement.attrs[attrKey].content = prefixAssetsPath(assetsPrefix, attrValue.content)
      }
    })
  }

  // Merge UIDL attributes to the attributes coming from the mapping object
  if (mappedElement.attrs) {
    originalElement.attrs = resolveAttributes(mappedElement.attrs, originalElement.attrs)
  }

  if (originalElement.attrs && attributesMapping) {
    const attrsKeys = Object.keys(originalElement.attrs)

    attrsKeys
      .filter((key) => attributesMapping[key])
      .forEach((key) => {
        originalElement.attrs[attributesMapping[key]] = originalElement.attrs[key]
        delete originalElement.attrs[key]
      })
  }

  if (mappedElement.children) {
    originalElement.children = resolveChildren(mappedElement.children, originalElement.children)
  }
}

export const resolveChildren = (mappedChildren: UIDLNode[], originalChildren: UIDLNode[] = []) => {
  let newChildren = cloneObject(mappedChildren)

  let placeholderFound = false
  newChildren.forEach((childNode) => {
    traverseNodes(childNode, (node, parentNode) => {
      if (!isPlaceholderNode(node)) {
        return // we're only interested in placeholder nodes
      }

      if (parentNode !== null) {
        if (parentNode.type === 'element') {
          // children nodes can only be added to type 'element'
          // filter out the placeholder node and add the original children instead
          parentNode.content.children = replacePlaceholderNode(
            parentNode.content.children,
            originalChildren
          )
          placeholderFound = true
        }
      } else {
        // when parent is null, we work on the root children array for the given element
        newChildren = replacePlaceholderNode(newChildren, originalChildren)
        placeholderFound = true
      }
    })
  })

  // If a placeholder was found, it was removed and replaced with the original children somewhere inside the newChildren array
  if (placeholderFound) {
    return newChildren
  }

  // If no placeholder was found, newChildren are appended to the original children
  return [...originalChildren, ...newChildren]
}

const isPlaceholderNode = (node: UIDLNode) =>
  node.type === 'dynamic' && node.content.referenceType === 'children'

// Replaces a single occurrence of the placeholder node (referenceType = 'children') with the original children of the element
const replacePlaceholderNode = (nodes: UIDLNode[], insertedNodes: UIDLNode[]) => {
  for (let index = 0; index < nodes.length; index++) {
    if (isPlaceholderNode(nodes[index])) {
      const retValue = [
        ...nodes.slice(0, index),
        ...insertedNodes,
        ...nodes.slice(index + 1, nodes.length),
      ]

      return retValue
    }
  }

  return nodes
}

const resolveRepeat = (repeatContent: UIDLRepeatContent, parentNode: UIDLNode) => {
  const { dataSource } = repeatContent
  if (dataSource.type === 'dynamic' && dataSource.content.referenceType === 'attr') {
    const nodeDataSourceAttr = dataSource.content.id
    const parentElement = parentNode.type === 'element' ? parentNode.content : null

    if (parentElement && parentElement.attrs) {
      repeatContent.dataSource = parentElement.attrs[nodeDataSourceAttr]
      // remove original attribute so it is not added as a static/dynamic value on the node
      delete parentElement.attrs[nodeDataSourceAttr]
    }
  }
}

// Generates an unique key for each node in the UIDL.
// By default it uses the component `name` and in case there are multiple nodes with the same name
// it uses an incremental key which is padded with 0, so it can generate things like:
// container, container1, container2, etc. OR
// container, container01, container02, ... container10, container11,... in case the number is higher
export const generateUniqueKeys = (node: UIDLNode, lookup: ElementsLookup) => {
  traverseElements(node, (element) => {
    // If a certain node name (ex: "container") is present multiple times in the component, it will be counted here
    // NextKey will be appended to the node name to ensure uniqueness inside the component
    const nodeOcurrence = lookup[element.name]

    if (nodeOcurrence.count === 1) {
      // If the name ocurrence is unique we use it as it is
      element.key = element.name
    } else {
      const currentKey = nodeOcurrence.nextKey
      element.key = generateKey(element.name, currentKey)
      nodeOcurrence.nextKey = generateNextIncrementalKey(currentKey)
    }
  })
}

const generateKey = (name: string, key: string): string => {
  const firstOcurrence = parseInt(key, 10) === 0
  return firstOcurrence ? name : name + key
}

const generateNextIncrementalKey = (currentKey: string): string => {
  const nextNumericValue = parseInt(currentKey, 10) + 1
  let returnValue = nextNumericValue.toString()
  while (returnValue.length < currentKey.length) {
    // pad with 0
    returnValue = '0' + returnValue
  }
  return returnValue
}

export const createNodesLookup = (node: UIDLNode, lookup: ElementsLookup) => {
  traverseElements(node, (element) => {
    const elementName = element.name
    if (!lookup[elementName]) {
      lookup[elementName] = {
        count: 0,
        nextKey: '0',
      }
    }

    lookup[elementName].count++
    const newCount = lookup[elementName].count
    if (newCount > 9 && isPowerOfTen(newCount)) {
      // Add a '0' each time we pass a power of ten: 10, 100, 1000, etc.
      // nextKey will start either from: '0', '00', '000', etc.
      lookup[elementName].nextKey = '0' + lookup[elementName].nextKey
    }
  })
}

const isPowerOfTen = (value: number) => {
  while (value > 9 && value % 10 === 0) {
    value /= 10
  }

  return value === 1
}

export const ensureDataSourceUniqueness = (node: UIDLNode) => {
  let index = 0

  traverseRepeats(node, (repeat) => {
    if (repeat.dataSource.type === 'static' && !customDataSourceIdentifierExists(repeat)) {
      repeat.meta = repeat.meta || {}
      repeat.meta.dataSourceIdentifier = index === 0 ? 'items' : `items${index}`
      index += 1
    }
  })
}

const customDataSourceIdentifierExists = (repeat: UIDLRepeatContent) => {
  return !!(repeat.meta && repeat.meta.dataSourceIdentifier)
}

/**
 * Prefixes all urls inside the style object with the assetsPrefix
 * @param style the style object on the current node
 * @param assetsPrefix a string representing the asset prefix
 */
const prefixAssetURLs = (
  style: UIDLStyleDefinitions,
  assetsPrefix: string
): UIDLStyleDefinitions => {
  // iterate through all the style keys
  return Object.keys(style).reduce((acc, styleKey) => {
    const styleValue = style[styleKey]

    switch (styleValue.type) {
      case 'dynamic':
        acc[styleKey] = styleValue
        return acc
      case 'static':
        const staticContent = styleValue.content
        if (typeof staticContent === 'number') {
          acc[styleKey] = styleValue
          return acc
        }

        if (
          typeof staticContent === 'string' &&
          STYLE_PROPERTIES_WITH_URL.includes(styleKey) &&
          staticContent.includes(ASSETS_IDENTIFIER)
        ) {
          // split the string at the beginning of the ASSETS_IDENTIFIER string
          const startIndex = staticContent.indexOf(ASSETS_IDENTIFIER) - 1 // account for the leading '/'
          acc[styleKey] =
            staticContent.slice(0, startIndex) +
            prefixAssetsPath(assetsPrefix, staticContent.slice(startIndex, staticContent.length))
        } else {
          acc[styleKey] = styleValue
        }
        return acc
      case 'nested-style':
        acc[styleKey] = styleValue
        acc[styleKey].content = prefixAssetURLs(styleValue.content, assetsPrefix)
        return acc
    }

    return acc
  }, {})
}

const resolveAttributes = (
  mappedAttrs: Record<string, UIDLAttributeValue>,
  uidlAttrs: Record<string, UIDLAttributeValue>
) => {
  // We gather the results here uniting the mapped attributes and the uidl attributes.
  const resolvedAttrs: Record<string, UIDLAttributeValue> = {}

  // This will gather all the attributes from the UIDL which are mapped using the elements-mapping
  // These attributes will not be added on the tag as they are, but using the elements-mapping
  // Such an example is the url attribute on the Link tag, which needs to be mapped in the case of html to href
  const mappedAttributes: string[] = []
  // First we iterate through the mapping attributes and we add them to the result
  Object.keys(mappedAttrs).forEach((key) => {
    const attrValue = mappedAttrs[key]
    if (!attrValue) {
      return
    }

    if (attrValue.type === 'dynamic' && attrValue.content.referenceType === 'attr') {
      // we lookup for the attributes in the UIDL and use the element-mapping key to set them on the tag
      // ex: Link has an 'url' attribute in the UIDL, but it needs to be mapped to 'href' in the case of HTML
      const uidlAttributeKey = attrValue.content.id
      if (uidlAttrs && uidlAttrs[uidlAttributeKey]) {
        resolvedAttrs[key] = uidlAttrs[uidlAttributeKey]
        mappedAttributes.push(uidlAttributeKey)
      }

      return
    }

    resolvedAttrs[key] = mappedAttrs[key]
  })

  // The UIDL attributes can override the mapped attributes, so they come last
  if (uidlAttrs) {
    Object.keys(uidlAttrs).forEach((key) => {
      // Skip the attributes that were mapped as referenceType = 'attr'
      if (!mappedAttributes.includes(key)) {
        resolvedAttrs[key] = uidlAttrs[key]
      }
    })
  }

  return resolvedAttrs
}

const resolveDependency = (
  mappedElement: UIDLElement,
  uidlDependency?: UIDLDependency,
  localDependenciesPrefix = './'
) => {
  // If dependency is specified at UIDL level it will have priority over the mapping one
  const nodeDependency = uidlDependency || mappedElement.dependency
  if (nodeDependency && nodeDependency.type === 'local') {
    // When a dependency is specified without a path, we infer it is a local import.

    // ex: PrimaryButton component should be written in a file called primary-button
    const componentName = mappedElement.elementType
    const componentFileName = camelCaseToDashCase(componentName)

    // concatenate a trailing slash in case it's missing
    if (localDependenciesPrefix[localDependenciesPrefix.length - 1] !== '/') {
      localDependenciesPrefix = localDependenciesPrefix + '/'
    }

    nodeDependency.path = nodeDependency.path || localDependenciesPrefix + componentFileName
  }

  return nodeDependency
}

const resolveEvents = (events: UIDLEventDefinitions, eventsMapping: Record<string, string>) => {
  const resultedEvents: UIDLEventDefinitions = {}
  Object.keys(events).forEach((eventKey) => {
    const resolvedKey = eventsMapping[eventKey] || eventKey
    resultedEvents[resolvedKey] = events[eventKey]
  })

  return resultedEvents
}
