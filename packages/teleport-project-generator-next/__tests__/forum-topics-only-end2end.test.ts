/* tslint:disable:no-any */
import { parse } from '@babel/parser'
import { GeneratedFolder } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import profileFixture from './__fixtures__/profile-page-uidl.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

/**
 * A forum without communities, through the whole generator: its New topic
 * page is a static page behind a sign-in (`/forum/new`), which the generator
 * writes at `pages/forum/new.js` — where the Forum plugin finds it and serves
 * it per request, through the gate of the main community.
 */

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder
const fixture = profileFixture as any

const buildTopicsOnlyUidl = (): Record<string, unknown> => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as any
  uidl.dataSources = { [fixture.dataSource.id]: fixture.dataSource }
  uidl.authentication = {
    ...fixture.authentication,
    pageProtection: { composer: { route: '/forum/new', requiresAuth: true, allowedRoles: [] } },
  }
  uidl.plugins = {
    forum: {
      settings: { structure: 'topics' },
      pages: { home: '/forum', topic: '/forum/t', 'new-topic': '/forum/new' },
    },
  }
  uidl.root.stateDefinitions.route.values.push({
    value: 'forum-new',
    seo: { title: 'New topic' },
    pageOptions: {
      navLink: '/forum/new',
      componentName: 'NewTopic',
      stateDefinitions: {
        viewer: { type: 'object', defaultValue: { signed_in: false, can_post: false } },
      },
    },
  })
  uidl.root.node.content.children.push({
    type: 'conditional',
    content: {
      node: {
        type: 'element',
        content: {
          elementType: 'container',
          name: 'composer',
          attrs: { 'data-tq-forum-page': { type: 'static', content: 'new-topic' } },
          children: [{ type: 'static', content: 'New topic' }],
        },
      },
      value: 'forum-new',
      reference: { type: 'dynamic', content: { referenceType: 'state', id: 'route' } },
    },
  })
  return uidl
}

/** Every generated file by its path (`pages/forum/new.js`). */
const filesOf = (folder: GeneratedFolder, prefix = ''): Record<string, string> =>
  folder.subFolders.reduce(
    (files, sub) => ({ ...files, ...filesOf(sub, `${prefix}${sub.name}/`) }),
    Object.fromEntries(
      folder.files.map((file) => [`${prefix}${file.name}.${file.fileType}`, String(file.content)])
    )
  )

describe('a forum without communities, generated', () => {
  let files: Record<string, string>

  beforeAll(async () => {
    files = filesOf(
      await createNextProjectGenerator().generateProject(buildTopicsOnlyUidl(), template)
    )
  }, 120000)

  it('writes the static composer at pages/forum/new.js and serves it through the main community’s gate', () => {
    const composer = files['pages/forum/new.js']
    expect(composer).toBeDefined()
    expect(() => parse(composer, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
    expect(composer).toContain('import __tqForumData from "../../utils/forum-page-data"')
    expect(composer.match(/export async function getServerSideProps/g)).toHaveLength(1)
    expect(composer).not.toContain('getStaticProps')

    const body = composer.slice(composer.indexOf('export async function getServerSideProps'))
    // The sign-in guard the page was generated with stays in front of the gate.
    expect(body.indexOf('__tqPageAccess.guardPageAccess(context')).toBeGreaterThan(0)
    expect(body.indexOf('__tqPageAccess.guardPageAccess(context')).toBeLessThan(
      body.indexOf('loadCommunityGate')
    )
    expect(body).toContain('const slug = "main"')
    expect(body).toMatch(/loadCommunityGate\(\{\s*slug,\s*session,\s*need: 'post'\s*\}\)/)
    expect(body).toContain("res.setHeader('Cache-Control', 'private, no-store')")
    expect(body).not.toContain('s-maxage')
    expect(body).toContain('viewer: data.viewer')
    expect(body).toMatch(/__tqForum: \{\s*seo: \{\s*noindex: true\s*\}\s*\}/)
    expect(composer).toContain('useState(props.viewer !== undefined ? props.viewer : {')
    expect(composer).toContain('<meta name="robots" content="noindex" />')
    expect(composer).toContain('export default remountOnPageArrival(NewTopic)')
    expect(files['utils/page-arrival.js']).toBeDefined()
    expect(files['utils/auth/page-access.js']).toBeDefined()
  })

  it('emits the forum’s module and routes, and nothing of a community', () => {
    const data = files['utils/forum-page-data.js']
    expect(data).toContain('"structure":"topics"')
    expect(files['pages/api/plugins/forum/replies.js']).toBeDefined()
    expect(files['pages/api/plugins/forum/notifications.js']).toBeDefined()
    for (const name of ['pages/sitemap-forum.xml.js', 'pages/llms-forum.txt.js']) {
      expect(files[name]).toBeDefined()
      expect(files[name]).not.toMatch(/communit/i)
    }
    const forumPages = Object.keys(files).filter((name) => name.startsWith('pages/forum/'))
    expect(forumPages).toEqual(['pages/forum/new.js'])
    // No file links a community's page.
    const linking = Object.keys(files).filter((name) =>
      /\/forum\/(c|manage|communities)\b/.test(files[name])
    )
    expect(linking).toEqual([])
  })
})
