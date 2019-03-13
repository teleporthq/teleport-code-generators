import {
  ContentNode,
  ComponentDependency,
  StyleDefinitions,
  ElementsMapping,
  ElementMapping,
} from '../../uidl-definitions/types'

import {
  prefixPlaygroundAssetsURL,
  cloneElement,
  traverseNodes,
} from '../../shared/utils/uidl-utils'
import { ASSETS_IDENTIFIER } from '../../shared/constants'

const STYLE_PROPERTIES_WITH_URL = ['background', 'backgroundImage']

type ContentNodesLookup = Record<string, { count: number; nextKey: string }>

export const resolveContentNode = (
  content: ContentNode,
  elementsMapping: ElementsMapping,
  localDependenciesPrefix: string,
  assetsPrefix?: string
) => {
  traverseNodes(content, (node) => {
    const mappedElement = elementsMapping[node.type] || { type: node.type }

    // Setting up the name of the node based on the type, if it is not supplied
    node.name = node.name || node.type

    // Mapping the type according to the elements mapping
    node.type = mappedElement.type

    // If the mapping contains children, insert that structure into the UIDL
    if (mappedElement.children) {
      const originalNodeChildren = node.children || []
      node.children = cloneElement(mappedElement.children)
      replaceChildrenPlaceholder(node, originalNodeChildren)
    }

    // Resolve dependency with the UIDL having priority
    if (node.dependency || mappedElement.dependency) {
      node.dependency = resolveDependency(mappedElement, node.dependency, localDependenciesPrefix)
    }

    // Resolve assets prefix inside style (ex: background-image)
    if (node.style && assetsPrefix) {
      node.style = prefixAssetURLs(node.style, assetsPrefix)
    }

    // Prefix the attributes which may point to local assets
    if (node.attrs && assetsPrefix) {
      Object.keys(node.attrs).forEach((attrKey) => {
        if (typeof node.attrs[attrKey] === 'string') {
          node.attrs[attrKey] = prefixPlaygroundAssetsURL(assetsPrefix, node.attrs[attrKey])
        }
      })
    }

    // Merge UIDL attributes to the attributes coming from the mapping object
    if (mappedElement.attrs) {
      node.attrs = mergeAttributes(mappedElement.attrs, node.attrs)
    }

    // The UIDL has priority over the mapping repeat
    const repeatStructure = node.repeat || mappedElement.repeat
    if (repeatStructure) {
      let dataSource = repeatStructure.dataSource

      // We clone the content in case the content node is coming from the mapping to avoid reference leaking
      const clonedContent = cloneElement(repeatStructure.content)

      // Data source might be preset on a referenced attribute in the uidl node
      // ex: attrs[options] in case of a dropdown primitive with select/options
      if (typeof dataSource === 'string' && dataSource.startsWith('$attrs.') && node.attrs) {
        const nodeDataSourceAttr = dataSource.replace('$attrs.', '')
        dataSource = node.attrs[nodeDataSourceAttr]
      }

      node.repeat = {
        dataSource,
        content: clonedContent,
      }
    }
  })
}

// Generates an unique key for each node in the UIDL.
// By default it uses the component `name` and in case there are multiple nodes with the same name
// it uses an incremental key which is padded with 0, so it can generate things like:
// container, container1, container2, etc. OR
// container, container01, container02, ... container10, container11,... in case the number is higher
export const generateUniqueKeys = (content: ContentNode, nodesLookup: ContentNodesLookup) => {
  traverseNodes(content, (node) => {
    // skip generating keys for the state nodes
    if (node.type === 'state') {
      return
    }

    // If a certain node name (ex: "container") is present multiple times in the component, it will be counted here
    // NextKey will be appended to the node name to ensure uniqueness inside the component
    const nodeOcurrence = nodesLookup[node.name]

    if (nodeOcurrence.count === 1) {
      // If the name ocurrence is unique we use it as it is
      node.key = node.name
    } else {
      const currentKey = nodeOcurrence.nextKey
      node.key = generateKey(node.name, currentKey)
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

export const createNodesLookup = (content: ContentNode, lookup: ContentNodesLookup) => {
  traverseNodes(content, (node) => {
    // we don't add state names in the lookup
    if (node.type === 'state') {
      return
    }

    const nodeName = node.name
    if (!lookup[nodeName]) {
      lookup[nodeName] = {
        count: 0,
        nextKey: '0',
      }
    }

    lookup[nodeName].count++
    const newCount = lookup[nodeName].count
    if (newCount > 9 && isPowerOfTen(newCount)) {
      // Add a '0' each time we pass a power of ten: 10, 100, 1000, etc.
      // nextKey will start either from: '0', '00', '000', etc.
      lookup[nodeName].nextKey = '0' + lookup[nodeName].nextKey
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
const prefixAssetURLs = (style: StyleDefinitions, assetsPrefix: string): StyleDefinitions => {
  // iterate through all the style keys
  return Object.keys(style).reduce((acc, styleKey) => {
    const styleValue = style[styleKey]

    // when objects are encountered, go recursively (ex: media queries, hover)
    if (typeof styleValue === 'object') {
      acc[styleKey] = prefixAssetURLs(styleValue, assetsPrefix)
      return acc
    }

    // number values are ignored
    if (typeof styleValue === 'number') {
      acc[styleKey] = styleValue
      return acc
    }

    // only whitelisted style properties are checked
    if (STYLE_PROPERTIES_WITH_URL.includes(styleKey) && styleValue.includes(ASSETS_IDENTIFIER)) {
      // split the string at the beginning of the ASSETS_IDENTIFIER string
      const startIndex = styleValue.indexOf(ASSETS_IDENTIFIER)
      acc[styleKey] =
        styleValue.slice(0, startIndex) +
        prefixPlaygroundAssetsURL(assetsPrefix, styleValue.slice(startIndex, styleValue.length))
    } else {
      acc[styleKey] = styleValue
    }

    return acc
  }, {})
}

const mergeAttributes = (mappedAttrs: Record<string, any>, uidlAttrs: Record<string, any>) => {
  // We gather the results here uniting the mapped attributes and the uidl attributes.
  const resolvedAttrs: Record<string, any> = {}

  // This will gather all the attributes from the UIDL which are mapped using the elements-mapping
  // These attributes will not be added on the tag as they are, but using the elements-mapping
  // Such an example is the url attribute on the Link tag, which needs to be mapped in the case of html to href
  const mappedAttributes: string[] = []

  // First we iterate through the mapping attributes and we add them to the result
  Object.keys(mappedAttrs).forEach((key) => {
    const value = mappedAttrs[key]
    if (!value) {
      return
    }

    if (typeof value === 'string' && value.startsWith('$attrs.')) {
      // we lookup for the attributes in the UIDL and use the element-mapping key to set them on the tag
      // (ex: Link has an url attribute in the UIDL, but it needs to be mapped to href in the case of HTML)
      const uidlAttributeKey = value.replace('$attrs.', '')
      if (uidlAttrs && uidlAttrs[uidlAttributeKey]) {
        resolvedAttrs[key] = uidlAttrs[uidlAttributeKey]
        mappedAttributes.push(uidlAttributeKey)
      }

      // in the case of mapped reference attributes ($attrs) we don't write them unless they are specified in the uidl
      return
    }

    resolvedAttrs[key] = mappedAttrs[key]
  })

  // The UIDL attributes can override the mapped attributes, so they come last
  if (uidlAttrs) {
    Object.keys(uidlAttrs).forEach((key) => {
      // Skip the attributes that were mapped from $attrs
      if (!mappedAttributes.includes(key)) {
        resolvedAttrs[key] = uidlAttrs[key]
      }
    })
  }

  return resolvedAttrs
}

const resolveDependency = (
  mappedElement: ElementMapping,
  uidlDependency?: ComponentDependency,
  localDependenciesPrefix = './'
) => {
  // If dependency is specified at UIDL level it will have priority over the mapping one
  const nodeDependency = uidlDependency || mappedElement.dependency
  if (nodeDependency && nodeDependency.type === 'local') {
    // When a dependency is specified without a path, we infer it is a local import.
    // This might be removed at a later point
    nodeDependency.path = nodeDependency.path || localDependenciesPrefix + mappedElement.type
  }

  return nodeDependency
}

// Traverses the content node tree and replaces the $children placeholder with
// the original children of the node being mapped
const replaceChildrenPlaceholder = (
  node: ContentNode,
  originalChildren: Array<ContentNode | string>
) => {
  if (!node.children) {
    return
  }

  const initialValue: Array<ContentNode | string> = []
  node.children = node.children.reduce((acc, child) => {
    if (typeof child === 'string') {
      if (child === '$children') {
        // When $children is encountered it is replaced by all the children of the original node from the UIDL
        acc.push(...originalChildren)
        return acc
      }

      // String nodes are just pushed the way they are
      acc.push(child)
      return acc
    }

    // The child node is pushed after the $children token was replaced
    replaceChildrenPlaceholder(child, originalChildren)
    acc.push(child)
    return acc
  }, initialValue)
}
