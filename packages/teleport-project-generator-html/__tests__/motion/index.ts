import { FileType, GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import { ScrollSceneRuntime } from '@teleporthq/teleport-shared'
import uidlSample from '../../../../examples/uidl-samples/tests.json'
import { createHTMLProjectGenerator, pluginCloneGlobals, pluginHomeReplace } from '../../src'
import { pluginMotionRuntime } from '../../src/plugin-motion-runtime'
import HTMLTemplate from '../../src/project-template'
import {
  SCENE_BACKDROP_DECLARATIONS,
  SCENE_BACKDROP_MEDIA_DECLARATIONS,
  SCENE_BACKDROP_MEDIA_SELECTOR,
  SCENE_BACKDROP_SELECTOR,
  SCENE_CHAPTERS_DECLARATIONS,
  SCENE_CHAPTERS_SELECTOR,
  SCENE_COUNT_CSS,
  SCENE_HIDDEN_CSS,
} from '../../src/motion/runtime-css'
import { normalizeSceneLength } from '../../src/motion/contract'
import { generateScrollSceneComponentCode } from '../../../teleport-project-generator-next/src/widgets/scroll-scene-component'

const s = (content: unknown) => ({ type: 'static', content })
const LANES =
  '[{"prop":"opacity","at":[0,0.3],"values":[0,1]},{"prop":"x","at":[0,1],"values":[0,-70],"unit":"%"}]'

const chapter = (id: string, bind: string) => ({
  type: 'element',
  content: {
    elementType: 'container',
    attrs: { id: s(id), 'data-scroll-bind': s(bind) },
    children: [s(id)],
  },
})

const SCENE = {
  type: 'element',
  content: {
    elementType: 'scroll-scene-node',
    name: 'story',
    attrs: {
      id: s('story'),
      sceneLength: s('400vh'),
      pin: s(true),
      scrub: s(0.4),
      reducedMotion: s('static'),
      exposeProgress: s(true),
      chapterSnap: s('gentle'),
      layout: s('chapters'),
    },
    style: { width: s('100%') },
    children: [chapter('chapter-one', LANES), chapter('chapter-two', 'depth-2')],
  },
}

const UNPINNED_SCENE = {
  type: 'element',
  content: {
    elementType: 'scroll-scene-node',
    name: 'drift',
    attrs: { id: s('drift'), pin: s(false) },
    children: [chapter('drift-item', 'depth-1')],
  },
}

const MOTION = {
  type: 'element',
  content: {
    elementType: 'motion-node',
    name: 'reveal',
    attrs: {
      id: s('reveal'),
      preset: s('slide-up'),
      trigger: s('in-view'),
      inViewOnce: s(false),
      inViewAmount: s(0.4),
      repeatType: s('mirror'),
      scrollOffset: s('enter'),
      from: s({ opacity: 0, y: 80 }),
      to: s({ opacity: 1, y: 0 }),
    },
    children: [s('Revealed')],
  },
}

const video = (attrs: Record<string, unknown>) => ({
  type: 'element',
  content: { elementType: 'scroll-video-node', name: 'clip', attrs, children: [] as unknown[] },
})

const projectWith = (...nodes: unknown[]): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample))
  uidl.root.node.content.children[0].content.node.content.children.push(...nodes)
  return uidl as ProjectUIDL
}

const generate = async (uidl: ProjectUIDL): Promise<GeneratedFolder> => {
  const generator = createHTMLProjectGenerator()
  generator.addPlugin(pluginHomeReplace)
  generator.addPlugin(pluginCloneGlobals)
  generator.addPlugin(pluginMotionRuntime)
  return generator.generateProject(uidl, HTMLTemplate)
}

const fileOf = (folder: GeneratedFolder, name: string, fileType: string) =>
  folder.files.find((file) => file.name === name && file.fileType === fileType)?.content ?? ''

const pagesOf = (folder: GeneratedFolder) =>
  folder.files.filter((file) => file.fileType === FileType.HTML)

describe('Motion in the static HTML export', () => {
  it('adds nothing to a project that has no motion', async () => {
    const folder = await generate(projectWith())

    expect(folder.files.some((file) => file.name === 'tq-motion')).toBe(false)
    folder.files.forEach((file) => {
      expect(file.content).not.toContain('data-tq-motion-on')
      expect(file.content).not.toContain('data-scene-stage')
    })
  })

  it('a pinned scene becomes a track holding a sticky stage, with its chapters inside', async () => {
    const folder = await generate(projectWith(SCENE))
    const page = fileOf(folder, 'index', FileType.HTML)

    expect(page).not.toContain('scroll-scene-node')
    expect(page).toMatch(
      /<div[^>]*data-scene-track="true"[^>]*>\s*<div[^>]*data-scene-stage="true"/
    )
    const track = /<div([^>]*data-scene-track="true"[^>]*)>/.exec(page)?.[1] ?? ''
    expect(track).toContain('id="story"')
    expect(track).toContain('data-scene-length="400vh"')
    expect(track).toContain('data-scene-pin="true"')
    expect(track).toContain('data-scene-scrub="0.4"')
    expect(track).toContain('data-scene-reduced-motion="static"')
    expect(track).toContain('data-scene-expose-progress="true"')
    expect(track).toContain('data-scene-chapter-snap="gentle"')
    // the authored class still styles the track, and no camelCase prop survives
    expect(track).toContain('class="')
    expect(track).not.toMatch(/scenelength|chaptersnap|reducedmotion|layout=/i)
    expect(page).toContain('data-scene-layout="chapters"')

    const stage = page.slice(page.indexOf('data-scene-stage'))
    expect(stage.indexOf('chapter-one')).toBeGreaterThan(-1)
    expect(stage.indexOf('chapter-two')).toBeGreaterThan(stage.indexOf('chapter-one'))
    // the lanes reach the page as JSON the runtime can parse
    const bind = /data-scroll-bind='([^']*)'/.exec(page)?.[1] ?? ''
    expect(JSON.parse(bind)).toEqual(JSON.parse(LANES))
  })

  it('a scene that does not pin keeps its children as they are: no stage, no length rule', async () => {
    const folder = await generate(projectWith(UNPINNED_SCENE))
    const page = fileOf(folder, 'index', FileType.HTML)
    const css = fileOf(folder, 'style', FileType.CSS)

    expect(page).toContain('data-scene-pin="false"')
    expect(page).not.toContain('data-scene-stage=')
    expect(css).not.toContain('min-height: 300vh')
  })

  it('lays the scene out in the stylesheet, only on a page that said it will be animated', async () => {
    const folder = await generate(projectWith(SCENE))
    const css = fileOf(folder, 'style', FileType.CSS)

    expect(css).toContain(
      ':where(html[data-tq-motion-on]) [data-scene-track][data-scene-pin="true"][data-scene-length="400vh"] {\n  min-height: 400vh !important;'
    )
    expect(css).toContain('position: sticky !important;')
    expect(css).toContain(SCENE_HIDDEN_CSS)
    expect(css).toContain(SCENE_COUNT_CSS)
    // every structural rule waits for the flag, so a page without JavaScript reads as plain content
    css
      .split('}')
      .filter((rule) => /data-scene-(stage|track)/.test(rule))
      .forEach((rule) => expect(rule).toContain(':where(html[data-tq-motion-on])'))
  })

  it('a motion element becomes a div that carries its whole configuration', async () => {
    const folder = await generate(projectWith(MOTION))
    const page = fileOf(folder, 'index', FileType.HTML)
    const tag = /<div([^>]*data-tq-motion="true"[^>]*)>/.exec(page)?.[1] ?? ''

    expect(page).not.toContain('motion-node')
    expect(tag).toContain('id="reveal"')
    expect(tag).toContain('data-motion-preset="slide-up"')
    expect(tag).toContain('data-motion-trigger="in-view"')
    expect(tag).toContain('data-motion-in-view-once="false"')
    expect(tag).toContain('data-motion-in-view-amount="0.4"')
    expect(tag).toContain('data-motion-repeat-type="mirror"')
    expect(tag).toContain('data-motion-scroll-offset="enter"')
    expect(JSON.parse(/data-motion-from='([^']*)'/.exec(tag)?.[1] ?? '')).toEqual({
      opacity: 0,
      y: 80,
    })
    expect(JSON.parse(/data-motion-to='([^']*)'/.exec(tag)?.[1] ?? '')).toEqual({
      opacity: 1,
      y: 0,
    })

    const css = fileOf(folder, 'style', FileType.CSS)
    expect(css).toContain(':not([data-motion-ready]) {\n  visibility: hidden;')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('a scroll video becomes a host holding its clip; with a phone variant the runtime picks the source', async () => {
    const single = fileOf(
      await generate(projectWith(video({ src: s('/clip.mp4'), poster: s('/poster.jpg') }))),
      'index',
      FileType.HTML
    )
    expect(single).toMatch(/<div[^>]*data-scroll-video="true"[^>]*>\s*<video/)
    expect(single).toContain('data-scroll-video-src="/clip.mp4"')
    const clip = /<video([^>]*)>/.exec(single)?.[1] ?? ''
    expect(clip).toContain('muted')
    expect(clip).toContain('playsinline')
    expect(clip).toContain('poster="/poster.jpg"')
    expect(clip).toContain('src="/clip.mp4"')

    const withPhone = fileOf(
      await generate(projectWith(video({ src: s('/clip.mp4'), mobileSrc: s('/clip-540.mp4') }))),
      'index',
      FileType.HTML
    )
    expect(withPhone).toContain('data-scroll-video-mobile-src="/clip-540.mp4"')
    expect(/<video([^>]*)>/.exec(withPhone)?.[1] ?? '').not.toContain('src=')

    const empty = fileOf(await generate(projectWith(video({}))), 'index', FileType.HTML)
    expect(empty).toContain('data-scroll-video="true"')
    expect(empty).not.toContain('<video')
  })

  it('ships one runtime file with only the parts the project uses, and every page links it once', async () => {
    const scenesOnly = await generate(projectWith(SCENE))
    const runtime = fileOf(scenesOnly, 'tq-motion', FileType.JS)
    expect(runtime).toContain('window.__tqMotionRuntime = true')
    expect(runtime).toContain('const initScene = ')
    expect(runtime).not.toContain('const initMotion = ')
    expect(runtime).not.toContain('const initVideo = ')
    // the maintainers' notes stay out of the visitor's download
    expect(runtime.split('\n').some((line) => /^\s*\/\//.test(line))).toBe(false)

    const everything = await generate(projectWith(SCENE, MOTION, video({ src: s('/clip.mp4') })))
    const full = fileOf(everything, 'tq-motion', FileType.JS)
    expect(full).toContain('const initScene = ')
    expect(full).toContain('const initMotion = ')
    expect(full).toContain('const initVideo = ')
    // valid JavaScript: compiling it (never running it) is the check
    expect(() => new Function(full)).not.toThrow()

    const pages = pagesOf(everything)
    expect(pages.length).toBeGreaterThan(1)
    pages.forEach((page) => {
      expect(page.content.match(/<script defer src="\.\/tq-motion\.js"><\/script>/g)).toHaveLength(
        1
      )
      expect(page.content.match(/setAttribute\('data-tq-motion-on', ''\)/g)).toHaveLength(1)
      expect(page.content.indexOf('tq-motion.js')).toBeLessThan(page.content.indexOf('</head>'))
    })
    // a component exported as a document of its own sits one folder down and links one folder up;
    // a bare fragment (no head) is never linked
    everything.subFolders
      .flatMap((folder) => folder.files)
      .filter((file) => file.fileType === FileType.HTML)
      .forEach((file) => {
        if (file.content.includes('</head>')) {
          expect(file.content).toContain('<script defer src="../tq-motion.js"></script>')
        } else {
          expect(file.content).not.toContain('tq-motion.js')
        }
      })
  })

  it('runs the very engine the Next export runs', () => {
    const runtimeEngine = ScrollSceneRuntime.engineSource()
    const nextWidget = generateScrollSceneComponentCode()

    expect(nextWidget).toContain(runtimeEngine)
    expect(nextWidget).toContain(ScrollSceneRuntime.announcementsSource())
    expect(nextWidget).toContain(ScrollSceneRuntime.chapterHelpersSource())
    expect(nextWidget).toContain(ScrollSceneRuntime.restackBodySource())
    expect(nextWidget).toContain(ScrollSceneRuntime.anchorNavigationBodySource())
    expect(nextWidget).toContain(ScrollSceneRuntime.gentleSnapBodySource())
    // the stylesheet's copies of the engine's two CSS strings
    expect(runtimeEngine).toContain(SCENE_HIDDEN_CSS)
    expect(runtimeEngine).toContain(SCENE_COUNT_CSS)
    // the rules the Next widget renders in its own <style> are the rules of the stylesheet
    expect(nextWidget).toContain(`${SCENE_BACKDROP_SELECTOR} { ${SCENE_BACKDROP_DECLARATIONS} }`)
    expect(nextWidget).toContain(
      `${SCENE_BACKDROP_MEDIA_SELECTOR} { ${SCENE_BACKDROP_MEDIA_DECLARATIONS} }`
    )
    expect(nextWidget).toContain(`${SCENE_CHAPTERS_SELECTOR} { ${SCENE_CHAPTERS_DECLARATIONS} }`)
  })

  it('bounds a scene length the way the engine does', () => {
    expect(normalizeSceneLength('400vh')).toBe('400vh')
    expect(normalizeSceneLength('50vh')).toBe('100vh')
    expect(normalizeSceneLength('9000vh')).toBe('4000vh')
    expect(normalizeSceneLength('12rem')).toBe('300vh')
    expect(normalizeSceneLength(undefined)).toBe('300vh')
  })
})
