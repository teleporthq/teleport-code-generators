import { ComponentUIDL, UIDLElementNode, UIDLNode } from '@teleporthq/teleport-types'
import { resolveUnboundExpressions } from '../../src/resolvers/unbound-expressions'

const expr = (content: string): UIDLNode => ({ type: 'expr', content } as UIDLNode)

const optionWith = (child: UIDLNode): UIDLElementNode => ({
  type: 'element',
  content: {
    elementType: 'option',
    attrs: { value: { type: 'static', content: '' } },
    children: [child],
  },
})

const buildComponent = (node: UIDLElementNode): ComponentUIDL =>
  ({
    name: 'AddInventoryItem',
    node,
    propDefinitions: {
      inventoryItem: { type: 'object', defaultValue: {} },
    },
    stateDefinitions: {
      categoryOptions: { type: 'array', defaultValue: [] },
    },
  } as unknown as ComponentUIDL)

const containerWith = (children: UIDLNode[]): UIDLElementNode => ({
  type: 'element',
  content: { elementType: 'container', children },
})

// `console.warn` is the resolver's diagnostic channel; silence it so the suite
// output stays readable while still exercising the code path.
let warnSpy: jest.SpyInstance

beforeEach(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  warnSpy.mockRestore()
})

describe('resolveUnboundExpressions', () => {
  it('neutralises an orphaned option expression that references an unbound iterator', () => {
    const option = optionWith(expr('cat.name'))
    const uidl = buildComponent({
      type: 'element',
      content: { elementType: 'select', children: [option] },
    })

    resolveUnboundExpressions(uidl)

    expect(option.content.children[0]).toEqual({ type: 'static', content: '' })
  })

  it('keeps expressions that reference an in-scope repeater iterator', () => {
    const boundExpr = expr('item?.id')
    const repeater: UIDLNode = {
      type: 'cms-list-repeater',
      content: {
        elementType: 'fragment',
        name: 'list',
        key: 'list',
        renderPropIdentifier: 'item',
        nodes: {
          list: {
            type: 'element',
            content: { elementType: 'div', children: [boundExpr] },
          },
        },
      },
    } as UIDLNode
    const uidl = buildComponent(containerWith([repeater]))

    resolveUnboundExpressions(uidl)

    expect(boundExpr).toEqual({ type: 'expr', content: 'item?.id' })
  })

  it('keeps the `index` a list repeater binds alongside its render prop', () => {
    const indexExpr = expr('index + 1')
    const repeater: UIDLNode = {
      type: 'cms-list-repeater',
      content: {
        elementType: 'fragment',
        name: 'list',
        key: 'list',
        renderPropIdentifier: 'item',
        nodes: {
          list: {
            type: 'element',
            content: { elementType: 'div', children: [indexExpr] },
          },
        },
      },
    } as UIDLNode
    const uidl = buildComponent(containerWith([repeater]))

    resolveUnboundExpressions(uidl)

    expect(indexExpr).toEqual({ type: 'expr', content: 'index + 1' })
  })

  it('keeps `index` inside a repeat that opts into it and drops it otherwise', () => {
    const indexed: UIDLElementNode = {
      type: 'element',
      content: { elementType: 'div', children: [expr('index')] },
    }
    const notIndexed: UIDLElementNode = {
      type: 'element',
      content: { elementType: 'div', children: [expr('index')] },
    }
    const repeatNode = (child: UIDLElementNode, useIndex: boolean): UIDLNode =>
      ({
        type: 'repeat',
        content: {
          node: child,
          dataSource: { type: 'dynamic', content: { referenceType: 'prop', id: 'inventoryItem' } },
          meta: { iteratorName: 'row', useIndex },
        },
      } as UIDLNode)
    const uidl = buildComponent(
      containerWith([repeatNode(indexed, true), repeatNode(notIndexed, false)])
    )

    resolveUnboundExpressions(uidl)

    expect(indexed.content.children[0]).toEqual({ type: 'expr', content: 'index' })
    expect(notIndexed.content.children[0]).toEqual({ type: 'static', content: '' })
  })

  it('flags a repeater iterator referenced outside of its subtree', () => {
    const escaped = optionWith(expr('item?.id'))
    const repeater: UIDLNode = {
      type: 'cms-list-repeater',
      content: {
        elementType: 'fragment',
        name: 'list',
        key: 'list',
        renderPropIdentifier: 'item',
        nodes: {
          list: { type: 'element', content: { elementType: 'div', children: [] } },
        },
      },
    } as UIDLNode
    const uidl = buildComponent(containerWith([repeater, escaped]))

    resolveUnboundExpressions(uidl)

    expect(escaped.content.children[0]).toEqual({ type: 'static', content: '' })
  })

  it('keeps expressions that reference props, state and globals', () => {
    const propsExpr = expr('props.inventoryItem?.name')
    const stateExpr = expr('categoryOptions')
    const globalExpr = expr('JSON.stringify(props.inventoryItem)')
    const uidl = buildComponent(containerWith([propsExpr, stateExpr, globalExpr]))

    resolveUnboundExpressions(uidl)

    expect(propsExpr).toEqual({ type: 'expr', content: 'props.inventoryItem?.name' })
    expect(stateExpr).toEqual({ type: 'expr', content: 'categoryOptions' })
    expect(globalExpr).toEqual({ type: 'expr', content: 'JSON.stringify(props.inventoryItem)' })
  })

  it('neutralises the renderer-only `state` object, which generated code never declares', () => {
    // Regression: React state is destructured into bare variables, so a `state`
    // reference that survived the editor export compiles to
    // `ReferenceError: state is not defined` and fails `next build`.
    const container = containerWith([expr('state'), expr('state.addressLine')])
    const uidl = buildComponent(container)

    resolveUnboundExpressions(uidl)

    expect(container.content.children).toEqual([
      { type: 'static', content: '' },
      { type: 'static', content: '' },
    ])
  })

  it('keeps a state named `state` when the component actually declares it', () => {
    const container = containerWith([expr('state')])
    const uidl = buildComponent(container)
    uidl.stateDefinitions.state = { type: 'string', defaultValue: '' }

    resolveUnboundExpressions(uidl)

    expect(container.content.children).toEqual([{ type: 'expr', content: 'state' }])
  })

  it('neutralises an unbound expression used as an attribute value', () => {
    const element: UIDLElementNode = {
      type: 'element',
      content: {
        elementType: 'div',
        attrs: {
          'data-item-id': { type: 'expr', content: 'cat.id' },
          title: { type: 'static', content: 'ok' },
        },
        children: [],
      },
    }
    const uidl = buildComponent(element)

    resolveUnboundExpressions(uidl)

    expect(element.content.attrs!['data-item-id']).toEqual({ type: 'static', content: '' })
    expect(element.content.attrs!.title).toEqual({ type: 'static', content: 'ok' })
  })

  it('preserves surrounding static text when neutralising mixed content', () => {
    const span: UIDLElementNode = {
      type: 'element',
      content: {
        elementType: 'span',
        children: [{ type: 'static', content: 'Hello ' }, expr('cat.name')],
      },
    }
    const uidl = buildComponent(span)

    resolveUnboundExpressions(uidl)

    expect(span.content.children).toEqual([
      { type: 'static', content: 'Hello ' },
      { type: 'static', content: '' },
    ])
  })

  it('keeps the literal fallback an unbound expression was authored with', () => {
    const srcAttr: UIDLElementNode = {
      type: 'element',
      content: {
        elementType: 'image',
        attrs: { src: { type: 'expr', content: `company?.logo ?? 'https://cdn/placeholder.png'` } },
        children: [],
      },
    }
    const container = containerWith([expr(`company?.name || "N/A"`), srcAttr])
    const uidl = buildComponent(container)

    resolveUnboundExpressions(uidl)

    expect(container.content.children[0]).toEqual({ type: 'static', content: 'N/A' })
    expect(srcAttr.content.attrs!.src).toEqual({
      type: 'static',
      content: 'https://cdn/placeholder.png',
    })
  })

  it('does not mistake a fallback-looking literal inside a string for a real fallback', () => {
    const container = containerWith([expr(`company?.size || "size || '-'"`)])
    const uidl = buildComponent(container)

    resolveUnboundExpressions(uidl)

    expect(container.content.children[0]).toEqual({ type: 'static', content: `size || '-'` })
  })

  it('blanks rather than guesses when the fallback is not a plain literal', () => {
    const container = containerWith([expr('company?.name || buildName(company)')])
    const uidl = buildComponent(container)

    resolveUnboundExpressions(uidl)

    expect(container.content.children[0]).toEqual({ type: 'static', content: '' })
  })

  it('keeps an inline callback whose parameter is declared by the expression itself', () => {
    const callbackExpr = expr('(event) => event.target.value')
    // tslint:disable-next-line no-invalid-template-strings
    const arrowExpr = expr('props.inventoryItem.tags.map((tag, i) => `${i}:${tag}`).join()')
    const container = containerWith([callbackExpr, arrowExpr])
    const uidl = buildComponent(container)

    resolveUnboundExpressions(uidl)

    expect(container.content.children).toEqual([callbackExpr, arrowExpr])
  })

  it('leaves an expression alone when it declares bindings the analyser cannot resolve', () => {
    const iife = expr('(() => { const total = 2; return total })()')
    const container = containerWith([iife])
    const uidl = buildComponent(container)

    resolveUnboundExpressions(uidl)

    expect(container.content.children).toEqual([iife])
  })

  it('does not treat quoted JSON payloads as references', () => {
    const filterExpr = expr(
      `JSON.stringify([{ "type": "condition", "source": "id", "operand": "=" }])`
    )
    const container = containerWith([filterExpr])
    const uidl = buildComponent(container)

    resolveUnboundExpressions(uidl)

    expect(container.content.children).toEqual([filterExpr])
  })

  it('keeps a navlink transitionTo that references a global-context identifier', () => {
    // Regression: the abilities resolver emits transitionTo exprs like
    // `/profile/${currentUser?.id}` for details navlinks bound to
    // "Current User > id". These identifiers are destructured from
    // useGlobalContext() by the JSX emitter, so they must not be blanked.
    const link: UIDLElementNode = {
      type: 'element',
      content: {
        elementType: 'navlink',
        attrs: {
          // tslint:disable-next-line no-invalid-template-strings
          transitionTo: { type: 'expr', content: '`/profile/${currentUser?.id}`' },
        },
        children: [],
      },
    }
    const uidl = buildComponent(containerWith([link]))

    resolveUnboundExpressions(uidl)

    expect(link.content.attrs.transitionTo).toEqual({
      type: 'expr',
      // tslint:disable-next-line no-invalid-template-strings
      content: '`/profile/${currentUser?.id}`',
    })
  })

  it('neutralises an unbound reference inside a template literal', () => {
    const link: UIDLElementNode = {
      type: 'element',
      content: {
        elementType: 'navlink',
        attrs: {
          // tslint:disable-next-line no-invalid-template-strings
          transitionTo: { type: 'expr', content: '`/deal-details/${deal?.id}`' },
        },
        children: [],
      },
    }
    const uidl = buildComponent(containerWith([link]))

    resolveUnboundExpressions(uidl)

    expect(link.content.attrs.transitionTo).toEqual({ type: 'static', content: '' })
  })

  it('keeps the render prop a data-source node introduces for its children', () => {
    const boundExpr = expr('dataSourceData?.title')
    const dataSource: UIDLNode = {
      type: 'data-source-item',
      content: {
        elementType: 'DataProvider',
        renderPropIdentifier: 'dataSourceData',
        resourceDefinition: {
          type: 'external-data-source',
          dataSourceId: 'ds-1',
          tableName: 'items',
          dataSourceType: 'postgresql',
        },
        children: [{ type: 'element', content: { elementType: 'div', children: [boundExpr] } }],
      },
    } as UIDLNode
    const uidl = buildComponent(containerWith([dataSource]))

    resolveUnboundExpressions(uidl)

    expect(boundExpr).toEqual({ type: 'expr', content: 'dataSourceData?.title' })
  })
})
