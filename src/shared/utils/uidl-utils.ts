import { ASSETS_IDENTIFIER } from '../../shared/constants'

/**
 * A couple of different cases which need to be handled
 * In case of next/nuxt generators, the file names represent the urls of the pages
 * Also the root path needs to be represented by the index file
 */
export const extractPageMetadata = (
  routerDefinitions: StateDefinition,
  stateName: string,
  options: { usePathAsFileName?: boolean; convertDefaultToIndex?: boolean } = {
    usePathAsFileName: false,
    convertDefaultToIndex: false,
  }
): { fileName: string; componentName: string; path: string } => {
  const defaultPage = routerDefinitions.defaultValue
  const pageDefinitions = routerDefinitions.values || []
  const pageDefinition = pageDefinitions.find((stateDef) => stateDef.value === stateName)

  // If not meta object is defined, the stateName is used
  if (!pageDefinition || !pageDefinition.meta) {
    return {
      fileName: options.convertDefaultToIndex && stateName === defaultPage ? 'index' : stateName,
      componentName: stateName,
      path: '/' + stateName,
    }
  }

  // In case the path is used as the url (next, nuxt), we override the filename from the path
  const fileNameFromMeta = options.usePathAsFileName
    ? pageDefinition.meta.path && pageDefinition.meta.path.slice(1)
    : pageDefinition.meta.fileName

  return {
    fileName:
      options.convertDefaultToIndex && stateName === defaultPage
        ? 'index'
        : fileNameFromMeta || stateName,
    componentName: pageDefinition.meta.componentName || stateName,
    path: pageDefinition.meta.path || '/' + stateName,
  }
}

export const prefixPlaygroundAssetsURL = (prefix: string, originalString: string | undefined) => {
  if (!originalString || !originalString.startsWith(ASSETS_IDENTIFIER)) {
    return originalString
  }

  if (originalString.startsWith('/')) {
    return prefix + originalString
  }

  return `${prefix}/${originalString}`
}

// Either receives the content node or the children element
export const cloneElement = (node: ContentNode | Array<ContentNode | string>) =>
  JSON.parse(JSON.stringify(node))

export const traverseNodes = (node: ContentNode, fn: (node: ContentNode) => void) => {
  fn(node)

  if (node.children) {
    node.children.forEach((child) => {
      if (typeof child !== 'string') {
        traverseNodes(child, fn)
      }
    })
  }

  if (node.repeat) {
    traverseNodes(node.repeat.content, fn)
  }

  if (node.states && node.type === 'state') {
    node.states.forEach((stateBranch) => {
      if (typeof stateBranch.content !== 'string') {
        traverseNodes(stateBranch.content, fn)
      }
    })
    return
  }
}

interface SplitResponse {
  staticStyles: UIDLStyleDefinitions
  dynamicStyles: UIDLStyleDefinitions
}
export const splitDynamicAndStaticStyles = (style: UIDLStyleDefinitions): SplitResponse => {
  // const staticStyles: UIDLStyleDefinitions = {}
  // const dynamicStyles: UIDLStyleDefinitions = {}

  const responsePayload: SplitResponse = { staticStyles: {}, dynamicStyles: {} }

  Object.keys(style).reduce((acc: SplitResponse, styleKey) => {
    const styleValue = style[styleKey]
    const { staticStyles, dynamicStyles } = acc

    switch (styleValue.type) {
      case 'dynamic':
        dynamicStyles[styleKey] = styleValue
        return acc
      case 'static':
        staticStyles[styleKey] = styleValue
        return acc
      case 'nested-style':
        const nestedResult = splitDynamicAndStaticStyles(styleValue.content)
        if (Object.keys(nestedResult.dynamicStyles).length > 0) {
          dynamicStyles[styleKey] = styleValue
          dynamicStyles[styleKey].content = nestedResult.dynamicStyles
        }
        if (Object.keys(nestedResult.staticStyles).length > 0) {
          staticStyles[styleKey] = styleValue
          staticStyles[styleKey].content = nestedResult.staticStyles
        }
        return acc
      default:
        throw new Error(
          `splitDynamicAndStaticStyles encountered an unknown style definition ${JSON.stringify(
            styleValue,
            null,
            2
          )}`
        )
    }

    return acc
  }, responsePayload)

  return responsePayload
}

// TODO add tests
// return only the root level styles, ignoring any :hover or @media keys which can be nested structures
export const cleanupNestedStyles = (style: UIDLStyleDefinitions): UIDLStyleDefinitions => {
  return Object.keys(style).reduce((resultedStyles: UIDLStyleDefinitions, styleKey: string) => {
    const styleValue = style[styleKey]

    switch (styleValue.type) {
      case 'nested-style':
        return resultedStyles
      default:
        resultedStyles[styleKey] = styleValue
        return resultedStyles
    }
  }, {})
}

// removes all the dynamic styles from the style object, including the nested structures
export const cleanupDynamicStyles = (style: UIDLStyleDefinitions): UIDLStyleDefinitions => {
  return Object.keys(style).reduce((resultedStyles: UIDLStyleDefinitions, styleKey: string) => {
    const styleValue = style[styleKey]

    switch (styleValue.type) {
      case 'dynamic':
        return resultedStyles
      case 'nested-style':
        resultedStyles[styleKey] = styleValue
        resultedStyles[styleKey].content = cleanupDynamicStyles(styleValue.content)
        return resultedStyles
      case 'static':
        resultedStyles[styleKey] = styleValue
        return resultedStyles
      default:
        throw new Error(
          `cleanupDynamicStyles encountered an unknown style definition ${JSON.stringify(
            styleValue,
            null,
            2
          )}`
        )
    }
  }, {})
}

// Traverses the style object and applies the convert funtion to all the dynamic styles
export const transformDynamicStyles = (
  style: UIDLStyleDefinitions,
  transform: (value: string, key?: string) => unknown
) => {
  return Object.keys(style).reduce((resultedStyles: Record<string, unknown>, styleKey) => {
    const styleValue = style[styleKey]

    switch (styleValue.type) {
      case 'dynamic':
        resultedStyles[styleKey] = transform(styleValue.content.id, styleKey)
        return resultedStyles
      case 'nested-style':
        resultedStyles[styleKey] = transformDynamicStyles(styleValue.content, transform)
        return resultedStyles
      case 'static':
        resultedStyles[styleKey] = styleValue.content
        return resultedStyles
      default:
        throw new Error(
          `transformDynamicStyles encountered an unknown style definition ${JSON.stringify(
            styleValue,
            null,
            2
          )}`
        )
    }
  }, {})
}

const dynamicPrefixes = ['$props.', '$state.', '$local.']

export const isDynamicPrefixedValue = (value: any) => {
  if (typeof value !== 'string') {
    return false
  }

  return dynamicPrefixes.reduce((result, prefix) => {
    // endsWith is added to avoid errors when the user is typing and reaches `$props.`
    return result || (value.startsWith(prefix) && !value.endsWith(prefix))
  }, false)
}

export const removeDynamicPrefix = (value: string, newPrefix?: string) => {
  const indexOfFirstDot = value.indexOf('.')
  if (indexOfFirstDot < 0) {
    return value
  }

  const prefix = newPrefix ? newPrefix + '.' : '' // ex: props. or state. as a prefix

  return prefix + value.slice(indexOfFirstDot + 1)
}

// returns falsy or typecast object to UIDLDynamicReference and returns it
export const isUIDLDynamicReference = (jsonObject: Record<string, unknown> | string) => {
  if (typeof jsonObject === 'string') {
    return false
  }

  const { content, type } = jsonObject as UIDLDynamicReference
  if (
    type === 'dynamic' &&
    !Array.isArray(content) &&
    typeof content === 'object' &&
    ['prop', 'state', 'local'].indexOf(content.referenceType) !== -1 &&
    typeof content.id === 'string'
  ) {
    return jsonObject as UIDLDynamicReference
  }

  return false
}

// returns falsy or typecast object to UIDLDynamicReference and returns it
export const isUIDLStaticReference = (jsonObject: Record<string, unknown> | string) => {
  if (typeof jsonObject === 'string') {
    return false
  }

  const { content, type } = jsonObject as UIDLStaticReference
  if (type === 'static' && typeof content === 'string') {
    return jsonObject as UIDLStaticReference
  }

  return false
}
