import { ASSETS_IDENTIFIER } from '../../shared/constants'
import { StateDefinition, ContentNode, StyleDefinitions } from '../../typings/uidl-definitions'

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

export const splitDynamicAndStaticStyles = (style: StyleDefinitions) => {
  const staticStyles: StyleDefinitions = {}
  const dynamicStyles: StyleDefinitions = {}

  Object.keys(style).forEach((key) => {
    const value = style[key]

    if (typeof value === 'object') {
      const nestedResult = splitDynamicAndStaticStyles(value)
      if (Object.keys(nestedResult.dynamicStyles).length > 0) {
        dynamicStyles[key] = nestedResult.dynamicStyles
      }
      if (Object.keys(nestedResult.staticStyles).length > 0) {
        staticStyles[key] = nestedResult.staticStyles
      }
    } else if (typeof value === 'string' && value.startsWith('$props.')) {
      dynamicStyles[key] = value
    } else {
      staticStyles[key] = value
    }
  })

  return {
    staticStyles,
    dynamicStyles,
  }
}

// return only the root level styles, ignoring any :hover or @media keys which can be nested structures
export const cleanupNestedStyles = (style: StyleDefinitions) => {
  return Object.keys(style).reduce((resultedStyles: StyleDefinitions, styleKey: string) => {
    const styleValue = style[styleKey]

    if (typeof styleValue === 'object') {
      // skip dynamic style
      return resultedStyles
    }

    resultedStyles[styleKey] = styleValue

    return resultedStyles
  }, {})
}

// removes all the dynamic styles from the style object, including the nested structures
export const cleanupDynamicStyles = (style: StyleDefinitions) => {
  return Object.keys(style).reduce((resultedStyles: StyleDefinitions, styleKey: string) => {
    const styleValue = style[styleKey]

    if (typeof styleValue === 'string' && styleValue.startsWith('$props.')) {
      // skip dynamic style
      return resultedStyles
    }

    resultedStyles[styleKey] =
      typeof styleValue === 'object' ? cleanupDynamicStyles(styleValue) : styleValue

    return resultedStyles
  }, {})
}

// Traverses the style object and applies the convert funtion to all the dynamic styles
export const transformDynamicStyles = (
  style: StyleDefinitions,
  transform: (value: string, key?: string) => any
) => {
  return Object.keys(style).reduce((acc: any, key) => {
    const value = style[key]
    if (typeof value === 'string' && value.startsWith('$props.')) {
      acc[key] = transform(value, key)
    } else if (typeof value === 'object') {
      acc[key] = transformDynamicStyles(value, transform)
    } else {
      acc[key] = style[key]
    }
    return acc
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
