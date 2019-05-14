import { ASSETS_IDENTIFIER } from '../constants'
import {
  ComponentUIDL,
  UIDLStateDefinition,
  UIDLStyleDefinitions,
  UIDLConditionalNode,
  UIDLElement,
  UIDLNode,
  UIDLStaticValue,
  UIDLAttributeValue,
  UIDLDynamicReference,
} from '../typings/uidl'

/**
 * A couple of different cases which need to be handled
 * In case of next/nuxt generators, the file names represent the urls of the pages
 * Also the root path needs to be represented by the index file
 */
export const extractPageMetadata = (
  routeDefinitions: UIDLStateDefinition,
  stateName: string,
  options: {
    usePathAsFileName?: boolean
    convertDefaultToIndex?: boolean
  } = {
    usePathAsFileName: false,
    convertDefaultToIndex: false,
  }
): { fileName: string; componentName: string; path: string } => {
  const defaultPage = routeDefinitions.defaultValue
  const pageDefinitions = routeDefinitions.values || []
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

export const extractRoutes = (rootComponent: ComponentUIDL) => {
  // Assuming root element starts with a UIDLElementNode
  const rootElement = rootComponent.node.content as UIDLElement

  // Look for conditional nodes in the first level children of the root element
  return rootElement.children.filter(
    (child) => child.type === 'conditional' && child.content.reference.content.id === 'route'
  ) as UIDLConditionalNode[]
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

// Clones existing objects while keeping the type cast
export const cloneObject = <T>(node: T): T => JSON.parse(JSON.stringify(node))

// This function parses all the UIDLNodes in a tree structure
// enabling a function to be applied to each individual node
export const traverseNodes = (
  node: UIDLNode,
  fn: (node: UIDLNode, parentNode: UIDLNode) => void,
  parent: UIDLNode | null = null
) => {
  fn(node, parent)

  switch (node.type) {
    case 'element':
      if (node.content.children) {
        node.content.children.forEach((child) => {
          traverseNodes(child, fn, node)
        })
      }
      break

    case 'repeat':
      traverseNodes(node.content.node, fn, node)
      break

    case 'conditional':
      traverseNodes(node.content.node, fn, node)
      break

    case 'slot':
      if (node.content.fallback) {
        traverseNodes(node.content.fallback, fn, node)
      }
      break

    case 'static':
    case 'dynamic':
      break

    default:
      throw new Error(
        `traverseNodes was given an unsupported node type ${JSON.stringify(node, null, 2)}`
      )
  }
}

// Parses a node structure recursively and applies a function to each UIDLElement instance
export const traverseElements = (node: UIDLNode, fn: (element: UIDLElement) => void) => {
  switch (node.type) {
    case 'element':
      fn(node.content)

      if (node.content.children) {
        node.content.children.forEach((child) => {
          traverseElements(child, fn)
        })
      }

      break

    case 'repeat':
      traverseElements(node.content.node, fn)
      break

    case 'conditional':
      traverseElements(node.content.node, fn)
      break

    case 'slot':
      if (node.content.fallback) {
        traverseElements(node.content.fallback, fn)
      }
      break

    case 'static':
    case 'dynamic':
      break

    default:
      throw new Error(
        `traverseElements was given an unsupported node type ${JSON.stringify(node, null, 2)}`
      )
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
  transform: (value: UIDLDynamicReference, key?: string) => unknown
) => {
  return Object.keys(style).reduce((resultedStyles: Record<string, unknown>, styleKey) => {
    const styleValue = style[styleKey]

    switch (styleValue.type) {
      case 'dynamic':
        resultedStyles[styleKey] = transform(styleValue, styleKey)
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

/**
 * Transform properties like
 * $props.something
 * $local.something
 * $state.something
 *
 * Into their json alternative which is used in beta release/0.6 and
 * later.
 */
export const transformStringAssignmentToJson = (
  declaration: string | number
): UIDLStaticValue | UIDLAttributeValue => {
  if (typeof declaration === 'number') {
    return {
      type: 'static',
      content: declaration,
    }
  }

  const parts = declaration.split('.')
  const prefix = parts[0]
  const path = parts.slice(1).join('.')

  if (['$props', '$state', '$local'].indexOf(prefix) !== -1) {
    let referenceType: 'prop' | 'state' | 'local' = 'prop'
    if (prefix !== '$props') {
      referenceType = prefix.replace('$', '') as 'state' | 'local'
    }
    return {
      type: 'dynamic',
      content: {
        referenceType,
        id: path,
      },
    }
  }

  return {
    type: 'static',
    content: declaration,
  }
}

export const transformStylesAssignmentsToJson = (
  styleObject: Record<string, unknown>
): UIDLStyleDefinitions => {
  const newStyleObject: UIDLStyleDefinitions = {}

  Object.keys(styleObject).reduce((acc, key) => {
    const styleContentAtKey = styleObject[key]
    const entityType = typeof styleContentAtKey

    if (['string', 'number'].indexOf(entityType) !== -1) {
      acc[key] = transformStringAssignmentToJson(styleContentAtKey as string | number)
      return acc
    }

    if (!Array.isArray(styleContentAtKey) && entityType === 'object') {
      // if this value is already properly declared, make sure it is not
      const { type, content } = styleContentAtKey as Record<string, unknown>

      if (['dynamic', 'static'].indexOf(type as string) !== -1) {
        acc[key] = styleContentAtKey as UIDLAttributeValue
        return acc
      }

      if (type === 'nested-style') {
        acc[key] = {
          type: 'nested-style',
          content: transformStylesAssignmentsToJson(content as Record<string, unknown>),
        }
        return acc
      }

      // if the supported types of objects did not match the previous if statement
      // we are ready to begin parsing a new nested style
      acc[key] = {
        type: 'nested-style',
        content: transformStylesAssignmentsToJson(styleContentAtKey as Record<string, unknown>),
      }
      return acc
    }

    throw new Error(
      `transformStylesAssignmentsToJson encountered a style value that is not supported ${JSON.stringify(
        styleContentAtKey,
        null,
        2
      )}`
    )
  }, newStyleObject)

  return newStyleObject
}

export const transformAttributesAssignmentsToJson = (
  attributesObject: Record<string, unknown>
): Record<string, UIDLAttributeValue> => {
  const newStyleObject: Record<string, UIDLAttributeValue> = {}

  Object.keys(attributesObject).reduce((acc, key) => {
    const attributeContent = attributesObject[key]
    const entityType = typeof attributeContent

    if (['string', 'number'].indexOf(entityType) !== -1) {
      acc[key] = transformStringAssignmentToJson(attributeContent as
        | string
        | number) as UIDLAttributeValue
      return acc
    }

    if (!Array.isArray(attributeContent) && entityType === 'object') {
      // if this value is already properly declared, make sure it is not
      const { type } = attributeContent as Record<string, unknown>
      if (['dynamic', 'static'].indexOf(type as string) !== -1) {
        acc[key] = attributeContent as UIDLAttributeValue
        return acc
      }

      throw new Error(
        `transformAttributesAssignmentsToJson encountered a style value that is not supported ${JSON.stringify(
          attributeContent,
          null,
          2
        )}`
      )
    }

    throw new Error(
      `transformAttributesAssignmentsToJson encountered a style value that is not supported ${JSON.stringify(
        attributeContent,
        null,
        2
      )}`
    )
  }, newStyleObject)

  return newStyleObject
}
