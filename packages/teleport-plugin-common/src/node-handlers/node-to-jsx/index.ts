import * as types from '@babel/types'
import {
  UIDLElementNode,
  UIDLRepeatNode,
  UIDLConditionalNode,
  UIDLConditionalExpression,
  UIDLDynamicReference,
  UIDLSlotNode,
  UIDLNode,
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
} from '../../utils/ast-utils'
import { createJSXTag, createSelfClosingJSXTag } from '../../builders/ast-builders'
import { DEFAULT_JSX_OPTIONS } from './constants'

const generateElementNode: NodeToJSX<UIDLElementNode, types.JSXElement> = (
  node,
  params,
  jsxOptions
) => {
  const options = { ...DEFAULT_JSX_OPTIONS, ...jsxOptions }
  const { dependencies, nodesLookup } = params
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
            options.dynamicReferencePrefixMap[referenceType as 'prop' | 'state' | 'local']
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
      const childTag = generateNode(child, params, options)

      if (typeof childTag === 'string') {
        addChildJSXText(elementTag, childTag)
      } else if (childTag.type === 'JSXExpressionContainer' || childTag.type === 'JSXElement') {
        addChildJSXTag(elementTag, childTag)
      } else {
        addChildJSXTag(elementTag, types.jsxExpressionContainer(childTag))
      }
    })
  }

  nodesLookup[key] = elementTag
  return elementTag
}

export default generateElementNode

const generateNode: NodeToJSX<UIDLNode, JSXASTReturnType> = (node, params, options) => {
  switch (node.type) {
    case 'inject':
      return node.content.toString()

    case 'raw':
      return options.domHTMLInjection
        ? options.domHTMLInjection(node.content.toString())
        : node.content.toString()

    case 'static':
      return StringUtils.encode(node.content.toString())

    case 'dynamic':
      return createDynamicValueExpression(node, options)

    case 'element':
      return generateElementNode(node, params, options)

    case 'repeat':
      return generateRepeatNode(node, params, options)

    case 'conditional':
      return generateConditionalNode(node, params, options)

    case 'slot':
      if (options.slotHandling === 'native') {
        return generateNativeSlotNode(node, params, options)
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

const generateRepeatNode: NodeToJSX<UIDLRepeatNode, types.JSXExpressionContainer> = (
  node,
  params,
  options
) => {
  const { node: repeatContent, dataSource, meta } = node.content

  const contentAST = generateElementNode(repeatContent, params, options)

  const { iteratorName, iteratorKey } = UIDLUtils.getRepeatIteratorNameAndKey(meta)

  const localIteratorPrefix = options.dynamicReferencePrefixMap.local
  addDynamicAttributeToJSXTag(contentAST, 'key', iteratorKey, localIteratorPrefix)

  const source = getRepeatSourceIdentifier(dataSource, options)

  const arrowFunctionArguments = [types.identifier(iteratorName)]
  if (meta.useIndex) {
    arrowFunctionArguments.push(types.identifier('index'))
  }

  return types.jsxExpressionContainer(
    types.callExpression(types.memberExpression(source, types.identifier('map')), [
      types.arrowFunctionExpression(arrowFunctionArguments, contentAST),
    ])
  )
}

const generateConditionalNode: NodeToJSX<UIDLConditionalNode, types.LogicalExpression> = (
  node,
  params,
  options
) => {
  const { reference, value } = node.content
  const conditionIdentifier = createConditionIdentifier(reference, params, options)

  const subTree = generateNode(node.content.node, params, options)

  const condition: UIDLConditionalExpression =
    value !== undefined && value !== null
      ? { conditions: [{ operand: value, operation: '===' }] }
      : node.content.condition

  return createConditionalJSXExpression(subTree, condition, conditionIdentifier)
}

const generatePropsSlotNode: NodeToJSX<UIDLSlotNode, types.JSXExpressionContainer> = (
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
    const fallbackContent = generateNode(node.content.fallback, params, options)
    // only static dynamic or element are allowed here
    const fallbackNode =
      typeof fallbackContent === 'string'
        ? types.stringLiteral(fallbackContent)
        : (fallbackContent as types.JSXElement | types.MemberExpression)

    // props.children with fallback
    return types.jsxExpressionContainer(
      types.logicalExpression('||', childrenExpression, fallbackNode)
    )
  }

  return types.jsxExpressionContainer(childrenExpression)
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
    const fallbackContent = generateNode(node.content.fallback, params, options)
    if (typeof fallbackContent === 'string') {
      addChildJSXText(slotNode, fallbackContent)
    } else if (fallbackContent.type === 'MemberExpression') {
      addChildJSXTag(slotNode, types.jsxExpressionContainer(fallbackContent))
    } else {
      addChildJSXTag(slotNode, fallbackContent as types.JSXElement)
    }
  }

  return slotNode
}
