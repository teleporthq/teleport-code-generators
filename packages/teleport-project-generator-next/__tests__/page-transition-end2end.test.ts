import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
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

const template = () => JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

const buildUidl = (pageTransition?: {
  preset: string
  duration: number
  easing: string
  skipRoutes?: string[]
  options?: Record<string, string>
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
    expect(wrapper).toContain('pageTransitionVariants(PRESET, SLIDE_PX, context, OPTIONS)')
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
