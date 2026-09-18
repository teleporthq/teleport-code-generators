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
    expect(wrapper?.content).toContain('AnimatePresence mode="wait" initial={false}')
    expect(wrapper?.content).toContain("router.events.on('routeChangeStart'")
    expect(wrapper?.content).toContain('useReducedMotion')
    const pkg = output.files.find((file) => file.name === 'package')
    expect(pkg?.content).toContain('"framer-motion"')
    expect(pkg?.content).toContain('"react": "^18.3.1"')
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

  it('plays an arriving page once the pictures on its first screen are decoded, 300 ms at most', async () => {
    const output = await generator.generateProject(
      buildUidl({ preset: 'fade', duration: 0.35, easing: 'ease-out' }),
      template()
    )
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).toContain('const PICTURE_WAIT_MS = 300')
    expect(wrapper).toContain('image.decode().catch(() => {})')
    // the first page is ready at once; a later one waits at its starting state
    expect(wrapper).toContain('const [readyKey, setReadyKey] = React.useState(routeKey)')
    expect(wrapper).toContain("animate={readyKey === routeKey ? 'animate' : 'initial'}")
    // a page that arrived after it takes the turn: a late answer changes nothing
    expect(wrapper).toContain('if (readyKeyRef.current === key) {')
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
    expect(wrapper).toContain('const skip = isSkippedRoute(routeKeyOf(url))')
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
    expect(wrapper).toContain(`const MORPH_CSS = ${JSON.stringify(plan?.css)}`)
    expect(plan?.css).toContain('::view-transition-group(tq-morph)')
    expect(plan?.css).not.toContain('@view-transition')
    expect(wrapper).toContain('<style dangerouslySetInnerHTML={{ __html: MORPH_CSS }} />')
  })

  it('turned off by the author, plays every page change as its transition, with no flight', async () => {
    const output = await generator.generateProject(
      buildUidl({ ...config, flyingPictures: false }),
      template()
    )
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    // no stylesheet for a flight, so a page change never starts one
    expect(wrapper).toContain('const MORPH_CSS = ""')
    expect(wrapper).toContain(
      "if (!MORPH_CSS || !pageRef.current || typeof document.startViewTransition !== 'function'"
    )
  })

  it('pairs the pictures with the static export’s own helpers', async () => {
    const output = await generator.generateProject(buildUidl(config), template())
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).toContain(PageTransition.morphHelpersSource())
    expect(wrapper).toContain('const image = tqMorphSource(url, clickedRef.current)')
    expect(wrapper).toContain('const target = tqMorphTarget(morph.src)')
  })

  it('flies only going forward, to a page that plays transitions, for a visitor who wants motion', async () => {
    const output = await generator.generateProject(buildUidl(config), template())
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).toContain('if (!reverse && !skip && startMorph(url, pointer))')
    expect(wrapper).toContain(
      "typeof document.startViewTransition !== 'function' || prefersLessMotion()"
    )
  })

  it('keeps the leaving page until the browser has pictured it, on every page', async () => {
    const output = await generator.generateProject(buildUidl(config), template())
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).toContain(
      "import { AnimatePresence, motion, usePresence, useReducedMotion } from 'framer-motion'"
    )
    // Always rendered: framer-motion never forgets a presence child, so one that came and went would hold its page forever.
    expect(wrapper).toContain(
      '{MORPH_CSS ? <HoldForMorph pageKey={routeKey} morphRef={morphRef} /> : null}'
    )
    expect(wrapper).toContain('morph.captured.then(safeToRemove)')
  })

  it('gives up on the flight rather than freezing the screen when the page does not arrive', async () => {
    const output = await generator.generateProject(buildUidl(config), template())
    const wrapper = findFile(output, 'components', 'tq-page-transition')?.content || ''
    expect(wrapper).toContain('setTimeout(() => abandonMorph(morph), MORPH_WAIT_MS)')
    expect(wrapper).toContain("router.events.on('routeChangeError', onRouteChangeError)")
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
    expect(wrapper).toContain(revealOnScreen.toString())
    expect(wrapper).toContain(
      'revealOnScreen(pageTransitionVariants(PRESET, SLIDE_PX, context, OPTIONS, CUSTOM || undefined), context.screen)'
    )
    // the old hand-clearing lost its race with framer's last write
    expect(wrapper).not.toContain('pageRef.current.style.clipPath')
    // no screen measured yet (the first page, the server): only the settling applies
    const firstPage = revealOnScreen(pageTransitionVariants('circle', 24))
    expect(firstPage?.animate.transitionEnd).toEqual({ clipPath: 'none' })
    // the exit starts from the full reveal on its own, so nothing has to put the clip back
    expect(firstPage?.exit.clipPath).toEqual(['circle(150% at 50% 50%)', 'circle(0% at 50% 50%)'])
  })

  it('measures a reveal on the screen, not on the page it clips', () => {
    // A page change started 2000px down a page, on a 1200 x 800 screen.
    const screen = { width: 1200, height: 800, top: 2000 }
    const pressed = { reverse: false, originX: '600px', originY: '36px' }
    const circle = revealOnScreen(pageTransitionVariants('circle', 24, pressed), screen)
    // CSS resolves a circle's percentage against the diagonal over root two — here, the screen's
    const full = 1.5 * Math.sqrt((1200 * 1200 + 800 * 800) / 2)
    // the arrival opens at the top of the new page, under the press
    expect(circle?.initial.clipPath).toBe('circle(0px at 600px 36px)')
    expect(circle?.animate.clipPath).toBe('circle(' + full + 'px at 600px 36px)')
    // the leaving page is frozen where it stood: the circle closes on the press, 2000px down it
    expect(circle?.exit.clipPath).toEqual([
      'circle(' + full + 'px at 600px 2036px)',
      'circle(0px at 600px 2036px)',
    ])
    // a wipe sweeps the screen, not the page: its edges run over the 800px on show
    const wipe = revealOnScreen(pageTransitionVariants('wipe-down', 24), screen)
    expect(wipe?.initial.clipPath).toBe('inset(0px 0% calc(100% - 0px) 0%)')
    expect(wipe?.animate.clipPath).toBe('inset(0px 0% calc(100% - 800px) 0%)')
    expect(wipe?.exit.clipPath).toEqual([
      'inset(2000px 0% calc(100% - 2800px) 0%)',
      'inset(2800px 0% calc(100% - 2800px) 0%)',
    ])
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
      'const screen = { width: window.innerWidth, height: window.innerHeight, top: window.scrollY || 0 }'
    )
    expect(wrapper).toContain(
      'const origin = pointer || { x: screen.width / 2, y: screen.height / 2 }'
    )
    expect(revealOnScreen.toString()).not.toContain('`')
  })

  it('runs a reveal frame by frame (no blink as it ends); every other preset keeps the browser-run animation', async () => {
    const circle = await generator.generateProject(
      buildUidl({ preset: 'circle', duration: 0.3, easing: 'ease-out' }),
      template()
    )
    const circleWrapper = findFile(circle, 'components', 'tq-page-transition')?.content || ''
    expect(circleWrapper).toContain('onUpdate={REVEAL ? stepByFrame : undefined}')
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

  it('injects cleanly: no backticks in any injected function source', () => {
    expect(pageTransitionVariants.toString()).not.toContain('`')
    expect(reversePageTransitionPreset.toString()).not.toContain('`')
    expect(pageTransitionCover.toString()).not.toContain('`')
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
