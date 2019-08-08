import { HTMLTemplateGenerationParams } from '../../../src/node-handlers/node-to-html/types'
import generateHTMLTemplateSyntax from '../../../src/node-handlers/node-to-html'
import { HastNode, HastText, ComponentUIDL } from '@teleporthq/teleport-types'
import { DEFAULT_TEMPLATE_SYNTAX } from '../../../src/node-handlers/node-to-html/constants'
import componentUIDLSample from '../../../../../examples/test-samples/component-sample.json'

const uidl = componentUIDLSample as ComponentUIDL

describe('generateHTMLTemplateSyntax', () => {
  const params: HTMLTemplateGenerationParams = {
    dependencies: {},
    dataObject: {},
    methodsObject: {},
    templateLookup: {},
  }

  describe('uidl node', () => {
    it('returns a HAST Syntax', () => {
      const result = generateHTMLTemplateSyntax(uidl.node, params, DEFAULT_TEMPLATE_SYNTAX)

      const hastElement = result as HastNode
      expect(hastElement.tagName).toBe('container')
      expect(hastElement.children.length).toBe(3)
      expect(hastElement.children[0].type).toBe('element')

      const firstChild = hastElement.children[0] as HastNode
      expect((firstChild.children[1] as HastText).value).toBe('{{ title }}')

      const secondChild = hastElement.children[1] as HastNode
      expect(secondChild.properties['v-for']).toBe('(item, index) in items')

      const thirdChild = hastElement.children[2] as HastNode
      expect(thirdChild.properties['v-if']).toBe('isVisible')
    })

    it('returns a HAST Syntax with custom syntax', () => {
      const result = generateHTMLTemplateSyntax(uidl.node, params, {
        ...DEFAULT_TEMPLATE_SYNTAX,
        conditionalAttr: 'test-condition',
        repeatAttr: 'test-repeat',
        interpolation: (value) => `[${value}]`,
      })

      const hastElement = result as HastNode
      expect(hastElement.tagName).toBe('container')
      expect(hastElement.children.length).toBe(3)
      expect(hastElement.children[0].type).toBe('element')

      const firstChild = hastElement.children[0] as HastNode
      expect((firstChild.children[1] as HastText).value).toBe('[title]')

      const secondChild = hastElement.children[1] as HastNode
      expect(secondChild.properties['test-repeat']).toBe('(item, index) in items')

      const thirdChild = hastElement.children[2] as HastNode
      expect(thirdChild.properties['test-condition']).toBe('isVisible')
    })
  })
})
