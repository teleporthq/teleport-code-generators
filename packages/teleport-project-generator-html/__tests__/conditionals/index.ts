import { FileType, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../../examples/uidl-samples/tests.json'
import { createHTMLProjectGenerator, pluginCloneGlobals, pluginHomeReplace } from '../../src'
import HTMLTemplate from '../../src/project-template'

/**
 * An element shown on a condition appears as the page first loads in the
 * Next.js export: the condition is resolved against the value its reference
 * starts with. Until 2026-09-18 every STATE condition rendered nothing, true
 * or not, so a download lost the burger of a closed menu and the first tab of
 * every tab set. Since 2026-10-04 a condition on the page's own state keeps
 * every branch in the page for the state runtime to switch, and the ones the
 * page does not start on are `hidden` (state-runtime/ covers the runtime); a
 * condition on anything else is still resolved once.
 */
const s = (content: unknown) => ({ type: 'static', content })
const span = (id: string) => ({
  type: 'element',
  content: { elementType: 'text', semanticType: 'span', attrs: { id: s(id) }, children: [s(id)] },
})
const when = (
  reference: Record<string, unknown>,
  conditions: Array<Record<string, unknown>>,
  id: string
) => ({
  type: 'conditional',
  content: { reference, node: span(id), condition: { conditions, matchingCriteria: 'all' } },
})
const state = (id: string, refPath?: string[]) => ({
  type: 'dynamic',
  content: { referenceType: 'state', id, ...(refPath ? { refPath } : {}) },
})
const prop = (id: string) => ({ type: 'dynamic', content: { referenceType: 'prop', id } })

const homePage = async (
  children: unknown[],
  stateDefinitions: Record<string, unknown>,
  propDefinitions: Record<string, unknown> = {}
): Promise<string> => {
  const uidl = JSON.parse(JSON.stringify(uidlSample))
  const home = uidl.root.node.content.children[0].content.node.content
  home.children = children
  // A page's own state and props travel with its route, as the editor exports them.
  const homeRoute = uidl.root.stateDefinitions.route.values.find(
    (route: { value: string }) => route.value === uidl.root.stateDefinitions.route.defaultValue
  )
  homeRoute.pageOptions = { ...(homeRoute.pageOptions || {}), stateDefinitions, propDefinitions }
  const generator = createHTMLProjectGenerator()
  generator.addPlugin(pluginHomeReplace)
  generator.addPlugin(pluginCloneGlobals)
  const { files } = await generator.generateProject(uidl as ProjectUIDL, HTMLTemplate)
  return (
    files.find((file) => file.name === 'index' && file.fileType === FileType.HTML)?.content ?? ''
  )
}

const openingTag = (page: string, id: string) =>
  new RegExp(`<[a-z][^>]*\\bid="${id}"[^>]*>`).exec(page)?.[0]
const inPage = (page: string, id: string) => openingTag(page, id) !== undefined
/** In the markup and not `hidden`: what a visitor sees before any script runs. */
const shows = (page: string, id: string) =>
  inPage(page, id) && !/\shidden(=""|\s|>)/.test(openingTag(page, id) ?? '')

describe('Conditions in a static HTML page', () => {
  it('a state condition shows what the page starts with, and keeps the rest hidden for the runtime', async () => {
    const page = await homePage(
      [
        when(state('menuOpen'), [{ operation: '===', operand: true }], 'menu-panel'),
        when(state('menuOpen'), [{ operation: '===', operand: false }], 'burger'),
        when(state('tab'), [{ operation: '===', operand: 'a' }], 'tab-a'),
        when(state('tab'), [{ operation: '===', operand: 'b' }], 'tab-b'),
      ],
      {
        menuOpen: { type: 'boolean', defaultValue: false },
        tab: { type: 'string', defaultValue: 'a' },
      }
    )

    expect(shows(page, 'burger')).toBe(true)
    expect(shows(page, 'tab-a')).toBe(true)
    expect(shows(page, 'menu-panel')).toBe(false)
    expect(shows(page, 'tab-b')).toBe(false)
    expect(inPage(page, 'menu-panel')).toBe(true)
    expect(inPage(page, 'tab-b')).toBe(true)
    expect(openingTag(page, 'menu-panel')).toContain('data-tq-if="menuOpen"')
    expect(openingTag(page, 'burger')).toContain('data-tq-if="!menuOpen"')
    expect(openingTag(page, 'tab-b')).toContain(`data-tq-if="tab === 'b'"`)
    expect(page).toContain(`data-tq-state="menuOpen = false; tab = 'a'"`)
  })

  it('reads into an object state and compares numbers, once: the runtime keeps no objects', async () => {
    const page = await homePage(
      [
        when(state('cart', ['count']), [{ operation: '>', operand: 0 }], 'cart-badge'),
        when(state('cart', ['count']), [{ operation: '===', operand: 0 }], 'cart-empty'),
      ],
      { cart: { type: 'object', defaultValue: { count: 0 } } }
    )

    expect(shows(page, 'cart-empty')).toBe(true)
    expect(inPage(page, 'cart-badge')).toBe(false)
    expect(page).not.toContain('data-tq-')
  })

  it('a condition with no operand tests the value itself, as the JSX generators do', async () => {
    const page = await homePage(
      [
        when(state('loading'), [{ operation: '!' }], 'content'),
        when(prop('isPromo'), [{ operation: '!' }], 'regular-price'),
      ],
      { loading: { type: 'boolean', defaultValue: true } },
      { isPromo: { type: 'boolean', defaultValue: false } }
    )

    // loading starts true: "not loading" is false, and the runtime can turn it on
    expect(shows(page, 'content')).toBe(false)
    expect(openingTag(page, 'content')).toContain('data-tq-if="!loading"')
    // isPromo starts false: "not promo" is true; a prop never changes in a static page
    expect(shows(page, 'regular-price')).toBe(true)
    expect(openingTag(page, 'regular-price')).not.toContain('data-tq-if')
  })

  it('a condition on a list or an object is answered on what it starts with', async () => {
    const page = await homePage(
      [
        when(state('lines'), [{ operation: 'isEmpty' }], 'cart-empty'),
        when(state('lines'), [{ operation: 'isNotEmpty' }], 'cart-lines'),
        when(state('picked'), [{ operation: 'isNotEmpty' }], 'some-picked'),
        when(state('picked'), [{ operation: 'contains', operand: 'b' }], 'picked-b'),
        when(state('picked'), [{ operation: 'notContains', operand: 'z' }], 'not-picked-z'),
        when(state('picked'), [{ operation: 'contains', operand: 'z' }], 'picked-z'),
        when(state('picked'), [{ operation: 'lengthGreaterThan', operand: 1 }], 'several'),
        when(state('picked'), [{ operation: 'lengthEquals', operand: 3 }], 'three'),
        when(
          state('rows'),
          [{ operation: 'contains', operand: 7, containsField: 'id' }],
          'row-seven'
        ),
        when(state('filters'), [{ operation: 'hasKey', operand: 'size' }], 'by-size'),
        when(state('filters'), [{ operation: 'notHasKey', operand: 'size' }], 'any-size'),
        when(state('heading'), [{ operation: 'isNotEmpty' }], 'with-heading'),
      ],
      {
        lines: { type: 'array', defaultValue: [] },
        picked: { type: 'array', defaultValue: ['a', 'b'] },
        rows: { type: 'array', defaultValue: [{ id: 7 }, { id: 9 }] },
        filters: { type: 'object', defaultValue: { size: 'm' } },
        heading: { type: 'string', defaultValue: 'Hello' },
      }
    )

    const shown = [
      'cart-empty',
      'some-picked',
      'picked-b',
      'not-picked-z',
      'several',
      'row-seven',
      'by-size',
      'with-heading',
    ]
    const absent = ['cart-lines', 'picked-z', 'three', 'any-size']
    expect(shown.filter((id) => !shows(page, id))).toEqual([])
    expect(absent.filter((id) => inPage(page, id))).toEqual([])
  })

  it('a condition it cannot answer renders nothing, and the page is still exported', async () => {
    const page = await homePage(
      [
        // a list is not a value `===` can be written against
        when(state('lines'), [{ operation: '===', operand: 'x' }], 'list-equals'),
        // the other side has no starting value to read
        when(state('picked'), [{ operation: 'contains', operand: state('missing') }], 'by-choice'),
        when(state('filters'), [{ operation: '!' }], 'no-filters'),
        when(state('open'), [{ operation: '===', operand: true }], 'panel'),
      ],
      {
        lines: { type: 'array', defaultValue: [] },
        picked: { type: 'array', defaultValue: ['a'] },
        filters: { type: 'object', defaultValue: {} },
        open: { type: 'boolean', defaultValue: true },
      }
    )

    expect(['list-equals', 'by-choice', 'no-filters'].filter((id) => inPage(page, id))).toEqual([])
    expect(shows(page, 'panel')).toBe(true)
  })

  it('a value holding a quote still compares', async () => {
    const quote = 'She said "yes"'
    const page = await homePage(
      [when(state('answer'), [{ operation: '===', operand: quote }], 'quoted')],
      { answer: { type: 'string', defaultValue: quote } }
    )

    expect(shows(page, 'quoted')).toBe(true)
  })

  it('the other side of a comparison is read at its starting value too', async () => {
    const page = await homePage(
      [
        when(
          state('card', ['id']),
          [{ operation: '===', operand: state('picked', ['id']) }],
          'same'
        ),
        when(
          state('card', ['id']),
          [{ operation: '!==', operand: state('picked', ['id']) }],
          'other'
        ),
        when(state('card', ['tags']), [{ operation: 'contains', operand: state('tag') }], 'tagged'),
        when(state('card', ['price']), [{ operation: '>', operand: prop('budget') }], 'too-dear'),
      ],
      {
        card: { type: 'object', defaultValue: { id: 'c1', tags: ['new', 'sale'], price: 40 } },
        picked: { type: 'object', defaultValue: { id: 'c1' } },
        tag: { type: 'string', defaultValue: 'sale' },
      },
      { budget: { type: 'number', defaultValue: 50 } }
    )

    expect(['same', 'tagged'].filter((id) => !shows(page, id))).toEqual([])
    expect(['other', 'too-dear'].filter((id) => inPage(page, id))).toEqual([])
  })

  it('rules that each read their own value, and groups of rules, are answered together', async () => {
    const isOpen = { reference: state('panel', ['open']), operation: '===', operand: true }
    const isAdmin = { reference: state('user', ['role']), operation: '===', operand: 'admin' }
    const isGuest = { reference: state('user', ['role']), operation: '===', operand: 'guest' }
    const either = (...conditions: unknown[]) => ({ conditions, matchingCriteria: 'any' })
    const page = await homePage(
      [
        when(state('panel', ['open']), [isOpen, isAdmin], 'open-for-admin'),
        when(state('panel', ['open']), [isOpen, isGuest], 'open-for-guest'),
        when(state('panel', ['open']), [isOpen, either(isGuest, isAdmin)], 'open-for-either'),
        when(state('panel', ['open']), [either(isGuest, { ...isOpen, operand: false })], 'neither'),
      ],
      {
        panel: { type: 'object', defaultValue: { open: true } },
        user: { type: 'object', defaultValue: { role: 'admin' } },
      }
    )

    expect(['open-for-admin', 'open-for-either'].filter((id) => !shows(page, id))).toEqual([])
    expect(['open-for-guest', 'neither'].filter((id) => inPage(page, id))).toEqual([])
  })

  it('a rule on a value of the list item is answered for each item', async () => {
    const item = (path: string) => ({ type: 'expr', content: `product${path}` })
    const page = await homePage(
      [
        {
          type: 'cms-list-repeater',
          content: {
            elementType: 'cms-list-repeater',
            name: 'products',
            key: 'products',
            renderPropIdentifier: 'product',
            source: JSON.stringify([
              { name: 'A', featured: true, stock: 0, 'sale-price': 5, price: 5 },
              { name: 'B', featured: false, stock: 3, 'sale-price': 7, price: 9 },
              { name: 'C', featured: true, stock: 2, 'sale-price': 4, price: 4 },
            ]),
            nodes: {
              list: {
                type: 'element',
                content: {
                  elementType: 'container',
                  semanticType: 'div',
                  children: [
                    when(item('?.featured'), [{ operation: '===', operand: true }], 'featured'),
                    when(item('?.stock'), [{ operation: '>', operand: 0 }], 'in-stock'),
                    when(
                      item('?.["sale-price"]'),
                      [{ operation: '<', operand: item('?.price') }],
                      'on-sale'
                    ),
                    when(item('?.missing'), [{ operation: '===', operand: true }], 'unknown'),
                  ],
                },
              },
            },
          },
        },
      ],
      {}
    )

    const count = (id: string) => page.split(`id="${id}"`).length - 1
    expect({
      featured: count('featured'),
      inStock: count('in-stock'),
      onSale: count('on-sale'),
      unknown: count('unknown'),
    }).toEqual({ featured: 2, inStock: 2, onSale: 1, unknown: 0 })
  })

  it('a state with no starting value shows nothing that depends on it', async () => {
    const page = await homePage(
      [when(state('unknown'), [{ operation: '===', operand: true }], 'depends')],
      {}
    )

    expect(inPage(page, 'depends')).toBe(false)
  })
})
