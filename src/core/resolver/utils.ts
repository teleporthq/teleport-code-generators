import { prefixPlaygroundAssetsURL, traverseElements } from '../../shared/utils/uidl-utils'
import { ASSETS_IDENTIFIER } from '../../shared/constants'

const STYLE_PROPERTIES_WITH_URL = ['background', 'backgroundImage']

type ElementsLookup = Record<string, { count: number; nextKey: string }>

export const mergeMappings = (oldMapping: Mapping, newMapping?: Mapping) => {
  if (!newMapping) {
    return oldMapping
  }

  return {
    elements: { ...oldMapping.elements, ...newMapping.elements },
    events: { ...oldMapping.events, ...newMapping.events },
  }
}

// This function is taking a content node instance and returned a resolved version of it,
// applying the rules set by the mapping structure passed as a parameter
// The function performs mapping for: attributes, dependencies, repeat, style, events and so on
export const resolveContentNode = (
  uidlNode: UIDLNode,
  mapping: Mapping,
  localDependenciesPrefix: string,
  assetsPrefix?: string
) => {
  const { events: eventsMapping, elements: elementsMapping } = mapping
  traverseElements(uidlNode, (element) => {
    const originalElement = element
    const mappedElement = elementsMapping[originalElement.elementType] || {
      elementType: originalElement.elementType, // identity mapping
    }

    // Setting up the name of the node based on the type, if it is not supplied
    originalElement.name = originalElement.name || originalElement.elementType

    // Mapping the type according to the elements mapping
    originalElement.elementType = mappedElement.elementType

    // If the mapping contains children, insert that structure into the UIDL
    // if (mappedElement.children) {
    //   const originalNodeChildren = originalElement.children || []
    //   node.children = cloneElement(mappedElement.children)
    //   replaceChildrenPlaceholder(node, originalNodeChildren)
    // }

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

    if (originalElement.events && eventsMapping) {
      originalElement.events = resolveEvents(originalElement.events, eventsMapping)
    }

    // Prefix the attributes which may point to local assets
    if (originalElement.attrs && assetsPrefix) {
      Object.keys(originalElement.attrs).forEach((attrKey) => {
        const attrValue = originalElement.attrs[attrKey]
        if (attrValue.type === 'static' && typeof attrValue.content === 'string') {
          originalElement.attrs[attrKey].content = prefixPlaygroundAssetsURL(
            assetsPrefix,
            attrValue.content
          )
        }
      })
    }

    // Merge UIDL attributes to the attributes coming from the mapping object
    if (mappedElement.attrs) {
      originalElement.attrs = mergeAttributes(mappedElement.attrs, originalElement.attrs)
    }

    // The UIDL has priority over the mapping repeat
    // const repeatStructure = node.repeat || mappedElement.repeat
    // if (repeatStructure) {
    //   let dataSource = repeatStructure.dataSource

    //   // We clone the content in case the content node is coming from the mapping to avoid reference leaking
    //   const clonedContent = cloneElement(repeatStructure.content)

    //   // Data source might be preset on a referenced attribute in the uidl node
    //   // ex: attrs[options] in case of a dropdown primitive with select/options
    //   if (dataSource.type === 'dynamic' && dataSource.content.referenceType === 'attr') {
    //     const nodeDataSourceAttr = dataSource.content.id
    //     dataSource = node.attrs[nodeDataSourceAttr]

    //     // remove original attribute so it doesn't get added as a static/dynamic value on the node
    //     delete node.attrs[nodeDataSourceAttr]
    //   }

    //   node.repeat = {
    //     dataSource,
    //     content: clonedContent,
    //     meta: repeatStructure.meta,
    //   }
    // }
  })
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
        // dynamicStyles[styleKey] = styleValue
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
          const startIndex = staticContent.indexOf(ASSETS_IDENTIFIER)
          acc[styleKey] =
            staticContent.slice(0, startIndex) +
            prefixPlaygroundAssetsURL(
              assetsPrefix,
              staticContent.slice(startIndex, staticContent.length)
            )
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

const mergeAttributes = (
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
  uidlDependency?: ComponentDependency,
  localDependenciesPrefix = './'
) => {
  // If dependency is specified at UIDL level it will have priority over the mapping one
  const nodeDependency = uidlDependency || mappedElement.dependency
  if (nodeDependency && nodeDependency.type === 'local') {
    // When a dependency is specified without a path, we infer it is a local import.
    // This might be removed at a later point
    nodeDependency.path = nodeDependency.path || localDependenciesPrefix + mappedElement.elementType
  }

  return nodeDependency
}

// Traverses the content node tree and replaces the $children placeholder with
// the original children of the node being mapped
// const replaceChildrenPlaceholder = (
//   node: ContentNode,
//   originalChildren: Array<ContentNode | string>
// ) => {
//   if (!node.children) {
//     return
//   }

//   const initialValue: Array<ContentNode | string> = []
//   node.children = node.children.reduce((acc, child) => {
//     if (typeof child === 'string') {
//       if (child === '$children') {
//         // When $children is encountered it is replaced by all the children of the original node from the UIDL
//         acc.push(...originalChildren)
//         return acc
//       }

//       // String nodes are just pushed the way they are
//       acc.push(child)
//       return acc
//     }

//     // The child node is pushed after the $children token was replaced
//     replaceChildrenPlaceholder(child, originalChildren)
//     acc.push(child)
//     return acc
//   }, initialValue)
// }

const resolveEvents = (events: EventDefinitions, eventsMapping: Record<string, string>) => {
  const resultedEvents: EventDefinitions = {}
  Object.keys(events).forEach((eventKey) => {
    const resolvedKey = eventsMapping[eventKey] || eventKey
    resultedEvents[resolvedKey] = events[eventKey]
  })

  return resultedEvents
}
