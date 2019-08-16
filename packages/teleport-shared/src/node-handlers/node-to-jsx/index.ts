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
  renameJSXTag,
} from '../../utils/ast-jsx-utils'
import { createJSXTag, createSelfClosingJSXTag } from '../../builders/ast-builders'
import { camelCaseToDashCase } from '../../utils/string-utils'

const generateJSXSyntax = (
  node: UIDLNode,
  params: JSXGenerationParams,
  options: JSXGenerationOptions = {
    dynamicReferencePrefixMap: {
      prop: '',
      state: '',
      local: '',
    },
    dependencyHandling: 'import',
    stateHandling: 'mutation',
    slotHandling: 'native',
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

export default generateJSXSyntax

const generateElementNode = (
  node: UIDLElementNode,
  params: JSXGenerationParams,
  options?: JSXGenerationOptions
) => {
  const { dependencies, nodesLookup } = params
  const { elementType, children, key, attrs, dependency, events } = node.content
  const elementTag = children ? createJSXTag(elementType) : createSelfClosingJSXTag(elementType)

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
    if (options.dependencyHandling === 'import') {
      // Make a copy to avoid reference leaking
      dependencies[elementType] = { ...dependency }
    } else {
      // Convert
      const rootElementIdentifier = elementTag.openingElement.name as types.JSXIdentifier
      const webComponentName = camelCaseToDashCase(rootElementIdentifier.name)
      renameJSXTag(elementTag, webComponentName)
    }
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

const generatePropsSlotNode = (
  node: UIDLSlotNode,
  params: JSXGenerationParams,
  options?: JSXGenerationOptions,
  t = types
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
    const fallbackContent = generateJSXSyntax(node.content.fallback, params, options)
    // only static dynamic or element are allowed here
    const fallbackNode =
      typeof fallbackContent === 'string'
        ? t.stringLiteral(fallbackContent)
        : (fallbackContent as types.JSXElement | types.MemberExpression)

    // props.children with fallback
    return t.jsxExpressionContainer(t.logicalExpression('||', childrenExpression, fallbackNode))
  }

  return t.jsxExpressionContainer(childrenExpression)
}

const generateNativeSlotNode = (
  node: UIDLSlotNode,
  params: JSXGenerationParams,
  options?: JSXGenerationOptions,
  t = types
) => {
  const slotNode = createSelfClosingJSXTag('slot')

  if (node.content.name) {
    addAttributeToJSXTag(slotNode, 'name', node.content.name)
  }

  if (node.content.fallback) {
    const fallbackContent = generateJSXSyntax(node.content.fallback, params, options)
    if (typeof fallbackContent === 'string') {
      addChildJSXText(slotNode, fallbackContent)
    } else if (fallbackContent.type === 'MemberExpression') {
      addChildJSXTag(slotNode, t.jsxExpressionContainer(fallbackContent))
    } else {
      addChildJSXTag(slotNode, fallbackContent as types.JSXElement)
    }
  }

  return slotNode
}
