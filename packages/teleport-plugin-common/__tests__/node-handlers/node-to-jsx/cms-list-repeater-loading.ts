import * as types from '@babel/types'
import generator from '@babel/generator'
import { elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { UIDLNode } from '@teleporthq/teleport-types'
import generateJSXSyntax from '../../../src/node-handlers/node-to-jsx'
import {
  JSXGenerationParams,
  JSXGenerationOptions,
} from '../../../src/node-handlers/node-to-jsx/types'

/**
 * A repeater fed by a plain STATE has no `DataProvider` — nothing hoists its
 * loading branch onto a `renderLoading` slot, so before `isLoading` existed the
 * branch was generated and then thrown away, and a page that was still fetching
 * showed its EMPTY branch ("no results") for the whole request.
 *
 * These tests pin both halves of the contract: the branch renders when the node
 * carries the signal, and the emitted code is UNCHANGED when it does not — which
 * is what keeps every data-source-backed mapper (products list, blog) on exactly
 * the path it was on.
 */

const params = (): JSXGenerationParams => ({
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

const options: JSXGenerationOptions = {
  dynamicReferencePrefixMap: {
    prop: 'props',
    state: '',
    local: '',
  },
}

// Two children, so `unwrapTransparentRepeaterRoot` leaves the fragment in place —
// the shape a listing's skeleton branch actually has.
const loadingBranch = () =>
  elementNode('fragment', {}, [
    elementNode('container', {}, [staticNode('skeleton one')]),
    elementNode('container', {}, [staticNode('skeleton two')]),
  ])

const repeaterNode = (isLoading?: { type: 'expr'; content: string }): UIDLNode =>
  ({
    type: 'cms-list-repeater',
    content: {
      elementType: 'Repeater',
      name: 'repeater',
      key: 'repeater',
      renderPropIdentifier: 'favouriteProduct',
      source: 'favouriteProducts',
      nodes: {
        list: elementNode('container', {}, [staticNode('row')]),
        empty: elementNode('container', {}, [staticNode('No products available')]),
        loading: loadingBranch(),
      },
      ...(isLoading ? { isLoading } : {}),
    },
  } as unknown as UIDLNode)

// The repeater is generated through its PARENT, which is where a non-JSX result
// gets wrapped in a `{ … }` expression container. Generating it standalone would
// not exercise that.
const generate = (isLoading?: { type: 'expr'; content: string }): string => {
  const tree = elementNode('container', {}, [repeaterNode(isLoading)])
  const ast = generateJSXSyntax(tree, params(), options) as types.JSXElement
  return generator(ast).code
}

describe('cms-list-repeater loading branch', () => {
  it('renders the loading branch instead of the repeater when isLoading is set', () => {
    const code = generate({ type: 'expr', content: "isLoadingFavourites || ''" })

    // `String(x) === "true"`, never a bare truthiness test: the flag is a string
    // state, and the STRING `'false'` is truthy.
    expect(code).toContain(`String(isLoadingFavourites || '') === "true"`)
    expect(code).toContain('skeleton one')
    expect(code).toContain('skeleton two')
    // Still a ternary, not a replacement — the repeater is the other branch.
    expect(code).toContain('<Repeater')
    expect(code.indexOf('skeleton one')).toBeLessThan(code.indexOf('<Repeater'))
  })

  it('accepts a static flag', () => {
    expect(generate()).not.toContain('String(')

    const tree = elementNode('container', {}, [
      {
        ...(repeaterNode() as { content: unknown }),
        content: {
          ...(repeaterNode() as unknown as { content: Record<string, unknown> }).content,
          isLoading: { type: 'static', content: 'true' },
        },
      } as unknown as UIDLNode,
    ])
    const code = generator(generateJSXSyntax(tree, params(), options) as types.JSXElement).code

    expect(code).toContain(`String("true") === "true"`)
  })

  it('leaves a repeater WITHOUT isLoading exactly as it was', () => {
    const code = generate()

    // ⛔ The regression guard for every data-source-backed mapper: its loading
    // branch is hoisted onto the `DataProvider`, so emitting it here as well
    // would draw the same branch twice.
    expect(code).not.toContain('String(')
    expect(code).not.toContain('skeleton one')
    expect(code).toContain('<Repeater')
    expect(code).toContain('renderEmpty')
  })
})
