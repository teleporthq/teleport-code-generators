import {
  ContentNode,
  ComponentDependency,
  StyleDefinitions,
  ElementsMapping,
  ElementMapping,
} from '../../../uidl-definitions/types'

const prefixAssetURLs = (styles: StyleDefinitions, assetsPrefix: string): StyleDefinitions => {
  const whitelistStyleProperties = ['background', 'backgroundImage']

  // iterate through all the style keys
  return Object.keys(styles).reduce((acc, styleKey) => {
    const styleValue = styles[styleKey]

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
    if (whitelistStyleProperties.includes(styleKey) && styleValue.includes('url("')) {
      // position index after the double quotes to introduce the url prefix before
      const startIndex = styleValue.indexOf('url("') + 5
      acc[styleKey] =
        styleValue.slice(0, startIndex) +
        prefixRelativeURL(assetsPrefix, styleValue.slice(startIndex, styleValue.length - 1))
    } else {
      acc[styleKey] = styleValue
    }

    return acc
  }, {})
}

/**
 * Concatenates the prefix to the URL string.
 * If the url starts with 'http', the return value will be the 'originalString'
 * If the url does not start with a '/' it also appends that
 */
const prefixRelativeURL = (prefix: string, originalString: string) => {
  if (originalString.startsWith('http')) {
    return originalString
  }

  if (originalString.startsWith('/')) {
    return prefix + originalString
  }

  return `${prefix}/${originalString}`
}

const mergeAttributes = (mappedElement: ElementMapping, uidlAttrs: any, assetsPrefix?: string) => {
  // We gather the results here uniting the mapped attributes and the uidl attributes.
  const resolvedAttrs: Record<string, any> = {}

  // This will gather all the attributes from the UIDL which are mapped using the elements-mapping
  // These attributes will not be added on the tag as they are, but using the elements-mapping
  // Such an example is the url attribute on the Link tag, which needs to be mapped in the case of html to href
  const mappedAttributes: string[] = []

  const attrs: Record<string, any> = mappedElement.attrs || {}
  // First we iterate through the mapping attributes and we add them to the result
  Object.keys(attrs).forEach((key) => {
    const value = attrs[key]
    if (!value) {
      return
    }

    if (typeof value === 'string' && value.startsWith('$attrs.')) {
      // we lookup for the attributes in the UIDL and use the element-mapping key to set them on the tag
      // (ex: Link has an url attribute in the UIDL, but it needs to be mapped to href in the case of HTML)
      const uidlAttributeKey = value.replace('$attrs.', '')
      if (uidlAttrs && uidlAttrs[uidlAttributeKey]) {
        resolvedAttrs[key] =
          key === 'src' && assetsPrefix
            ? prefixRelativeURL(assetsPrefix, uidlAttrs[uidlAttributeKey])
            : uidlAttrs[uidlAttributeKey]

        mappedAttributes.push(uidlAttributeKey)
      }

      // in the case of mapped reference attributes ($attrs) we don't write them unless they are specified in the uidl
      return
    }

    resolvedAttrs[key] = attrs[key]
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

// Traverses the mapped elements children and inserts the original children of the node being mapped.
const insertChildrenIntoNode = (
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
    insertChildrenIntoNode(child, originalChildren)
    acc.push(child)
    return acc
  }, initialValue)
}

export const resolveContentNode = (
  node: ContentNode,
  elementsMapping: ElementsMapping,
  localDependenciesPrefix: string,
  assetsPrefix?: string
) => {
  const mappedElement = elementsMapping[node.type] || { type: node.type }

  node.type = mappedElement.type

  // Resolve dependency with the UIDL having priority
  if (node.dependency || mappedElement.dependency) {
    node.dependency = resolveDependency(mappedElement, node.dependency, localDependenciesPrefix)
  }

  // Resolve assets prefix inside style (ex: background-image)
  if (node.styles && assetsPrefix) {
    node.styles = prefixAssetURLs(node.styles, assetsPrefix)
  }

  // Merge UIDL attributes to the attributes coming from the mapping object
  if (mappedElement.attrs) {
    node.attrs = mergeAttributes(mappedElement, node.attrs, assetsPrefix)
  }

  // If the mapping contains children, insert that structure into the UIDL
  if (mappedElement.children) {
    const originalNodeChildren = node.children || []

    const replacingNode = {
      ...node,
      children: JSON.parse(JSON.stringify(mappedElement.children)),
    }

    insertChildrenIntoNode(replacingNode, originalNodeChildren)
    node.children = replacingNode.children
  }

  // The UIDL has priority over the mapping repeat
  const repeatStructure = node.repeat || mappedElement.repeat
  if (repeatStructure) {
    const { dataSource, content } = repeatStructure

    // Data source might be preset on a referenced attribute in the uidl node
    // ex: attrs[options] in case of a dropdown primitive with select/options
    if (typeof dataSource === 'string' && dataSource.startsWith('$attrs.') && node.attrs) {
      const nodeDataSourceAttr = dataSource.replace('$attrs.', '')
      repeatStructure.dataSource = node.attrs[nodeDataSourceAttr]
    }

    // The content inside the repeat must also be mapped like any regular content node
    repeatStructure.content = resolveContentNode(
      content,
      elementsMapping,
      localDependenciesPrefix,
      assetsPrefix
    )

    node.repeat = repeatStructure
  }

  // If the node has multiple state branches, each content needs to be resolved
  if (node.type === 'state' && node.states) {
    node.states = node.states.map((stateBranch) => {
      if (typeof stateBranch.content === 'string') {
        return stateBranch
      } else {
        return {
          ...stateBranch,
          content: resolveContentNode(
            stateBranch.content,
            elementsMapping,
            localDependenciesPrefix,
            assetsPrefix
          ),
        }
      }
    })
  }

  // Traverse the UIDL
  if (node.children) {
    node.children = node.children.map((child) => {
      if (typeof child === 'string') {
        return child
      } else {
        return resolveContentNode(child, elementsMapping, localDependenciesPrefix, assetsPrefix)
      }
    })
  }

  return node
}
