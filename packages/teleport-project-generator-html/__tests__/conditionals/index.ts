import { FileType, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../../examples/uidl-samples/tests.json'
import { createHTMLProjectGenerator, pluginCloneGlobals, pluginHomeReplace } from '../../src'
import HTMLTemplate from '../../src/project-template'

/**
 * A static page has no runtime, so an element shown on a condition appears as
 * the page first loads in the Next.js export: the condition is resolved
 * against the value its reference starts with. Until 2026-09-18 every STATE
 * condition rendered nothing, true or not, so a download lost the burger of a
 * closed menu and the first tab of every tab set.
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

const shows = (page: string, id: string) => page.includes(`id="${id}"`)

describe('Conditions in a static HTML page', () => {
  it('a state condition shows what the page starts with, and nothing it does not', async () => {
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
  })

  it('reads into an object state and compares numbers', async () => {
    const page = await homePage(
      [
        when(state('cart', ['count']), [{ operation: '>', operand: 0 }], 'cart-badge'),
        when(state('cart', ['count']), [{ operation: '===', operand: 0 }], 'cart-empty'),
      ],
      { cart: { type: 'object', defaultValue: { count: 0 } } }
    )

    expect(shows(page, 'cart-empty')).toBe(true)
    expect(shows(page, 'cart-badge')).toBe(false)
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

    // loading starts true: "not loading" is false
    expect(shows(page, 'content')).toBe(false)
    // isPromo starts false: "not promo" is true
    expect(shows(page, 'regular-price')).toBe(true)
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

    expect(shows(page, 'depends')).toBe(false)
  })
})
