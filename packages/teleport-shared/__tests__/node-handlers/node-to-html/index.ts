import { elementNode, staticNode } from '../../../src/builders/uidl-builders'
import { HTMLTemplateGenerationParams } from '../../../src/node-handlers/node-to-html/types'
import generateHTMLTemplateSyntax from '../../../src/node-handlers/node-to-html'
import { HastNode } from '@teleporthq/teleport-types'
import { DEFAULT_TEMPLATE_SYNTAX } from '../../../src/node-handlers/node-to-html/constants'

describe('generateHTMLTemplateSyntax', () => {
  const params: HTMLTemplateGenerationParams = {
    dependencies: {},
    dataObject: {},
    methodsObject: {},
    templateLookup: {},
  }

  it('returns a props.children expression', () => {
    const node = elementNode('container', { key: staticNode('value') }, [staticNode('Hello')])
    const result = generateHTMLTemplateSyntax(node, params, DEFAULT_TEMPLATE_SYNTAX)

    const hastElement = result as HastNode
    expect(hastElement.tagName).toBe('container')
    expect(hastElement.children[0].type).toBe('text')
  })
})
