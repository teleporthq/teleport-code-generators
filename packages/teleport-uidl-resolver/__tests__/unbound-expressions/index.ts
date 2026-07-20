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
    const uidl = buildComponent({
      type: 'element',
      content: { elementType: 'container', children: [repeater] },
    })

    resolveUnboundExpressions(uidl)

    expect(boundExpr).toEqual({ type: 'expr', content: 'item?.id' })
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
    const uidl = buildComponent({
      type: 'element',
      content: { elementType: 'container', children: [repeater, escaped] },
    })

    resolveUnboundExpressions(uidl)

    expect(escaped.content.children[0]).toEqual({ type: 'static', content: '' })
  })

  it('keeps expressions that reference props, state, globals and event', () => {
    const propsExpr = expr('props.inventoryItem?.name')
    const stateExpr = expr('categoryOptions')
    const globalExpr = expr('JSON.stringify(params)')
    const eventExpr = expr('event.target.value')
    const uidl = buildComponent({
      type: 'element',
      content: {
        elementType: 'container',
        children: [propsExpr, stateExpr, globalExpr, eventExpr],
      },
    })

    resolveUnboundExpressions(uidl)

    expect(propsExpr).toEqual({ type: 'expr', content: 'props.inventoryItem?.name' })
    expect(stateExpr).toEqual({ type: 'expr', content: 'categoryOptions' })
    expect(globalExpr).toEqual({ type: 'expr', content: 'JSON.stringify(params)' })
    expect(eventExpr).toEqual({ type: 'expr', content: 'event.target.value' })
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
    const uidl = buildComponent({
      type: 'element',
      content: { elementType: 'container', children: [link] },
    })

    resolveUnboundExpressions(uidl)

    expect(link.content.attrs.transitionTo).toEqual({
      type: 'expr',
      // tslint:disable-next-line no-invalid-template-strings
      content: '`/profile/${currentUser?.id}`',
    })
  })
})
