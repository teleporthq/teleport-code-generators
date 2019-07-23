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

import { JSXGenerationParams, JSXGenerationOptions, JSXRootReturnType } from './types'

import {
  addEventHandlerToTag,
  createConditionIdentifier,
  createDynamicValueExpression,
  createConditionalJSXExpression,
  getRepeatSourceIdentifier,
} from './utils'

import { getRepeatIteratorNameAndKey } from '../../utils/uidl-utils'
import {
  addChildJSXText,
  addChildJSXTag,
  addAttributeToJSXTag,
  addDynamicAttributeToJSXTag,
} from '../../utils/ast-jsx-utils'
import { createJSXTag } from '../../builders/ast-builders'

const generateJSXSyntax = (
  node: UIDLNode,
  params: JSXGenerationParams,
  options: JSXGenerationOptions = {
    dynamicReferencePrefixMap: {
      prop: '',
      state: '',
      local: '',
    },
    useHooks: false,
  }
): JSXRootReturnType => {
  switch (node.type) {
    case 'static':
      return node.content.toString()

    case 'dynamic':
      return createDynamicValueExpression(node, options)

    case 'element':
      return generateElementNode(node, params, options)

    case 'repeat':
      return generateRepeatNode(node, params, options)

    case 'conditional':
      return generateConditionalNode(node, params, options)

    case 'slot':
      return generateSlotNode(node, params, options)

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

export default generateJSXSyntax

const generateElementNode = (
  node: UIDLElementNode,
  params: JSXGenerationParams,
  options?: JSXGenerationOptions
) => {
  const { dependencies, nodesLookup } = params
  const { elementType, children, key, attrs, dependency, events } = node.content
  const elementTag = createJSXTag(elementType)

  if (attrs) {
    Object.keys(attrs).forEach((attrKey) => {
      const attributeValue = attrs[attrKey]
      switch (attributeValue.type) {
        case 'dynamic':
          const {
            content: { id, referenceType },
          } = attributeValue
          const prefix = options.dynamicReferencePrefixMap[referenceType]
          addDynamicAttributeToJSXTag(elementTag, attrKey, id, prefix)
          break
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

  if (dependency) {
    // Make a copy to avoid reference leaking
    dependencies[elementType] = { ...dependency }
  }

  if (events) {
    Object.keys(events).forEach((eventKey) => {
      addEventHandlerToTag(elementTag, eventKey, events[eventKey], params, options)
    })
  }

  if (children) {
    children.forEach((child) => {
      const childTag = generateJSXSyntax(child, params, options)

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

const generateRepeatNode = (
  node: UIDLRepeatNode,
  params: JSXGenerationParams,
  options?: JSXGenerationOptions,
  t = types
) => {
  const { node: repeatContent, dataSource, meta } = node.content

  const contentAST = generateJSXSyntax(repeatContent, params, options)

  if (typeof contentAST === 'string' || (contentAST as types.JSXExpressionContainer).expression) {
    throw new Error(
      `generateRepeatNode found a repeat node that specified invalid content ${JSON.stringify(
        contentAST,
        null,
        2
      )}`
    )
  }

  const content = contentAST as types.JSXElement
  const { iteratorName, iteratorKey } = getRepeatIteratorNameAndKey(meta)

  const localIteratorPrefix = options.dynamicReferencePrefixMap.local
  addDynamicAttributeToJSXTag(content, 'key', iteratorKey, localIteratorPrefix)

  const source = getRepeatSourceIdentifier(dataSource, options)

  const arrowFunctionArguments = [t.identifier(iteratorName)]
  if (meta.useIndex) {
    arrowFunctionArguments.push(t.identifier('index'))
  }

  return t.jsxExpressionContainer(
    t.callExpression(t.memberExpression(source, t.identifier('map')), [
      t.arrowFunctionExpression(arrowFunctionArguments, content),
    ])
  )
}

const generateConditionalNode = (
  node: UIDLConditionalNode,
  params: JSXGenerationParams,
  options?: JSXGenerationOptions
) => {
  const { reference, value } = node.content
  const conditionIdentifier = createConditionIdentifier(reference, params, options)

  const subTree = generateJSXSyntax(node.content.node, params, options)

  const condition: UIDLConditionalExpression =
    value !== undefined && value !== null
      ? { conditions: [{ operand: value, operation: '===' }] }
      : node.content.condition

  return createConditionalJSXExpression(subTree, condition, conditionIdentifier)
}

const generateSlotNode = (
  node: UIDLSlotNode,
  params: JSXGenerationParams,
  options?: JSXGenerationOptions,
  t = types
) => {
  // TODO: Handle multiple slots with props['slot-name']
  const childrenProp: UIDLDynamicReference = {
    type: 'dynamic',
    content: {
      referenceType: 'prop',
      id: 'children',
    },
  }

  const childrenExpression = createDynamicValueExpression(childrenProp, options)

  if (node.content.fallback) {
    const fallbackContent = generateJSXSyntax(node.content.fallback, params, options)
    let expression: types.Expression

    if (typeof fallbackContent === 'string') {
      expression = t.stringLiteral(fallbackContent)
    } else if ((fallbackContent as types.JSXExpressionContainer).expression) {
      expression = (fallbackContent as types.JSXExpressionContainer).expression as types.Expression
    } else {
      expression = fallbackContent as types.JSXElement
    }

    // props.children with fallback
    return t.jsxExpressionContainer(t.logicalExpression('||', childrenExpression, expression))
  }

  return t.jsxExpressionContainer(childrenExpression)
}
