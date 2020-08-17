import * as hastUtils from '../../utils/hast-utils'
import { createHTMLNode } from '../../builders/hast-builders'
import { UIDLUtils, StringUtils } from '@teleporthq/teleport-shared'
import {
  UIDLRepeatNode,
  UIDLConditionalNode,
  UIDLSlotNode,
  UIDLNode,
  UIDLElementNode,
  HastNode,
} from '@teleporthq/teleport-types'
import { createConditionalStatement, handleAttribute, handleEvent } from './utils'
import { NodeToHTML } from './types'
import { DEFAULT_TEMPLATE_SYNTAX } from './constants'

const generateElementNode: NodeToHTML<UIDLElementNode, HastNode> = (node, params, syntax) => {
  const templateSyntax = { ...DEFAULT_TEMPLATE_SYNTAX, ...syntax }
  const { dependencies, templateLookup } = params
  const { elementType, name, key, children, attrs, dependency, events, selfClosing } = node.content

  const originalElementName = elementType || 'component'
  const tagName = originalElementName
  let safeTagName =
    dependency && dependency.type === 'local'
      ? templateSyntax.customElementTagName(tagName)
      : tagName

  if (dependency) {
    const existingDependency = dependencies[tagName]
    safeTagName =
      existingDependency && existingDependency?.path !== dependency?.path
        ? `${StringUtils.dashCaseToUpperCamelCase(
            StringUtils.removeIllegalCharacters(dependency.path)
          )}${tagName}`
        : tagName

    if (templateSyntax.dependencyHandling === 'import' && dependency.type !== 'local') {
      dependencies[safeTagName] = { ...dependency }

      if (existingDependency && existingDependency?.path !== dependency?.path) {
        dependencies[safeTagName] = {
          ...dependency,
          meta: {
            ...dependency.meta,
            originalName: originalElementName,
          },
        }
      }
    } else if (dependency.type === 'local') {
      // local dependencies can be renamed based on their safety (eg: Header/header, Form/form)
      const safeImportName = StringUtils.dashCaseToUpperCamelCase(safeTagName)
      dependencies[safeImportName] = { ...dependency }
    }
  }

  const htmlNode = createHTMLNode(safeTagName)

  if (attrs) {
    Object.keys(attrs).forEach((attrKey) => {
      const attrValue = attrs[attrKey]
      handleAttribute(htmlNode, name, attrKey, attrValue, params, templateSyntax, node)
    })
  }

  if (events) {
    Object.keys(events).forEach((eventKey) =>
      handleEvent(htmlNode, name, eventKey, events[eventKey], params, templateSyntax)
    )
  }

  if (!selfClosing && children) {
    children.forEach((child) => {
      const childTag = generateNode(child, params, templateSyntax)

      if (typeof childTag === 'string') {
        hastUtils.addTextNode(htmlNode, childTag)
      } else {
        hastUtils.addChildNode(htmlNode, childTag)
      }
    })
  }

  templateLookup[key] = htmlNode
  return htmlNode
}

export default generateElementNode

const generateNode: NodeToHTML<UIDLNode, HastNode | string> = (node, params, templateSyntax) => {
  switch (node.type) {
    case 'raw':
      return generateRawHTMLNode(node, params, templateSyntax)
    case 'static':
      return StringUtils.encode(node.content.toString())

    case 'dynamic':
      return templateSyntax.interpolation(node.content.id)

    case 'element':
      return generateElementNode(node, params, templateSyntax)

    case 'repeat':
      return generateRepeatNode(node, params, templateSyntax)

    case 'conditional':
      return generateConditionalNode(node, params, templateSyntax)

    case 'slot':
      return generateSlotNode(node, params, templateSyntax)

    default:
      throw new Error(
        `generateHTMLSyntax encountered a node of unsupported type: ${JSON.stringify(
          node,
          null,
          2
        )}`
      )
  }
}

const generateRawHTMLNode: NodeToHTML<UIDLNode, HastNode> = (node, params, templateSyntax) => {
  const attrKey = templateSyntax.domHTMLInjection ? templateSyntax.domHTMLInjection : 'innerHTML'
  const htmlNode = createHTMLNode('span')
  const dataObjName = `${node.type}${StringUtils.generateRandomString()}`
  hastUtils.addAttributeToNode(htmlNode, attrKey, dataObjName)
  params.dataObject[dataObjName] = node.content.toString()
  return htmlNode
}

const generateRepeatNode: NodeToHTML<UIDLRepeatNode, HastNode> = (node, params, templateSyntax) => {
  const { dataSource, node: repeatContent, meta = {} } = node.content
  const repeatContentTag = generateElementNode(repeatContent, params, templateSyntax)

  let dataObjectIdentifier = meta.dataSourceIdentifier || `items`
  if (dataSource.type === 'dynamic') {
    dataObjectIdentifier = dataSource.content.id
  } else {
    params.dataObject[dataObjectIdentifier] = dataSource.content
  }

  const { iteratorName, iteratorKey } = UIDLUtils.getRepeatIteratorNameAndKey(meta)
  const repeatIterator = templateSyntax.repeatIterator(
    iteratorName,
    dataObjectIdentifier,
    meta.useIndex
  )

  hastUtils.addAttributeToNode(repeatContentTag, templateSyntax.repeatAttr, repeatIterator)
  hastUtils.addAttributeToNode(repeatContentTag, templateSyntax.valueBinding('key'), iteratorKey)
  return repeatContentTag
}

const generateConditionalNode: NodeToHTML<UIDLConditionalNode, HastNode> = (
  node,
  params,
  templateSyntax
) => {
  let conditionalTag = generateNode(node.content.node, params, templateSyntax)
  // conditional attribute needs to be added on a tag, so in case of a text node we wrap it with
  // a 'span' which is the less intrusive of all
  if (typeof conditionalTag === 'string') {
    const wrappingSpan = createHTMLNode('span')
    hastUtils.addTextNode(wrappingSpan, conditionalTag)
    conditionalTag = wrappingSpan
  }

  const conditionalStatement = createConditionalStatement(node)
  hastUtils.addAttributeToNode(conditionalTag, templateSyntax.conditionalAttr, conditionalStatement)
  return conditionalTag
}

const generateSlotNode: NodeToHTML<UIDLSlotNode, HastNode> = (node, params, templateSyntax) => {
  const slotNode = createHTMLNode('slot')

  if (node.content.name) {
    hastUtils.addAttributeToNode(slotNode, 'name', node.content.name)
  }

  if (node.content.fallback) {
    const { fallback } = node.content
    const fallbackContent = generateNode(fallback, params, templateSyntax)

    if (typeof fallbackContent === 'string') {
      hastUtils.addTextNode(slotNode, fallbackContent)
    } else {
      hastUtils.addChildNode(slotNode, fallbackContent)
    }
  }

  return slotNode
}
