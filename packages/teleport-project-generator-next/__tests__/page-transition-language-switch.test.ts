/**
 * The page transition freezes the page a visitor leaves (fixed in place, at its scroll
 * offset) until the next page has arrived. "Another page" was decided by comparing the
 * address in the route event with the current page's key. The event carries the language
 * (`/es/classes`), the key, made from `router.asPath`, never does (`/classes`), so on a
 * site with several languages a language switch counted as a move to another page: the
 * page was frozen, no other page ever arrived to release it, and it could not be scrolled
 * again until the visitor went somewhere else.
 */

import { moduleBody } from './_helpers/load-client-runtime'
import { generatePageTransitionComponentCode } from '../src/page-transition/page-transition-component'

interface RenderedElement {
  type: unknown
  props: Record<string, unknown>
  children: unknown[]
}

interface Route {
  asPath: string
  locale?: string
  locales?: string[]
  defaultLocale?: string
}

type RouteHandler = (url: string) => void

const isElement = (value: unknown): value is RenderedElement =>
  !!value && typeof value === 'object' && 'props' in value && 'children' in value

const findPage = (tree: unknown): RenderedElement | undefined => {
  if (Array.isArray(tree)) {
    for (const item of tree) {
      const found = findPage(item)
      if (found) {
        return found
      }
    }
    return undefined
  }
  if (!isElement(tree)) {
    return undefined
  }
  return 'data-tq-page-transition' in tree.props ? tree : findPage(tree.children)
}

/**
 * The generated `components/tq-page-transition.js` under a minimal hooks runtime: effects
 * run after each render, state setters ask for another render, and the route events it
 * subscribed to can be fired.
 */
const mountTransition = (preset: string, firstRoute: Route) => {
  const source = generatePageTransitionComponentCode({ preset, duration: 0.3, easing: 'ease-out' })
  const slots: unknown[] = []
  const handlers: Record<string, RouteHandler[]> = {}
  const router = {
    ...firstRoute,
    events: {
      on: (name: string, handler: RouteHandler) => {
        handlers[name] = [...(handlers[name] || []), handler]
      },
      off: (name: string, handler: RouteHandler) => {
        handlers[name] = (handlers[name] || []).filter((item) => item !== handler)
      },
    },
    beforePopState: (): void => undefined,
  }
  let cursor = 0
  let pendingEffects: Array<() => void> = []

  const sameDeps = (a: unknown[] | undefined, b: unknown[] | undefined) =>
    !!a && !!b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]))
  const slot = <T>(create: () => T): T => {
    if (cursor >= slots.length) {
      slots.push(create())
    }
    return slots[cursor++] as T
  }

  const useEffect = (effect: () => void | (() => void), deps?: unknown[]) => {
    const record = slot<{ deps?: unknown[]; cleanup?: void | (() => void) }>(() => ({}))
    if (!deps || !sameDeps(record.deps, deps)) {
      record.deps = deps
      pendingEffects.push(() => {
        if (typeof record.cleanup === 'function') {
          record.cleanup()
        }
        record.cleanup = effect()
      })
    }
  }

  const React = {
    Fragment: 'fragment',
    createElement: (
      type: unknown,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ) => ({
      type,
      props: props || {},
      children,
    }),
    useRef: (initial: unknown) => slot(() => ({ current: initial })),
    useState: (initial: unknown) => {
      const state = slot(() => ({ value: initial }))
      const set = (next: unknown) => {
        state.value =
          typeof next === 'function' ? (next as (v: unknown) => unknown)(state.value) : next
      }
      return [state.value, set]
    },
    useMemo: (create: () => unknown, deps: unknown[]) => {
      const memo = slot<{ deps?: unknown[]; value?: unknown }>(() => ({}))
      if (!sameDeps(memo.deps, deps)) {
        memo.deps = deps
        memo.value = create()
      }
      return memo.value
    },
    useCallback: (callback: unknown, deps: unknown[]) => {
      const memo = slot<{ deps?: unknown[]; value?: unknown }>(() => ({}))
      if (!sameDeps(memo.deps, deps)) {
        memo.deps = deps
        memo.value = callback
      }
      return memo.value
    },
    useEffect,
    useLayoutEffect: useEffect,
  }

  const style = {
    getPropertyValue: () => '',
    getPropertyPriority: () => '',
    setProperty: (): void => undefined,
    removeProperty: (): void => undefined,
  }
  const element = { style, getAttribute: (): null => null, clientWidth: 1440, scrollHeight: 4000 }
  const windowFake = {
    innerWidth: 1440,
    innerHeight: 900,
    scrollY: 250,
    matchMedia: () => ({ matches: false }),
    addEventListener: (): void => undefined,
    removeEventListener: (): void => undefined,
    getComputedStyle: () => ({ backgroundColor: 'rgb(255, 255, 255)', overflowY: 'auto' }),
  }
  const documentFake = {
    documentElement: element,
    body: element,
    images: [] as unknown[],
    querySelector: (): null => null,
    querySelectorAll: (): unknown[] => [],
    addEventListener: (): void => undefined,
    removeEventListener: (): void => undefined,
  }

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const Component = new Function(
    'React',
    'useRouter',
    'AnimatePresence',
    'motion',
    'usePresence',
    'window',
    'document',
    'setTimeout',
    'clearTimeout',
    `${moduleBody(source.replace(/^export default .*$/m, ''))}\nreturn TqPageTransition`
  )(
    React,
    () => router,
    'AnimatePresence',
    { div: 'motion.div' },
    () => [true, (): void => undefined],
    windowFake,
    documentFake,
    () => 0,
    (): void => undefined
  ) as (props: { children: unknown }) => unknown

  const render = () => {
    cursor = 0
    const tree = Component({ children: 'the page' })
    const effects = pendingEffects
    pendingEffects = []
    effects.forEach((effect) => effect())
    return tree
  }
  render()

  return {
    /** What Next announces before it changes the route. */
    announce: (url: string) => (handlers.routeChangeStart || []).forEach((handler) => handler(url)),
    /** The route after the change; the page as it renders then. */
    arriveAt: (route: Route) => {
      Object.assign(router, route)
      return findPage(render())
    },
    page: () => findPage(render()),
  }
}

const TWO_LANGUAGES = { locales: ['en', 'es'], defaultLocale: 'en' }
const isFrozen = (page: RenderedElement | undefined) =>
  (page?.props.style as { position?: string } | undefined)?.position === 'fixed'

describe.each(['slide-up', 'fade'])('generated page transition (%s) and languages', (preset) => {
  it('does not freeze the page when the visitor switches language', () => {
    const site = mountTransition(preset, { asPath: '/classes', locale: 'en', ...TWO_LANGUAGES })

    site.announce('/es/classes')
    const page = site.arriveAt({ asPath: '/classes', locale: 'es' })

    expect(page?.props['data-tq-page-transition']).toBe('/classes')
    expect(isFrozen(page)).toBe(false)
  })

  it('does not freeze the home page on a language switch either', () => {
    const site = mountTransition(preset, { asPath: '/', locale: 'en', ...TWO_LANGUAGES })

    site.announce('/es')

    expect(isFrozen(site.arriveAt({ asPath: '/', locale: 'es' }))).toBe(false)
  })

  it('still freezes the page being left when a translated page moves to another page', () => {
    const site = mountTransition(preset, { asPath: '/', locale: 'es', ...TWO_LANGUAGES })

    site.announce('/es/classes')

    expect(isFrozen(site.page())).toBe(true)
  })

  it('still freezes the page being left on a site with one language', () => {
    const site = mountTransition(preset, { asPath: '/classes' })

    site.announce('/pricing')

    expect(isFrozen(site.page())).toBe(true)
  })

  it('takes an address that only differs by its query or hash for the same page', () => {
    const site = mountTransition(preset, { asPath: '/classes', locale: 'es', ...TWO_LANGUAGES })

    site.announce('/es/classes?level=1#top')

    expect(isFrozen(site.page())).toBe(false)
  })
})

describe('generated page transition (fade): the page arriving in a translated language', () => {
  it('is laid over the page being left, as in the default language', () => {
    const over = (route: Route, announced: string, arrived: Route) => {
      const site = mountTransition('fade', route)
      site.announce(announced)
      const page = site.arriveAt(arrived)
      return (page?.props.style as { position?: string } | undefined)?.position
    }

    const english = over({ asPath: '/', locale: 'en', ...TWO_LANGUAGES }, '/classes', {
      asPath: '/classes',
    })
    const spanish = over({ asPath: '/', locale: 'es', ...TWO_LANGUAGES }, '/es/classes', {
      asPath: '/classes',
    })

    expect(english).toBe('relative')
    expect(spanish).toBe('relative')
  })
})
