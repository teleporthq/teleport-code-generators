import * as types from '@babel/types'
import generateJSXSyntax from '../../../src/node-handlers/node-to-jsx'

import { slotNode, elementNode, staticNode } from '../../../src/builders/uidl-builders'
import {
  JSXGenerationParams,
  JSXGenerationOptions,
} from '../../../src/node-handlers/node-to-jsx/types'

describe('generateJSXSyntax', () => {
  describe('slot node', () => {
    const params: JSXGenerationParams = {
      dependencies: {},
      propDefinitions: null,
      stateDefinitions: null,
      nodesLookup: {},
    }

    const options: JSXGenerationOptions = {
      dynamicReferencePrefixMap: {
        prop: 'props',
        state: '',
        local: '',
      },
    }

    it('returns a props.children expression', () => {
      const node = slotNode()
      const result = generateJSXSyntax(node, params, { ...options, slotHandling: 'props' })

      const expression = result as types.JSXExpressionContainer
      expect(expression.expression.type).toBe('MemberExpression')

      const memberExpression = expression.expression as types.MemberExpression
      expect((memberExpression.object as types.Identifier).name).toBe('props')
      expect(memberExpression.property.name).toBe('children')
    })

    it('returns a props.children with fallback', () => {
      const node = slotNode(elementNode('span', {}, [staticNode('fallback')]))
      const result = generateJSXSyntax(node, params, { ...options, slotHandling: 'props' })

      const expression = result as types.JSXExpressionContainer
      expect(expression.expression.type).toBe('LogicalExpression')

      const logicalExpression = expression.expression as types.LogicalExpression
      const memberExpression = logicalExpression.left as types.MemberExpression
      const fallbackJSXNode = logicalExpression.right as types.JSXElement

      expect((memberExpression.object as types.Identifier).name).toBe('props')
      expect(memberExpression.property.name).toBe('children')

      expect((fallbackJSXNode.openingElement.name as types.JSXIdentifier).name).toBe('span')
    })

    it('returns a <slot> tag', () => {
      const node = slotNode()
      const result = generateJSXSyntax(node, params, { ...options, slotHandling: 'native' })

      const slotJSXTag = result as types.JSXElement
      expect((slotJSXTag.openingElement.name as types.JSXIdentifier).name).toBe('slot')
    })

    it('returns a <slot> tag with fallback', () => {
      const node = slotNode(elementNode('span', {}, [staticNode('fallback')]))
      const result = generateJSXSyntax(node, params, { ...options, slotHandling: 'native' })

      const slotJSXTag = result as types.JSXElement
      expect((slotJSXTag.openingElement.name as types.JSXIdentifier).name).toBe('slot')

      const slotFallbackJSXTag = slotJSXTag.children[0] as types.JSXElement
      expect((slotFallbackJSXTag.openingElement.name as types.JSXIdentifier).name).toBe('span')
    })

    it('returns a named <slot> tag', () => {
      const node = slotNode(null, 'hole')
      const result = generateJSXSyntax(node, params, { ...options, slotHandling: 'native' })

      const slotJSXTag = result as types.JSXElement
      expect((slotJSXTag.openingElement.name as types.JSXIdentifier).name).toBe('slot')

      const nameAttr = slotJSXTag.openingElement.attributes[0] as types.JSXAttribute
      expect(nameAttr.name.name).toBe('name')
      expect((nameAttr.value as types.StringLiteral).value).toBe('hole')
    })
  })
})
