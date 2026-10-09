import { generateBlogPostTransformationCode } from '../src/transformations/blog-post'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'
import {
  buildProductTransformOptions,
  getTransformationCode,
  getTransformWrapperCode,
} from '../src/transformations'

/**
 * A post page's Contents list: the post's sections — its headings of the
 * topmost level it uses — each with the address that jumps to it, drawn for a
 * post of three sections or more. The headings get their ids for it even with
 * the heading anchors off, and only a post page's own fetch carries the list.
 *
 * `CONTENTS_FIXTURES` is the SAME table as teleport-gui `packages/renderer/src/
 * utils/__tests__/blog-contents-sections.test.ts`: the canvas and the site must
 * list the same sections under the same addresses.
 */

type Build = (record: unknown, options?: Record<string, unknown>) => Record<string, unknown>

const buildWith = (options: { headingAnchors?: boolean; contents?: boolean } = {}): Build =>
  new Function(
    generateSharedTransformationCode() +
      '\n' +
      generateBlogPostTransformationCode(options) +
      '\nreturn buildBlogPost;'
  )() as Build

const POST = { id: 'p1', title: 'Connect a domain', slug: 'connect-a-domain', status: 'published' }
const DETAILS = { details: true }

const CONTENTS_FIXTURES: Array<{ name: string; html: string; sections: string[][] }> = [
  {
    name: 'a help article: its h2 sections, not the h3 under them, never the h1',
    html:
      '<h1>Title</h1><p>Intro</p><h2>Before you start</h2><p>x</p><h2>Steps</h2>' +
      '<h3>Open the panel</h3><h2>Check that it worked</h2><h2>Troubleshooting</h2>',
    sections: [
      ['before-you-start', 'Before you start'],
      ['steps', 'Steps'],
      ['check-that-it-worked', 'Check that it worked'],
      ['troubleshooting', 'Troubleshooting'],
    ],
  },
  {
    name: 'fewer than three sections: no list',
    html: '<h2>One</h2><p>x</p><h2>Two</h2><h3>Two and a half</h3><h3>Two and three quarters</h3>',
    sections: [],
  },
  {
    name: 'the topmost level the post uses',
    html: '<h3>Alpha</h3><h4>Under alpha</h4><h3>Beta</h3><h3>Gamma</h3>',
    sections: [
      ['alpha', 'Alpha'],
      ['beta', 'Beta'],
      ['gamma', 'Gamma'],
    ],
  },
  {
    name: 'ids the content has are kept, repeated titles numbered, entities decoded',
    html:
      '<h2 id="custom">Café &amp; Crème</h2><h2>Setup</h2><h2>Setup</h2>' +
      '<h2 id="setup-2">Clash</h2>',
    sections: [
      ['custom', 'Café & Crème'],
      ['setup', 'Setup'],
      ['setup-3', 'Setup'],
      ['setup-2', 'Clash'],
    ],
  },
  {
    name: 'an empty heading is no section',
    html: '<h2><br></h2><h2>A</h2><h2>B</h2><h2>C</h2>',
    sections: [
      ['a', 'A'],
      ['b', 'B'],
      ['c', 'C'],
    ],
  },
  {
    name: 'accented, non-Latin and symbol-only titles',
    html: '<h2>Crème brûlée</h2><h2>Привет мир</h2><h2>!!!</h2>',
    sections: [
      ['creme-brulee', 'Crème brûlée'],
      ['привет-мир', 'Привет мир'],
      ['section', '!!!'],
    ],
  },
  {
    name: 'a title that names a built-in property',
    html: '<h2>Constructor</h2><h2>Prototype</h2><h2>Has own property</h2>',
    sections: [
      ['constructor', 'Constructor'],
      ['prototype', 'Prototype'],
      ['has-own-property', 'Has own property'],
    ],
  },
  {
    name: 'inline markup inside a heading',
    html: '<h2>Use <code>npm</code> &lt;3</h2><h2><strong>Bold</strong> move</h2><h2>Last</h2>',
    sections: [
      ['use-npm-3', 'Use npm <3'],
      ['bold-move', 'Bold move'],
      ['last', 'Last'],
    ],
  },
]

const asPairs = (sections: unknown) =>
  (sections as Array<{ id: string; title: string; href: string }>).map((section) => {
    expect(section.href).toBe(`#${section.id}`)
    return [section.id, section.title]
  })

describe('a post page’s Contents list', () => {
  it.each(CONTENTS_FIXTURES)('$name', ({ html, sections }) => {
    const built = buildWith({ contents: true })({ ...POST, content: html }, DETAILS)
    expect(asPairs(built.sections)).toEqual(sections)
    // Every section the list links to is a heading of the page, under that id.
    for (const [id] of sections) {
      expect(built.content as string).toContain(`id="${id}"`)
    }
  })

  it('gives the headings their ids without the # links while the heading anchors are off', () => {
    const built = buildWith({ contents: true })(
      { ...POST, content: '<h2>One</h2><h2>Two</h2><h2>Three</h2>' },
      DETAILS
    )
    expect(built.content).toBe(
      '<h2 id="one">One</h2><h2 id="two">Two</h2><h2 id="three">Three</h2>'
    )
  })

  it('links the same ids the heading anchors give, with the anchors on', () => {
    const built = buildWith({ contents: true, headingAnchors: true })(
      { ...POST, content: '<h2>One</h2><h2>Two</h2><h2>Three</h2>' },
      DETAILS
    )
    expect(built.content).toContain(
      '<h2 id="one">One<a class="tq-heading-anchor" href="#one" aria-hidden="true" tabindex="-1">#</a></h2>'
    )
    expect(asPairs(built.sections)).toEqual([
      ['one', 'One'],
      ['two', 'Two'],
      ['three', 'Three'],
    ])
  })

  it('reads a heading stored with its # link already, without the #', () => {
    const stored =
      '<h2 id="one">One<a class="tq-heading-anchor" href="#one" aria-hidden="true" tabindex="-1">#</a></h2>' +
      '<h2>Two</h2><h2>Three</h2>'
    const built = buildWith({ contents: true, headingAnchors: true })(
      { ...POST, content: stored },
      DETAILS
    )
    expect(asPairs(built.sections)).toEqual([
      ['one', 'One'],
      ['two', 'Two'],
      ['three', 'Three'],
    ])
  })

  it('is left off a listing’s cards and off a post without the list', () => {
    const content = '<h2>One</h2><h2>Two</h2><h2>Three</h2>'
    const card = buildWith({ contents: true })({ ...POST, content })
    expect(card.sections).toEqual([])
    expect(card.content).toContain('id="one"')

    const withoutList = buildWith()({ ...POST, content }, DETAILS)
    expect(withoutList.sections).toEqual([])
    expect(withoutList.content).toBe(content)
  })
})

describe('the Contents setting, from the project to the fetcher', () => {
  const HELP_TABLE = 'teleport_help_articles'

  it('reaches the transform of its own preset only', () => {
    const options = buildProductTransformOptions({
      helpCenterSettings: { headingAnchors: false, contents: true },
      blogSettings: { headingAnchors: true },
    })
    expect(getTransformationCode(HELP_TABLE, options)).toContain('var BLOG_CONTENTS = true')
    expect(getTransformationCode('teleport_blog_posts', options)).toContain(
      'var BLOG_CONTENTS = false'
    )
  })

  it('tells the transform when the fetch is a post page’s own', () => {
    expect(getTransformWrapperCode(HELP_TABLE)).toContain(
      'details: Array.isArray(records) && records.length === 1'
    )
  })
})
