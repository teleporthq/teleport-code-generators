import * as types from '@babel/types'
import componentUIDLSample from '../../../../../examples/test-samples/component-sample.json'
import generateJSXSyntax from '../../../src/node-handlers/node-to-jsx'

import { slotNode, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import {
  JSXGenerationParams,
  JSXGenerationOptions,
} from '../../../src/node-handlers/node-to-jsx/types'
import { ComponentUIDL } from '@teleporthq/teleport-types'

const uidl = componentUIDLSample as ComponentUIDL

describe('generateJSXSyntax', () => {
  const params: JSXGenerationParams = {
    dependencies: {},
    propDefinitions: uidl.propDefinitions,
    stateDefinitions: uidl.stateDefinitions,
    nodesLookup: {},
  }

  const options: JSXGenerationOptions = {
    dynamicReferencePrefixMap: {
      prop: 'props',
      state: '',
      local: '',
    },
  }

  describe('uidl node', () => {
    it('returns a JSX AST Syntax', () => {
      const result = generateJSXSyntax(uidl.node, params, { ...options, slotHandling: 'props' })

      const element = result as types.JSXElement

      expect(element.children.length).toBe(6)
      expect((element.openingElement.name as types.JSXIdentifier).name).toBe('container')
    })
  })

  describe('slot node', () => {
    it('returns a props.children expression', () => {
      const node = elementNode('container', {}, [slotNode()])
      const result = generateJSXSyntax(node, params, { ...options, slotHandling: 'props' })

      const expression = result.children[0] as types.JSXExpressionContainer
      expect(expression.expression.type).toBe('MemberExpression')

      const memberExpression = expression.expression as types.MemberExpression
      expect((memberExpression.object as types.Identifier).name).toBe('props')
      expect(memberExpression.property.name).toBe('children')
    })

    it('returns a props.children with fallback', () => {
      const node = elementNode('container', {}, [
        slotNode(elementNode('span', {}, [staticNode('fallback')])),
      ])
      const result = generateJSXSyntax(node, params, { ...options, slotHandling: 'props' })

      const expression = result.children[0] as types.JSXExpressionContainer
      expect(expression.expression.type).toBe('LogicalExpression')

      const logicalExpression = expression.expression as types.LogicalExpression
      const memberExpression = logicalExpression.left as types.MemberExpression
      const fallbackJSXNode = logicalExpression.right as types.JSXElement

      expect((memberExpression.object as types.Identifier).name).toBe('props')
      expect(memberExpression.property.name).toBe('children')

      expect((fallbackJSXNode.openingElement.name as types.JSXIdentifier).name).toBe('span')
    })

    it('returns a <slot> tag', () => {
      const node = elementNode('container', {}, [slotNode()])
      const result = generateJSXSyntax(node, params, { ...options, slotHandling: 'native' })

      const slotJSXTag = result.children[0] as types.JSXElement
      expect((slotJSXTag.openingElement.name as types.JSXIdentifier).name).toBe('slot')
    })

    it('returns a <slot> tag with fallback', () => {
      const node = elementNode('container', {}, [
        slotNode(elementNode('span', {}, [staticNode('fallback')])),
      ])
      const result = generateJSXSyntax(node, params, { ...options, slotHandling: 'native' })

      const slotJSXTag = result.children[0] as types.JSXElement
      expect((slotJSXTag.openingElement.name as types.JSXIdentifier).name).toBe('slot')

      const slotFallbackJSXTag = slotJSXTag.children[0] as types.JSXElement
      expect((slotFallbackJSXTag.openingElement.name as types.JSXIdentifier).name).toBe('span')
    })

    it('returns a named <slot> tag', () => {
      const node = elementNode('container', {}, [slotNode(null, 'hole')])
      const result = generateJSXSyntax(node, params, { ...options, slotHandling: 'native' })

      const slotJSXTag = result.children[0] as types.JSXElement
      expect((slotJSXTag.openingElement.name as types.JSXIdentifier).name).toBe('slot')

      const nameAttr = slotJSXTag.openingElement.attributes[0] as types.JSXAttribute
      expect(nameAttr.name.name).toBe('name')
      expect((nameAttr.value as types.StringLiteral).value).toBe('hole')
    })
  })
})
