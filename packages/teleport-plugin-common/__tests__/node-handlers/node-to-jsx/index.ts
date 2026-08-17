import * as types from '@babel/types'
import componentUIDLSample from '../../../../../examples/test-samples/component-sample.json'
import generateJSXSyntax from '../../../src/node-handlers/node-to-jsx'

import { slotNode, elementNode, staticNode, dynamicNode } from '@teleporthq/teleport-uidl-builders'
import {
  JSXGenerationParams,
  JSXGenerationOptions,
} from '../../../src/node-handlers/node-to-jsx/types'
import { ComponentUIDL, UIDLNode } from '@teleporthq/teleport-types'

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

  describe('markdown-node with dynamic/expr children (CMS rich text)', () => {
    const buildParams = (): JSXGenerationParams => ({
      dependencies: {},
      propDefinitions: {},
      stateDefinitions: {},
      globalStateDefinitions: {},
      nodesLookup: {},
      windowImports: {},
      localeReferences: [],
      globalReferences: [],
      globalStateReferences: [],
      hoistedConstants: [],
    })

    // Asserts the element is a <Markdown>{<expr> || ''}</Markdown> tag from markdown-to-jsx,
    // which renders both markdown syntax and embedded HTML.
    const expectMarkdownTag = (result: types.JSXElement, localParams: JSXGenerationParams) => {
      expect((result.openingElement.name as types.JSXIdentifier).name).toBe('Markdown')

      const container = result.children[0] as types.JSXExpressionContainer
      expect(container.type).toBe('JSXExpressionContainer')
      // dynamic content is guarded with `<expr> || ''` so a nullish value renders empty
      expect((container.expression as types.LogicalExpression).operator).toBe('||')

      expect(localParams.dependencies.Markdown).toEqual({
        type: 'package',
        path: 'markdown-to-jsx',
        version: '7.7.12',
      })
    }

    it('renders an expr child through the markdown-to-jsx <Markdown> component', () => {
      const localParams = buildParams()
      const node = elementNode('markdown-node', {}, [
        { type: 'expr', content: 'props.cmsRichtext' } as UIDLNode,
      ])

      const result = generateJSXSyntax(node, localParams, options) as types.JSXElement

      expectMarkdownTag(result, localParams)
    })

    it('renders a dynamic child through the markdown-to-jsx <Markdown> component', () => {
      const localParams = buildParams()
      const node = elementNode('markdown-node', {}, [dynamicNode('prop', 'cmsRichtext')])

      const result = generateJSXSyntax(node, localParams, options) as types.JSXElement

      expectMarkdownTag(result, localParams)
    })

    it('leaves a non-markdown div with an expr child as a plain value', () => {
      const localParams = buildParams()
      const node = elementNode('container', {}, [
        { type: 'expr', content: 'props.cmsRichtext' } as UIDLNode,
      ])

      const result = generateJSXSyntax(node, localParams, options) as types.JSXElement

      // generic expression handling wraps in a typeof/JSON.stringify guard, no markdown render
      const container = result.children[0] as types.JSXExpressionContainer
      expect(container.expression.type).toBe('ConditionalExpression')
      expect((result.openingElement.name as types.JSXIdentifier).name).not.toBe('Markdown')
      expect(localParams.dependencies.Markdown).toBeUndefined()
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

    const buildTwoReferenceConditions = (matchingCriteria: string) =>
      ({
        reference: {
          type: 'dynamic',
          content: { referenceType: 'state', id: 'newsletterOfferVisible' },
        },
        condition: {
          conditions: [
            { operation: '===', operand: true },
            {
              operation: '===',
              operand: false,
              reference: {
                type: 'dynamic',
                content: { referenceType: 'state', id: 'userIsLoggedIn' },
              },
            },
          ],
          matchingCriteria,
        },
      } as never)

    it('compares each entry against its own reference when one is set (AND chain)', () => {
      const ownerContainer = elementNode('container', {}, [])
      ownerContainer.content.renderingConditions = buildTwoReferenceConditions('all')

      const wrappingParent = elementNode('container', {}, [ownerContainer])
      const twoStateParams: JSXGenerationParams = {
        ...params,
        stateDefinitions: {
          newsletterOfferVisible: { type: 'boolean', defaultValue: true },
          userIsLoggedIn: { type: 'boolean', defaultValue: false },
        },
        globalReferences: [],
        globalStateReferences: [],
      }
      const result = generateJSXSyntax(wrappingParent, twoStateParams, options)

      const expressionChild = result.children[0] as types.JSXExpressionContainer
      const outerLogical = expressionChild.expression as types.LogicalExpression
      expect(outerLogical.operator).toBe('&&')

      // Left side is the chained condition pair, joined with `&&` for 'all'.
      const conditionChain = outerLogical.left as types.LogicalExpression
      expect(conditionChain.type).toBe('LogicalExpression')
      expect(conditionChain.operator).toBe('&&')

      // `=== true` compiles to the bare identifier, `=== false` to `!identifier`
      // — i.e. `newsletterOfferVisible && !userIsLoggedIn`, the wild-log case.
      const firstComparison = conditionChain.left as types.Identifier
      const secondComparison = conditionChain.right as types.UnaryExpression
      expect(firstComparison.name).toBe('newsletterOfferVisible')
      expect(secondComparison.operator).toBe('!')
      expect((secondComparison.argument as types.Identifier).name).toBe('userIsLoggedIn')
    })

    it('chains mixed-reference entries with `||` when matchingCriteria is not "all"', () => {
      const ownerContainer = elementNode('container', {}, [])
      ownerContainer.content.renderingConditions = buildTwoReferenceConditions('||')

      const wrappingParent = elementNode('container', {}, [ownerContainer])
      const twoStateParams: JSXGenerationParams = {
        ...params,
        stateDefinitions: {
          newsletterOfferVisible: { type: 'boolean', defaultValue: true },
          userIsLoggedIn: { type: 'boolean', defaultValue: false },
        },
        globalReferences: [],
        globalStateReferences: [],
      }
      const result = generateJSXSyntax(wrappingParent, twoStateParams, options)

      const expressionChild = result.children[0] as types.JSXExpressionContainer
      const outerLogical = expressionChild.expression as types.LogicalExpression
      const conditionChain = outerLogical.left as types.LogicalExpression
      expect(conditionChain.operator).toBe('||')
      expect((conditionChain.left as types.Identifier).name).toBe('newsletterOfferVisible')
      expect(
        ((conditionChain.right as types.UnaryExpression).argument as types.Identifier).name
      ).toBe('userIsLoggedIn')
    })

    it('mixes a prop-referencing entry into a state-anchored chain with the right prefix', () => {
      const ownerContainer = elementNode('container', {}, [])
      ownerContainer.content.renderingConditions = {
        reference: {
          type: 'dynamic',
          content: { referenceType: 'state', id: 'menuOpen' },
        },
        condition: {
          conditions: [
            { operation: '===', operand: true },
            {
              operation: '===',
              operand: 'admin',
              reference: {
                type: 'dynamic',
                content: { referenceType: 'prop', id: 'role' },
              },
            },
          ],
          matchingCriteria: 'all',
        },
      } as never

      const wrappingParent = elementNode('container', {}, [ownerContainer])
      const mixedParams: JSXGenerationParams = {
        ...params,
        stateDefinitions: { menuOpen: { type: 'boolean', defaultValue: false } },
        propDefinitions: { role: { type: 'string', defaultValue: 'guest' } },
        globalReferences: [],
        globalStateReferences: [],
      }
      const result = generateJSXSyntax(wrappingParent, mixedParams, options)

      const expressionChild = result.children[0] as types.JSXExpressionContainer
      const conditionChain = (expressionChild.expression as types.LogicalExpression)
        .left as types.LogicalExpression

      // `=== true` on the boolean state compiles to the bare identifier.
      const stateComparison = conditionChain.left as types.Identifier
      expect(stateComparison.name).toBe('menuOpen')

      // The prop entry rides the `props.` prefix from the prefix map.
      const propComparison = conditionChain.right as types.BinaryExpression
      const propMember = propComparison.left as types.MemberExpression
      expect((propMember.object as types.Identifier).name).toBe('props')
      expect((propMember.property as types.Identifier).name).toBe('role')
      expect((propComparison.right as types.StringLiteral).value).toBe('admin')
    })

    it('tracks a globalState per-entry reference on params for context wiring', () => {
      const ownerContainer = elementNode('container', {}, [])
      ownerContainer.content.renderingConditions = {
        reference: {
          type: 'dynamic',
          content: { referenceType: 'state', id: 'menuOpen' },
        },
        condition: {
          conditions: [
            { operation: '===', operand: true },
            {
              operation: '===',
              operand: true,
              reference: {
                type: 'dynamic',
                content: { referenceType: 'globalState', id: 'darkMode' },
              },
            },
          ],
          matchingCriteria: 'all',
        },
      } as never

      const wrappingParent = elementNode('container', {}, [ownerContainer])
      const globalStateParams: JSXGenerationParams = {
        ...params,
        stateDefinitions: { menuOpen: { type: 'boolean', defaultValue: false } },
        globalStateDefinitions: {
          darkMode: { id: 'darkMode', name: 'darkMode', type: 'boolean', defaultValue: false },
        },
        globalReferences: [],
        globalStateReferences: [],
      }
      generateJSXSyntax(wrappingParent, globalStateParams, options)

      expect(globalStateParams.globalStateReferences).toEqual([
        { id: 'darkMode', name: 'darkMode' },
      ])
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

  describe('controlled <textarea> must not render children (React SSR contract)', () => {
    const buildParams = (): JSXGenerationParams => ({
      dependencies: {},
      propDefinitions: {},
      stateDefinitions: {},
      globalStateDefinitions: {},
      nodesLookup: {},
      windowImports: {},
      localeReferences: [],
      globalReferences: [],
      globalStateReferences: [],
      hoistedConstants: [],
    })

    it('drops the children of a textarea that has a value attribute', () => {
      // The details/entity binder can add value={{ ctx.field }} to a <textarea>
      // while leaving its original text child in place. React's server renderer
      // throws "If you supply value on a <textarea> you must not supply children",
      // aborting static export — so the children must not be attached.
      const localParams = buildParams()
      const node = elementNode('textarea', { value: dynamicNode('prop', 'description') }, [
        elementNode('span', {}, [dynamicNode('prop', 'description')]),
      ])
      const result = generateJSXSyntax(node, localParams, options) as types.JSXElement

      expect((result.openingElement.name as types.JSXIdentifier).name).toBe('textarea')
      expect(result.children.length).toBe(0)
      // The child <span> is still generated into nodesLookup so the later
      // styled-jsx traversal doesn't fail with "missing from the template chunk".
      expect(Object.keys(localParams.nodesLookup).length).toBeGreaterThanOrEqual(2)
    })

    it('drops the children of a textarea that has a defaultValue attribute', () => {
      const localParams = buildParams()
      const node = elementNode('textarea', { defaultValue: dynamicNode('prop', 'description') }, [
        elementNode('span', {}, [staticNode('initial')]),
      ])
      const result = generateJSXSyntax(node, localParams, options) as types.JSXElement
      expect(result.children.length).toBe(0)
    })

    it('keeps the children of an uncontrolled textarea (no value/defaultValue)', () => {
      const localParams = buildParams()
      const node = elementNode('textarea', {}, [staticNode('initial content')])
      const result = generateJSXSyntax(node, localParams, options) as types.JSXElement
      expect(result.children.length).toBeGreaterThan(0)
    })

    it('drops a stray dynamic (element/expression) child of an uncontrolled textarea', () => {
      // Run 97ac2650 "Add Note": a textarea whose value binding arrived as a
      // {{ }} CHILD (no value attr) was demoted to an element child — React
      // stringifies it to the literal "[object Object]". The backstop drops the
      // dynamic child so it can never render "[object Object]". (The primary fix
      // hoists the binding to a value= attr at import time.)
      const localParams = buildParams()
      const node = elementNode('textarea', {}, [
        elementNode('span', {}, [dynamicNode('prop', 'noteBody')]),
      ])
      const result = generateJSXSyntax(node, localParams, options) as types.JSXElement
      expect(result.children.length).toBe(0)
      // The dropped child is still generated into nodesLookup (styled-jsx pass).
      expect(Object.keys(localParams.nodesLookup).length).toBeGreaterThanOrEqual(2)
    })

    it('drops the children of a named textarea controlled by the form-store binding', () => {
      // maybeAddFormStoreFieldBinding injects value={formState['field'] ?? ''}
      // onto named inputs inside a data-store-values-state form AFTER the UIDL
      // attrs are processed — the textarea has NO value in its UIDL attrs but
      // ends up controlled all the same, so its children must also be skipped.
      const localParams = { ...buildParams(), formStoreStateName: 'formValues' }
      const node = elementNode('textarea', { name: staticNode('description') }, [
        staticNode('initial content'),
      ])
      const result = generateJSXSyntax(node, localParams, options) as types.JSXElement

      const hasInjectedValue = result.openingElement.attributes.some(
        (attr) =>
          attr.type === 'JSXAttribute' &&
          attr.name.type === 'JSXIdentifier' &&
          attr.name.name === 'value'
      )
      expect(hasInjectedValue).toBe(true)
      expect(result.children.length).toBe(0)
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
