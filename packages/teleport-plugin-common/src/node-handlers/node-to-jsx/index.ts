import * as types from '@babel/types'
import {
  UIDLElementNode,
  UIDLRepeatNode,
  UIDLConditionalNode,
  UIDLConditionalExpression,
  UIDLDynamicReference,
  UIDLSlotNode,
  UIDLNode,
  UIDLCMSListNode,
  UIDLCMSItemNode,
  UIDLExpressionValue,
  UIDLCMSListRepeaterNode,
  UIDLCMSMixedTypeNode,
  UIDLElement,
  UIDLDataSourceItemNode,
  UIDLDataSourceListNode,
} from '@teleporthq/teleport-types'
import { UIDLUtils, StringUtils } from '@teleporthq/teleport-shared'
import { JSXASTReturnType, JSXGenerationOptions, JSXGenerationParams, NodeToJSX } from './types'

import {
  addEventHandlerToTag,
  createConditionIdentifier,
  createDynamicValueExpression,
  createConditionalJSXExpression,
  getRepeatSourceIdentifier,
} from './utils'
import {
  addChildJSXText,
  addChildJSXTag,
  addAttributeToJSXTag,
  addDynamicAttributeToJSXTag,
  addRawAttributeToJSXTag,
  generateDynamicWindowImport,
  addDynamicExpressionAttributeToJSXTag,
  resolveObjectValue,
  objectToObjectExpression,
} from '../../utils/ast-utils'
import { createJSXTag, createSelfClosingJSXTag } from '../../builders/ast-builders'
import { DEFAULT_JSX_OPTIONS } from './constants'
import { ASTBuilders, ASTUtils } from '../..'

const getElementType = (node: UIDLNode): string | null => {
  if (
    node.type === 'element' &&
    node.content &&
    typeof node.content === 'object' &&
    'elementType' in node.content
  ) {
    return (node.content as any).elementType
  }
  if ((node.type === 'data-source-list' || node.type === 'data-source-item') && node.content) {
    return (node.content as any).elementType || 'DataProvider'
  }
  return null
}

const getClassName = (node: UIDLNode): string | null => {
  if (
    node.type === 'element' &&
    node.content &&
    typeof node.content === 'object' &&
    'key' in node.content
  ) {
    return (node.content as any).key || null
  }
  return null
}

const reorderChildrenForSearch = (children: UIDLNode[]): UIDLNode[] => {
  const searchNodes: UIDLNode[] = []
  const dataProviderNodes: UIDLNode[] = []
  const paginationNodes: UIDLNode[] = []
  const otherNodes: UIDLNode[] = []

  children.forEach((child) => {
    const elementType = getElementType(child)
    const nodeType = child.type
    const className = getClassName(child)

    // Check for search nodes - use className since elementType is replaced by semanticType
    if (
      className &&
      (className.includes('data-source-search') || className.includes('search-node'))
    ) {
      searchNodes.push(child)
    }
    // Check for DataProvider nodes - these should appear SECOND
    else if (
      nodeType === 'data-source-list' ||
      nodeType === 'data-source-item' ||
      elementType === 'DataProvider'
    ) {
      dataProviderNodes.push(child)
    }
    // Check for pagination nodes - use className since elementType is replaced by semanticType
    else if (
      (elementType &&
        (elementType.includes('pagination') || elementType.includes('cms-pagination'))) ||
      (className && (className.includes('pagination') || className.includes('cms-pagination')))
    ) {
      paginationNodes.push(child)
    }
    // Everything else goes in the middle
    else {
      otherNodes.push(child)
    }
  })

  // Only reorder if we have search or pagination nodes alongside a DataProvider
  // This ensures we only reorder when there's an actual pagination/search group
  // If there's no search/pagination, keep original order to preserve DataProvider positions
  const hasSearchOrPagination = searchNodes.length > 0 || paginationNodes.length > 0
  const hasDataProvider = dataProviderNodes.length > 0

  if (hasSearchOrPagination && hasDataProvider) {
    // Order: search nodes first, then data providers, then other nodes, then pagination last
    // This ensures: search input -> DataProvider -> content -> pagination buttons
    return [...searchNodes, ...dataProviderNodes, ...otherNodes, ...paginationNodes]
  } else {
    // No reordering needed - preserve original order
    return children
  }
}

const generateElementNode: NodeToJSX<UIDLElementNode, types.JSXElement> = (
  node,
  params,
  jsxOptions
) => {
  const { dependencies, nodesLookup } = params
  const options = { ...DEFAULT_JSX_OPTIONS, ...jsxOptions }
  const { elementType, selfClosing, children, key, attrs, dependency, events } = node.content

  const originalElementName = elementType || 'component'
  let tagName = originalElementName

  // Check if this is a fragment element - normalize to Fragment before processing
  const isFragment = tagName.toLowerCase() === 'fragment'
  if (isFragment) {
    tagName = 'Fragment'
  }

  if (dependency) {
    if (
      options.dependencyHandling === 'import' ||
      (options.dependencyHandling === 'ignore' && dependency?.type === 'package')
    ) {
      const existingDependency = dependencies[tagName]
      if (existingDependency && existingDependency?.path !== dependency?.path) {
        tagName = `${StringUtils.dashCaseToUpperCamelCase(
          StringUtils.removeIllegalCharacters(dependency.path)
        )}${tagName}`
        dependencies[tagName] = {
          ...dependency,
          meta: {
            ...dependency.meta,
            originalName: originalElementName,
          },
        }
      } else {
        // Make a copy to avoid reference leaking
        dependencies[tagName] = { ...dependency }
      }
    }

    if (dependency?.meta && `needsWindowObject` in dependency.meta) {
      const dynamicWindowImport = generateDynamicWindowImport('useEffect', dependency.path)
      params.windowImports[dependency.path] = dynamicWindowImport
    }
  } else if (isFragment) {
    // If no dependency was provided but this is a fragment, add Fragment dependency
    if (options.dependencyHandling === 'import') {
      dependencies.Fragment = {
        type: 'package',
        path: 'react',
        version: 'latest',
        meta: {
          namedImport: true,
        },
      }
    }
  }

  const elementName =
    dependency && dependency.type === 'local' && options.customElementTag
      ? options.customElementTag(tagName)
      : tagName

  const elementTag = selfClosing ? createSelfClosingJSXTag(elementName) : createJSXTag(elementName)

  if (attrs) {
    addAttributesToJSXTag(attrs, elementTag, options, params)
  }

  if (events) {
    Object.keys(events).forEach((eventKey) => {
      addEventHandlerToTag(elementTag, eventKey, events[eventKey], params, options)
    })
  }

  if (!selfClosing && children) {
    // Reorder children to ensure search nodes appear before DataProvider nodes
    const reorderedChildren = reorderChildrenForSearch(children)

    reorderedChildren.forEach((child) => {
      const childTags = generateNode(child, params, options)
      childTags.forEach((childTag) => {
        if (typeof childTag === 'string') {
          addChildJSXText(elementTag, childTag)
        } else if (childTag.type === 'JSXExpressionContainer' || childTag.type === 'JSXElement') {
          addChildJSXTag(elementTag, childTag)
        } else {
          addChildJSXTag(elementTag, types.jsxExpressionContainer(childTag))
        }
      })
    })
  }

  nodesLookup[key] = elementTag
  return elementTag
}

export default generateElementNode

const addAttributesToJSXTag = (
  attrs: UIDLElement['attrs'],
  elementTag: types.JSXElement,
  options: JSXGenerationOptions,
  params: JSXGenerationParams
) => {
  Object.keys(attrs ?? {}).forEach((attrKey) => {
    const attributeValue = attrs[attrKey]

    if (!attributeValue.type) {
      return
    }

    switch (attributeValue.type) {
      case 'dynamic':
        const {
          content: { referenceType },
        } = attributeValue

        switch (referenceType) {
          default:
            const prefix =
              options.dynamicReferencePrefixMap[referenceType as 'prop' | 'state' | 'local']
            addDynamicAttributeToJSXTag(
              elementTag,
              attrKey,
              (attributeValue as UIDLDynamicReference).content.id,
              prefix
            )

            break
        }
        break
      case 'import':
        addDynamicAttributeToJSXTag(elementTag, attrKey, attributeValue.content.id)
        break
      case 'raw':
        addRawAttributeToJSXTag(elementTag, attrKey, attributeValue)
        break
      case 'comp-style':
      case 'static':
        addAttributeToJSXTag(elementTag, attrKey, attributeValue.content)
        break
      case 'expr':
        addDynamicExpressionAttributeToJSXTag(elementTag, attributeValue, attrKey)
        break

      case 'element':
        addAttributeToJSXTag(
          elementTag,
          attrKey,
          generateElementNode(attributeValue, params, options)
        )

        break

      case 'object': {
        const content = attributeValue.content
        if (typeof content !== 'object') {
          return
        }
        const expression = objectToObjectExpression(content as Record<string, unknown>)
        elementTag.openingElement.attributes.push(
          types.jsxAttribute(types.jsxIdentifier(attrKey), types.jsxExpressionContainer(expression))
        )
        break
      }

      default:
        throw new Error(
          `generateElementNode could not generate code for attribute of type ${JSON.stringify(
            attributeValue
          )}`
        )
    }
  })
}

const generateNode: NodeToJSX<UIDLNode, JSXASTReturnType[]> = (node, params, options) => {
  switch (node.type) {
    case 'expr':
      return [generateExpressionNode(node, params, options)]

    case 'raw':
      return [
        options.domHTMLInjection
          ? options.domHTMLInjection(node.content.toString())
          : node.content.toString(),
      ]

    case 'inject':
      if (node?.dependency) {
        params.dependencies.Script = node.dependency
      }
      return [node.content.toString()]

    case 'static':
      return [StringUtils.encode(node.content.toString())]

    case 'dynamic':
      switch (node.content.referenceType) {
        case 'prop': {
          // If the dynamic node is a prop and has a default value of type UIDLElementNode,
          // we should use it with a logical expression.
          const prop = params.propDefinitions[node.content.id]
          if (prop?.type === 'element' && prop.defaultValue) {
            const prefix = options.dynamicReferencePrefixMap[node.content.referenceType] || ''

            const propDefault = prop.defaultValue as UIDLElementNode
            const jsxNode = params.nodesLookup[propDefault.content.key]

            if (jsxNode === undefined) {
              throw Error(`Prop ${node.content.id} is of type element \n
              The JSXNode of the prop-${node.content.id} is missing from the nodesLookup`)
            }

            return [
              types.logicalExpression(
                '??',
                prefix === ''
                  ? types.identifier(node.content.id)
                  : types.memberExpression(
                      types.identifier(prefix),
                      types.identifier(node.content.id)
                    ),
                jsxNode as types.JSXElement
              ),
            ]
          }

          return [createDynamicValueExpression(node, options)]
        }

        case 'locale': {
          // Locale is not handled the same in all frameworks.
          // So, we need to handle it differently using individual plugins for each framework.
          const emptyExpression = types.jsxEmptyExpression()
          emptyExpression.innerComments = [
            {
              type: 'CommentBlock',
              value: `locale-${node.content.id}`,
            },
          ]
          const expression = types.jsxExpressionContainer(emptyExpression)
          const jsxTag = createJSXTag('span')
          addChildJSXTag(jsxTag, expression)

          params.localeReferences.push(jsxTag)
          return [jsxTag]
        }

        case 'global': {
          params.globalReferences.push(node.content.id)
          return [createDynamicValueExpression(node, options)]
        }

        default:
          return [createDynamicValueExpression(node, options)]
      }

    case 'cms-item':
    case 'cms-list':
      return generateCMSNode(node, params, options)

    case 'cms-list-repeater':
      return generateCMSListRepeaterNode(node, params, options)

    case 'cms-mixed-type':
      return generateCMSMixedTypeNode(node, params, options)

    case 'data-source-item':
    case 'data-source-list':
      return generateDataSourceNode(node, params, options)

    case 'element':
      // Check if this element node is wrapping a data-source node
      if (
        node.content &&
        typeof node.content === 'object' &&
        'type' in node.content &&
        (node.content.type === 'data-source-item' || node.content.type === 'data-source-list')
      ) {
        // Treat it as a data-source node
        // tslint:disable-next-line:no-any
        return generateDataSourceNode(node.content as any, params, options)
      }
      return [generateElementNode(node, params, options)]

    case 'repeat':
      return generateRepeatNode(node, params, options)

    case 'conditional':
      return generateConditionalNode(node, params, options)

    case 'slot':
      if (options.slotHandling === 'native') {
        return [generateNativeSlotNode(node, params, options)]
      } else {
        return generatePropsSlotNode(node, params, options)
      }

    default:
      throw new Error(
        `generateNodeSyntax encountered a node of unsupported type: ${JSON.stringify(
          node,
          null,
          2
        )}`
      )
  }
}

const generateExpressionNode: NodeToJSX<UIDLExpressionValue, types.JSXExpressionContainer> = (
  node
) => {
  const expression = ASTUtils.getExpressionFromUIDLExpressionNode(node)

  // Wrap expression to safely handle objects/arrays: (typeof val === 'object' && val !== null) ? JSON.stringify(val) : val
  const safeExpression = types.conditionalExpression(
    types.logicalExpression(
      '&&',
      types.binaryExpression(
        '===',
        types.unaryExpression('typeof', expression, true),
        types.stringLiteral('object')
      ),
      types.binaryExpression('!==', expression, types.nullLiteral())
    ),
    types.callExpression(
      types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
      [expression]
    ),
    expression
  )

  return types.jsxExpressionContainer(safeExpression)
}

const generateCMSMixedTypeNode: NodeToJSX<UIDLCMSMixedTypeNode, types.JSXElement[]> = (
  node,
  params,
  options
) => {
  const {
    nodes: { error, fallback },
    elementType,
    renderPropIdentifier,
    mappings = {},
    attrs,
    dependency,
  } = node.content
  const jsxTag = StringUtils.dashCaseToUpperCamelCase(elementType)
  const cmsMixedNode = ASTBuilders.createJSXTag(jsxTag, [], true)
  const mappingsObject: types.ObjectProperty[] = []

  if (attrs) {
    addAttributesToJSXTag(attrs, cmsMixedNode, options, params)
  }

  if (dependency) {
    params.dependencies[elementType] = dependency
  }

  Object.keys(mappings).forEach((key) => {
    const element = generateElementNode(mappings[key], params, options)
    mappingsObject.push(
      types.objectProperty(
        types.identifier(`"${key}"`),
        types.arrowFunctionExpression([types.identifier(renderPropIdentifier)], element)
      )
    )
  })

  cmsMixedNode.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('mappingConfiguration'),
      types.jsxExpressionContainer(types.objectExpression(mappingsObject))
    )
  )

  if (fallback) {
    cmsMixedNode.openingElement.attributes.push(
      types.jSXAttribute(
        types.jsxIdentifier('renderDefault'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression(
            [types.identifier(renderPropIdentifier)],
            generateElementNode(fallback, params, options)
          )
        )
      )
    )
  }

  if (error) {
    cmsMixedNode.openingElement.attributes.push(
      types.jSXAttribute(
        types.jsxIdentifier('renderError'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression(
            [types.identifier(renderPropIdentifier)],
            generateElementNode(error, params, options)
          )
        )
      )
    )
  }

  return [cmsMixedNode]
}

const generateCMSNode: NodeToJSX<UIDLCMSListNode | UIDLCMSItemNode, types.JSXElement[]> = (
  node,
  params,
  options
) => {
  const {
    initialData,
    key,
    renderPropIdentifier,
    resource: { params: resourceParams } = {},
    router,
    elementType,
    dependency,
  } = node.content
  const { loading, error, success } = node.content.nodes
  const jsxTag = StringUtils.dashCaseToUpperCamelCase(elementType)

  if (router && options?.dependencyHandling === 'import') {
    params.dependencies.useRouter = router
  }

  if (!success) {
    return []
  }

  if (dependency && options.dependencyHandling === 'import') {
    params.dependencies[elementType] = dependency
  }

  const cmsNode = ASTBuilders.createJSXTag(jsxTag, [], true)

  if (node.type === 'cms-item') {
    cmsNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('renderSuccess'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression(
            [types.identifier(renderPropIdentifier)],
            generateNode(success, params, options)[0] as types.JSXElement
          )
        )
      )
    )
  }

  if (node.type === 'cms-list') {
    cmsNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('renderSuccess'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression(
            [types.identifier('params')],
            generateNode(success, params, options)[0] as types.JSXElement
          )
        )
      )
    )
  }
  if (dependency && options.dependencyHandling === 'import') {
    params.dependencies.Repeater = dependency
  }
  if (loading) {
    cmsNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('renderLoading'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression(
            [],
            generateNode(loading, params, options)[0] as types.JSXElement
          )
        )
      )
    )
  }

  if (error) {
    cmsNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('renderError'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression(
            [],
            generateNode(error, params, options)[0] as types.JSXElement
          )
        )
      )
    )
  }

  if (initialData && initialData.content.referenceType === 'prop') {
    cmsNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('initialData'),
        types.jsxExpressionContainer(
          types.memberExpression(
            types.identifier(options.dynamicReferencePrefixMap[initialData.content.referenceType]),
            types.identifier(initialData.content.id)
          )
        )
      )
    )

    cmsNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('persistDataDuringLoading'),
        types.jsxExpressionContainer(types.booleanLiteral(true))
      )
    )

    let keyValue = 'props?.pagination?.page'

    if (node.type === 'cms-item') {
      const { entityKeyProperty } = node.content
      const entityName = initialData.content.id
      keyValue = entityKeyProperty
        ? `props?.${entityName}?.${entityKeyProperty}`
        : `props?.${entityName}?.id`
    }

    cmsNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('key'),
        types.jsxExpressionContainer(types.identifier(keyValue))
      )
    )
  }

  if (Object.keys(resourceParams || {}).length > 0) {
    const nodeParams: types.ObjectProperty[] = Object.keys(resourceParams).reduce(
      (acc: types.ObjectProperty[], attrKey) => {
        const property = resourceParams[attrKey]

        if (property.type === 'static') {
          acc.push(types.objectProperty(types.stringLiteral(attrKey), resolveObjectValue(property)))
        }

        if (property.type === 'expr') {
          const expression = ASTUtils.getExpressionFromUIDLExpressionNode(property)
          acc.push(types.objectProperty(types.stringLiteral(attrKey), expression))
        }

        if (property.type === 'dynamic') {
          acc.push(
            types.objectProperty(
              types.stringLiteral(attrKey),
              property.content.referenceType === 'prop'
                ? types.memberExpression(
                    types.identifier(
                      options.dynamicReferencePrefixMap[property.content.referenceType]
                    ),
                    types.identifier(property.content.id)
                  )
                : types.identifier(property.content.id)
            )
          )
        }

        return acc
      },
      []
    )
    cmsNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('params'),
        types.jsxExpressionContainer(types.objectExpression(nodeParams))
      )
    )
  }

  params.nodesLookup[key] = cmsNode
  return [cmsNode]
}

const generateDataSourceNode: NodeToJSX<
  UIDLDataSourceItemNode | UIDLDataSourceListNode,
  types.JSXElement[]
> = (node, params, options) => {
  const { renderPropIdentifier, elementType, dependency, resourceDefinition } = node.content

  const key = node.content.key || `ds-${resourceDefinition.dataSourceId}-${Date.now()}`
  const name = node.content.name || renderPropIdentifier

  // tslint:disable-next-line:no-any
  const children =
    node.content.children && node.content.children.length > 0
      ? node.content.children
      : (node.content as any).nodes?.success
      ? [(node.content as any).nodes.success]
      : []

  const jsxTag = StringUtils.dashCaseToUpperCamelCase(elementType)

  if (dependency && options.dependencyHandling === 'import') {
    params.dependencies[elementType] = dependency
  }

  const dataSourceNode = ASTBuilders.createJSXTag(jsxTag, [], true)

  dataSourceNode.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('resourceDefinition'),
      types.jsxExpressionContainer(
        types.objectExpression([
          types.objectProperty(
            types.stringLiteral('type'),
            types.stringLiteral('external-data-source')
          ),
          types.objectProperty(
            types.stringLiteral('dataSourceId'),
            types.stringLiteral(resourceDefinition.dataSourceId)
          ),
          types.objectProperty(
            types.stringLiteral('tableName'),
            types.stringLiteral(resourceDefinition.tableName)
          ),
          types.objectProperty(
            types.stringLiteral('dataSourceType'),
            types.stringLiteral(resourceDefinition.dataSourceType)
          ),
        ])
      )
    )
  )

  dataSourceNode.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('name'),
      types.jsxExpressionContainer(types.stringLiteral(name))
    )
  )

  if (children && children.length > 0) {
    const childrenNodes = children.flatMap((child) => generateNode(child, params, options))
    const renderFunction = types.arrowFunctionExpression(
      [types.identifier(renderPropIdentifier)],
      types.jsxFragment(
        types.jsxOpeningFragment(),
        types.jsxClosingFragment(),
        childrenNodes as types.JSXElement[]
      )
    )
    dataSourceNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('renderSuccess'),
        types.jsxExpressionContainer(renderFunction)
      )
    )
  }

  // tslint:disable-next-line:no-any
  if ((node.content as any).nodes?.loading) {
    // tslint:disable-next-line:no-any
    const loadingNode = generateNode((node.content as any).nodes.loading, params, options)[0]
    dataSourceNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('renderLoading'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression([], loadingNode as types.JSXElement)
        )
      )
    )
  }

  // tslint:disable-next-line:no-any
  if ((node.content as any).nodes?.error) {
    // tslint:disable-next-line:no-any
    const errorNode = generateNode((node.content as any).nodes.error, params, options)[0]
    dataSourceNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('renderError'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression([], errorNode as types.JSXElement)
        )
      )
    )
  }

  // Add resource params if they exist
  // tslint:disable-next-line:no-any
  const resourceParams = (node.content as any).resource?.params
  if (resourceParams && Object.keys(resourceParams).length > 0) {
    const nodeParams: types.ObjectProperty[] = Object.keys(resourceParams).reduce(
      (acc: types.ObjectProperty[], attrKey) => {
        const property = resourceParams[attrKey]

        if (property.type === 'static') {
          // Special handling for filters array - convert dynamic destinations
          if (attrKey === 'filters' && Array.isArray(property.content)) {
            acc.push(
              types.objectProperty(
                types.stringLiteral(attrKey),
                types.arrayExpression(
                  property.content.map(
                    (filter: { source?: string; destination?: unknown; operand?: string }) =>
                      types.objectExpression([
                        types.objectProperty(
                          types.identifier('source'),
                          types.stringLiteral(filter.source || '')
                        ),
                        types.objectProperty(
                          types.identifier('destination'),
                          ASTUtils.convertFilterDestinationToExpression(filter.destination, {
                            dynamicReferencePrefixMap: options.dynamicReferencePrefixMap,
                          })
                        ),
                        types.objectProperty(
                          types.identifier('operand'),
                          types.stringLiteral(filter.operand || '')
                        ),
                      ])
                  )
                )
              )
            )
          } else {
            acc.push(
              types.objectProperty(types.stringLiteral(attrKey), resolveObjectValue(property))
            )
          }
        }

        if (property.type === 'expr') {
          const expression = ASTUtils.getExpressionFromUIDLExpressionNode(property)
          acc.push(types.objectProperty(types.stringLiteral(attrKey), expression))
        }

        if (property.type === 'dynamic') {
          const refType = property.content.referenceType as 'prop' | 'state' | 'local'
          acc.push(
            types.objectProperty(
              types.stringLiteral(attrKey),
              property.content.referenceType === 'prop'
                ? types.memberExpression(
                    types.identifier(options.dynamicReferencePrefixMap[refType]),
                    types.identifier(property.content.id)
                  )
                : types.identifier(property.content.id)
            )
          )
        }

        return acc
      },
      []
    )
    dataSourceNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('params'),
        types.jsxExpressionContainer(types.objectExpression(nodeParams))
      )
    )
  }

  params.nodesLookup[key] = dataSourceNode
  return [dataSourceNode]
}

const generateRepeatNode: NodeToJSX<UIDLRepeatNode, types.JSXExpressionContainer[]> = (
  node,
  params,
  options
) => {
  const { node: repeatContent, dataSource, meta } = node.content
  const contentASTs = generateNode(repeatContent, params, options) as types.JSXElement[]

  const { iteratorName, iteratorKey } = UIDLUtils.getRepeatIteratorNameAndKey(meta)

  const localIteratorPrefix = options.dynamicReferencePrefixMap.local
  contentASTs.forEach((contentAST) => {
    addDynamicAttributeToJSXTag(contentAST, 'key', iteratorKey, localIteratorPrefix)
  })

  const source = getRepeatSourceIdentifier(dataSource, options)

  const arrowFunctionArguments = [types.identifier(iteratorName)]
  if (meta.useIndex) {
    arrowFunctionArguments.push(types.identifier('index'))
  }

  return contentASTs.map((contentAST) =>
    types.jsxExpressionContainer(
      types.callExpression(types.memberExpression(source, types.identifier('map')), [
        types.arrowFunctionExpression(arrowFunctionArguments, contentAST),
      ])
    )
  )
}

const generateConditionalNode: NodeToJSX<UIDLConditionalNode, types.LogicalExpression[]> = (
  node,
  params,
  options
) => {
  const { reference, value } = node.content
  const subTrees = generateNode(node.content.node, params, options)

  // Track global references used in conditionals
  if (
    reference.type === 'dynamic' &&
    'referenceType' in reference.content &&
    reference.content.referenceType === 'global'
  ) {
    params.globalReferences.push(reference.content.id)
  }

  const condition: UIDLConditionalExpression =
    value !== undefined && value !== null
      ? { conditions: [{ operand: value, operation: '===' }] }
      : node.content.condition

  const conditionIdentifier = createConditionIdentifier(reference, params, options)
  const conditionalExpressions: types.LogicalExpression[] = subTrees.map((subTree) =>
    createConditionalJSXExpression(subTree, condition, conditionIdentifier)
  )

  return conditionalExpressions
}

const generateCMSListRepeaterNode: NodeToJSX<UIDLCMSListRepeaterNode, types.JSXElement[]> = (
  node,
  params,
  options
) => {
  const jsxTag = StringUtils.dashCaseToUpperCamelCase(node.content.elementType)
  const repeaterNode = ASTBuilders.createJSXTag(jsxTag, [], true)

  repeaterNode.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('items'),
      types.jsxExpressionContainer(types.identifier(node.content.source ?? 'params'))
    )
  )

  const listElement = generateNode(node.content.nodes.list, params, {
    ...options,
    localIdentifier: node.content.renderPropIdentifier,
  })[0] as types.JSXElement

  // Create key as template literal: `${item?.id}${index}`
  const keyAttribute = types.jsxAttribute(
    types.jsxIdentifier('key'),
    types.jsxExpressionContainer(
      types.templateLiteral(
        [
          types.templateElement({ raw: '', cooked: '' }, false),
          types.templateElement({ raw: '', cooked: '' }, false),
          types.templateElement({ raw: '', cooked: '' }, true),
        ],
        [
          types.optionalMemberExpression(
            types.identifier(node.content.renderPropIdentifier),
            types.identifier('id'),
            false,
            true
          ),
          types.identifier('index'),
        ]
      )
    )
  )
  listElement.openingElement.attributes.push(keyAttribute)

  repeaterNode.openingElement.attributes.push(
    types.jsxAttribute(
      types.jSXIdentifier('renderItem'),
      types.jsxExpressionContainer(
        types.arrowFunctionExpression(
          [types.identifier(node.content.renderPropIdentifier), types.identifier('index')],
          listElement
        )
      )
    )
  )

  if ('empty' in node.content.nodes) {
    repeaterNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('renderEmpty'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression(
            [],
            generateNode(node.content.nodes.empty, params, options)[0] as types.JSXElement
          )
        )
      )
    )
  }

  if ('loading' in node.content.nodes) {
    generateNode(node.content.nodes.loading, params, options)
  }

  if (node.content?.dependency && options.dependencyHandling === 'import') {
    params.dependencies[jsxTag] = node.content.dependency
  }

  return [repeaterNode]
}

const generatePropsSlotNode: NodeToJSX<UIDLSlotNode, types.JSXExpressionContainer[]> = (
  node: UIDLSlotNode,
  params,
  options
) => {
  // React/Preact do not have native slot nodes and implement this differently through the props.children syntax.
  // Unfortunately, names slots are ignored because React/Preact treat all the inner content of the component as props.children
  const childrenProp: UIDLDynamicReference = {
    type: 'dynamic',
    content: {
      referenceType: 'prop',
      id: 'children',
    },
  }

  const childrenExpression = createDynamicValueExpression(childrenProp, options)

  if (node.content.fallback) {
    const fallbackContents = generateNode(node.content.fallback, params, options)
    // only static dynamic or element are allowed here

    return fallbackContents.map((fallbackContent) => {
      const fallbackNode =
        typeof fallbackContent === 'string'
          ? types.stringLiteral(fallbackContent)
          : (fallbackContent as types.JSXElement | types.MemberExpression)

      // props.children with fallback
      return types.jsxExpressionContainer(
        types.logicalExpression('||', childrenExpression, fallbackNode)
      )
    })
  }

  return [types.jsxExpressionContainer(childrenExpression)]
}

const generateNativeSlotNode: NodeToJSX<UIDLSlotNode, types.JSXElement> = (
  node,
  params,
  options
) => {
  const slotNode = createSelfClosingJSXTag('slot')

  if (node.content.name) {
    addAttributeToJSXTag(slotNode, 'name', node.content.name)
  }

  if (node.content.fallback) {
    const fallbackContents = generateNode(node.content.fallback, params, options)

    fallbackContents.forEach((fallbackContent) => {
      if (typeof fallbackContent === 'string') {
        addChildJSXText(slotNode, fallbackContent)
      } else if (fallbackContent.type === 'MemberExpression') {
        addChildJSXTag(slotNode, types.jsxExpressionContainer(fallbackContent))
      } else {
        addChildJSXTag(slotNode, fallbackContent as types.JSXElement)
      }
    })
  }

  return slotNode
}
