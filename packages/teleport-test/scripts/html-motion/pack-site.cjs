// Packs the motion fixture through the REAL download entry point (packProject, built dist).
// node pack-site.cjs <out-dir> [next] — the static HTML site by default, the Next project with `next`.
const path = require('path')
const fs = require('fs')
const CG = path.resolve(__dirname, '../../../..')
const { packProject } = require(CG + '/packages/teleport-code-generator/dist/cjs/index.js')
const { ProjectType, PublisherType } = require(CG + '/packages/teleport-types/dist/cjs/index.js')
const uidl = JSON.parse(fs.readFileSync(CG + '/examples/uidl-samples/tests.json', 'utf8'))
const s = (content) => ({ type: 'static', content })
const styles = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, s(v)]))
const el = (elementType, name, attrs, style, children) => ({
  type: 'element',
  content: { elementType, name, attrs, style: styles(style), children },
})
const text = (content) => ({ type: 'static', content })
const lanes = (value) => s(JSON.stringify(value))
const chapter = (id, label, bind) =>
  el(
    'container',
    id,
    { id: s(id), 'data-scroll-bind': lanes(bind) },
    { color: '#fff', fontSize: '64px', textAlign: 'center' },
    [text(label)]
  )
const spacer = (name, label) =>
  el(
    'container',
    name,
    { id: s(name) },
    { height: '120vh', padding: '40px', background: '#f4f1ea' },
    [text(label)]
  )
const jump = el('text', 'jump', { id: s('jump') }, {}, [text('Jump to chapter three')])
jump.content.semanticType = 'span'
jump.content.abilities = { link: { type: 'section', content: { section: s('chapter-three') } } }
const children = [
  el(
    'motion-node',
    'load-fade',
    { preset: s('fade-in'), trigger: s('load'), duration: s(0.4), id: s('load-fade') },
    { padding: '24px' },
    [text('Loaded heading')]
  ),
  el('container', 'nav', {}, { padding: '24px' }, [jump]),
  spacer('intro', 'Intro'),
  el(
    'scroll-scene-node',
    'story',
    { sceneLength: s('300vh'), pin: s(true), scrub: s(0), id: s('story'), chapterSnap: s('off') },
    { width: '100%', background: '#111' },
    [
      el(
        'image',
        'backdrop',
        {
          'data-scene-backdrop': s('true'),
          src: s('https://picsum.photos/seed/tq/1200/800'),
          id: s('backdrop'),
        },
        {},
        []
      ),
      chapter('chapter-one', 'Chapter one', [
        { prop: 'opacity', at: [0, 0.25, 0.33], values: [1, 1, 0] },
      ]),
      chapter('chapter-two', 'Chapter two', [
        { prop: 'opacity', at: [0.33, 0.4, 0.6, 0.66], values: [0, 1, 1, 0] },
        { prop: 'y', at: [0.33, 0.4], values: [24, 0] },
      ]),
      chapter('chapter-three', 'Chapter three', [
        { prop: 'opacity', at: [0.66, 0.73], values: [0, 1] },
        { prop: 'y', at: [0.66, 0.73], values: [24, 0] },
      ]),
    ]
  ),
  spacer('between', 'Between'),
  el(
    'motion-node',
    'slide',
    { preset: s('slide-up'), trigger: s('in-view'), inViewAmount: s(0.3), id: s('slide') },
    { padding: '40px', background: '#dde' },
    [text('Slides up')]
  ),
  el(
    'motion-node',
    'cascade',
    { preset: s('slide-up'), trigger: s('in-view'), stagger: s(0.1), id: s('cascade') },
    {},
    [
      el(
        'container',
        'grid',
        { id: s('grid') },
        { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' },
        [
          el('container', 'card-a', { id: s('card-a') }, { height: '160px', background: '#cde' }, [
            text('A'),
          ]),
          el('container', 'card-b', { id: s('card-b') }, { height: '160px', background: '#cde' }, [
            text('B'),
          ]),
          el('container', 'card-c', { id: s('card-c') }, { height: '160px', background: '#cde' }, [
            text('C'),
          ]),
        ]
      ),
    ]
  ),
  el(
    'motion-node',
    'hover',
    {
      preset: s('none'),
      trigger: s('hover'),
      to: s({ scale: 1.2 }),
      duration: s(0.2),
      id: s('hover'),
    },
    { width: '200px', height: '80px', background: '#fc9' },
    [text('Hover me')]
  ),
  el(
    'motion-node',
    'linked',
    {
      preset: s('none'),
      trigger: s('scroll'),
      from: s({ y: 60, opacity: 0.2 }),
      to: s({ y: -60, opacity: 1 }),
      id: s('linked'),
    },
    { height: '200px', background: '#9cf' },
    [text('Scroll linked')]
  ),
  el(
    'scroll-scene-node',
    'film',
    { sceneLength: s('250vh'), pin: s(true), scrub: s(0), id: s('film') },
    { width: '100%' },
    [
      el(
        'scroll-video-node',
        'clip',
        { src: s('./clip.mp4'), smoothing: s(0), id: s('clip') },
        {},
        []
      ),
      chapter('film-title', 'Over the clip', [{ prop: 'opacity', at: [0, 0.1], values: [0, 1] }]),
    ]
  ),
  spacer('outro', 'Outro'),
]
const home = uidl.root.node.content.children[0]
home.content.node.content.children = children
home.content.node.content.style = {
  ...(home.content.node.content.style || {}),
  overflow: s('visible'),
  alignItems: s('stretch'),
}
;(async () => {
  const outputPath = process.argv[2]
  const result = await packProject(uidl, {
    projectType: process.argv[3] === 'next' ? ProjectType.NEXT : ProjectType.HTML,
    publisher: PublisherType.DISK,
    publishOptions: { outputPath, projectSlug: 'site' },
  })
  console.log('packProject success:', result.success)
  console.log(fs.readdirSync(path.join(outputPath, 'site')).join(' '))
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
