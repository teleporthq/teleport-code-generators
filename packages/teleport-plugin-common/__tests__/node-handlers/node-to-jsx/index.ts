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
    propDefinitions: uidl.propDefinitions || {},
    stateDefinitions: uidl.stateDefinitions || {},
    globalStateDefinitions: {},
    nodesLookup: {},
    windowImports: {},
    localeReferences: [],
    globalReferences: [],
    globalStateReferences: [],
    hoistedConstants: [],
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

  describe('renderingConditions on elements', () => {
    it('wraps the element with a logical `&&` when renderingConditions are set', () => {
      const ownerContainer = elementNode('container', {}, [])
      ownerContainer.content.renderingConditions = {
        reference: {
          type: 'dynamic',
          content: {
            referenceType: 'state',
            id: 'profileViewer',
            refPath: ['currentUserId'],
          },
        },
        condition: {
          conditions: [
            {
              operation: '===',
              operand: {
                type: 'dynamic',
                content: {
                  referenceType: 'local',
                  id: 'id',
                  refPath: ['id'],
                },
              },
            },
          ],
        },
      } as never

      const wrappingParent = elementNode('container', {}, [ownerContainer])
      const detailsParams: JSXGenerationParams = {
        ...params,
        globalReferences: [],
        detailsPageExposeAsName: 'User',
      }
      const result = generateJSXSyntax(wrappingParent, detailsParams, options)

      const expressionChild = result.children[0] as types.JSXExpressionContainer
      expect(expressionChild.type).toBe('JSXExpressionContainer')

      const logical = expressionChild.expression as types.LogicalExpression
      expect(logical.type).toBe('LogicalExpression')
      expect(logical.operator).toBe('&&')

      // The wrapped content is the original <container/>.
      const wrappedContent = logical.right as types.JSXElement
      expect(wrappedContent.type).toBe('JSXElement')
      expect((wrappedContent.openingElement.name as types.JSXIdentifier).name).toBe('container')
    })
  })

  describe('navlink href via differentiatorValue', () => {
    // The navlink attribute flow is exercised end-to-end in the resolver tests;
    // here we only confirm that an `expr`-typed attribute which mentions
    // `currentUser` registers a global reference so useGlobalContext() is wired
    // up downstream.
    it('tracks currentUser as a global reference when emitted via an expr attr', () => {
      const linkWithDifferentiatorHref = elementNode('a', {
        href: {
          type: 'expr',
          content: '`/profile/' + '$' + '{' + 'currentUser?.id}' + '`',
        },
      })
      const localParams: JSXGenerationParams = {
        ...params,
        globalReferences: [],
      }
      generateJSXSyntax(linkWithDifferentiatorHref, localParams, options)
      expect(localParams.globalReferences).toContain('currentUser')
    })
  })

  describe('plan v15 Layer 4 — codegen safety net for junk attrs and corrupt values', () => {
    // Suppress the console.warn that fires when junk attrs are dropped so
    // the test runner output stays clean. Reset between tests.
    let warnSpy: jest.SpyInstance | null = null
    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => {
      warnSpy?.mockRestore()
    })

    const attributeNames = (el: types.JSXElement): string[] =>
      el.openingElement.attributes
        .filter((a): a is types.JSXAttribute => a.type === 'JSXAttribute')
        .map((a) => (a.name as types.JSXIdentifier).name)

    it('drops junk-name attribute true="true"', () => {
      const node = elementNode('div', {
        true: { type: 'static', content: 'true' },
        class: { type: 'static', content: 'kept' },
      } as never)
      const result = generateJSXSyntax(node, params, options) as types.JSXElement
      const names = attributeNames(result)
      expect(names).not.toContain('true')
      expect(names).toContain('class')
    })

    it('drops junk-name attribute false="false"', () => {
      const node = elementNode('div', {
        false: { type: 'static', content: 'false' },
        class: { type: 'static', content: 'kept' },
      } as never)
      const result = generateJSXSyntax(node, params, options) as types.JSXElement
      expect(attributeNames(result)).not.toContain('false')
    })

    it('drops numeric-name attributes (e.g. 0="x")', () => {
      const node = elementNode('div', {
        '0': { type: 'static', content: 'x' },
        class: { type: 'static', content: 'kept' },
      } as never)
      const result = generateJSXSyntax(node, params, options) as types.JSXElement
      expect(attributeNames(result)).not.toContain('0')
    })

    it('drops null and undefined name attrs', () => {
      const node = elementNode('div', {
        null: { type: 'static', content: 'x' },
        undefined: { type: 'static', content: 'y' },
        class: { type: 'static', content: 'kept' },
      } as never)
      const result = generateJSXSyntax(node, params, options) as types.JSXElement
      const names = attributeNames(result)
      expect(names).not.toContain('null')
      expect(names).not.toContain('undefined')
    })

    it('drops entity-escaped binding markers in static attr values (&#123;)', () => {
      const node = elementNode('tq-if', {
        condition: { type: 'static', content: '&#123;&#123;state.X&#125;&#125;' },
      } as never)
      const result = generateJSXSyntax(node, params, options) as types.JSXElement
      expect(attributeNames(result)).not.toContain('condition')
    })

    it('drops static attr values with truncated `{{` (no closing `}}`)', () => {
      const node = elementNode('tq-if', {
        condition: { type: 'static', content: '{{state.isMobileMenuOpen' },
      } as never)
      const result = generateJSXSyntax(node, params, options) as types.JSXElement
      expect(attributeNames(result)).not.toContain('condition')
    })

    it('preserves well-formed static attrs (no false positives)', () => {
      const node = elementNode('div', {
        class: { type: 'static', content: 'foo' },
        'data-config': { type: 'static', content: '{"k":1}' },
        condition: { type: 'static', content: '{{state.X}}' },
      } as never)
      const result = generateJSXSyntax(node, params, options) as types.JSXElement
      const names = attributeNames(result)
      expect(names).toContain('class')
      expect(names).toContain('data-config')
      expect(names).toContain('condition')
    })
  })
})
