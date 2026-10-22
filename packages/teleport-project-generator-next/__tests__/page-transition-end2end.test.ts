import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import { PageTransition } from '@teleporthq/teleport-shared'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'
import {
  pageTransitionCover,
  pageTransitionCoverColor,
  pageTransitionSkipPattern,
  pageTransitionVariants,
  resolvePageTransitionOptions,
  reversePageTransitionPreset,
} from '../src/page-transition/page-transition-variants'
import { revealOnScreen } from '../src/page-transition/reveal-on-screen'
import { REVEAL_ON_SCREEN_SOURCES } from '../src/page-transition/reveal-on-screen-source.generated'

const template = () => JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

const buildUidl = (pageTransition?: {
  preset: string
  duration: number
  easing: string
  skipRoutes?: string[]
  options?: Record<string, string>
  custom?: { arrive: Record<string, number>; leave: Record<string, number> }
  flyingPictures?: boolean
}) => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  if (pageTransition) {
    ;(uidl.globals.settings as { pageTransition?: unknown }).pageTransition = pageTransition
  }
  return uidl
}

const findFile = (folder: GeneratedFolder, folderName: string, fileName: string) =>
  folder.subFolders
    .find((sub) => sub.name === folderName)
    ?.files.find((file) => file.name === fileName)

describe('Next generator page transition', () => {
  const generator = createNextProjectGenerator()

  it('leaves a project without a transition exactly as before', async () => {
    const output = await generator.generateProject(buildUidl(), template())
    expect(findFile(output, 'components', 'tq-page-transition')).toBeUndefined()
    const app = findFile(output, 'pages', '_app')
    expect(app?.content).toContain('<Component {...pageProps} />')
    expect(app?.content).not.toContain('TqPageTransition')
    const pkg = output.files.find((file) => file.name === 'package')
    expect(pkg?.content).not.toContain('framer-motion')
  })

  it('wraps the page mount and ships the wrapper when the editor chose one', async () => {
    const output = await generator.generateProject(
      buildUidl({ preset: 'slide-up', duration: 0.25, easing: 'ease-out' }),
      template()
    )
    const app = findFile(output, 'pages', '_app')
    expect(app?.content).toContain(
      "import TqPageTransition from '../components/tq-page-transition'"
    )
    expect(app?.content).toContain(
      '<TqPageTransition><Component {...pageProps} /></TqPageTransition>'
    )
    const wrapper = findFile(output, 'components', 'tq-page-transition')
    expect(wrapper?.content).toContain("const PRESET = 'slide-up'")
    expect(wrapper?.content).toContain('function reversePageTransitionPreset(')
    expect(wrapper?.content).toContain('router.beforePopState(')
    expect(wrapper?.content).toContain("window.addEventListener('pointerdown'")
    expect(wrapper?.content).toContain('const DURATION = 0.25')
    expect(wrapper?.content).toContain('const EASE = [0, 0, 0.58, 1]')
    expect(wrapper?.content).toContain('function pageTransitionVariants(')
    expect(wrapper?.content).toContain(
      "AnimatePresence mode={context.morph || !OVERLAP ? 'wait' : 'sync'} initial={false}"
    )
    expect(wrapper?.content).toContain("router.events.on('routeChangeStart'")
    const pkg = output.files.find((file) => file.name === 'package')
    expect(pkg?.content).toContain('"framer-motion"')
    expect(pkg?.content).toContain('"react": "^18.3.1"')
  })

  // The server cannot know that a visitor asks for less motion. A wrapper that
  // rendered the bare page for them made React throw the server's page away on
  // every load (error 418) and draw it again in the browser.
  it('renders the same page for every visitor and gives less motion each page at once', async () => {
    const output = await generator.generateProject(
      buildUidl({ preset: 'slide-up', duration: 0.25, easing: 'ease-out' }),
      template()
    )
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''

    expect(wrapper).not.toContain('useReducedMotion')
    expect(wrapper).toContain('if (!variants) {\n    return children\n  }')
    expect(wrapper).toContain('const skip = prefersLessMotion() || isSkippedRoute(routeKeyOf(url))')
  })

  it('ignores a transition it does not know and a preset of none', async () => {
    const output = await generator.generateProject(
      buildUidl({ preset: 'none', duration: 0.35, easing: 'ease-out' }),
      template()
    )
    expect(findFile(output, 'components', 'tq-page-transition')).toBeUndefined()
    expect(findFile(output, 'pages', '_app')?.content).not.toContain('TqPageTransition')
  })

  it('falls back to the site curve when the easing name is unknown', async () => {
    const output = await generator.generateProject(
      buildUidl({ preset: 'fade', duration: 0.45, easing: 'wobble' }),
      template()
    )
    expect(findFile(output, 'components', 'tq-page-transition')?.content).toContain(
      'const EASE = [0, 0, 0.58, 1]'
    )
  })

  // Hero photographs of 3000px missed a 300 ms wait: the page faded in on an
  // empty hero and the photograph snapped in over it in one frame.
  it('plays an arriving page once the pictures on its first screen are decoded, longer while the leaving page holds the screen', async () => {
    const output = await generator.generateProject(
      buildUidl({ preset: 'fade', duration: 0.35, easing: 'ease-out' }),
      template()
    )
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).toContain('const PICTURE_WAIT_MS = 1200')
    expect(wrapper).toContain('const BARE_PICTURE_WAIT_MS = 300')
    expect(wrapper).toContain('image.decode().catch(() => {})')
    // the long wait only where the leaving page is still on screen: overlapping, or pictured by the browser
    expect(wrapper).toContain(
      'const held = !!landing || !!(overlap && overlap.arrivingKey === key)\n' +
        '    Promise.all([picturesReady(node, held ? PICTURE_WAIT_MS : BARE_PICTURE_WAIT_MS), twinReady]).then(([loading]) => {'
    )
    // the first page is ready at once; a later one waits at its starting state
    expect(wrapper).toContain('const [readyKey, setReadyKey] = React.useState(routeKey)')
    expect(wrapper).toContain("animate={readyKey === routeKey ? 'animate' : 'initial'}")
    // a page that arrived after it takes the turn: a late answer changes nothing
    expect(wrapper).toContain('if (readyKeyRef.current === key) {')
  })

  describe('a picture that misses the wait', () => {
    const latePictures = async () => {
      const output = await generator.generateProject(
        buildUidl({ preset: 'fade', duration: 0.35, easing: 'ease-out' }),
        template()
      )
      const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
      const runtime = new Function(
        'window',
        [
          declarationOf(wrapper, 'DURATION'),
          declarationOf(wrapper, 'LATE_PICTURE_WAIT_MS'),
          declarationOf(wrapper, 'LATE_PICTURE_ATTR'),
          declarationOf(wrapper, 'picturesReady'),
          declarationOf(wrapper, 'fadeInWhenLoaded'),
          'return { picturesReady, fadeInWhenLoaded }',
        ].join('\n')
      )({ innerHeight: 800 })
      jest.useFakeTimers()
      return { wrapper, ...runtime }
    }
    const pictureAt = (
      top: number,
      loaded: boolean,
      decode = () => new Promise(() => undefined)
    ) => {
      const attributes = new Map<string, string>()
      const listeners = new Map<string, Set<(event: { type: string }) => void>>()
      const picture = {
        complete: loaded,
        attributes,
        decode,
        getBoundingClientRect: () => ({ top, bottom: top + 400 }),
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
        addEventListener: (type: string, listener: (event: { type: string }) => void) =>
          listeners.set(type, (listeners.get(type) || new Set()).add(listener)),
        removeEventListener: (type: string, listener: (event: { type: string }) => void) =>
          listeners.get(type)?.delete(listener),
        listening: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
        fire: (type: string) => {
          picture.complete = true
          ;[...(listeners.get(type) || [])].forEach((listener) => listener({ type }))
        },
      }
      return picture
    }
    const ATTR = 'data-tq-late-picture'

    afterEach(() => jest.useRealTimers())

    it('waits unseen and fades in once it has loaded, the way its page did', async () => {
      const { wrapper, picturesReady, fadeInWhenLoaded } = await latePictures()
      const decoded = pictureAt(0, true, () => Promise.resolve())
      const hero = pictureAt(100, false)
      const belowTheFold = pictureAt(1200, false)
      const ready = picturesReady({ querySelectorAll: () => [decoded, hero, belowTheFold] }, 1200)
      jest.advanceTimersByTime(1200)
      // settled by the wait, with the first-screen pictures still loading
      expect(await ready).toEqual([hero])

      fadeInWhenLoaded(hero)
      expect(hero.attributes.get(ATTR)).toBe('loading')
      hero.fire('load')
      expect(hero.attributes.get(ATTR)).toBe('in')
      jest.advanceTimersByTime(350 + 100)
      expect(hero.attributes.has(ATTR)).toBe(false)
      expect(hero.listening()).toBe(0)

      // unseen while loading, then faded in with the page's own duration and curve
      expect(wrapper).toContain(
        'const LATE_PICTURE_CSS = ' +
          JSON.stringify(
            `[${ATTR}="loading"] { opacity: 0 !important; }\n` +
              `[${ATTR}="in"] { transition: opacity 0.35s cubic-bezier(0, 0, 0.58, 1) !important; }`
          )
      )
      expect(wrapper).toContain('<style dangerouslySetInnerHTML={{ __html: LATE_PICTURE_CSS }} />')
      // only the pictures that missed the wait; not the flight's twin, nor for less motion or a page shown at once
      expect(wrapper).toContain(
        '        if (!prefersLessMotion() && !isSkippedRoute(key)) {\n' +
          '          loading.filter((image) => image !== twin).forEach(fadeInWhenLoaded)\n' +
          '        }\n' +
          '        setReadyKey(key)'
      )
    })

    it('is never left unseen: one that fails shows at once, one that never loads after the hard timeout', async () => {
      const { fadeInWhenLoaded } = await latePictures()
      const broken = pictureAt(0, false)
      fadeInWhenLoaded(broken)
      broken.fire('error')
      expect(broken.attributes.has(ATTR)).toBe(false)
      expect(broken.listening()).toBe(0)

      const stalled = pictureAt(0, false)
      fadeInWhenLoaded(stalled)
      jest.advanceTimersByTime(5000 - 1)
      expect(stalled.attributes.get(ATTR)).toBe('loading')
      jest.advanceTimersByTime(1)
      expect(stalled.attributes.has(ATTR)).toBe(false)
      expect(stalled.listening()).toBe(0)
      // loading after all, it simply appears: nothing hides it again
      stalled.fire('load')
      expect(stalled.attributes.has(ATTR)).toBe(false)
    })
  })

  // Frozen, the leaving page no longer gives the document a height: a scrollbar
  // that takes room vanished at the click and came back when the arriving page
  // mounted, and the page jolted sideways by the scrollbar's width both times.
  it.each(['fade', 'slide-up', 'circle'])(
    "%s holds the scrollbar's room for exactly as long as the leaving page is frozen",
    async (preset) => {
      const output = await generator.generateProject(
        buildUidl({ preset, duration: 0.35, easing: 'ease-out' }),
        template()
      )
      const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
      const guard = wrapper.indexOf('      if (!gutterRef.current) {\n')
      const hold = wrapper.indexOf('gutterRef.current = holdScrollbarGutter()')
      const freeze = wrapper.indexOf(
        'setFrozen({ key: routeKeyRef.current, top: window.scrollY || 0 })'
      )
      // measured and held right before the page is frozen, once per freeze
      expect(guard).toBeGreaterThan(-1)
      expect(hold).toBeGreaterThan(guard)
      expect(freeze).toBeGreaterThan(hold)
      // given back before the paint of the commit that ends the freeze, and on unmount
      expect(wrapper).toContain(
        "const useBeforePaintEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect"
      )
      expect(wrapper).toContain(
        'useBeforePaintEffect(() => {\n    if (!frozen) {\n      releaseGutter()\n    }\n  }, [frozen])'
      )
      expect(wrapper).toContain('React.useEffect(() => releaseGutter, [])')
      expect(wrapper.indexOf('releaseGutter()')).toBeLessThan(wrapper.indexOf('if (!variants) {'))
    }
  )

  it("holds the room only when the scrollbar takes some, and puts <html>'s own overflow back exactly", async () => {
    const output = await generator.generateProject(
      buildUidl({ preset: 'fade', duration: 0.35, easing: 'ease-out' }),
      template()
    )
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    const start = wrapper.indexOf('const holdScrollbarGutter = () => {')
    const source = wrapper.slice(start, wrapper.indexOf('\n}\n', start) + 2)
    const pageRoot = (clientWidth: number, own?: [string, string]) => {
      const declarations = new Map<string, [string, string]>(own ? [['overflow-y', own]] : [])
      const style = {
        getPropertyValue: (name: string) => (declarations.get(name) || [''])[0],
        getPropertyPriority: (name: string) => (declarations.get(name) || ['', ''])[1],
        setProperty: (name: string, value: string, priority = '') => {
          declarations.set(name, [value, priority])
        },
        removeProperty: (name: string) => {
          declarations.delete(name)
        },
      }
      return { clientWidth, style, declarations }
    }
    const holdOn = (root: ReturnType<typeof pageRoot>, innerWidth: number) =>
      new Function('window', 'document', `${source}\nreturn holdScrollbarGutter()`)(
        { innerWidth },
        { documentElement: root }
      )

    // an overlay scrollbar (or a page that does not scroll) takes no room: nothing is touched
    const overlay = pageRoot(1280)
    expect(holdOn(overlay, 1280)).toBeNull()
    expect(overlay.declarations.size).toBe(0)

    // a scrollbar that takes 15px keeps it while frozen; <html> had no overflow of its own
    const classic = pageRoot(1265)
    const release = holdOn(classic, 1280)
    expect(classic.declarations.get('overflow-y')).toEqual(['scroll', 'important'])
    release()
    expect(classic.declarations.has('overflow-y')).toBe(false)

    // a value of the page's own comes back with its priority
    const styled = pageRoot(1265, ['auto', 'important'])
    const releaseStyled = holdOn(styled, 1280)
    expect(styled.declarations.get('overflow-y')).toEqual(['scroll', 'important'])
    releaseStyled()
    expect(styled.declarations.get('overflow-y')).toEqual(['auto', 'important'])
  })
})

describe('Next generator per-page skip', () => {
  const generator = createNextProjectGenerator()

  it('carries the opted-out routes into the wrapper as patterns', async () => {
    const output = await generator.generateProject(
      buildUidl({
        preset: 'fade',
        duration: 0.35,
        easing: 'ease-out',
        skipRoutes: ['/checkout', '/products/[slug]'],
      }),
      template()
    )
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).toContain('const SKIP_ROUTES = ["/checkout","/products/[slug]"]')
    expect(wrapper).toContain('const skip = prefersLessMotion() || isSkippedRoute(routeKeyOf(url))')
    expect(wrapper).not.toContain('isSkippedRoute(routeKeyRef.current)')
  })

  it('emits an empty list when no page opted out', async () => {
    const output = await generator.generateProject(
      buildUidl({ preset: 'fade', duration: 0.35, easing: 'ease-out' }),
      template()
    )
    expect(findFile(output, 'components', 'tq-page-transition')?.content).toContain(
      'const SKIP_ROUTES = []'
    )
  })
})

describe('Next generator cover presets', () => {
  const generator = createNextProjectGenerator()

  it('ships the overlay panels, painted in the theme colour, only for the cover family', async () => {
    const covered = await generator.generateProject(
      buildUidl({ preset: 'curtain', duration: 0.35, easing: 'ease-out' }),
      template()
    )
    const wrapper = findFile(covered, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).toContain('function pageTransitionCover(')
    expect(wrapper).toContain('--dl-color-theme-primary1')
    expect(wrapper).toContain('data-tq-page-transition-panel')
    expect(wrapper).toContain("const PRESET = 'curtain'")
    // the panels stay closed until the arriving page's pictures are ready
    expect(wrapper).toContain("setPanelPhase('covered')")
    expect(wrapper).toContain(
      "setPanelPhase((phase) => (phase === 'covered' ? 'uncovering' : phase))"
    )
  })
})

describe('Next generator flying picture', () => {
  const generator = createNextProjectGenerator()
  const config = { preset: 'slide-up', duration: 0.3, easing: 'ease-out' }

  it('plays the static export’s stylesheet, without opting every page load in', async () => {
    const output = await generator.generateProject(buildUidl(config), template())
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    const plan = PageTransition.viewTransitionPlan(config, { crossDocument: false })
    expect(wrapper).toContain(`const VT_CSS = ${JSON.stringify(plan?.css)}`)
    expect(plan?.css).toContain('::view-transition-group(tq-morph)')
    expect(plan?.css).not.toContain('@view-transition')
    expect(wrapper).toContain('<style dangerouslySetInnerHTML={{ __html: VT_CSS }} />')
  })

  it('turned off by the author, plays every page change as its transition, with no flight', async () => {
    const output = await generator.generateProject(
      buildUidl({ ...config, flyingPictures: false }),
      template()
    )
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    // no stylesheet for a flight, so a page change never starts one
    expect(wrapper).toContain('const VT_CSS = ""')
    expect(wrapper).toContain('const FLIES = false')
    expect(wrapper).toContain(
      "if (!VT_CSS || !pageRef.current || typeof document.startViewTransition !== 'function'"
    )
  })

  it('a reveal keeps its stylesheet with the flight off: the reveal itself plays as a View Transition', async () => {
    const output = await generator.generateProject(
      buildUidl({ preset: 'circle', duration: 0.3, easing: 'ease-out', flyingPictures: false }),
      template()
    )
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).toContain('const FLIES = false')
    expect(wrapper).toContain('const VT_CSS = "')
    expect(wrapper).toContain('tq-page-arrive')
    expect(wrapper).not.toContain('tq-morph-away')
  })

  it('pairs the pictures with the static export’s own helpers', async () => {
    const output = await generator.generateProject(buildUidl(config), template())
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).toContain(PageTransition.morphHelpersSource())
    expect(wrapper).toContain(
      'const image = FLIES && !reverse ? tqMorphSource(url, clickedRef.current) : null'
    )
    expect(wrapper).toContain('twin = landing.src ? tqMorphTarget(landing.src) : null')
  })

  it('flies only going forward, to a page that plays transitions, for a visitor who wants motion', async () => {
    const output = await generator.generateProject(buildUidl(config), template())
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).toContain('if (!skip && startViewChange(url, pointer, reverse))')
    // the picture flies forward only; a reveal plays either way
    expect(wrapper).toContain(
      'const image = FLIES && !reverse ? tqMorphSource(url, clickedRef.current) : null'
    )
    expect(wrapper).toContain('if (!image && !REVEAL) {')
    expect(wrapper).toContain(
      "typeof document.startViewTransition !== 'function' || prefersLessMotion()"
    )
  })

  it('keeps the leaving page until the browser has pictured it, on every page', async () => {
    const output = await generator.generateProject(buildUidl(config), template())
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).toContain(
      "import { AnimatePresence, motion, usePresence } from 'framer-motion'"
    )
    // Always rendered: framer-motion never forgets a presence child, so one that came and went would hold its page forever.
    expect(wrapper).toContain(
      '{VT_CSS || OVERLAP ? <HoldPage pageKey={routeKey} changeRef={changeRef} overlapRef={overlapRef} /> : null}'
    )
    expect(wrapper).toContain('change.captured.then(safeToRemove)')
  })

  it('gives up on the flight rather than freezing the screen when the page does not arrive', async () => {
    const output = await generator.generateProject(buildUidl(config), template())
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).toContain('setTimeout(() => abandon(change), ARRIVAL_WAIT_MS)')
    expect(wrapper).toContain("router.events.on('routeChangeError', onRouteChangeError)")
  })

  // Nothing is frozen in a View Transition's page change, and every export
  // scrolls smoothly for its in-page anchors: the product page arrived at the
  // card's offset and glided up through itself to its top.
  describe("holds <html>'s scrolling instant through the change, and gives it back on every path", () => {
    const pageRoot = (own?: [string, string]) => {
      const declarations = new Map<string, [string, string]>(own ? [['scroll-behavior', own]] : [])
      return {
        declarations,
        style: {
          getPropertyValue: (name: string) => (declarations.get(name) || [''])[0],
          getPropertyPriority: (name: string) => (declarations.get(name) || ['', ''])[1],
          setProperty: (name: string, value: string, priority = '') => {
            declarations.set(name, [value, priority])
          },
          removeProperty: (name: string) => {
            declarations.delete(name)
          },
        },
        setAttribute: () => undefined,
        removeAttribute: () => undefined,
      }
    }
    const viewChanges = async (root: ReturnType<typeof pageRoot>, failsToStart = false) => {
      const output = await generator.generateProject(buildUidl(config), template())
      const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
      const effect = wrapper.slice(
        wrapper.indexOf('    const root = document.documentElement\n'),
        wrapper.indexOf('    const onRouteChangeStart = ')
      )
      const transitions: Array<{
        finish: () => void
        fail: () => void
        skipTransition: () => void
      }> = []
      const document = {
        documentElement: root,
        startViewTransition: () => {
          if (failsToStart) {
            throw new Error('InvalidStateError')
          }
          let finish = () => undefined
          let fail = () => undefined
          const finished = new Promise<void>((resolve, reject) => {
            finish = resolve
            fail = reject
          })
          const transition = {
            ready: Promise.resolve(),
            finished,
            finish,
            fail,
            skipTransition: () => finish(),
          }
          transitions.push(transition)
          return transition
        },
      }
      const changeRef = { current: null }
      const { startViewChange, abandon } = new Function(
        'document',
        'changeRef',
        'scrollRef',
        'pageRef',
        'clickedRef',
        'overlapRef',
        'routeKeyRef',
        [
          declarationOf(wrapper, 'VT_CSS'),
          declarationOf(wrapper, 'FLIES'),
          declarationOf(wrapper, 'ARRIVAL_WAIT_MS'),
          declarationOf(wrapper, 'holdStyle'),
          'const REVEAL = false',
          'const TQ_MORPH_NAME = "tq-morph"',
          'const prefersLessMotion = () => false',
          'const tqMorphClear = () => {}',
          'const tqMorphSource = () => ({ style: {}, src: "/hero.jpg" })',
          effect,
          'return { startViewChange, abandon }',
        ].join('\n')
      )(
        document,
        changeRef,
        { current: null },
        { current: {} },
        { current: null },
        { current: null },
        { current: '/products' }
      )
      const changeTo = (url: string) => startViewChange(url, null, false)
      const scrolling = () => root.declarations.get('scroll-behavior')
      return { changeTo, abandon, changeRef, transitions, scrolling }
    }
    const settled = () => new Promise((resolve) => setImmediate(resolve))
    const flushed = async () => {
      for (let tick = 0; tick < 5; tick++) {
        await Promise.resolve()
      }
    }

    it('when the change plays through, or its transition fails', async () => {
      const root = pageRoot()
      const { changeTo, transitions, scrolling } = await viewChanges(root)
      expect(changeTo('/products/terra')).toBe(true)
      expect(scrolling()).toEqual(['auto', 'important'])
      transitions[0].finish()
      await settled()
      expect(scrolling()).toBeUndefined()

      expect(changeTo('/products/lumen')).toBe(true)
      expect(scrolling()).toEqual(['auto', 'important'])
      transitions[1].fail()
      await settled()
      expect(scrolling()).toBeUndefined()
    })

    it("when the change cannot start, putting the page's own value back exactly", async () => {
      const root = pageRoot(['smooth', ''])
      const { changeTo, scrolling } = await viewChanges(root, true)
      expect(changeTo('/products/terra')).toBe(false)
      expect(scrolling()).toEqual(['smooth', ''])
    })

    it('when the page never arrives, or its route fails', async () => {
      const root = pageRoot()
      const { changeTo, abandon, changeRef, scrolling } = await viewChanges(root)
      jest.useFakeTimers()
      try {
        changeTo('/products/terra')
        jest.advanceTimersByTime(3000 - 1)
        await flushed()
        expect(scrolling()).toEqual(['auto', 'important'])
        jest.advanceTimersByTime(1)
        await flushed()
        expect(scrolling()).toBeUndefined()

        // routeChangeError abandons the change in flight
        changeTo('/products/lumen')
        expect(scrolling()).toEqual(['auto', 'important'])
        abandon(changeRef.current)
        await flushed()
        expect(scrolling()).toBeUndefined()
      } finally {
        jest.useRealTimers()
      }
    })

    it('when a second change interrupts the first: held once, given back by the last', async () => {
      const root = pageRoot(['smooth', ''])
      const { changeTo, transitions, scrolling } = await viewChanges(root)
      changeTo('/products/terra')
      changeTo('/products/lumen')
      transitions[0].finish()
      await settled()
      // the first change no longer owns the page: the second is still playing
      expect(scrolling()).toEqual(['auto', 'important'])
      transitions[1].finish()
      await settled()
      // held once, so the first hold's "auto" is never taken for the page's own
      expect(scrolling()).toEqual(['smooth', ''])
    })
  })
})

describe('Next generator reveal presets (Circle, the Wipes)', () => {
  const generator = createNextProjectGenerator()

  it("never leaves the reveal's clip on the page: settled, first page included, it is dropped by framer", async () => {
    const output = await generator.generateProject(
      buildUidl({ preset: 'circle', duration: 0.3, easing: 'ease-out' }),
      template()
    )
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    // the shipped wrapper carries the function tested below, and every reveal goes through it
    expect(wrapper).toContain(REVEAL_ON_SCREEN_SOURCES.revealOnScreen)
    expect(wrapper).toContain(
      'revealOnScreen(pageTransitionVariants(PRESET, SLIDE_PX, context, OPTIONS, CUSTOM || undefined), context.screen)'
    )
    // the old hand-clearing lost its race with framer's last write
    expect(wrapper).not.toContain('pageRef.current.style.clipPath')
    // no screen measured yet (the first page, the server): only the settling applies
    const firstPage = revealOnScreen(pageTransitionVariants('circle', 24))
    expect(firstPage?.animate.transitionEnd).toEqual({ clipPath: 'none' })
    // the leaving page holds under the arriving one: it has no exit of its own
    expect(firstPage?.exit).toEqual({})
  })

  it('measures a reveal on the screen, not on the page it clips', () => {
    // A page change started 2000px down a page, on a 1200 x 800 screen.
    const screen = { width: 1200, height: 800 }
    const pressed = { reverse: false, originX: '600px', originY: '36px' }
    const circle = revealOnScreen(pageTransitionVariants('circle', 24, pressed), screen)
    // CSS resolves a circle's percentage against the diagonal over root two — here, the screen's
    const full = 1.5 * Math.sqrt((1200 * 1200 + 800 * 800) / 2)
    // the arrival opens at the top of the new page, under the press
    expect(circle?.initial.clipPath).toBe('circle(0px at 600px 36px)')
    expect(circle?.animate.clipPath).toBe('circle(' + full + 'px at 600px 36px)')
    // the leaving page is frozen where it stood and simply holds under the reveal
    expect(circle?.exit).toEqual({})
    // a wipe sweeps the screen, not the page: its edges run over the 800px on show
    const wipe = revealOnScreen(pageTransitionVariants('wipe-down', 24), screen)
    expect(wipe?.initial.clipPath).toBe('inset(0px 0% calc(100% - 0px) 0%)')
    expect(wipe?.animate.clipPath).toBe('inset(0px 0% calc(100% - 800px) 0%)')
    expect(wipe?.exit).toEqual({})
    // the sides already match (the page is as wide as the screen); only the band is added
    expect(revealOnScreen(pageTransitionVariants('wipe-left', 24), screen)?.initial.clipPath).toBe(
      'inset(0px 0% calc(100% - 800px) 100%)'
    )
    // every other preset is untouched
    expect(revealOnScreen(pageTransitionVariants('fade', 24), screen)).toEqual(
      pageTransitionVariants('fade', 24)
    )
  })

  it('measures the screen when a page change starts, from the press or the screen centre', async () => {
    const output = await generator.generateProject(
      buildUidl({ preset: 'circle', duration: 0.3, easing: 'ease-out' }),
      template()
    )
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).toContain(
      'const screen = { width: window.innerWidth, height: window.innerHeight }'
    )
    expect(wrapper).toContain(
      'const origin = pointer || { x: screen.width / 2, y: screen.height / 2 }'
    )
    expect(REVEAL_ON_SCREEN_SOURCES.revealOnScreen.startsWith('function revealOnScreen(')).toBe(
      true
    )
  })

  it('opens a reveal over the leaving page, which holds; a slide plays in turn', async () => {
    const circle = await generator.generateProject(
      buildUidl({ preset: 'circle', duration: 0.3, easing: 'ease-out' }),
      template()
    )
    const circleWrapper = findFile(circle, 'components', 'tq-page-transition')?.content || ''
    // with View Transitions the whole change is one, the leaving picture kept as it is
    expect(circleWrapper).toContain('if (!image && !REVEAL) {')
    // without them the reveal runs frame by frame in framer's own loop — a browser-run
    // clip-path animation ends one frame before its last value and the page blinks away
    expect(circleWrapper).toContain('onUpdate={REVEAL ? stepByFrame : undefined}')
    const plan = PageTransition.viewTransitionPlan(
      { preset: 'circle', duration: 0.3, easing: 'ease-out' },
      { crossDocument: false }
    )
    expect(plan?.revealsOver).toBe(true)
    expect(plan?.css).toContain('::view-transition-old(root) {\n    animation: none;\n  }')
    expect(circleWrapper).toContain(`const VT_CSS = ${JSON.stringify(plan?.css)}`)
    // without them the two pages overlap: the arriving page above, the leaving one held until it has opened
    expect(circleWrapper).toContain('const OVERLAP = REVEAL || DISSOLVE')
    expect(circleWrapper).toContain(
      "AnimatePresence mode={context.morph || !OVERLAP ? 'wait' : 'sync'} initial={false}"
    )
    expect(circleWrapper).toContain(
      "const OVER = { position: 'relative', zIndex: 1, minHeight: '100vh' }"
    )
    expect(circleWrapper).toContain('if (OVERLAP && !skip) {')
    expect(circleWrapper).toContain('overlap.opened.then(safeToRemove)')
    expect(circleWrapper).toContain(
      "if (definition === 'animate' && overlap && overlap.arrivingKey === routeKey) {"
    )
    expect(
      PageTransition.viewTransitionPlan(
        { preset: 'slide-up', duration: 0.3, easing: 'ease-out' },
        { crossDocument: false }
      )?.revealsOver
    ).toBe(false)
    const reveal = (preset: string) => {
      const variants = pageTransitionVariants(preset, 24)
      return !!(variants && variants.animate.clipPath)
    }
    expect(reveal('circle')).toBe(true)
    expect(reveal('wipe-down')).toBe(true)
    expect(reveal('fade')).toBe(false)
    expect(reveal('slide-up')).toBe(false)
  })
})

// One top-level declaration of the generated wrapper, as text: from its first
// line up to the next top-level statement or comment.
const declarationOf = (wrapper: string, name: string): string => {
  const start = wrapper.indexOf(`\nconst ${name} = `)
  if (start < 0) {
    throw new Error(`the wrapper declares no ${name}`)
  }
  const rest = wrapper.slice(start + 1)
  const end = rest.slice(1).search(/\n(const |\/\/ |function )/)
  return end < 0 ? rest : rest.slice(0, end + 1)
}

describe('Next generator dissolve presets (Fade, Crossfade)', () => {
  const generator = createNextProjectGenerator()
  const wrapperFor = async (config: { preset: string; flyingPictures?: boolean }) => {
    const output = await generator.generateProject(
      buildUidl({ duration: 0.35, easing: 'ease-out', ...config }),
      template()
    )
    return findFile(output, 'components', 'tq-page-transition')?.content || ''
  }
  // The states the wrapper plays for a preset, evaluated from the text it ships.
  const playedBy = (wrapper: string, preset: string) =>
    new Function(
      [
        PageTransition.PAGE_TRANSITION_HELPER_SOURCES.reversePageTransitionPreset,
        PageTransition.PAGE_TRANSITION_HELPER_SOURCES.pageTransitionVariants,
        declarationOf(wrapper, 'DISSOLVE'),
        declarationOf(wrapper, 'dissolveOver'),
        `return dissolveOver(pageTransitionVariants(${JSON.stringify(preset)}, 24))`,
      ].join('\n')
    )()

  // Faded out and then in, one after the other, the two pages left the site's
  // bare background on screen between them at every change.
  it.each(['fade', 'crossfade'])(
    '%s fades the arriving page in over the leaving one, which holds, instead of one after the other',
    async (preset) => {
      const wrapper = await wrapperFor({ preset })
      expect(wrapper).toContain('const DISSOLVE = true')
      expect(wrapper).toContain('const OVERLAP = REVEAL || DISSOLVE')
      // the arriving page mounts at once, over the frozen leaving page; a flight still waits
      expect(wrapper).toContain(
        "AnimatePresence mode={context.morph || !OVERLAP ? 'wait' : 'sync'} initial={false}"
      )
      // the leaving page has no exit of its own; the arriving page plays the preset's arrival
      const played = playedBy(wrapper, preset)
      expect(played.exit).toEqual({})
      expect(played.initial).toEqual(pageTransitionVariants(preset, 24)?.initial)
      expect(played.animate).toEqual(pageTransitionVariants(preset, 24)?.animate)
      expect(wrapper).toContain(
        ': dissolveOver(\n            revealOnScreen(pageTransitionVariants(PRESET, SLIDE_PX, context, OPTIONS, CUSTOM || undefined), context.screen)\n          )'
      )
      // held in the document until the arriving page is in, with the flight turned off too
      const noFlight = await wrapperFor({ preset, flyingPictures: false })
      expect(noFlight).toContain('const VT_CSS = ""')
      expect(noFlight).toContain(
        '{VT_CSS || OVERLAP ? <HoldPage pageKey={routeKey} changeRef={changeRef} overlapRef={overlapRef} /> : null}'
      )
      expect(noFlight).toContain('if (OVERLAP && !skip) {')
    }
  )

  it('every preset that moves the leaving page still plays it, one page after the other', async () => {
    for (const preset of ['slide-up', 'zoom-in', 'blur', 'stack', 'custom', 'cover']) {
      const wrapper = await wrapperFor({ preset })
      expect(wrapper).toContain('const DISSOLVE = false')
      expect(playedBy(wrapper, preset).exit).toEqual(pageTransitionVariants(preset, 24)?.exit)
    }
  })

  it("lays the arriving page on the site's ground, a screen tall, out of reach until it plays", async () => {
    const wrapper = await wrapperFor({ preset: 'fade' })
    expect(wrapper).toContain(
      "const OVER = { position: 'relative', zIndex: 1, minHeight: '100vh' }"
    )
    expect(wrapper).toContain("const UNSEEN = { pointerEvents: 'none' }")
    expect(wrapper).toContain('setOver({ key: overlap.arrivingKey, ground: siteGround() })')
    expect(wrapper).toContain(
      'Object.assign({ backgroundColor: over.ground }, OVER, readyKey === routeKey ? null : UNSEEN)'
    )
    expect(wrapper).toContain('const pageStyle = frozenStyle || overStyle')
    // the ground is what the browser paints the canvas with: <html>'s colour, else <body>'s
    const groundOf = (html: string, body: string) =>
      new Function(
        'window',
        'document',
        `${declarationOf(wrapper, 'siteGround')}\nreturn siteGround()`
      )(
        { getComputedStyle: (element: { color: string }) => ({ backgroundColor: element.color }) },
        { documentElement: { color: html }, body: { color: body } }
      )
    expect(groundOf('rgb(252, 250, 246)', 'rgb(20, 20, 20)')).toBe('rgb(252, 250, 246)')
    expect(groundOf('rgba(0, 0, 0, 0)', 'rgb(252, 250, 246)')).toBe('rgb(252, 250, 246)')
    expect(groundOf('transparent', 'rgba(0, 0, 0, 0)')).toBe('Canvas')
  })

  it('keeps the leaving page from input and assistive technology while it lies underneath, and gives a page coming back both again', async () => {
    const wrapper = await wrapperFor({ preset: 'fade' })
    // marked when it starts leaving under the arriving page, and held until that is in
    expect(wrapper).toContain(
      '    } else if (overlap && overlap.leavingKey === pageKey) {\n      setLeaving(pageIn(pageKey), true)\n      overlap.opened.then(safeToRemove)\n'
    )
    const setLeaving = new Function(`${declarationOf(wrapper, 'setLeaving')}\nreturn setLeaving`)()
    const nodeWith = (inert: boolean) => {
      const attributes = new Map<string, string>()
      return {
        ...(inert ? { inert: false } : {}),
        attributes,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
      }
    }
    const modern = nodeWith(true)
    setLeaving(modern, true)
    expect(modern.inert).toBe(true)
    expect(modern.attributes.size).toBe(0)
    setLeaving(modern, false)
    expect(modern.inert).toBe(false)
    // a browser without inert hides it from assistive technology at least
    const older = nodeWith(false)
    setLeaving(older, true)
    expect(older.attributes.get('aria-hidden')).toBe('true')
    setLeaving(older, false)
    expect(older.attributes.has('aria-hidden')).toBe(false)
    expect(() => setLeaving(null, true)).not.toThrow()
    // back to a page that has not gone yet: it takes input again and plays at once
    expect(wrapper).toContain(
      '      const returning = pageIn(routeKeyOf(url))\n      if (returning) {\n        setLeaving(returning, false)\n        readyKeyRef.current = routeKeyOf(url)\n        setReadyKey(readyKeyRef.current)\n      }'
    )
    const pageIn = new Function('document', `${declarationOf(wrapper, 'pageIn')}\nreturn pageIn`)({
      querySelectorAll: (selector: string) =>
        selector === '[data-tq-page-transition]'
          ? ['/', '/products'].map((key) => ({ key, getAttribute: () => key }))
          : [],
    })
    expect(pageIn('/products')?.key).toBe('/products')
    expect(pageIn('/cart')).toBeNull()
  })

  it('holds the leaving page from the moment it starts leaving, so a slow page still arrives over it', async () => {
    const wrapper = await wrapperFor({ preset: 'fade' })
    // the fallback that lets go of a page whose arrival never completes counts from
    // the leaving, not from the click: counted from the click, a page that took
    // longer to load arrived over nothing
    const timer = 'setTimeout(overlap.finish, DURATION * 1000 + PICTURE_WAIT_MS + 1000)'
    expect(wrapper.split(timer).length).toBe(2)
    expect(wrapper.indexOf(timer)).toBeGreaterThan(wrapper.indexOf('const HoldPage = '))
    expect(wrapper.indexOf(timer)).toBeLessThan(wrapper.indexOf('const TqPageTransition = '))
    // a change that does not overlap (a flight, a page shown at once) lets a held page go
    expect(wrapper.split('letHeldPageGo()').length).toBe(3)
    // the page that goes last hands the ref to the page left in the document
    expect(wrapper).toContain('pageRef.current = node || pageIn(routeKeyRef.current)')
  })
})

describe('pageTransitionVariants (mirror of the editor contract)', () => {
  it('matches the editor states preset for preset', () => {
    expect(pageTransitionVariants('fade', 24)).toEqual({
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
    })
    expect(pageTransitionVariants('slide-up', 24)).toEqual({
      initial: { opacity: 0, y: 24 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: -24 },
    })
    expect(pageTransitionVariants('wipe-down', 24)).toEqual({
      initial: { clipPath: 'inset(0 0 100% 0)' },
      animate: { clipPath: 'inset(0 0 0% 0)' },
      exit: { clipPath: 'inset(100% 0 0 0)' },
    })
    expect(
      pageTransitionVariants('circle', 24, { reverse: false, originX: '10px', originY: '20px' })
    ).toEqual({
      initial: { clipPath: 'circle(0% at 10px 20px)' },
      animate: { clipPath: 'circle(150% at 10px 20px)' },
      exit: { clipPath: 'circle(0% at 10px 20px)' },
    })
    expect(pageTransitionVariants('none', 24)).toBeNull()
  })

  it('plays directional presets the other way on back navigation', () => {
    const back = { reverse: true, originX: '50%', originY: '50%' }
    expect(pageTransitionVariants('slide-up', 24, back)).toEqual(
      pageTransitionVariants('slide-down', 24)
    )
    expect(pageTransitionVariants('wipe-left', 24, back)).toEqual(
      pageTransitionVariants('wipe-right', 24)
    )
    expect(reversePageTransitionPreset(reversePageTransitionPreset('stack'))).toBe('stack')
    expect(reversePageTransitionPreset('fade')).toBe('fade')
  })

  it('ships its helpers as text derived from their sources, each under its own name', async () => {
    const output = await createNextProjectGenerator().generateProject(
      buildUidl({ preset: 'fade', duration: 0.3, easing: 'ease-out' }),
      template()
    )
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    const sources = PageTransition.PAGE_TRANSITION_HELPER_SOURCES
    for (const name of Object.keys(sources) as Array<keyof typeof sources>) {
      expect(sources[name].startsWith(`function ${name}(`)).toBe(true)
      expect(wrapper).toContain(sources[name])
    }
  })

  it('cover presets hold the page while the panels sweep', () => {
    expect(pageTransitionCover('cover')).toEqual([
      { from: { y: '100%' }, cover: { y: '0%' }, away: { y: '-100%' } },
    ])
    expect(pageTransitionCover('fade')).toBeNull()
    expect(pageTransitionVariants('curtain', 24)?.exit).toEqual({ opacity: 0.999 })
  })
})

describe('Next generator preset options', () => {
  const generator = createNextProjectGenerator()

  it('resolves the chosen words at generation time and hands them to the variants', async () => {
    const output = await generator.generateProject(
      buildUidl({
        preset: 'slide-up',
        duration: 0.35,
        easing: 'ease-out',
        options: { distance: 'bold', color: 'dark' },
      }),
      template()
    )
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).toContain('const OPTIONS = {"distance":"bold"}')
    expect(wrapper).toContain(
      'pageTransitionVariants(PRESET, SLIDE_PX, context, OPTIONS, CUSTOM || undefined)'
    )
    expect(wrapper).toContain('const ORIGIN_FROM_POINTER = true')
  })

  it('fills defaults when the export carries no choices, so older projects play as before', async () => {
    const output = await generator.generateProject(
      buildUidl({ preset: 'curtain', duration: 0.35, easing: 'ease-out' }),
      template()
    )
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).toContain('const OPTIONS = {"color":"brand"}')
    expect(wrapper).toContain("const PANEL_COLOR = '" + pageTransitionCoverColor('brand') + "'")
    expect(wrapper).toContain('--dl-color-theme-primary1')
  })

  it('paints the curtain in the chosen theme colour and lets Circle grow from the centre', async () => {
    const curtain = await generator.generateProject(
      buildUidl({
        preset: 'curtain',
        duration: 0.35,
        easing: 'ease-out',
        options: { color: 'light' },
      }),
      template()
    )
    const curtainWrapper = findFile(curtain, 'components', 'tq-page-transition')?.content || ''
    expect(curtainWrapper).toContain(
      "const PANEL_COLOR = 'var(--dl-color-theme-neutral-light, #ffffff)'"
    )
    const circle = await generator.generateProject(
      buildUidl({
        preset: 'circle',
        duration: 0.35,
        easing: 'ease-out',
        options: { origin: 'center' },
      }),
      template()
    )
    const circleWrapper = findFile(circle, 'components', 'tq-page-transition')?.content || ''
    expect(circleWrapper).toContain('const ORIGIN_FROM_POINTER = false')
    expect(circleWrapper).toContain('reverse || !ORIGIN_FROM_POINTER ? null : pointerRef.current')
  })

  it('paints the curtain with a project token or a colour of the user’s own, and never with anything else', async () => {
    const token = await generator.generateProject(
      buildUidl({
        preset: 'cover',
        duration: 0.35,
        easing: 'ease-out',
        options: { color: '--dl-color-theme-accent1' },
      }),
      template()
    )
    expect(findFile(token, 'components', 'tq-page-transition')?.content).toContain(
      "const PANEL_COLOR = 'var(--dl-color-theme-accent1, var(--dl-color-theme-neutral-dark, #111111))'"
    )
    const hex = await generator.generateProject(
      buildUidl({
        preset: 'cover',
        duration: 0.35,
        easing: 'ease-out',
        options: { color: '#BF4408' },
      }),
      template()
    )
    expect(findFile(hex, 'components', 'tq-page-transition')?.content).toContain(
      "const PANEL_COLOR = '#BF4408'"
    )
    const hostile = await generator.generateProject(
      buildUidl({
        preset: 'cover',
        duration: 0.35,
        easing: 'ease-out',
        options: { color: "'; alert(1); '" },
      }),
      template()
    )
    const wrapper = findFile(hostile, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).not.toContain('alert(1)')
    expect(wrapper).toContain("const PANEL_COLOR = 'var(--dl-color-theme-primary1")
    const unresolved = await generator.generateProject(
      buildUidl({
        preset: 'cover',
        duration: 0.35,
        easing: 'ease-out',
        options: { color: 'token:TQ_x' },
      }),
      template()
    )
    expect(findFile(unresolved, 'components', 'tq-page-transition')?.content).toContain(
      "const PANEL_COLOR = 'var(--dl-color-theme-primary1"
    )
    const custom = await generator.generateProject(
      buildUidl({
        preset: 'cover',
        duration: 0.35,
        easing: 'ease-out',
        options: { color: '--brand-orange' },
      }),
      template()
    )
    expect(findFile(custom, 'components', 'tq-page-transition')?.content).toContain(
      "const PANEL_COLOR = 'var(--brand-orange, var(--dl-color-theme-neutral-dark, #111111))'"
    )
  })

  it('replaces a word it does not know with the default instead of failing the build', async () => {
    const output = await generator.generateProject(
      buildUidl({
        preset: 'blur',
        duration: 0.35,
        easing: 'ease-out',
        options: { softness: 'extreme' },
      }),
      template()
    )
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).toContain('const OPTIONS = {"softness":"light"}')
  })

  it('mirrors the editor: resolved options change the states the same way', () => {
    const bold = resolvePageTransitionOptions('slide-up', { distance: 'bold' })
    expect(pageTransitionVariants('slide-up', 24, undefined, bold)?.initial.y).toBe(96)
    expect(pageTransitionVariants('slide-up', 24)?.initial.y).toBe(24)
    expect(
      pageTransitionVariants(
        'blur',
        24,
        undefined,
        resolvePageTransitionOptions('blur', { softness: 'heavy' })
      )?.initial.filter
    ).toBe('blur(28px)')
    expect(resolvePageTransitionOptions('curtain', { color: 'neon' })).toEqual({ color: 'brand' })
  })
})

describe('Next generator design-your-own preset', () => {
  const generator = createNextProjectGenerator()

  it('ships the sanitized states and plays them through the same variants', async () => {
    const output = await generator.generateProject(
      buildUidl({
        preset: 'custom',
        duration: 0.8,
        easing: 'bounce',
        custom: {
          arrive: { opacity: 0.2, x: 40, y: 0, scale: 0.9, blur: 8 },
          leave: { opacity: 0, x: -9999, y: 0, scale: 1.1, blur: 0 },
        },
      }),
      template()
    )
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).toContain("const PRESET = 'custom'")
    expect(wrapper).toContain('"arrive":{"opacity":0.2,"x":40,"y":0,"scale":0.9,"blur":8}')
    expect(wrapper).toContain('"leave":{"opacity":0,"x":-400,"y":0,"scale":1.1,"blur":0}')
    expect(wrapper).toContain(
      'pageTransitionVariants(PRESET, SLIDE_PX, context, OPTIONS, CUSTOM || undefined)'
    )
    expect(wrapper).toContain('const DURATION = 0.8')
  })

  it('leaves every other preset with no custom states', async () => {
    const output = await generator.generateProject(
      buildUidl({ preset: 'fade', duration: 0.35, easing: 'ease-out' }),
      template()
    )
    expect(findFile(output, 'components', 'tq-page-transition')?.content).toContain(
      'const CUSTOM = null'
    )
  })
})
