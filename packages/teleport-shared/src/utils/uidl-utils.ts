import { ASSETS_IDENTIFIER } from '../constants'
import {
  camelCaseToDashCase,
  removeIllegalCharacters,
  dashCaseToUpperCamelCase,
} from './string-utils'
import {
  ComponentUIDL,
  UIDLStyleDefinitions,
  UIDLConditionalNode,
  UIDLElement,
  UIDLNode,
  UIDLStaticValue,
  UIDLAttributeValue,
  UIDLDynamicReference,
  UIDLRepeatContent,
  UIDLRepeatMeta,
  UIDLElementNode,
} from '@teleporthq/teleport-types'

export const extractRoutes = (rootComponent: ComponentUIDL) => {
  // Assuming root element starts with a UIDLElementNode
  const rootElement = rootComponent.node.content as UIDLElement

  // Look for conditional nodes in the first level children of the root element
  return rootElement.children.filter(
    (child) => child.type === 'conditional' && child.content.reference.content.id === 'route'
  ) as UIDLConditionalNode[]
}

export const createWebComponentFriendlyName = (componentName: string) => {
  const dashCaseName = camelCaseToDashCase(componentName)
  if (dashCaseName.includes('-')) {
    return dashCaseName
  }

  return `app-${dashCaseName}`
}

export const setFriendlyOutputOptions = (uidl: ComponentUIDL) => {
  uidl.outputOptions = uidl.outputOptions || {}
  const defaultComponentName = 'AppComponent'
  const friendlyName = removeIllegalCharacters(uidl.name) || defaultComponentName
  if (!uidl.outputOptions.fileName) {
    uidl.outputOptions.fileName = camelCaseToDashCase(friendlyName)
  }
  if (!uidl.outputOptions.componentClassName) {
    uidl.outputOptions.componentClassName = dashCaseToUpperCamelCase(friendlyName)
  }

  // failsafe for invalid UIDL samples with illegal characters as element names
  // when used in projects, resolveLocalDependencies should handle this
  traverseElements(uidl.node, (element) => {
    if (element.dependency) {
      element.semanticType = dashCaseToUpperCamelCase(
        removeIllegalCharacters(element.semanticType) || defaultComponentName
      )
    } else {
      element.semanticType = removeIllegalCharacters(element.semanticType)
    }
  })
}

export const getComponentFileName = (component: ComponentUIDL) => {
  return component.outputOptions && component.outputOptions.fileName
    ? component.outputOptions.fileName
    : camelCaseToDashCase(getComponentClassName(component))
}

export const getStyleFileName = (component: ComponentUIDL) => {
  const componentFileName = getComponentFileName(component)

  // If component meta style file name is not set, we default to the component file name
  return component.outputOptions && component.outputOptions.styleFileName
    ? component.outputOptions.styleFileName
    : componentFileName
}

export const getTemplateFileName = (component: ComponentUIDL) => {
  const componentFileName = getComponentFileName(component)

  // If component meta style file name is not set, we default to the component file name
  return component.outputOptions && component.outputOptions.templateFileName
    ? component.outputOptions.templateFileName
    : componentFileName
}

export const getComponentFolderPath = (component: ComponentUIDL) =>
  component.outputOptions && component.outputOptions.folderPath
    ? component.outputOptions.folderPath
    : []

export const getComponentClassName = (component: ComponentUIDL) => {
  const componentName =
    component.outputOptions && component.outputOptions.componentClassName
      ? component.outputOptions.componentClassName
      : component.name

  // Failsafe for angular modules and other places where component names are computed without passing through mapping
  // "Component" will not exist when generating a component because the resolver checks for illegal class names
  if (componentName === 'Component') {
    return 'AppComponent'
  }

  return componentName
}

export const getRepeatIteratorNameAndKey = (meta: UIDLRepeatMeta = {}) => {
  const iteratorName = meta.iteratorName || 'item'
  const iteratorKey = meta.iteratorKey || (meta.useIndex ? 'index' : iteratorName)
  return {
    iteratorKey,
    iteratorName,
  }
}

export const prefixAssetsPath = (prefix: string, originalString: string | undefined) => {
  if (!originalString || !originalString.includes(ASSETS_IDENTIFIER)) {
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
      const { attrs, children, style, abilities, referencedStyles } = node.content
      if (attrs) {
        Object.keys(attrs).forEach((attrKey) => {
          traverseNodes(attrs[attrKey], fn, node)
        })
      }

      if (referencedStyles && Object.keys(referencedStyles).length > 0) {
        Object.values(referencedStyles).forEach((styleRef) => {
          if (styleRef.content.mapType === 'inlined') {
            traverseStyleObject(styleRef.content.styles)
          }
        })
      }

      if (style) {
        traverseStyleObject(style)
      }

      if (abilities?.link?.type === 'url') {
        traverseNodes(abilities?.link?.content?.url, fn, node)
      }

      if (children) {
        children.forEach((child) => {
          traverseNodes(child, fn, node)
        })
      }
      break

    case 'repeat':
      traverseNodes(node.content.node, fn, node)
      traverseNodes(node.content.dataSource, fn, node)
      break

    case 'conditional':
      traverseNodes(node.content.node, fn, node)
      traverseNodes(node.content.reference, fn, node)
      break

    case 'slot':
      if (node.content.fallback) {
        traverseNodes(node.content.fallback, fn, node)
      }
      break

    case 'static':
    case 'dynamic':
    case 'raw':
      break

    default:
      throw new Error(
        `traverseNodes was given an unsupported node type ${JSON.stringify(node, null, 2)}`
      )
  }
}

const traverseStyleObject = (style: UIDLStyleDefinitions) => {
  Object.keys(style).forEach((styleKey) => {
    const styleValue = style[styleKey]
    // TODO: cross-check the support for the strings as content for styles
    if (styleValue.type !== 'static' && styleValue.type !== 'dynamic') {
      throw new Error(`We support only 'static' and 'dynamic' content for styles`)
    }
  })
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
    case 'raw':
      break

    default:
      throw new Error(
        `traverseElements was given an unsupported node type ${JSON.stringify(node, null, 2)}`
      )
  }
}

export const traverseRepeats = (node: UIDLNode, fn: (element: UIDLRepeatContent) => void) => {
  switch (node.type) {
    case 'element':
      if (node.content.children) {
        node.content.children.forEach((child) => {
          traverseRepeats(child, fn)
        })
      }

      break

    case 'repeat':
      fn(node.content)

      traverseRepeats(node.content.node, fn)
      break

    case 'conditional':
      traverseRepeats(node.content.node, fn)
      break

    case 'slot':
      if (node.content.fallback) {
        traverseRepeats(node.content.fallback, fn)
      }
      break

    case 'static':
    case 'dynamic':
    case 'raw':
      break

    default:
      throw new Error(
        `traverseRepeats was given an unsupported node type ${JSON.stringify(node, null, 2)}`
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

// removes all the dynamic styles from the style object, including the nested structures
export const cleanupDynamicStyles = (style: UIDLStyleDefinitions): UIDLStyleDefinitions => {
  return Object.keys(style).reduce((resultedStyles: UIDLStyleDefinitions, styleKey: string) => {
    const styleValue = style[styleKey]

    switch (styleValue.type) {
      case 'dynamic':
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
  // tslint:disable-next-line no-any
  transform: (value: UIDLDynamicReference, key?: string) => any
  // tslint:disable-next-line no-any
): Record<string, any> => {
  return Object.keys(style).reduce((resultedStyles: Record<string, unknown>, styleKey) => {
    const styleValue = style[styleKey]

    switch (styleValue.type) {
      case 'dynamic':
        resultedStyles[styleKey] = transform(styleValue, styleKey)
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
      const { type } = styleContentAtKey as Record<string, unknown>

      if (['dynamic', 'static'].indexOf(type as string) !== -1) {
        acc[key] = styleContentAtKey as UIDLAttributeValue
        return acc
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
      acc[key] = transformStringAssignmentToJson(
        attributeContent as string | number
      ) as UIDLAttributeValue
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

export const findFirstElementNode = (node: UIDLNode): UIDLElementNode => {
  switch (node.type) {
    case 'element':
      return node
    case 'static':
    case 'dynamic':
    case 'slot':
      throw new Error('UIDL does not have any element node')
    case 'conditional':
    case 'repeat':
      const childNode = node.content.node
      return findFirstElementNode(childNode)
    default:
      throw new Error(`Invalid node type '${node}'`)
  }
}

export const removeChildNodes = (
  node: UIDLNode,
  criteria: (element: UIDLNode) => boolean
): void => {
  switch (node.type) {
    case 'element':
      if (node.content.children) {
        // filter this level children
        node.content.children = node.content.children.filter((child) => !criteria(child))

        // call function recursively for remaining children
        node.content.children.forEach((child) => removeChildNodes(child, criteria))
      }

      break

    case 'repeat':
      removeChildNodes(node.content.node, criteria)
      break

    case 'conditional':
      removeChildNodes(node.content.node, criteria)
      break

    case 'slot':
      if (node.content.fallback) {
        removeChildNodes(node.content.fallback, criteria)
      }
      break

    case 'static':
    case 'dynamic':
    case 'raw':
      break

    default:
      throw new Error(
        `removeChildNodes was given an unsupported node type ${JSON.stringify(node, null, 2)}`
      )
  }
}
