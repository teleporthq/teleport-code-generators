import { UIDLAttributeValue, UIDLElementNode } from '@teleporthq/teleport-types'
import { handleAttribute } from '../../../src/node-handlers/node-to-html/utils'
import { createHTMLNode } from '../../../src/builders/hast-builders'
import {
  HTMLTemplateGenerationParams,
  HTMLTemplateSyntax,
} from '../../../src/node-handlers/node-to-html/types'
import { DEFAULT_TEMPLATE_SYNTAX } from '../../../src/node-handlers/node-to-html/constants'

describe('handleAttribute', () => {
  it('handle an attribute with boolean value', () => {
    const htmlNode = createHTMLNode('div')
    const elementName = 'MyComponent'
    const attrKey = 'isVisible'
    const attrValue: UIDLAttributeValue = {
      type: 'static',
      content: false,
    }
    const params: HTMLTemplateGenerationParams = {
      dependencies: {},
      dataObject: {},
      methodsObject: {},
      templateLookup: {},
    }
    const templateSyntax: HTMLTemplateSyntax = DEFAULT_TEMPLATE_SYNTAX
    const node: UIDLElementNode = {
      type: 'element',
      content: {
        elementType: 'text',
        children: [
          {
            type: 'static',
            content: 'are you ok?',
          },
        ],
      },
    }
    handleAttribute(htmlNode, elementName, attrKey, attrValue, params, templateSyntax, node)
    expect(htmlNode.properties).toHaveProperty(`:${attrKey}`, attrValue.content)

    const attrKey1 = 'isOpen'
    const attrValue1: UIDLAttributeValue = {
      type: 'static',
      content: true,
    }

    handleAttribute(htmlNode, elementName, attrKey1, attrValue1, params, templateSyntax, node)
    expect(htmlNode.properties).toHaveProperty(attrKey1, '')
  })
})
