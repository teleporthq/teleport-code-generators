import * as htmlUtils from '../../utils/html-utils'
import { createHTMLNode } from '../../builders/html-builders'
import { getRepeatIteratorNameAndKey } from '../../utils/uidl-utils'
import {
  UIDLElementNode,
  UIDLRepeatNode,
  UIDLConditionalNode,
  UIDLSlotNode,
  UIDLNode,
  HastNode,
} from '@teleporthq/teleport-types'
import { createConditionalStatement, handleAttribute, handleEvent } from './utils'
import { HTMLTemplateGenerationParams, HTMLTemplateSyntax } from './types'
import { DEFAULT_TEMPLATE_SYNTAX } from './constants'

type HTMLTemplateSyntaxFunction = (
  node: UIDLNode,
  params: HTMLTemplateGenerationParams,
  templateSyntax: HTMLTemplateSyntax
) => HastNode | string

const createHTMLTemplateSyntax: HTMLTemplateSyntaxFunction = (
  node,
  params,
  templateSyntax = DEFAULT_TEMPLATE_SYNTAX
) => {
  switch (node.type) {
    case 'static':
      return node.content.toString()

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

export default createHTMLTemplateSyntax

const generateElementNode = (
  node: UIDLElementNode,
  params: HTMLTemplateGenerationParams,
  templateSyntax: HTMLTemplateSyntax
) => {
  const { dependencies, templateLookup } = params
  const { elementType, name, key, children, attrs, dependency, events } = node.content
  const htmlNode = createHTMLNode(elementType)

  if (dependency) {
    dependencies[elementType] = { ...dependency }
  }

  if (attrs) {
    Object.keys(attrs).forEach((attrKey) => {
      const attrValue = attrs[attrKey]
      handleAttribute(htmlNode, name, attrKey, attrValue, params, templateSyntax)
    })
  }

  if (events) {
    Object.keys(events).forEach((eventKey) =>
      handleEvent(htmlNode, name, eventKey, events[eventKey], params, templateSyntax)
    )
  }

  if (children) {
    children.forEach((child) => {
      const childTag = createHTMLTemplateSyntax(child, params, templateSyntax)

      if (typeof childTag === 'string') {
        htmlUtils.addTextNode(htmlNode, childTag)
      } else {
        htmlUtils.addChildNode(htmlNode, childTag)
      }
    })
  }

  templateLookup[key] = htmlNode
  return htmlNode
}

const generateRepeatNode = (
  node: UIDLRepeatNode,
  params: HTMLTemplateGenerationParams,
  templateSyntax: HTMLTemplateSyntax
) => {
  const { dataSource, node: repeatContent, meta = {} } = node.content
  const repeatContentTag = createHTMLTemplateSyntax(repeatContent, params, templateSyntax)
  if (typeof repeatContentTag === 'string') {
    throw new Error(`generateRepeatNode received an invalid content ${repeatContentTag}`)
  }

  let dataObjectIdentifier = meta.dataSourceIdentifier || `items`
  if (dataSource.type === 'dynamic') {
    dataObjectIdentifier = dataSource.content.id
  } else {
    params.dataObject[dataObjectIdentifier] = dataSource.content
  }

  const { iteratorName, iteratorKey } = getRepeatIteratorNameAndKey(meta)
  const repeatIterator = templateSyntax.repeatIterator(
    iteratorName,
    dataObjectIdentifier,
    meta.useIndex
  )

  htmlUtils.addAttributeToNode(repeatContentTag, templateSyntax.repeatAttr, repeatIterator)
  htmlUtils.addAttributeToNode(repeatContentTag, templateSyntax.valueBinding('key'), iteratorKey)
  return repeatContentTag
}

const generateConditionalNode = (
  node: UIDLConditionalNode,
  params: HTMLTemplateGenerationParams,
  templateSyntax: HTMLTemplateSyntax
) => {
  let conditionalTag = createHTMLTemplateSyntax(node.content.node, params, templateSyntax)
  // conditional attribute needs to be added on a tag, so in case of a text node we wrap it with
  // a 'span' which is the less intrusive of all
  if (typeof conditionalTag === 'string') {
    const wrappingSpan = createHTMLNode('span')
    htmlUtils.addTextNode(wrappingSpan, conditionalTag)
    conditionalTag = wrappingSpan
  }

  const conditionalStatement = createConditionalStatement(node)
  htmlUtils.addAttributeToNode(conditionalTag, templateSyntax.conditionalAttr, conditionalStatement)
  return conditionalTag
}

const generateSlotNode = (
  node: UIDLSlotNode,
  params: HTMLTemplateGenerationParams,
  templateSyntax: HTMLTemplateSyntax
) => {
  const slotNode = createHTMLNode('slot')

  if (node.content.name) {
    htmlUtils.addAttributeToNode(slotNode, 'name', node.content.name)
  }

  if (node.content.fallback) {
    const { fallback } = node.content
    const fallbackContent = createHTMLTemplateSyntax(fallback, params, templateSyntax)

    if (typeof fallbackContent === 'string') {
      htmlUtils.addTextNode(slotNode, fallbackContent)
    } else {
      htmlUtils.addChildNode(slotNode, fallbackContent)
    }
  }

  return slotNode
}
