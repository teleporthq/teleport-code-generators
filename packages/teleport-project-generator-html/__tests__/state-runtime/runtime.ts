import { resolve } from 'path'
import { FileType } from '@teleporthq/teleport-types'
import { StateBindings } from '@teleporthq/teleport-shared'
import { fileOf, generateSite, stateSite } from '../_helpers/state-site'
import { STATE_RUNTIME_SCRIPT } from '../../src/state/runtime-script'

/**
 * The runtime (`tq-state.js`) driving a generated page in a DOM. This repo's
 * own jsdom 16 cannot load (the lockfile resolves its parse5 6 to 7.3.0), so
 * the editor checkout next to this one lends its jsdom, the way the browser
 * scripts in teleport-test borrow its Playwright.
 */
const loadJSDOM = () => {
  const candidates = ['jsdom', resolve(__dirname, '../../../../../teleport-gui/node_modules/jsdom')]
  for (const candidate of candidates) {
    try {
      // tslint:disable-next-line no-var-requires
      return require(candidate).JSDOM
    } catch (error) {
      // the next candidate
    }
  }
  return undefined
}
const JSDOM = loadJSDOM()
if (!JSDOM) {
  // tslint:disable-next-line no-console
  console.warn('tq-state runtime tests skipped: no jsdom loads (see the note in this file)')
}
const describeInDom = JSDOM ? describe : describe.skip

/** A parsed page; `boot` runs the runtime the way a `defer` script runs, once parsing is done. */
const visit = async (html: string) => {
  const dom = new JSDOM(html, { runScripts: 'outside-only' })
  const { document } = dom.window
  if (document.readyState === 'loading') {
    await new Promise((parsed) => document.addEventListener('DOMContentLoaded', parsed))
  }
  const byId = (id: string, within: ParentNode = document) =>
    within.querySelector(`#${id}`) as HTMLElement
  const shown = (id: string, within?: ParentNode) => !byId(id, within).hidden
  return {
    window: dom.window,
    document,
    byId,
    shown,
    boot: () => dom.window.eval(STATE_RUNTIME_SCRIPT),
  }
}

const generatedHome = async () =>
  visit(fileOf(await generateSite(stateSite()), 'index', FileType.HTML))

describeInDom('tq-state.js in a page', () => {
  it('changes nothing as the page loads', async () => {
    const page = await generatedHome()
    const changes = new page.window.MutationObserver(() => undefined)
    changes.observe(page.document.body, { attributes: true, subtree: true, childList: true })

    page.boot()

    expect(page.window.__tqStateRuntime).toBe(true)
    expect(changes.takeRecords()).toEqual([])
    // and it did render: a page that starts out of step is put right on load
    const outOfStep = await visit(
      `<div data-tq-scope="Page" data-tq-state="open = true"><p id="menu" data-tq-if="open" hidden></p></div>`
    )
    outOfStep.boot()
    expect(outOfStep.shown('menu')).toBe(true)
  })

  it('a click opens one menu; the other Navigation keeps its own', async () => {
    const page = await generatedHome()
    page.boot()
    const [first, second] = Array.from(
      page.document.querySelectorAll('[data-tq-scope="Navigation"]')
    ) as HTMLElement[]

    page.byId('burger', first).click()
    expect(page.shown('menu', first)).toBe(true)
    expect(page.shown('burger-close', first)).toBe(true)
    expect(page.shown('burger-open', first)).toBe(false)
    expect(page.shown('menu', second)).toBe(false)
    expect(page.shown('burger-open', second)).toBe(true)

    // a click on the label inside the burger bubbles to it
    page.byId('burger-close', first).click()
    expect(page.shown('menu', first)).toBe(false)
    expect(page.shown('burger-open', first)).toBe(true)
  })

  it('a tab click shows its panel and moves the active class', async () => {
    const page = await generatedHome()
    page.boot()

    page.byId('tab-2').click()
    expect([0, 1, 2].map((index) => page.shown(`panel-${index}`))).toEqual([false, false, true])
    expect(
      [0, 1, 2].map((index) => page.byId(`tab-${index}`).classList.contains('tab-active'))
    ).toEqual([false, false, true])

    page.byId('tab-1').click()
    expect([0, 1, 2].map((index) => page.shown(`panel-${index}`))).toEqual([false, true, false])
    expect(page.byId('tab-1').className).toContain('tab-active')
    expect(page.byId('tab-2').className).not.toContain('tab-active')
  })

  it('what the page put into a Navigation reads the page, not the Navigation', async () => {
    const page = await generatedHome()
    page.boot()
    const first = page.document.querySelector('[data-tq-scope="Navigation"]') as HTMLElement

    page.byId('burger', first).click()
    expect(page.shown('slot-badge')).toBe(false)

    page.byId('billing-switch').click()
    expect(page.shown('slot-badge')).toBe(true)
    expect(page.shown('price-yearly')).toBe(true)
    expect(page.shown('price-monthly')).toBe(false)
    expect(page.shown('menu', first)).toBe(true)
  })

  it('Enter and Space work a clickable div; a real button is left to the browser', async () => {
    const page = await generatedHome()
    page.boot()
    const first = page.document.querySelector('[data-tq-scope="Navigation"]') as HTMLElement
    const press = (element: HTMLElement, key: string) =>
      element.dispatchEvent(new page.window.KeyboardEvent('keydown', { key, bubbles: true }))

    press(page.byId('burger', first), 'Enter')
    expect(page.shown('menu', first)).toBe(true)
    press(page.byId('burger', first), ' ')
    expect(page.shown('menu', first)).toBe(false)
    press(page.byId('billing-switch'), 'Enter')
    expect(page.shown('price-yearly')).toBe(false)
  })

  it("a condition on an instance itself reads the store around it, its content the instance's", async () => {
    const page = await visit(`<body><div data-tq-scope="Page" data-tq-state="yearly = false">
      <button id="switch" data-tq-on-click="yearly = !yearly">Switch</button>
      <nav-wrapper id="nav" data-tq-scope="Navigation" data-tq-state="yearly = true" data-tq-if="yearly" hidden>
        <p id="inner" data-tq-if="yearly">inner</p>
      </nav-wrapper>
    </div></body>`)
    page.boot()

    expect(page.shown('nav')).toBe(false)
    expect(page.shown('inner')).toBe(true)
    page.byId('switch').click()
    expect(page.shown('nav')).toBe(true)
    expect(page.shown('inner')).toBe(true)
  })

  it('a binding it cannot read is left alone, and the others still work', async () => {
    const page = await visit(`<body><div data-tq-scope="Page" data-tq-state="open = false">
      <p id="broken" data-tq-if="open ===">broken</p>
      <p id="fine" data-tq-if="open" hidden>fine</p>
      <button id="toggle" data-tq-on-click="open = !open">Toggle</button>
    </div></body>`)
    const warn = jest.spyOn(page.window.console, 'warn').mockImplementation(() => undefined)
    page.boot()

    page.byId('toggle').click()
    expect(page.shown('fine')).toBe(true)
    expect(page.shown('broken')).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('open ==='))
  })

  it('reads every expression the generator writes the way the generator evaluates it', async () => {
    const { binary, literal, not, state } = StateBindings
    const values: Record<string, StateBindings.StateValue> = {
      count: 2,
      plan: `it's "yearly" \\o/`,
      open: true,
      none: null,
      ratio: -2.5,
    }
    const expressions = [
      state('open'),
      not(state('open')),
      binary('===', state('count'), literal(2)),
      binary('===', state('count'), literal('2')),
      binary('!==', state('none'), literal(null)),
      binary('===', state('plan'), literal(`it's "yearly" \\o/`)),
      binary('<', state('ratio'), literal(-2)),
      binary('>=', binary('+', state('count'), literal(1)), literal(3)),
      binary('===', binary('-', state('count'), binary('-', literal(5), literal(4))), literal(1)),
      binary(
        '&&',
        binary('||', state('open'), state('none')),
        binary('>', state('count'), literal(5))
      ),
      binary(
        '||',
        binary('&&', state('open'), state('none')),
        binary('<=', state('count'), literal(2))
      ),
      not(binary('&&', state('open'), binary('!==', state('plan'), literal('a;b')))),
      binary('===', state('missing'), literal(null)),
    ]
    const declarations = StateBindings.printAssignments(
      Object.keys(values).map((name) => ({ name, value: literal(values[name]) }))
    )
    const attribute = (value: string) => `"${StateBindings.escapeAttributeValue(value)}"`
    const page = await visit(
      `<body><div data-tq-scope="Page" data-tq-state=${attribute(declarations)}>${expressions
        .map(
          (expression, index) =>
            `<p id="e${index}" data-tq-if=${attribute(StateBindings.printExpression(expression))}${
              StateBindings.evaluateExpression(expression, values) ? ' hidden' : ''
            }></p>`
        )
        .join('')}</div></body>`
    )

    page.boot()

    expressions.forEach((expression, index) => {
      expect([StateBindings.printExpression(expression), page.shown(`e${index}`)]).toEqual([
        StateBindings.printExpression(expression),
        Boolean(StateBindings.evaluateExpression(expression, values)),
      ])
    })
  })
})
