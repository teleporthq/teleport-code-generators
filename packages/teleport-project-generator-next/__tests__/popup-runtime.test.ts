import { resolve } from 'path'
import {
  GeneratedFolder,
  ProjectUIDL,
  UIDLPopup,
  UIDLPopupConfig,
} from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator, createNextProjectPlugins } from '../src'
import NextTemplate from '../src/project-template'
import { buildPopupsHeadSnippet, NextPopupsProjectPlugin } from '../src/popups/project-plugin'
import { POPUP_RUNTIME_SOURCE } from '../src/popups/popup-runtime-source'

/**
 * The published site's popup runtime: an inline script in `_document`'s head
 * that decides, per page view, which popup (if any) opens, when, and what the
 * visitor did with it. Each "page load" below is a fresh jsdom window that
 * runs the exact emitted `<script>`, with storage carried over between loads
 * and a fake clock driving the timers. The popup component itself is
 * simulated: its open workflow listens for the custom event and draws the
 * card, its close workflow removes it.
 */

// This repo's own jsdom 16 cannot load (the lockfile resolves its parse5 6 to
// 7.3.0), so the editor checkout next to this one lends its jsdom — the same
// arrangement as body-code-unpack.test.ts.
const loadJSDOM = () => {
  const candidates = ['jsdom', resolve(__dirname, '../../../../teleport-gui/node_modules/jsdom')]
  for (const candidate of candidates) {
    try {
      // tslint:disable-next-line no-var-requires
      return require(candidate)
    } catch (error) {
      // the next candidate
    }
  }
  return undefined
}
const jsdom = loadJSDOM()
if (!jsdom) {
  // tslint:disable-next-line no-console
  console.warn('popup runtime tests skipped: no jsdom loads (see the note in this file)')
}
const describeInDom = jsdom ? describe : describe.skip

const DAY_MS = 24 * 60 * 60 * 1000
const OPEN_PREFIX = 'workflow:custom:tq-popup-open-'

const popup = (overrides: Partial<UIDLPopup> = {}): UIDLPopup => ({
  id: 'welcome',
  componentName: 'WelcomePopup',
  purpose: 'discount',
  layout: 'center',
  trigger: { desktop: 'delay', phone: 'delay', delaySeconds: 5, scrollPercent: 50 },
  frequency: { kind: 'days', days: 7 },
  pages: { mode: 'all', paths: [] },
  audience: 'everyone',
  voucherCode: 'WELCOME10',
  ...overrides,
})

const config = (popups: UIDLPopup[], excludedPaths: string[] = []): UIDLPopupConfig => ({
  popups,
  excludedPaths,
})

interface Task {
  at: number
  fn: () => void
}

function fakeClock() {
  let now = 0
  let seq = 0
  const tasks = new Map<number, Task>()
  const schedule = (fn: () => void, ms?: number) => {
    seq += 1
    tasks.set(seq, { at: now + (Number(ms) || 0), fn })
    return seq
  }
  return {
    setTimeout: schedule,
    clearTimeout: (id: number) => tasks.delete(id),
    requestAnimationFrame: (fn: (time: number) => void) => schedule(() => fn(now), 16),
    cancelAnimationFrame: (id: number) => tasks.delete(id),
    pending: () => tasks.size,
    advance(ms: number) {
      const end = now + ms
      for (;;) {
        let nextId = -1
        let next: Task | null = null
        tasks.forEach((task, id) => {
          if (task.at <= end && (!next || task.at < next.at)) {
            next = task
            nextId = id
          }
        })
        if (!next) {
          break
        }
        tasks.delete(nextId)
        now = Math.max(now, (next as Task).at)
        ;(next as Task).fn()
      }
      now = end
    },
  }
}

interface LoadOptions {
  path?: string
  popups: UIDLPopup[]
  excludedPaths?: string[]
  /** localStorage carried over from an earlier load. */
  storage?: Record<string, string>
  session?: Record<string, string>
  desktop?: boolean
  analytics?: boolean
  body?: string
  /** The popup component's open workflow starts listening this late (hydration). */
  listenAfterMs?: number
}

const cardHtml = (id: string) =>
  `<div data-tq-popup-root="${id}" role="dialog">` +
  '<button data-thq="thq-modal-close-button" aria-label="Close">x</button>' +
  '<p>Take 10% off your first order</p>' +
  '<button type="button" data-tq-popup-code="WELCOME10" data-tq-popup-convert="true"> Copy code </button>' +
  '<a href="#offer" data-tq-popup-convert="true"><span>Shop now</span></a>' +
  '<form><input name="email" /><button type="submit">Join</button></form>' +
  '</div>'

async function loadPage(options: LoadOptions) {
  const errors: unknown[] = []
  const virtualConsole = new jsdom.VirtualConsole()
  virtualConsole.on('jsdomError', (error: unknown) => errors.push(error))
  const dom = new jsdom.JSDOM(
    `<!doctype html><html><head></head><body>${options.body || ''}</body></html>`,
    {
      url: `https://shop.test${options.path || '/'}`,
      runScripts: 'outside-only',
      virtualConsole,
    }
  )
  const window = dom.window
  const document = window.document
  const clock = fakeClock()
  window.setTimeout = clock.setTimeout
  window.clearTimeout = clock.clearTimeout
  window.requestAnimationFrame = clock.requestAnimationFrame
  window.cancelAnimationFrame = clock.cancelAnimationFrame
  const desktop = options.desktop !== false
  window.matchMedia = (query: string) => ({
    matches: query === '(min-width: 1024px)' ? desktop : false,
    media: query,
  })
  window.addEventListener('error', (event: { error: unknown }) => errors.push(event.error))

  window.localStorage.clear()
  window.sessionStorage.clear()
  Object.entries(options.storage || {}).forEach(([key, value]) =>
    window.localStorage.setItem(key, value)
  )
  Object.entries(options.session || {}).forEach(([key, value]) =>
    window.sessionStorage.setItem(key, value)
  )

  const tracked: Array<{ name: string; detail: unknown }> = []
  if (options.analytics !== false) {
    window.tpAnalytics = {
      track: (name: string, detail: unknown) => tracked.push({ name, detail }),
    }
  }

  const dispatched: string[] = []
  const closed: string[] = []
  const mountCard = (id: string) => {
    if (document.querySelector(`[data-tq-popup-root="${id}"]`)) {
      return
    }
    document.body.insertAdjacentHTML('beforeend', cardHtml(id))
    const mounted = document.querySelector(`[data-tq-popup-root="${id}"]`)
    mounted.querySelector('[data-thq="thq-modal-close-button"]').addEventListener('click', () => {
      closed.push(id)
      mounted.remove()
    })
  }
  const listen = () =>
    options.popups.forEach((entry) =>
      window.addEventListener(`${OPEN_PREFIX}${entry.id}`, () => mountCard(entry.id))
    )
  options.popups.forEach((entry) =>
    window.addEventListener(`${OPEN_PREFIX}${entry.id}`, () => dispatched.push(entry.id))
  )
  if (options.listenAfterMs) {
    clock.setTimeout(listen, options.listenAfterMs)
  } else {
    listen()
  }

  // Like the head script: run while the document is still loading, then let
  // the document finish (the runtime evaluates the first page view then).
  const parsed = new Promise<void>((done) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => done())
    } else {
      done()
    }
  })
  const snippet = buildPopupsHeadSnippet(config(options.popups, options.excludedPaths))
  const script = snippet.slice('<script>'.length, -'</script>'.length)
  window.eval(script)
  await parsed

  const storage = () => {
    const values: Record<string, string> = {}
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      values[key] = window.localStorage.getItem(key)
    }
    return values
  }
  const card = (id: string) => document.querySelector(`[data-tq-popup-root="${id}"]`)

  return { window, document, clock, dispatched, closed, tracked, errors, storage, card }
}

describeInDom('popup runtime — the emitted head script', () => {
  it('is one dependency-free script that parses and reads the config it is given', async () => {
    const snippet = buildPopupsHeadSnippet(config([popup()]))
    expect(snippet.startsWith('<script>window.__tqPopups={')).toBe(true)
    expect(snippet.endsWith('</script>')).toBe(true)
    // tslint:disable-next-line:function-constructor
    expect(() => new Function(POPUP_RUNTIME_SOURCE)).not.toThrow()
    expect(POPUP_RUNTIME_SOURCE).not.toContain('`')
    expect(POPUP_RUNTIME_SOURCE).not.toContain('${')
    expect(POPUP_RUNTIME_SOURCE).not.toContain('</')
  })

  it('cannot be broken out of by a value in the config', async () => {
    const snippet = buildPopupsHeadSnippet(
      config([popup({ voucherCode: '</script><script>alert(1)</script>' })])
    )
    expect(snippet.match(/<\/script>/g)).toHaveLength(1)
    const page = await loadPage({ popups: [popup({ voucherCode: '</script><b>x' })] })
    expect(page.window.__tqPopups.popups[0].voucherCode).toBe('</script><b>x')
  })
})

describeInDom('popup runtime — where a popup may open', () => {
  it('arms nothing on an excluded path', async () => {
    const excludedPaths = ['/checkout', '/account/*']
    for (const path of ['/checkout', '/checkout/', '/account/orders']) {
      const page = await loadPage({ path, popups: [popup()], excludedPaths })
      expect(page.clock.pending()).toBe(0)
      page.clock.advance(60000)
      expect(page.dispatched).toEqual([])
    }
  })

  it('arms nothing on a checkout or purchase view the page declares', async () => {
    for (const view of ['begin_checkout', 'purchase']) {
      const page = await loadPage({
        path: '/thank-you',
        popups: [popup()],
        body: `<main data-tq-commerce-view="${view}"></main>`,
      })
      page.clock.advance(60000)
      expect(page.dispatched).toEqual([])
    }
  })

  it('opens the popup with an "only" rule for the path over a newer popup for every page', async () => {
    const pricing = popup({ id: 'pricing', pages: { mode: 'only', paths: ['/pricing'] } })
    const everywhere = popup({ id: 'everywhere' })
    const page = await loadPage({ path: '/pricing', popups: [pricing, everywhere] })
    page.clock.advance(60000)
    expect(page.dispatched).toEqual(['pricing'])

    const elsewhere = await loadPage({ path: '/about', popups: [pricing, everywhere] })
    elsewhere.clock.advance(60000)
    expect(elsewhere.dispatched).toEqual(['everywhere'])
  })

  it('prefers an "except" rule over "all", and the newer of two equal rules', async () => {
    const all = popup({ id: 'all' })
    const notBlog = popup({ id: 'not-blog', pages: { mode: 'except', paths: ['/blog/*'] } })
    const page = await loadPage({ path: '/shop', popups: [notBlog, all] })
    page.clock.advance(60000)
    expect(page.dispatched).toEqual(['not-blog'])

    const blog = await loadPage({ path: '/blog/hello', popups: [notBlog, all] })
    blog.clock.advance(60000)
    expect(blog.dispatched).toEqual(['all'])

    const twoAll = await loadPage({ popups: [popup({ id: 'older' }), popup({ id: 'newer' })] })
    twoAll.clock.advance(60000)
    expect(twoAll.dispatched).toEqual(['newer'])
  })
})

describeInDom('popup runtime — when it opens', () => {
  it('opens a delay popup after its timer, then remembers it was shown', async () => {
    const page = await loadPage({ popups: [popup()] })
    page.clock.advance(4999)
    expect(page.dispatched).toEqual([])

    page.clock.advance(1)
    expect(page.dispatched).toEqual(['welcome'])
    expect(page.card('welcome')).not.toBeNull()
    const shownAt = Number(page.storage()['tq_popup:welcome'])
    expect(Math.abs(Date.now() - shownAt)).toBeLessThan(5000)
    expect(page.tracked).toEqual([{ name: 'popup_shown', detail: { recordId: 'welcome' } }])
  })

  it('does not open again on a load within 7 days, and does after them', async () => {
    const first = await loadPage({ popups: [popup()] })
    first.clock.advance(60000)
    expect(first.dispatched).toEqual(['welcome'])

    const second = await loadPage({ popups: [popup()], storage: first.storage() })
    second.clock.advance(60000)
    expect(second.dispatched).toEqual([])

    const later = await loadPage({
      popups: [popup()],
      storage: { 'tq_popup:welcome': String(Date.now() - 8 * DAY_MS) },
    })
    later.clock.advance(60000)
    expect(later.dispatched).toEqual(['welcome'])
  })

  it('keeps "once" forever and "session" in the session', async () => {
    const once = popup({ frequency: { kind: 'once', days: 0 } })
    const old = String(Date.now() - 365 * DAY_MS)
    const onceAgain = await loadPage({ popups: [once], storage: { 'tq_popup:welcome': old } })
    onceAgain.clock.advance(60000)
    expect(onceAgain.dispatched).toEqual([])

    const session = popup({ frequency: { kind: 'session', days: 0 } })
    const first = await loadPage({ popups: [session] })
    first.clock.advance(60000)
    expect(first.dispatched).toEqual(['welcome'])
    expect(first.window.sessionStorage.getItem('tq_popup:welcome')).not.toBeNull()
    expect(first.storage()['tq_popup:welcome']).toBeUndefined()

    const sameSession = await loadPage({
      popups: [session],
      session: { 'tq_popup:welcome': first.window.sessionStorage.getItem('tq_popup:welcome') },
    })
    sameSession.clock.advance(60000)
    expect(sameSession.dispatched).toEqual([])
  })

  it('tells new visitors from returning ones by an earlier page load', async () => {
    const forNew = popup({ id: 'new', audience: 'new' })
    const forReturning = popup({ id: 'returning', audience: 'returning' })

    const first = await loadPage({ popups: [forNew, forReturning] })
    first.clock.advance(60000)
    expect(first.dispatched).toEqual(['new'])
    expect(first.storage().tq_popup_visited).toBeTruthy()

    const second = await loadPage({ popups: [forNew, forReturning], storage: first.storage() })
    second.clock.advance(60000)
    expect(second.dispatched).toEqual(['returning'])
  })

  it('opens on exit intent on a computer, and uses the phone trigger below 1024px', async () => {
    const exit = popup({
      trigger: { desktop: 'exit-intent', phone: 'scroll', delaySeconds: 5, scrollPercent: 50 },
    })
    const computer = await loadPage({ popups: [exit] })
    computer.clock.advance(60000)
    expect(computer.dispatched).toEqual([])
    const leaveInside = new computer.window.MouseEvent('mouseout', { bubbles: true, clientY: 20 })
    computer.document.body.dispatchEvent(leaveInside)
    expect(computer.dispatched).toEqual([])
    const leaveTop = new computer.window.MouseEvent('mouseout', { bubbles: true, clientY: 0 })
    computer.document.body.dispatchEvent(leaveTop)
    expect(computer.dispatched).toEqual(['welcome'])

    const phone = await loadPage({ popups: [exit], desktop: false })
    phone.document.body.dispatchEvent(new phone.window.MouseEvent('mouseout', { bubbles: true }))
    expect(phone.dispatched).toEqual([])
    Object.defineProperty(phone.document.documentElement, 'scrollHeight', { value: 2768 })
    Object.defineProperty(phone.window, 'pageYOffset', { value: 600, configurable: true })
    phone.window.dispatchEvent(new phone.window.Event('scroll'))
    expect(phone.dispatched).toEqual([])
    Object.defineProperty(phone.window, 'pageYOffset', { value: 1000, configurable: true })
    phone.window.dispatchEvent(new phone.window.Event('scroll'))
    expect(phone.dispatched).toEqual(['welcome'])
  })

  it('opens a load popup on the next frame', async () => {
    const page = await loadPage({
      popups: [
        popup({ trigger: { desktop: 'load', phone: 'load', delaySeconds: 0, scrollPercent: 0 } }),
      ],
    })
    expect(page.dispatched).toEqual([])
    page.clock.advance(16)
    expect(page.dispatched).toEqual(['welcome'])
  })

  it('keeps asking until the popup is on the page, and counts it shown once', async () => {
    const page = await loadPage({
      popups: [
        popup({ trigger: { desktop: 'load', phone: 'load', delaySeconds: 0, scrollPercent: 0 } }),
      ],
      listenAfterMs: 1200,
    })
    page.clock.advance(100)
    expect(page.dispatched.length).toBe(1)
    expect(page.storage()['tq_popup:welcome']).toBeUndefined()
    expect(page.tracked).toEqual([])

    page.clock.advance(5000)
    expect(page.card('welcome')).not.toBeNull()
    expect(page.storage()['tq_popup:welcome']).toBeDefined()
    expect(page.tracked).toEqual([{ name: 'popup_shown', detail: { recordId: 'welcome' } }])
    const asked = page.dispatched.length
    page.clock.advance(60000)
    expect(page.dispatched.length).toBe(asked)
  })

  it('re-evaluates on a client-side route change, and drops the old page timer', async () => {
    const pricing = popup({ id: 'pricing', pages: { mode: 'only', paths: ['/pricing'] } })
    const page = await loadPage({ path: '/', popups: [pricing] })
    page.clock.advance(60000)
    expect(page.dispatched).toEqual([])

    page.window.history.pushState({}, '', '/pricing')
    page.clock.advance(60000)
    expect(page.dispatched).toEqual(['pricing'])

    const home = popup({ id: 'home', pages: { mode: 'only', paths: ['/'] } })
    const leaving = await loadPage({ path: '/', popups: [home] })
    leaving.clock.advance(2000)
    leaving.window.history.pushState({}, '', '/about')
    leaving.clock.advance(60000)
    expect(leaving.dispatched).toEqual([])

    leaving.window.history.pushState({}, '', '/')
    leaving.clock.advance(60000)
    expect(leaving.dispatched).toEqual(['home'])
  })

  it('opens one popup per page view, even when it is closed again', async () => {
    const page = await loadPage({ popups: [popup({ id: 'older' }), popup({ id: 'newer' })] })
    page.clock.advance(60000)
    expect(page.dispatched).toEqual(['newer'])
    page.card('newer').querySelector('[data-thq="thq-modal-close-button"]').click()
    page.clock.advance(60000)
    expect(page.dispatched).toEqual(['newer'])

    page.window.history.pushState({}, '', '/next')
    page.clock.advance(60000)
    expect(page.dispatched).toEqual(['newer', 'older'])
  })
})

describeInDom('popup runtime — what the visitor does with it', () => {
  it('runs without analytics on the page', async () => {
    const page = await loadPage({ popups: [popup()], analytics: false })
    page.clock.advance(60000)
    expect(page.dispatched).toEqual(['welcome'])
    page.card('welcome').querySelector('[data-tq-popup-convert]').click()
    page.clock.advance(60000)
    expect(page.errors).toEqual([])
    expect(page.storage()['tq_popup:welcome']).toBeDefined()
  })

  it('counts a conversion once per opening', async () => {
    const page = await loadPage({ popups: [popup({ voucherCode: undefined })] })
    page.clock.advance(60000)
    const card = page.card('welcome')
    const link = card.querySelector('a[data-tq-popup-convert] span')
    link.click()
    link.click()
    card.querySelector('form').dispatchEvent(new page.window.Event('submit', { bubbles: true }))
    const conversions = page.tracked.filter((entry) => entry.name === 'popup_converted')
    expect(conversions).toEqual([{ name: 'popup_converted', detail: { recordId: 'welcome' } }])
  })

  it('counts a newsletter sign-up inside the popup as the conversion', async () => {
    const page = await loadPage({
      popups: [popup({ purpose: 'newsletter', voucherCode: undefined })],
    })
    page.clock.advance(60000)
    const form = page.card('welcome').querySelector('form')
    form.dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }))
    expect(page.tracked.map((entry) => entry.name)).toEqual(['popup_shown', 'popup_converted'])
  })

  it('closes the popup right after a converting link is followed', async () => {
    const page = await loadPage({ popups: [popup()] })
    page.clock.advance(60000)
    page.card('welcome').querySelector('a[data-tq-popup-convert]').click()
    expect(page.closed).toEqual([])
    page.clock.advance(0)
    expect(page.closed).toEqual(['welcome'])
  })

  it('copies the code and says so for a moment', async () => {
    const page = await loadPage({ popups: [popup()] })
    const written: string[] = []
    Object.defineProperty(page.window.navigator, 'clipboard', {
      value: {
        writeText: (text: string) => {
          written.push(text)
          return Promise.resolve()
        },
      },
    })
    page.clock.advance(60000)
    const button = page.card('welcome').querySelector('[data-tq-popup-code]')
    button.click()
    await Promise.resolve()
    await Promise.resolve()
    expect(written).toEqual(['WELCOME10'])
    expect(button.textContent).toBe('Copied')
    expect(page.tracked.map((entry) => entry.name)).toEqual(['popup_shown', 'popup_converted'])
    expect(page.closed).toEqual([])
    page.clock.advance(1500)
    expect(button.textContent).toBe(' Copy code ')
  })

  it('falls back to a selected textarea without the clipboard API', async () => {
    const page = await loadPage({ popups: [popup()] })
    const copied: string[] = []
    page.document.execCommand = (command: string) => {
      const area = page.document.activeElement
      copied.push(`${command}:${area && area.value}`)
      return true
    }
    page.clock.advance(60000)
    const button = page.card('welcome').querySelector('[data-tq-popup-code]')
    button.click()
    expect(copied).toEqual(['copy:WELCOME10'])
    expect(page.card('welcome').querySelector('textarea')).toBeNull()
    expect(button.textContent).toBe('Copied')
  })

  it('closes a corner or bottom popup on Escape, and leaves a centred one to its dialog', async () => {
    for (const layout of ['corner', 'bottom'] as const) {
      const page = await loadPage({ popups: [popup({ layout })] })
      page.clock.advance(60000)
      page.document.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape' }))
      expect(page.closed).toEqual(['welcome'])
    }
    const centred = await loadPage({ popups: [popup({ layout: 'center' })] })
    centred.clock.advance(60000)
    centred.document.dispatchEvent(new centred.window.KeyboardEvent('keydown', { key: 'Escape' }))
    expect(centred.closed).toEqual([])
  })
})

describe('NextPopupsProjectPlugin', () => {
  const uidlWith = (popups?: UIDLPopupConfig) =>
    ({
      globals: { customCode: { head: '<meta name="x">' } },
      root: {},
      ...(popups && { popups }),
    } as unknown as ProjectUIDL)

  it('leaves a project without popups byte-identical', async () => {
    for (const popups of [undefined, config([])]) {
      const uidl = uidlWith(popups)
      const customCode = uidl.globals.customCode
      const before = JSON.stringify(uidl)
      await new NextPopupsProjectPlugin().runBefore({ uidl, files: new Map() } as any)
      expect(JSON.stringify(uidl)).toBe(before)
      expect(uidl.globals.customCode).toBe(customCode)
      expect(uidl.globals.customCode.head).toBe('<meta name="x">')
    }
    const bare = { globals: {}, root: {} } as unknown as ProjectUIDL
    await new NextPopupsProjectPlugin().runBefore({ uidl: bare, files: new Map() } as any)
    expect(bare.globals.customCode).toBeUndefined()
  })

  it('puts the config and the runtime first in the head custom code', async () => {
    const uidl = uidlWith(config([popup()], ['/checkout']))
    await new NextPopupsProjectPlugin().runBefore({ uidl, files: new Map() } as any)
    const head = uidl.globals.customCode.head
    expect(head.startsWith('<script>window.__tqPopups=')).toBe(true)
    expect(head).toContain(POPUP_RUNTIME_SOURCE)
    expect(head.endsWith('</script><meta name="x">')).toBe(true)
  })

  it('is registered in the shared list packProject rebuilds the Next plugins from', async () => {
    const plugins = createNextProjectPlugins().filter(
      (plugin) => plugin instanceof NextPopupsProjectPlugin
    )
    expect(plugins).toHaveLength(1)
  })

  it('reaches the generated _document', async () => {
    const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
    uidl.popups = config([popup()], ['/checkout'])
    const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder
    const output = await createNextProjectGenerator().generateProject(
      uidl as unknown as Record<string, unknown>,
      template
    )
    const document = output.subFolders
      .find((folder) => folder.name === 'pages')
      ?.files.find((file) => file.name === '_document')
    expect(document?.content).toContain('window.__tqPopups=')
    expect(document?.content).toContain('tq_popup_visited')
  })
})
