import { UIDLUtils, StringUtils } from '@teleporthq/teleport-shared'
import {
  UIDLEventDefinitions,
  UIDLElement,
  UIDLNode,
  UIDLDependency,
  UIDLRepeatContent,
  UIDLAttributeValue,
  Mapping,
  GeneratorOptions,
  ComponentUIDL,
  UIDLElementNode,
  UIDLStyleSetTokenReference,
  UIDLStaticValue,
  UIDLDynamicReference,
} from '@teleporthq/teleport-types'
import deepmerge from 'deepmerge'

const STYLE_PROPERTIES_WITH_URL = ['background', 'backgroundImage']

type ElementsLookup = Record<string, { count: number; nextKey: string }>

export const mergeMappings = (
  oldMapping: Mapping,
  newMapping?: Mapping,
  deepMerge = false
): Mapping => {
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
    illegalClassNames: [
      ...(oldMapping.illegalClassNames || []),
      ...(newMapping.illegalClassNames || []),
    ],
    illegalPropNames: [
      ...(oldMapping.illegalPropNames || []),
      ...(newMapping.illegalPropNames || []),
    ],
  }
}

export const resolveMetaTags = (uidl: ComponentUIDL, options: GeneratorOptions) => {
  if (!uidl.seo || !uidl.seo.metaTags || !options.assets) {
    return
  }

  uidl.seo.metaTags.forEach((tag) => {
    Object.keys(tag).forEach((key) => {
      tag[key] = UIDLUtils.prefixAssetsPath(tag[key], options.assets)
    })
  })
}

export const removeIgnoredNodes = (uidlNode: UIDLNode) => {
  // For now this is only used by react-native that adds some ignore flags in the mapping for certain elements.
  UIDLUtils.removeChildNodes(uidlNode, (node) => {
    if (node.type === 'element' && node.content.ignore) {
      return true // elements mapped with ignore will be removed
    }

    return false
  })
}

export const resolveNode = (uidlNode: UIDLNode, options: GeneratorOptions) => {
  UIDLUtils.traverseNodes(uidlNode, (node, parentNode) => {
    if (node.type === 'element') {
      resolveElement(node.content, options)
    }

    if (node.type === 'repeat') {
      resolveRepeat(node.content, parentNode)
    }
  })
}

export const resolveElement = (element: UIDLElement, options: GeneratorOptions) => {
  const { mapping, localDependenciesPrefix } = options
  const {
    events: eventsMapping,
    elements: elementsMapping,
    attributes: attributesMapping,
  } = mapping
  const originalElement = element
  const originalElementType = originalElement.elementType
  const mappedElement = elementsMapping[originalElement.elementType] || {
    elementType: originalElement.semanticType ?? originalElement.elementType, // identity mapping
  }

  // Setting up the name of the node based on the type, if it is not supplied
  originalElement.name = originalElement.name || originalElement.elementType

  // Mapping the type from the semantic type of the mapping
  // Semantic type has precedence as it is dictated by the user
  originalElement.elementType = originalElement.semanticType || mappedElement.elementType

  if (mappedElement.ignore) {
    originalElement.ignore = mappedElement.ignore
  }

  if (mappedElement.selfClosing) {
    originalElement.selfClosing = mappedElement.selfClosing
  }

  // Resolve dependency with the UIDL having priority
  if (originalElement.dependency || mappedElement.dependency) {
    originalElement.dependency = resolveDependency(
      mappedElement,
      originalElement.dependency,
      localDependenciesPrefix
    )
  }

  // Resolve assets prefix inside style (ex: background-image)
  if (originalElement.style && options?.assets) {
    originalElement.style = prefixAssetURLs(originalElement.style, options.assets)
  }

  // Map events separately
  if (originalElement.events && eventsMapping) {
    originalElement.events = resolveEvents(originalElement.events, eventsMapping)
  }

  // Prefix the attributes which may point to local assets
  if (originalElement.attrs && options?.assets) {
    Object.keys(originalElement.attrs).forEach((attrKey) => {
      const attrValue = originalElement.attrs[attrKey]
      if (attrValue.type === 'static' && typeof attrValue.content === 'string') {
        originalElement.attrs[attrKey].content = UIDLUtils.prefixAssetsPath(
          attrValue.content,
          options.assets
        )
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

    // Solves an edge case for next.js by passing the styles from the <Link> tag to the <a> tag
    const anchorChild = originalElement.children.find(
      (child) => child.type === 'element' && child.content.elementType === 'a'
    ) as UIDLElementNode

    // only do it if there's a child <a> tag and the original element is a navlink
    const shouldPassStylesToAnchor =
      (originalElement?.style || originalElement?.referencedStyles) &&
      originalElementType === 'navlink' &&
      anchorChild
    if (shouldPassStylesToAnchor) {
      anchorChild.content.style = UIDLUtils.cloneObject(originalElement?.style || {})
      anchorChild.content.referencedStyles = UIDLUtils.cloneObject(
        originalElement?.referencedStyles || {}
      )
      originalElement.style = {}
      originalElement.referencedStyles = {}
    }
  }
}

export const resolveChildren = (mappedChildren: UIDLNode[], originalChildren: UIDLNode[] = []) => {
  let newChildren = UIDLUtils.cloneObject(mappedChildren)

  let placeholderFound = false
  newChildren.forEach((childNode) => {
    UIDLUtils.traverseNodes(childNode, (node, parentNode) => {
      if (node.type !== 'comp-style' && !isPlaceholderNode(node)) {
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
  UIDLUtils.traverseElements(node, (element) => {
    // If a certain node name (ex: "container") is present multiple times in the component, it will be counted here
    // NextKey will be appended to the node name to ensure uniqueness inside the component
    // Element name is stored as a lower case string in the lookup, considering camel case
    const nodeOcurrence = lookup[StringUtils.camelCaseToDashCase(element.name)]

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
  UIDLUtils.traverseElements(node, (element) => {
    // Element name is stored as a lower case string in the lookup, considering camel case
    const elementName = StringUtils.camelCaseToDashCase(element.name)
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

  UIDLUtils.traverseRepeats(node, (repeat) => {
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

export function parseStaticStyles(styles: string) {
  const stylesList: string[] = []
  const tokens = /[,\(\)]/
  let parens = 0
  let buffer = ''

  if (styles == null) {
    return stylesList
  }

  while (styles.length) {
    const match = tokens.exec(styles)
    if (!match) {
      break
    }
    const char = match[0]
    let ignoreChar = false
    let foundAssetId = false

    switch (char) {
      case ',':
        if (!parens) {
          if (buffer) {
            stylesList.push(buffer.trim())
            buffer = ''
          } else {
            foundAssetId = true
          }

          ignoreChar = true
        }
        break
      case '(':
        parens++
        break
      case ')':
        parens--
        break
      default:
        break
    }

    const index = match.index + 1
    buffer += styles.slice(0, ignoreChar ? index - 1 : index)
    styles = styles.slice(index)

    if (foundAssetId) {
      stylesList.push(buffer.trim())
      buffer = ''
      ignoreChar = true
    }
  }

  if (buffer.length || styles.length) {
    stylesList.push((buffer + styles).trim())
  }

  return stylesList
}

/**
 * Prefixes all urls inside the style object with the assetsPrefix
 * @param style the style object on the current node
 * @param assets comes from project generator options which contains the prefix, mappings and identifier
 */

export const prefixAssetURLs = <
  T extends UIDLStaticValue | UIDLDynamicReference | UIDLStyleSetTokenReference
>(
  style: Record<string, T>,
  assets: GeneratorOptions['assets']
): Record<string, T> => {
  // iterate through all the style keys
  return Object.keys(style).reduce((acc: Record<string, T>, styleKey: string) => {
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

        if (typeof staticContent === 'string' && STYLE_PROPERTIES_WITH_URL.includes(styleKey)) {
          // need to split the styles in case of multiple background being added (eg: gradient + bgImage)
          let styleList = parseStaticStyles(staticContent)
          styleList = styleList.map((subStyle) => {
            let asset = subStyle
            const match = subStyle.match(/url\(['"]?(.*?")['"]?\)/)
            if (match) {
              asset = match[1].replace(/('|")/g, '')
            }

            /*
              background image such as gradient shouldn't be urls
              we prevent that by checking if the value is actually an asset or not (same check as in the prefixAssetsPath function
              but we don't compute and generate a url)
            */
            if (!asset.startsWith('/')) {
              return subStyle
            }

            const url = UIDLUtils.prefixAssetsPath(asset, assets)
            const newStyleValue = `url("${url}")`
            return newStyleValue
          })

          acc[styleKey] = {
            type: 'static',
            content: styleList.join(','),
          } as T
        } else {
          acc[styleKey] = styleValue
        }
        return acc
      default:
        throw new Error(`Invalid styleValue type '${styleValue}'`)
    }
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
    // This is just a fallback for when the dependency path is not set by a project generator
    const componentName = mappedElement.elementType
    const componentFileName = StringUtils.camelCaseToDashCase(componentName)

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

export const checkForIllegalNames = (uidl: ComponentUIDL, mapping: Mapping) => {
  const { illegalClassNames, illegalPropNames } = mapping
  if (illegalClassNames.includes(uidl.outputOptions.componentClassName)) {
    console.warn(
      `Illegal component name '${uidl.outputOptions.componentClassName}'. Appending 'App' in front of it`
    )
    uidl.outputOptions.componentClassName = `App${uidl.outputOptions.componentClassName}`
  }

  if (uidl.propDefinitions) {
    Object.keys(uidl.propDefinitions).forEach((prop) => {
      if (illegalPropNames.includes(prop)) {
        throw new Error(`Illegal prop key '${prop}'`)
      }
    })
  }

  if (uidl.stateDefinitions) {
    Object.keys(uidl.stateDefinitions).forEach((state) => {
      if (illegalPropNames.includes(state)) {
        throw new Error(`Illegal state key '${state}'`)
      }
    })
  }
}

export const checkForDefaultPropsContainingAssets = (
  uidl: ComponentUIDL,
  assets: GeneratorOptions['assets']
) => {
  if (uidl.propDefinitions) {
    Object.keys(uidl.propDefinitions).forEach((prop) => {
      const propDefaultValue = uidl.propDefinitions[prop].defaultValue
      if (typeof propDefaultValue === 'string' && assets) {
        uidl.propDefinitions[prop].defaultValue = UIDLUtils.prefixAssetsPath(
          propDefaultValue,
          assets
        )
      }
    })
  }
}

export const checkForDefaultStateValueContainingAssets = (
  uidl: ComponentUIDL,
  assets: GeneratorOptions['assets']
) => {
  if (uidl.stateDefinitions) {
    Object.keys(uidl.stateDefinitions).forEach((state) => {
      const stateDefaultValue = uidl.stateDefinitions[state].defaultValue
      if (typeof stateDefaultValue === 'string' && assets) {
        uidl.stateDefinitions[state].defaultValue = UIDLUtils.prefixAssetsPath(
          stateDefaultValue,
          assets
        )
      }
    })
  }
}
