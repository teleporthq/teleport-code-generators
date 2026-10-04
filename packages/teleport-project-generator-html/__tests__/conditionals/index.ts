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

  it('a value holding a quote still compares', async () => {
    const quote = 'She said "yes"'
    const page = await homePage(
      [when(state('answer'), [{ operation: '===', operand: quote }], 'quoted')],
      { answer: { type: 'string', defaultValue: quote } }
    )

    expect(shows(page, 'quoted')).toBe(true)
  })

  it('a state with no starting value shows nothing that depends on it', async () => {
    const page = await homePage(
      [when(state('unknown'), [{ operation: '===', operand: true }], 'depends')],
      {}
    )

    expect(inPage(page, 'depends')).toBe(false)
  })
})
