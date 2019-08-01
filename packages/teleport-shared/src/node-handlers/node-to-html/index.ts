import * as htmlUtils from '../../utils/html-utils'
import { createHTMLNode } from '../../builders/html-builders'
import { getRepeatIteratorNameAndKey } from '../../utils/uidl-utils'
import { capitalize, dashCaseToUpperCamelCase } from '../../utils/string-utils'
import {
  UIDLElementNode,
  UIDLRepeatNode,
  UIDLConditionalNode,
  UIDLSlotNode,
  UIDLNode,
  HastNode,
} from '@teleporthq/teleport-types'
import {
  addStaticAttributeToNode,
  addDynamicAttributeToNode,
  generateConditionalStatement,
} from './utils'
import { HTMLTemplateGenerationParams } from './types'

const createHTMLTemplateSyntax = (
  node: UIDLNode,
  params: HTMLTemplateGenerationParams
): HastNode | string => {
  switch (node.type) {
    case 'static':
      return node.content.toString()

    case 'dynamic':
      return `{{${node.content.id}}}`

    case 'element':
      return generateElementNode(node, params)

    case 'repeat':
      return generateRepeatNode(node, params)

    case 'conditional':
      return generateConditionalNode(node, params)

    case 'slot':
      return generateSlotNode(node, params)

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

const generateElementNode = (node: UIDLElementNode, params: HTMLTemplateGenerationParams) => {
  const { dependencies, dataObject, methodsObject, templateLookup } = params
  const { elementType, name, key, children, attrs, dependency, events } = node.content
  const htmlNode = createHTMLNode(elementType)

  if (dependency) {
    dependencies[elementType] = { ...dependency }
  }

  if (attrs) {
    Object.keys(attrs).forEach((attrKey) => {
      const attrValue = attrs[attrKey]
      switch (attrValue.type) {
        case 'dynamic':
          addDynamicAttributeToNode(htmlNode, attrKey, attrValue.content.id)
          break
        case 'static':
          if (Array.isArray(attrValue.content)) {
            // This handles the cases when arrays are sent as props or passed as attributes
            // The array will be placed on the dataObject and the data reference is placed on the node
            const dataObjectIdentifier = `${name}${capitalize(attrKey)}`
            dataObject[dataObjectIdentifier] = attrValue.content
            addDynamicAttributeToNode(htmlNode, attrKey, dataObjectIdentifier)
          } else {
            addStaticAttributeToNode(htmlNode, attrKey, attrValue.content)
          }
          break
        default:
          throw new Error(
            `generateElementNode could not generate code for attribute of type ${JSON.stringify(
              attrValue
            )}`
          )
      }
    })
  }

  if (events) {
    Object.keys(events).forEach((eventKey) => {
      const eventHandlerKey = `@${eventKey}`
      if (events[eventKey].length === 1) {
        const statement = events[eventKey][0]
        const isPropEvent = statement && statement.type === 'propCall' && statement.calls

        if (isPropEvent) {
          htmlUtils.addAttributeToNode(
            htmlNode,
            eventHandlerKey,
            `this.$emit('${statement.calls}')`
          )
        } else {
          htmlUtils.addAttributeToNode(
            htmlNode,
            eventHandlerKey,
            statement.newState === '$toggle'
              ? `${statement.modifies} = !${statement.modifies}`
              : `${statement.modifies} = ${statement.newState}`
          )
        }
      } else {
        const methodName = `handle${dashCaseToUpperCamelCase(name)}${dashCaseToUpperCamelCase(
          eventKey
        )}`
        methodsObject[methodName] = events[eventKey]
        htmlUtils.addAttributeToNode(htmlNode, eventHandlerKey, methodName)
      }
    })
  }

  if (children) {
    children.forEach((child) => {
      const childTag = createHTMLTemplateSyntax(child, params)

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

export const generateRepeatNode = (node: UIDLRepeatNode, params: HTMLTemplateGenerationParams) => {
  const { dataSource, node: repeatContent, meta = {} } = node.content
  const repeatContentTag = createHTMLTemplateSyntax(repeatContent, params)
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
  const iterator = meta.useIndex ? `(${iteratorName}, index)` : iteratorName

  htmlUtils.addAttributeToNode(repeatContentTag, 'v-for', `${iterator} in ${dataObjectIdentifier}`)
  htmlUtils.addAttributeToNode(repeatContentTag, ':key', iteratorKey)
  return repeatContentTag
}

export const generateConditionalNode = (
  node: UIDLConditionalNode,
  params: HTMLTemplateGenerationParams
) => {
  let conditionalTag = createHTMLTemplateSyntax(node.content.node, params)
  // 'v-if' needs to be added on a tag, so in case of a text node we wrap it with
  // a 'span' which is the less intrusive of all
  if (typeof conditionalTag === 'string') {
    const wrappingSpan = createHTMLNode('span')
    htmlUtils.addTextNode(wrappingSpan, conditionalTag)
    conditionalTag = wrappingSpan
  }

  const conditionalStatement = generateConditionalStatement(node)
  htmlUtils.addAttributeToNode(conditionalTag, 'v-if', conditionalStatement)
  return conditionalTag
}

export const generateSlotNode = (node: UIDLSlotNode, params: HTMLTemplateGenerationParams) => {
  const slotNode = createHTMLNode('slot')

  if (node.content.name) {
    htmlUtils.addAttributeToNode(slotNode, 'name', node.content.name)
  }

  if (node.content.fallback) {
    const { fallback } = node.content
    const fallbackContent = createHTMLTemplateSyntax(fallback, params)

    if (typeof fallbackContent === 'string') {
      htmlUtils.addTextNode(slotNode, fallbackContent)
    } else {
      htmlUtils.addChildNode(slotNode, fallbackContent)
    }
  }

  return slotNode
}
