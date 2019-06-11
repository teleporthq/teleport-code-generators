import * as types from '@babel/types'

import {
  UIDLElementNode,
  UIDLRepeatNode,
  UIDLConditionalNode,
  UIDLConditionalExpression,
  UIDLDynamicReference,
  UIDLSlotNode,
  NodeSyntaxGenerator,
} from '@teleporthq/teleport-types'
import { ReactComponentAccumulators, GenerateNodeSyntaxReturnValue } from './types'

import {
  addAttributeToNode,
  addEventHandlerToTag,
  makeRepeatStructureWithMap,
  createConditionIdentifier,
  makeDynamicValueExpression,
  createConditionalJSXExpression,
} from './utils'

import {
  generateASTDefinitionForJSXTag,
  addChildJSXText,
  addChildJSXTag,
} from '@teleporthq/teleport-shared/lib/utils/ast-jsx-utils'

import { ERROR_LOG_NAME } from './constants'

export const generateNodeSyntax: NodeSyntaxGenerator<
  ReactComponentAccumulators,
  GenerateNodeSyntaxReturnValue
> = (node, accumulators) => {
  switch (node.type) {
    case 'static':
      return node.content.toString()

    case 'dynamic':
      return makeDynamicValueExpression(node)

    case 'element':
      return generateElementNode(node, accumulators)

    case 'repeat':
      return generateRepeatNode(node, accumulators)

    case 'conditional':
      return generateConditionalNode(node, accumulators)

    case 'slot':
      return generateSlotNode(node, accumulators)

    default:
      throw new Error(
        `${ERROR_LOG_NAME} generateNodeSyntax encountered a node of unsupported type: ${JSON.stringify(
          node,
          null,
          2
        )}`
      )
  }
}

const generateElementNode = (node: UIDLElementNode, accumulators: ReactComponentAccumulators) => {
  const { dependencies, stateIdentifiers, propDefinitions, nodesLookup } = accumulators
  const { elementType, children, key, attrs, dependency, events } = node.content
  const elementTag = generateASTDefinitionForJSXTag(elementType)

  if (attrs) {
    Object.keys(attrs).forEach((attrKey) => {
      addAttributeToNode(elementTag, attrKey, attrs[attrKey])
    })
  }

  if (dependency) {
    // Make a copy to avoid reference leaking
    dependencies[elementType] = { ...dependency }
  }

  if (events) {
    Object.keys(events).forEach((eventKey) => {
      addEventHandlerToTag(
        elementTag,
        eventKey,
        events[eventKey],
        stateIdentifiers,
        propDefinitions
      )
    })
  }

  if (children) {
    children.forEach((child) => {
      const childTag = generateNodeSyntax(child, accumulators)

      if (typeof childTag === 'string') {
        addChildJSXText(elementTag, childTag)
      } else if (childTag.type === 'JSXExpressionContainer') {
        addChildJSXTag(elementTag, childTag)
      } else {
        addChildJSXTag(elementTag, types.jsxExpressionContainer(childTag))
      }
    })
  }

  nodesLookup[key] = elementTag
  return elementTag
}

const generateRepeatNode = (node: UIDLRepeatNode, accumulators: ReactComponentAccumulators) => {
  const { node: repeatContent, dataSource, meta } = node.content

  const contentAST = generateNodeSyntax(repeatContent, accumulators)

  if (typeof contentAST === 'string' || (contentAST as types.JSXExpressionContainer).expression) {
    throw new Error(
      `${ERROR_LOG_NAME} generateRepeatNode found a repeat node that specified invalid content ${JSON.stringify(
        contentAST,
        null,
        2
      )}`
    )
  }

  const repeatAST = makeRepeatStructureWithMap(dataSource, contentAST as types.JSXElement, meta)
  return repeatAST
}

const generateConditionalNode = (
  node: UIDLConditionalNode,
  accumulators: ReactComponentAccumulators
) => {
  const { reference, value } = node.content
  const conditionIdentifier = createConditionIdentifier(reference, accumulators)

  const subTree = generateNodeSyntax(node.content.node, accumulators)

  const condition: UIDLConditionalExpression =
    value !== undefined && value !== null
      ? { conditions: [{ operand: value, operation: '===' }] }
      : node.content.condition

  return createConditionalJSXExpression(subTree, condition, conditionIdentifier)
}

const generateSlotNode = (
  node: UIDLSlotNode,
  accumulators: ReactComponentAccumulators,
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

  const childrenExpression = makeDynamicValueExpression(childrenProp)

  if (node.content.fallback) {
    const fallbackContent = generateNodeSyntax(node.content.fallback, accumulators)
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
