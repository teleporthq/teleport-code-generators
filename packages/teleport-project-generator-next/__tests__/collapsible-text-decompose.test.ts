import { UIDLConditionalNode, UIDLElement, UIDLElementNode } from '@teleporthq/teleport-types'
import {
  decomposeCollapsibleTextElement,
  decomposeCollapsibleTextInProject,
} from '../src/collapsible-text/decompose'

// A raw `collapsible-text` element as exported WITHOUT the GUI-side decomposition:
// the content paragraph followed by the two state-gated toggle labels.
function makeRawCollapsibleElement(linesAttr?: string): UIDLElement {
  const contentNode: UIDLElementNode = {
    type: 'element',
    content: {
      elementType: 'text',
      semanticType: 'p',
      children: [{ type: 'static', content: 'Some long body copy that overflows.' }],
    },
  }

  const label = (id: string, text: string, operand: boolean): UIDLConditionalNode => ({
    type: 'conditional',
    content: {
      node: {
        type: 'element',
        content: {
          elementType: 'text',
          semanticType: 'span',
          attrs: { id: { type: 'static', content: id } },
          children: [{ type: 'static', content: text }],
        },
      },
      reference: {
        type: 'dynamic',
        content: { referenceType: 'state', id: 'collapsibleTextExpanded' },
      },
      condition: { conditions: [{ operation: '=', operand }] },
    },
  })

  return {
    elementType: 'collapsible-text',
    ...(linesAttr
      ? { attrs: { ['data-tq-collapsible-lines']: { type: 'static', content: linesAttr } } }
      : {}),
    children: [contentNode, label('more', 'Show more', false), label('less', 'See less', true)],
  }
}

const attrContent = (el: UIDLElementNode | undefined, key: string): unknown =>
  (el?.content.attrs as Record<string, { content?: unknown }> | undefined)?.[key]?.content

describe('decomposeCollapsibleTextElement', () => {
  it('decomposes a raw element into collapsed + expanded views plus the two labels', () => {
    const element = makeRawCollapsibleElement()
    decomposeCollapsibleTextElement(element)

    expect(
      attrContent(
        { type: 'element', content: element } as UIDLElementNode,
        'data-tq-collapsible-root'
      )
    ).toBe('true')
    // [collapsedView, expandedView, showMore, seeLess]
    expect(element.children).toHaveLength(4)

    const collapsed = (element.children![0] as UIDLConditionalNode).content.node as UIDLElementNode
    const expanded = (element.children![1] as UIDLConditionalNode).content.node as UIDLElementNode
    expect(attrContent(collapsed, 'data-tq-collapsible-clamp')).toBe('true')
    expect(attrContent(expanded, 'data-tq-collapsible-clamp')).toBeUndefined()
  })

  it('defaults the clamp to 3 lines when no line hint is present', () => {
    const element = makeRawCollapsibleElement()
    decomposeCollapsibleTextElement(element)

    const collapsed = (element.children![0] as UIDLConditionalNode).content.node as UIDLElementNode
    const style = collapsed.content.style as Record<string, { content?: unknown }>
    expect(style['-webkit-line-clamp'].content).toBe('3')
    expect(style.display.content).toBe('-webkit-box')
    expect(style.overflow.content).toBe('hidden')
  })

  it('honours a custom line count from data-tq-collapsible-lines and strips the hint', () => {
    const element = makeRawCollapsibleElement('5')
    decomposeCollapsibleTextElement(element)

    const collapsed = (element.children![0] as UIDLConditionalNode).content.node as UIDLElementNode
    const style = collapsed.content.style as Record<string, { content?: unknown }>
    expect(style['-webkit-line-clamp'].content).toBe('5')
    // The transient hint must not leak into the DOM.
    expect(element.attrs?.['data-tq-collapsible-lines']).toBeUndefined()
  })

  it('tags the Show more label with data-tq-collapsible-more', () => {
    const element = makeRawCollapsibleElement()
    decomposeCollapsibleTextElement(element)

    const showMore = (element.children![2] as UIDLConditionalNode).content.node as UIDLElementNode
    expect(attrContent(showMore, 'data-tq-collapsible-more')).toBe('true')
  })

  it('is idempotent — an already-decomposed element is left untouched (hint stripped)', () => {
    const element = makeRawCollapsibleElement('5')
    decomposeCollapsibleTextElement(element)
    const afterFirst = JSON.parse(JSON.stringify(element.children))

    decomposeCollapsibleTextElement(element)
    expect(element.children).toEqual(afterFirst)
    expect(element.children).toHaveLength(4)
  })

  it('leaves a malformed element (missing labels) untouched', () => {
    const element: UIDLElement = {
      elementType: 'collapsible-text',
      children: [{ type: 'static', content: 'only content, no labels' }],
    }
    decomposeCollapsibleTextElement(element)
    expect(element.attrs?.['data-tq-collapsible-root']).toBeUndefined()
    expect(element.children).toHaveLength(1)
  })
})

describe('decomposeCollapsibleTextInProject', () => {
  it('decomposes collapsible-text elements across pages and components', () => {
    const uidl = {
      root: { node: { type: 'element', content: makeRawCollapsibleElement() } },
      components: {
        Card: { node: { type: 'element', content: makeRawCollapsibleElement('2') } },
      },
    }

    const found = decomposeCollapsibleTextInProject(uidl as never)
    expect(found).toBe(true)

    const rootEl = (uidl.root.node as UIDLElementNode).content
    const cardEl = (uidl.components.Card.node as UIDLElementNode).content
    expect(rootEl.attrs?.['data-tq-collapsible-root']?.content).toBe('true')
    expect(cardEl.attrs?.['data-tq-collapsible-root']?.content).toBe('true')

    const cardClamp = (cardEl.children![0] as UIDLConditionalNode).content.node as UIDLElementNode
    const cardStyle = cardClamp.content.style as Record<string, { content?: unknown }>
    expect(cardStyle['-webkit-line-clamp'].content).toBe('2')
  })

  it('returns false when the project has no collapsible-text primitive', () => {
    const uidl = {
      root: {
        node: { type: 'element', content: { elementType: 'container', children: [] as never[] } },
      },
      components: {},
    }
    expect(decomposeCollapsibleTextInProject(uidl as never)).toBe(false)
  })
})
