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
} from '@teleporthq/teleport-types'
import { UIDLUtils, StringUtils } from '@teleporthq/teleport-shared'
import { JSXASTReturnType, NodeToJSX } from './types'

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
  addDynamicCtxAttributeToJSXTag,
} from '../../utils/ast-utils'
import { createJSXTag, createSelfClosingJSXTag } from '../../builders/ast-builders'
import { DEFAULT_JSX_OPTIONS } from './constants'

const generateElementNode: NodeToJSX<UIDLElementNode, types.JSXElement> = (
  node,
  params,
  jsxOptions
) => {
  const { dependencies, nodesLookup, projectContexts = {}, projectResources = {} } = params
  const options = { ...DEFAULT_JSX_OPTIONS, ...jsxOptions, projectContexts, projectResources }
  const { elementType, selfClosing, children, key, attrs, dependency, events } = node.content

  const originalElementName = elementType || 'component'
  let tagName = originalElementName

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
  }

  const elementName =
    dependency && dependency.type === 'local' && options.customElementTag
      ? options.customElementTag(tagName)
      : tagName
  const elementTag = selfClosing ? createSelfClosingJSXTag(elementName) : createJSXTag(elementName)

  if (attrs) {
    Object.keys(attrs).forEach((attrKey) => {
      const attributeValue = attrs[attrKey]

      switch (attributeValue.type) {
        case 'dynamic':
          const {
            content: { id, referenceType },
          } = attributeValue
          const prefix =
            options.dynamicReferencePrefixMap[referenceType as 'prop' | 'state' | 'local' | 'ctx']

          if (referenceType === 'expr') {
            addDynamicExpressionAttributeToJSXTag(elementTag, attributeValue, params)
            break
          }

          if (referenceType === 'ctx') {
            addDynamicCtxAttributeToJSXTag({
              jsxASTNode: elementTag,
              name: attrKey,
              attrValue: attributeValue,
              options: jsxOptions,
              generationParams: params,
            })
            break
          }

          addDynamicAttributeToJSXTag(elementTag, attrKey, id, prefix)
          break
        case 'import':
          addDynamicAttributeToJSXTag(elementTag, attrKey, attributeValue.content.id)
          break
        case 'raw':
          addRawAttributeToJSXTag(elementTag, attrKey, attributeValue)
          break
        case 'comp-style':
        case 'static':
          const { content } = attributeValue
          addAttributeToJSXTag(elementTag, attrKey, content)
          break
        default:
          throw new Error(
            `generateElementNode could not generate code for attribute of type ${JSON.stringify(
              attributeValue
            )}`
          )
      }
    })
  }

  if (events) {
    Object.keys(events).forEach((eventKey) => {
      addEventHandlerToTag(elementTag, eventKey, events[eventKey], params, options)
    })
  }

  if (!selfClosing && children) {
    children.forEach((child) => {
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

const generateNode: NodeToJSX<UIDLNode, JSXASTReturnType[]> = (node, params, options) => {
  switch (node.type) {
    case 'raw':
      return [
        options.domHTMLInjection
          ? options.domHTMLInjection(node.content.toString())
          : node.content.toString(),
      ]
    case 'static':
      return [StringUtils.encode(node.content.toString())]

    case 'dynamic':
      return [createDynamicValueExpression(node, options, undefined, params)]

    case 'cms-item':
      return generateCMSItemNode(node, params, options)

    case 'cms-list':
      return generateCMSListNode(node, params, options)

    case 'element':
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

const generateCMSItemNode: NodeToJSX<
  UIDLCMSItemNode,
  Array<types.JSXElement | types.LogicalExpression>
> = (node, params, options) => {
  const { success, error, loading } = node.content.nodes
  /*
   * TODO:
   * Adding `loading` and `error` states at the moment are being conntrolled by the UIDL.
   * But this needs to be changed, the generators itself should make the decision. Depending
   * on the style flavour that is being ued.
   */
  const { statePersistanceName } = node.content
  const loadingState = StringUtils.createStateOrPropStoringValue(`${statePersistanceName}Loading`)
  const errorState = StringUtils.createStateOrPropStoringValue(`${statePersistanceName}Error`)

  const errorNodeAST = error
    ? types.logicalExpression(
        '&&',
        types.identifier(errorState),
        generateElementNode(error, params, options) as types.JSXElement
      )
    : null

  const loadingNodeAST = loading
    ? types.logicalExpression(
        '&&',
        types.identifier(loadingState),
        generateElementNode(loading, params, options) as types.JSXElement
      )
    : null

  const successElementAST = generateElementNode(success, params, options)
  const successAST =
    !loading || !error
      ? successElementAST
      : types.logicalExpression(
          '&&',
          types.logicalExpression(
            '&&',
            types.unaryExpression('!', types.identifier(loadingState)),
            types.unaryExpression('!', types.identifier(errorState))
          ),
          successElementAST
        )

  return [...(loading ? [loadingNodeAST] : []), ...(error ? [errorNodeAST] : []), successAST]
}

const generateCMSListNode: NodeToJSX<
  UIDLCMSListNode,
  Array<types.JSXExpressionContainer | types.LogicalExpression>
> = (node, params, options) => {
  const { success, empty, error, loading } = node.content.nodes
  const { loopItemsReference, statePersistanceName } = node.content
  const { type } = loopItemsReference

  let errorNodeAST: types.JSXElement | null = null
  let emptyNodeAST: types.JSXElement | null = null
  let loadingNodeAST: types.JSXElement | null = null
  let listNodeAST: types.JSXElement | null = null
  const source = getRepeatSourceIdentifier(node.content.loopItemsReference, options)

  /*
   * TODO: @JK move this too into validator
   * CMS list node can only be a dynamic !!
   */
  if (type !== 'dynamic') {
    throw new Error(`Node ${node} is dynamic, but the referece link is missing. \n
      Missing loopItemsReference`)
  }

  const loadingStatePersistanceName = StringUtils.createStateOrPropStoringValue(
    `${statePersistanceName}Loading`
  )
  const errorStatePersistanceName = StringUtils.createStateOrPropStoringValue(
    `${statePersistanceName}Error`
  )

  if (empty) {
    emptyNodeAST = generateNode(empty, params, options)[0] as types.JSXElement
  }

  if (error) {
    errorNodeAST = generateNode(error, params, options)[0] as types.JSXElement
    params.stateDefinitions[`${statePersistanceName}Error`] = {
      type: 'boolean',
      defaultValue: false,
    }
  }

  if (loading) {
    loadingNodeAST = generateNode(loading, params, options)[0] as types.JSXElement
    params.stateDefinitions[`${statePersistanceName}Loading`] = {
      type: 'boolean',
      defaultValue: false,
    }
  }

  if (success) {
    listNodeAST = (generateNode(success, params, options) as types.JSXElement[])[0]
  }

  const emptyNodeExpressionAST = empty
    ? types.logicalExpression(
        '&&',
        types.unaryExpression('!', types.memberExpression(source, types.identifier('length'))),
        emptyNodeAST
      )
    : null

  const errorNodeExpressionAST =
    error && errorStatePersistanceName
      ? types.logicalExpression('&&', types.identifier(errorStatePersistanceName), errorNodeAST)
      : null

  const loadingNodeExpressionAST =
    loading && loadingStatePersistanceName
      ? types.logicalExpression('&&', types.identifier(loadingStatePersistanceName), loadingNodeAST)
      : null

  const { iteratorName, iteratorKey } = UIDLUtils.getRepeatIteratorNameAndKey({
    useIndex: true,
    iteratorName: 'item',
  })

  const localIteratorPrefix = options.dynamicReferencePrefixMap.local

  addDynamicAttributeToJSXTag(listNodeAST, 'key', iteratorKey, localIteratorPrefix)
  addDynamicAttributeToJSXTag(
    listNodeAST,
    'value',
    ['item', ...(node.content.itemValuePath || [])].join('.'),
    localIteratorPrefix
  )

  const arrowFunctionArguments = [types.identifier(iteratorName)]
  arrowFunctionArguments.push(types.identifier('index'))

  return [
    ...(emptyNodeExpressionAST ? [emptyNodeExpressionAST] : []),
    ...(errorNodeExpressionAST ? [errorNodeExpressionAST] : []),
    ...(loadingNodeExpressionAST ? [loadingNodeExpressionAST] : []),
    types.logicalExpression(
      '&&',
      types.memberExpression(source, types.identifier('length')),
      types.callExpression(types.memberExpression(source, types.identifier('map')), [
        types.arrowFunctionExpression(arrowFunctionArguments, listNodeAST),
      ])
    ),
  ]
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
  const conditionIdentifier = createConditionIdentifier(reference, params, options)

  const subTrees = generateNode(node.content.node, params, options)

  const condition: UIDLConditionalExpression =
    value !== undefined && value !== null
      ? { conditions: [{ operand: value, operation: '===' }] }
      : node.content.condition

  return subTrees.map((subTree) =>
    createConditionalJSXExpression(subTree, condition, conditionIdentifier)
  )
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
