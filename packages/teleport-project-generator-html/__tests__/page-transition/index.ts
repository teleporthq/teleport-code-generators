import { FileType, GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../../examples/uidl-samples/tests.json'
import { createHTMLProjectGenerator, pluginCloneGlobals, pluginHomeReplace } from '../../src'
import { pluginPageTransition } from '../../src/plugin-page-transition'
import { viewTransitionPlan } from '../../src/page-transition/view-transition-css'
import HTMLTemplate from '../../src/project-template'

const projectWith = (pageTransition?: Record<string, unknown>): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample))
  if (pageTransition) {
    uidl.globals.settings = { ...uidl.globals.settings, pageTransition }
  }
  return uidl as ProjectUIDL
}

const generate = async (uidl: ProjectUIDL): Promise<GeneratedFolder> => {
  const generator = createHTMLProjectGenerator()
  generator.addPlugin(pluginHomeReplace)
  generator.addPlugin(pluginCloneGlobals)
  generator.addPlugin(pluginPageTransition)
  return generator.generateProject(uidl, HTMLTemplate)
}

const fileOf = (folder: GeneratedFolder, name: string, fileType: string) =>
  folder.files.find((file) => file.name === name && file.fileType === fileType)?.content ?? ''

const block = (css: string, name: string): string =>
  new RegExp(`@keyframes ${name} \\{[^}]*\\}[^}]*\\}\\s*\\}`).exec(css)?.[0] ?? ''

describe('The page transition of a static HTML export: what the stylesheet says', () => {
  it('plays the leaving page first and the arriving page after it, the way the Next export does', () => {
    const plan = viewTransitionPlan({ preset: 'slide-up', duration: 0.4, easing: 'ease-in-out' })

    expect(plan?.css).toContain('@view-transition {\n    navigation: auto;\n  }')
    expect(plan?.css).toContain(
      'animation: tq-page-leave 0.4s cubic-bezier(0.42, 0, 0.58, 1) both;'
    )
    // the arriving page waits one duration
    expect(plan?.css).toContain(
      'animation: tq-page-arrive 0.4s cubic-bezier(0.42, 0, 0.58, 1) 0.4s both;'
    )
    expect(block(plan?.css ?? '', 'tq-page-leave')).toContain(
      'to { opacity: 0; transform: translate(0px, -24px) scale(1); }'
    )
    expect(block(plan?.css ?? '', 'tq-page-arrive')).toContain(
      'from { opacity: 0; transform: translate(0px, 24px) scale(1); }'
    )
    // a visitor who asked for less motion gets plain navigation: everything sits inside the guard
    expect(plan?.css.startsWith('@media (prefers-reduced-motion: no-preference) {')).toBe(true)
  })

  it('gives the back button the preset played the other way, and asks the page which way it came', () => {
    const plan = viewTransitionPlan({ preset: 'slide-left', duration: 0.3, easing: 'ease-out' })

    expect(plan?.needsDirection).toBe(true)
    expect(plan?.css).toContain('html[data-tq-nav="back"]::view-transition-old(root)')
    expect(block(plan?.css ?? '', 'tq-page-leave')).toContain('translate(-48px, 0px)')
    expect(block(plan?.css ?? '', 'tq-page-leave-back')).toContain('translate(48px, 0px)')

    const fade = viewTransitionPlan({ preset: 'fade', duration: 0.3, easing: 'ease-out' })
    expect(fade?.needsDirection).toBe(false)
    expect(fade?.needsOrigin).toBe(false)
    expect(fade?.css).not.toContain('-back')
  })

  it('honours the words the editor offers per preset', () => {
    const bold = viewTransitionPlan({
      preset: 'slide-left',
      duration: 0.3,
      easing: 'ease-out',
      options: { distance: 'bold' },
    })
    expect(block(bold?.css ?? '', 'tq-page-arrive')).toContain('translate(192px, 0px)')

    const heavy = viewTransitionPlan({
      preset: 'blur',
      duration: 0.3,
      easing: 'ease-out',
      options: { softness: 'heavy' },
    })
    expect(block(heavy?.css ?? '', 'tq-page-leave')).toContain(
      'to { opacity: 0; filter: blur(28px); }'
    )
  })

  it('a circle grows from where the visitor pressed, or from the centre when the editor says so', () => {
    const fromClick = viewTransitionPlan({
      preset: 'circle',
      duration: 0.5,
      easing: 'ease-out',
      options: { origin: 'click' },
    })
    expect(fromClick?.needsOrigin).toBe(true)
    expect(fromClick?.css).toContain(
      'clip-path: circle(0% at var(--tq-origin-x, 50%) var(--tq-origin-y, 50%));'
    )

    const fromCentre = viewTransitionPlan({
      preset: 'circle',
      duration: 0.5,
      easing: 'ease-out',
      options: { origin: 'center' },
    })
    expect(fromCentre?.needsOrigin).toBe(false)
    expect(fromCentre?.css).toContain('clip-path: circle(0% at 50% 50%);')
  })

  it('the cover family sweeps a colour over the leaving page and off the arriving one', () => {
    const cover = viewTransitionPlan({
      preset: 'cover',
      duration: 0.6,
      easing: 'ease-out',
      options: { color: '--dl-color-theme-accent1' },
    })
    expect(cover?.css).toContain(
      '::view-transition-group(root) {\n    background: var(--dl-color-theme-accent1, var(--dl-color-theme-neutral-dark, #111111));'
    )
    expect(block(cover?.css ?? '', 'tq-page-leave')).toContain(
      'to { clip-path: inset(0 0 100% 0); }'
    )
    expect(block(cover?.css ?? '', 'tq-page-arrive')).toContain(
      'from { clip-path: inset(100% 0 0 0); }'
    )

    const curtain = viewTransitionPlan({ preset: 'curtain', duration: 0.6, easing: 'ease-out' })
    expect(block(curtain?.css ?? '', 'tq-page-leave')).toContain(
      'to { clip-path: inset(0 50% 0 50%); }'
    )
    expect(curtain?.css).toContain('background: var(--dl-color-theme-primary1,')
  })

  it('"design your own" plays exactly the two ends the user set, inside their ranges', () => {
    const plan = viewTransitionPlan({
      preset: 'custom',
      duration: 0.4,
      easing: 'spring',
      custom: {
        arrive: { opacity: 0, x: 40, y: 0, scale: 0.9, blur: 6 },
        leave: { opacity: 0, x: -4000, y: 0, scale: 1.1, blur: 2 },
      },
    })
    expect(plan?.css).toContain('cubic-bezier(0.34, 1.56, 0.64, 1)')
    expect(block(plan?.css ?? '', 'tq-page-arrive')).toContain(
      'from { opacity: 0; transform: translate(40px, 0px) scale(0.9); filter: blur(6px); }'
    )
    // -4000 is outside what the editor allows and is brought back to its bound
    expect(block(plan?.css ?? '', 'tq-page-leave')).toContain('translate(-400px, 0px) scale(1.1)')
  })

  it('has nothing to say for a preset it does not know', () => {
    expect(viewTransitionPlan({ preset: 'teleport', duration: 0.3, easing: 'ease' })).toBeNull()
  })
})

describe('The page transition of a static HTML export: what the pages get', () => {
  it('adds nothing when the project chose no transition', async () => {
    for (const uidl of [
      projectWith(),
      projectWith({ preset: 'none', duration: 0.3, easing: 'ease' }),
    ]) {
      const folder = await generate(uidl)
      folder.files.forEach((file) => {
        expect(file.content).not.toContain('view-transition')
        expect(file.content).not.toContain('pagereveal')
      })
    }
  })

  it('a plain fade is stylesheet only: no page gets a script', async () => {
    const folder = await generate(
      projectWith({ preset: 'fade', duration: 0.3, easing: 'ease-out' })
    )

    expect(fileOf(folder, 'style', FileType.CSS)).toContain('@view-transition')
    folder.files
      .filter((file) => file.fileType === FileType.HTML)
      .forEach((file) => expect(file.content).not.toContain('pagereveal'))
  })

  it('a preset with a way back puts the direction script in every page head, once', async () => {
    const folder = await generate(
      projectWith({ preset: 'slide-left', duration: 0.3, easing: 'ease-out' })
    )
    const pages = folder.files.filter((file) => file.fileType === FileType.HTML)

    expect(pages.length).toBeGreaterThan(1)
    pages.forEach((page) => {
      expect(page.content.match(/addEventListener\('pagereveal'/g)).toHaveLength(1)
      expect(page.content).toContain("root.setAttribute('data-tq-nav', 'back')")
      expect(page.content).not.toContain('sessionStorage')
      expect(page.content.indexOf('pagereveal')).toBeLessThan(page.content.indexOf('</head>'))
    })
  })

  it('a page that opted out appears at once; every other page keeps the transition', async () => {
    const folder = await generate(
      projectWith({
        preset: 'slide-left',
        duration: 0.3,
        easing: 'ease-out',
        skipRoutes: ['/about'],
      })
    )

    const about = fileOf(folder, 'about', FileType.HTML)
    expect(about).toContain('event.viewTransition.skipTransition()')
    expect(about).not.toContain('data-tq-nav')
    const home = fileOf(folder, 'index', FileType.HTML)
    expect(home).not.toContain('skipTransition')
    expect(home).toContain("root.setAttribute('data-tq-nav', 'back')")
  })

  it('the home page can opt out too, under the name it is written as', async () => {
    const folder = await generate(
      projectWith({ preset: 'fade', duration: 0.3, easing: 'ease-out', skipRoutes: ['/'] })
    )

    expect(fileOf(folder, 'index', FileType.HTML)).toContain('skipTransition')
    expect(fileOf(folder, 'about', FileType.HTML)).not.toContain('skipTransition')
  })
})
