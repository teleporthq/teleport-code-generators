import { parse } from '@babel/parser'
import { FileType, ProjectPluginStructure, UIDLPluginRecord } from '@teleporthq/teleport-types'
import { NextForumProjectPlugin, FORUM_FILE_KEYS } from '../src/forum/project-plugin'
import { FORUM_MAIN_COMMUNITY_SLUG, resolveForumConfig } from '../src/forum/settings'
import { rewriteForumPage } from '../src/forum/page-rewrite'
import { resolveDbSearchSections } from '../src/instant-search/sections'
import { resolveInstantSearchConfig } from '../src/instant-search/settings'

const TELEPORT_DATA_SOURCE = {
  id: 'ds-teleport',
  name: 'Teleport',
  type: 'teleport',
  config: { tables: ['teleport_forum_topics', 'teleport_forum_communities'] },
}

/** A details page as the generator leaves it: `record` is the prop its row is read as. */
const pageSource = (name: string, record: string, states: string[]): string =>
  `import React, { useState } from 'react'
import Head from 'next/head'
import ${record}Resource from '../../../utils/data-sources/teleport-teleport-forum-${record}-ds-telep'

const ${name} = (props) => {
${states.map((state) => `  ${state}`).join('\n')}
  return (
    <>
      <Head>
        <title>{props.${record}?.title}</title>
        <meta name="robots" content="index, follow" />
      </Head>
      <div data-tq-forum-page="${record}">{props.${record}?.title}</div>
    </>
  )
}

export default ${name}

export async function getStaticProps(context) {
  const { params = {} } = context
  try {
    const response = await ${record}Resource({ ...context?.params }, { as: 'visitor' })
    if (!response?.data) {
      return { notFound: true, revalidate: 60 }
    }
    return { props: { ...context?.params, ${record}: response.data, ...response?.meta }, revalidate: 60 }
  } catch (error) {
    console.log(error)
    return { notFound: true, revalidate: 60 }
  }
}

export async function getStaticPaths() {
  return { paths: [], fallback: 'blocking' }
}
`

/**
 * The same page when it asks for a sign-in, as the page-access guard leaves
 * it: rendered per request, the guard first, its row still read as a visitor.
 */
const guarded = (page: string): string =>
  page
    .replace(
      'export async function getStaticProps(context) {\n  const { params = {} } = context',
      'export async function getServerSideProps(context) {\n  const __tqAccessDenied = await __tqPageAccess.guardPageAccess(context, { requiresAuth: true })\n  if (__tqAccessDenied) return __tqAccessDenied\n  const { params = {} } = context'
    )
    .replace(
      "import Head from 'next/head'",
      "import Head from 'next/head'\nimport * as __tqPageAccess from '../../../utils/auth/page-access'"
    )
    .replace(/\nexport async function getStaticPaths\(\) \{[^}]*\}\n\}\n/, '')

const TOPIC_PAGE = pageSource('Topic', 'topic', [
  'const [viewer, setViewer] = useState({})',
  'const [topicDetails, setTopicDetails] = useState({})',
  'const [replies, setReplies] = useState([])',
  'const [score, setScore] = useState(0)',
  "const [replySort, setReplySort] = useState('best')",
  'const [isSubmitting, setIsSubmitting] = useState(false)',
])

const COMMUNITY_PAGE = pageSource('Community', 'community', [
  'const [viewer, setViewer] = useState({})',
  'const [topics, setTopics] = useState([])',
  'const [rules, setRules] = useState([])',
  'const [moderators, setModerators] = useState([])',
  'const [pendingJoinCount, setPendingJoinCount] = useState(0)',
  'const [isSubmitting, setIsSubmitting] = useState(false)',
])

// The community's two other pages read the same table under a name of their own.
const MANAGE_PAGE = guarded(
  pageSource('Manage', 'managed', [
    'const [viewer, setViewer] = useState({})',
    "const [rulesText, setRulesText] = useState('')",
    'const [members, setMembers] = useState([])',
  ])
)

const NEW_TOPIC_PAGE = guarded(
  pageSource('NewTopic', 'postingIn', [
    'const [viewer, setViewer] = useState({})',
    "const [bodyHtml, setBodyHtml] = useState('')",
  ])
)

/**
 * The composer of a forum without communities, as the generator leaves it: a
 * static page (`pages/forum/new.js`) behind the sign-in guard, with no row to read.
 */
const STATIC_COMPOSER_PAGE = `import React, { useState } from 'react'
import Head from 'next/head'
import * as __tqPageAccess from '../../utils/auth/page-access'

const NewTopic = (props) => {
  const [viewer, setViewer] = useState({ signed_in: false, can_post: false })
  const [bodyHtml, setBodyHtml] = useState('')
  return (
    <>
      <Head>
        <title>New topic</title>
        <meta name="robots" content="index, follow" />
      </Head>
      <div data-tq-forum-page="new-topic">New topic</div>
    </>
  )
}

export default NewTopic

export async function getServerSideProps(context) {
  const __tqAccessDenied = await __tqPageAccess.guardPageAccess(context, { requiresAuth: true })
  if (__tqAccessDenied) return __tqAccessDenied
  return { props: {} }
}
`

const routeValue = (navLink: string, tableName?: string, exposeAs?: string, column = 'slug') => ({
  value: navLink.slice(1) || 'home',
  pageOptions: {
    navLink,
    ...(tableName
      ? {
          dynamicRouteAttribute: column,
          detailsPageInfo: {
            dataSourceId: 'ds-teleport',
            dataSourceName: 'Teleport',
            dataSourceType: 'teleport',
            tableName,
            differentiatorColumn: column,
            featureIdentifier: '',
          },
          initialPropsData: {
            exposeAs: { name: exposeAs, valuePath: ['data'] },
            resource: { id: 'r1' },
          },
        }
      : {}),
  },
})

/** `uidl.plugins.forum.pages` as the editor sends it: a details page by its static base. */
const FORUM_PAGES = {
  home: '/forum',
  topic: '/forum/t',
  community: '/forum/c',
  manage: '/forum/manage',
  'new-topic': '/forum/new',
}

const pageRecord = (folder: string[], content: string) => ({
  path: ['pages', ...folder],
  files: [{ name: '[slug]', fileType: FileType.JS, content }],
})

// The three pages of a community: one table, three addresses.
const COMMUNITY_ROUTES = [
  routeValue('/forum/c/[slug]', 'teleport_forum_communities', 'community'),
  routeValue('/forum/manage/[slug]', 'teleport_forum_communities', 'managed'),
  routeValue('/forum/new/[slug]', 'teleport_forum_communities', 'postingIn'),
]
const ROUTE_ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]

function makeStructure(options: {
  record?: Partial<UIDLPluginRecord> | null
  auth?: boolean
  /** The order the community's three routes come in (`ROUTE_ORDERS`). */
  order?: number[]
  extraRoutes?: unknown[]
}): ProjectPluginStructure {
  const files = new Map()
  files.set('page-topic', pageRecord(['forum', 't'], TOPIC_PAGE))
  files.set('page-community', pageRecord(['forum', 'c'], COMMUNITY_PAGE))
  files.set('page-manage', pageRecord(['forum', 'manage'], MANAGE_PAGE))
  files.set('page-new-topic', pageRecord(['forum', 'new'], NEW_TOPIC_PAGE))
  const routes = [
    routeValue('/'),
    routeValue('/forum'),
    ...(options.extraRoutes ?? []),
    routeValue('/forum/t/[slug]', 'teleport_forum_topics', 'topic'),
    ...(options.order ?? ROUTE_ORDERS[0]).map((index) => COMMUNITY_ROUTES[index]),
  ]
  return {
    uidl: {
      name: 'test-project',
      globals: { settings: { title: 'Test', language: 'en' }, assets: [] },
      dataSources: { 'ds-teleport': TELEPORT_DATA_SOURCE },
      ...(options.auth ? { authentication: { enabled: true } } : {}),
      ...(options.record === null
        ? {}
        : {
            plugins: {
              forum: {
                settings: {},
                pages: FORUM_PAGES,
                ...(options.record ?? {}),
              },
            },
          }),
      root: { name: 'App', stateDefinitions: { route: { type: 'string', values: routes } } },
    },
    files,
    dependencies: {},
    devDependencies: {},
    template: { files: [], subFolders: [] },
  } as unknown as ProjectPluginStructure
}

/** The pages of a forum without communities: the feed, a topic and the composer, a static page. */
const TOPICS_ONLY_PAGES = { home: '/forum', topic: '/forum/t', 'new-topic': '/forum/new' }

/** A project whose forum has no communities, as the editor exports it and the generator writes its pages. */
function makeTopicsOnlyStructure(record: Partial<UIDLPluginRecord> = {}): ProjectPluginStructure {
  const structure = makeStructure({
    record: { settings: { structure: 'topics' }, pages: TOPICS_ONLY_PAGES, ...record },
    auth: true,
  })
  structure.files.clear()
  structure.files.set('page-topic', pageRecord(['forum', 't'], TOPIC_PAGE))
  structure.files.set('page-new-topic', {
    path: ['pages', 'forum'],
    files: [{ name: 'new', fileType: FileType.JS, content: STATIC_COMPOSER_PAGE }],
  })
  structure.uidl.root.stateDefinitions!.route.values = [
    routeValue('/'),
    routeValue('/forum'),
    routeValue('/forum/t/[slug]', 'teleport_forum_topics', 'topic'),
    routeValue('/forum/new'),
  ] as never
  return structure
}

const parses = (source: string) => parse(source, { sourceType: 'module', plugins: ['jsx'] })
const fileContent = (structure: ProjectPluginStructure, key: string): string =>
  structure.files.get(key)!.files[0].content as string
/** Every file of the project by its key, as the plugin left it. */
const generatedFiles = (structure: ProjectPluginStructure): Record<string, unknown> =>
  Object.fromEntries(Array.from(structure.files.entries()))

describe('NextForumProjectPlugin', () => {
  it('leaves a project without the plugin exactly as it was', async () => {
    const structure = makeStructure({ record: null })
    await new NextForumProjectPlugin().runAfter(structure)

    expect(structure.files.get(FORUM_FILE_KEYS.pageData)).toBeUndefined()
    expect(structure.files.get(FORUM_FILE_KEYS.repliesRoute)).toBeUndefined()
    expect(fileContent(structure, 'page-topic')).toBe(TOPIC_PAGE)
    expect(structure.dependencies.pg).toBeUndefined()
  })

  it('reads the settings clamped, the page routes and the data source', () => {
    const structure = makeStructure({
      record: {
        settings: { votes: 'up', topicsPerDay: 9999, moderation: 'nonsense', reactions: true },
      },
    })
    const config = resolveForumConfig(structure.uidl)!
    expect(config.settings.votes).toBe('up')
    expect(config.settings.topicsPerDay).toBe(200)
    // An unknown value falls back on the default: every post shows at once.
    expect(config.settings.moderation).toBe('none')
    expect(config.settings.holdLinks).toBe(false)
    expect(config.settings.reactions).toBe(true)
    expect(config.pages).toEqual(FORUM_PAGES)
    expect(config.routes).toEqual({
      topic: { staticBase: '/forum/t', column: 'slug' },
      community: { staticBase: '/forum/c', column: 'slug' },
      manage: { staticBase: '/forum/manage', column: 'slug' },
      newTopic: { staticBase: '/forum/new', column: 'slug' },
    })
    expect(config.dataSource).toEqual({ dataSourceId: 'ds-teleport', dataSourceType: 'teleport' })
  })

  it('resolves each page of a community by its own recorded base, whatever the routes’ order', async () => {
    for (const order of ROUTE_ORDERS) {
      const structure = makeStructure({ record: {}, order })
      const { routes } = resolveForumConfig(structure.uidl)!
      expect(routes.community).toEqual({ staticBase: '/forum/c', column: 'slug' })
      expect(routes.manage).toEqual({ staticBase: '/forum/manage', column: 'slug' })
      expect(routes.newTopic).toEqual({ staticBase: '/forum/new', column: 'slug' })

      await new NextForumProjectPlugin().runAfter(structure)
      const community = fileContent(structure, 'page-community')
      expect(community).toContain('__tqForumData.loadCommunityPage({')
      expect(community).not.toContain('loadCommunityGate')
      expect(community).toContain('"community": data.community')
      const manage = fileContent(structure, 'page-manage')
      expect(manage).toContain("need: 'moderate'")
      expect(manage).not.toContain('loadCommunityPage')
      expect(manage).toContain('"managed": data.community')
      const newTopic = fileContent(structure, 'page-new-topic')
      expect(newTopic).toContain("need: 'post'")
      expect(newTopic).toContain('"postingIn": data.community')
    }
  })

  it('takes only the address column from the route at a page’s base', () => {
    const config = (uidl: ProjectPluginStructure['uidl']) => resolveForumConfig(uidl)!
    // A page of the same table under a base that merely starts alike is another page.
    const lookalike = makeStructure({
      record: {},
      extraRoutes: [routeValue('/forum/c-old/[id]', 'teleport_forum_communities', 'old', 'id')],
    })
    expect(config(lookalike.uidl).routes.community).toEqual({
      staticBase: '/forum/c',
      column: 'slug',
    })
    // The column is the route's own.
    const byId = makeStructure({ record: { pages: { ...FORUM_PAGES, manage: '/forum/c-old' } } })
    byId.uidl.root.stateDefinitions!.route.values!.push(
      routeValue('/forum/c-old/[id]', 'teleport_forum_communities', 'old', 'id') as never
    )
    expect(config(byId.uidl).routes.manage).toEqual({ staticBase: '/forum/c-old', column: 'id' })
    // A recorded page with no route keeps its base; one that is not recorded is not served.
    const bare = makeStructure({
      record: { pages: { home: '/forum', topic: '/forum/topics/[slug]' } },
    })
    expect(config(bare.uidl).routes).toEqual({
      topic: { staticBase: '/forum/topics', column: 'slug' },
      community: null,
      manage: null,
      newTopic: null,
    })
  })

  it('emits the renderer, the data module, the routes, the index pages and the driver', async () => {
    const structure = makeStructure({ record: {}, auth: true })
    await new NextForumProjectPlugin().runAfter(structure)

    const markdown = structure.files.get(FORUM_FILE_KEYS.markdown)!
    expect(markdown.path).toEqual(['utils'])
    expect(markdown.files[0].name).toBe('forum-markdown')
    const data = fileContent(structure, FORUM_FILE_KEYS.pageData)
    expect(structure.files.get(FORUM_FILE_KEYS.pageData)!.path).toEqual(['utils'])
    expect(data).toContain("require('./forum-markdown')")
    expect(data).toContain('function loadTopicPage')
    expect(data).toContain('function loadCommunityPage')
    expect(data).toContain('function loadReplies')
    expect(data).toContain('function readSession')
    // The settings are baked, the session reader checks revocation on a project with sign-in.
    expect(data).toContain('"moderation":"none"')
    expect(data).toContain('session-revocation')

    const replies = structure.files.get(FORUM_FILE_KEYS.repliesRoute)!
    expect(replies.path).toEqual(['pages', 'api', 'plugins', 'forum'])
    expect(replies.files[0].name).toBe('replies')
    expect(replies.files[0].content).toContain('require("../../../../utils/forum-page-data")')
    expect(replies.files[0].content).toContain('rateLimitRequest')
    const notifications = structure.files.get(FORUM_FILE_KEYS.notificationsRoute)!
    expect(notifications.files[0].name).toBe('notifications')
    const files = structure.files.get(FORUM_FILE_KEYS.filesRoute)!
    expect(files.path).toEqual(['pages', 'api', 'plugins', 'forum'])
    expect(files.files[0].name).toBe('files')
    expect(files.files[0].content).toContain('forum.filesStillShown')
    expect(() => parses(files.files[0].content)).not.toThrow()
    expect(structure.files.get(FORUM_FILE_KEYS.sitemap)!.files[0].name).toBe('sitemap-forum.xml')
    expect(structure.files.get(FORUM_FILE_KEYS.llms)!.files[0].name).toBe('llms-forum.txt')
    expect(() => parses(fileContent(structure, FORUM_FILE_KEYS.sitemap))).not.toThrow()
    expect(structure.dependencies.pg).toBeDefined()
    expect(
      structure.files.get('security-runtime') || structure.files.has('utils/security-runtime')
    ).toBeTruthy()
    // The page-arrival wrapper the rewritten pages import.
    expect(structure.files.get(FORUM_FILE_KEYS.pageArrival)!.files[0].name).toBe('page-arrival')
  })

  it('skips the notifications route when the bell is off', async () => {
    const structure = makeStructure({ record: { settings: { notifications: false } } })
    await new NextForumProjectPlugin().runAfter(structure)
    expect(structure.files.get(FORUM_FILE_KEYS.notificationsRoute)).toBeUndefined()
    expect(structure.files.get(FORUM_FILE_KEYS.repliesRoute)).toBeDefined()
  })

  it('rewrites the topic and community pages to render per request from the module', async () => {
    const structure = makeStructure({ record: {} })
    await new NextForumProjectPlugin().runAfter(structure)

    const topic = fileContent(structure, 'page-topic')
    expect(() => parses(topic)).not.toThrow()
    expect(topic).not.toContain('getStaticProps')
    expect(topic).not.toContain('getStaticPaths')
    expect(topic).not.toContain('topicResource')
    expect(topic).toContain("import React, { useState } from 'react'")
    expect(topic).toContain('import __tqForumData from "../../../utils/forum-page-data"')
    expect(topic).toContain('export async function getServerSideProps(context)')
    expect(topic).toContain('__tqForumData.readSession(req)')
    expect(topic).toContain('__tqForumData.loadTopicPage({')
    expect(topic).toContain('slug = one(params["slug"])')
    expect(topic).toContain('notFound: true')
    expect(topic).toContain(
      "'private, no-store' : 'public, s-maxage=30, stale-while-revalidate=300'"
    )
    // The row keeps the prop the page binds, and every forum state starts from the module.
    expect(topic).toContain('"topic": data.topic')
    // The shaped topic is also the `topicDetails` state: what only the module derives.
    expect(topic).toContain('topicDetails: data.topic')
    expect(topic).toContain('useState(props.topicDetails !== undefined ? props.topicDetails : {})')
    expect(topic).toContain('useState(props.viewer !== undefined ? props.viewer : {})')
    expect(topic).toContain('useState(props.replies !== undefined ? props.replies : [])')
    expect(topic).toContain('useState(props.score !== undefined ? props.score : 0)')
    expect(topic).toContain("useState(props.replySort !== undefined ? props.replySort : 'best')")
    expect(topic).toContain('useState(false)')
    expect(topic).toContain('<meta name="robots" content="noindex" />')
    expect(topic).toContain('application/ld+json')
    expect(topic).toContain('export default remountOnPageArrival(Topic)')
    expect(topic).toContain('import remountOnPageArrival from "../../../utils/page-arrival"')

    const community = fileContent(structure, 'page-community')
    expect(() => parses(community)).not.toThrow()
    expect(community).toContain('__tqForumData.loadCommunityPage({')
    expect(community).toContain('"community": data.community')
    expect(community).toContain('useState(props.topics !== undefined ? props.topics : [])')
    // The About card's lists and the moderator bar's counts are states of the page.
    expect(community).toContain('useState(props.rules !== undefined ? props.rules : [])')
    expect(community).toContain('useState(props.moderators !== undefined ? props.moderators : [])')
    expect(community).toContain(
      'useState(props.pendingJoinCount !== undefined ? props.pendingJoinCount : 0)'
    )
    expect(community).toContain('rules: data.rules')
    expect(community).toContain('moderators: data.moderators')
    expect(community).toContain('openReportCount: data.openReportCount')
    // The list is the server's: the address says which order and which page, never how many a page holds.
    expect(community).toContain('sortBy: data.sortBy')
    expect(community).toContain('paging: data.paging')
    expect(community).toMatch(
      /loadCommunityPage\(\{\s*slug,\s*session,\s*sort: one\(query\.sort\),\s*page: /
    )
    expect(community).not.toContain('perPage')
    expect(community.slice(community.indexOf('__tqForum: {'))).not.toContain('moderators')
  })

  it('serves Manage and New topic through the membership gate, never cached nor indexed', async () => {
    const structure = makeStructure({ record: {}, auth: true })
    await new NextForumProjectPlugin().runAfter(structure)
    expect(fileContent(structure, FORUM_FILE_KEYS.pageData)).toContain(
      'async function loadCommunityGate(args)'
    )

    const pages = [
      { key: 'page-manage', record: 'managed', need: 'moderate', component: 'Manage' },
      { key: 'page-new-topic', record: 'postingIn', need: 'post', component: 'NewTopic' },
    ]
    for (const { key, record, need, component } of pages) {
      const page = fileContent(structure, key)
      expect(() => parses(page)).not.toThrow()
      // The row is no longer read under the visitor's row policy.
      expect(page).not.toContain(`${record}Resource`)
      expect(page).not.toContain("as: 'visitor'")
      const body = page.slice(page.indexOf('export async function getServerSideProps'))
      // The sign-in guard stays in front of the gate.
      expect(body.indexOf('__tqPageAccess.guardPageAccess')).toBeGreaterThan(0)
      expect(body.indexOf('__tqPageAccess.guardPageAccess')).toBeLessThan(
        body.indexOf('loadCommunityGate')
      )
      expect(body).toContain('__tqForumData.loadCommunityGate({')
      expect(body).toContain(`need: '${need}'`)
      expect(body).toContain('notFound: true')
      expect(body).toContain("res.setHeader('Cache-Control', 'private, no-store')")
      expect(body).not.toContain('s-maxage')
      expect(body).not.toContain('pageUrl')
      expect(body).toContain(`"${record}": data.community`)
      expect(body).toContain('viewer: data.viewer')
      expect(body).toMatch(/__tqForum: \{\s*seo: \{\s*noindex: true\s*\}\s*\}/)
      expect(page).toContain('useState(props.viewer !== undefined ? props.viewer : {})')
      expect(page).toContain('<meta name="robots" content="noindex" />')
      expect(page).toContain(`export default remountOnPageArrival(${component})`)
    }

    // The Manage form's rules field reads its state once, when it mounts: the rules arrive with the page.
    const manage = fileContent(structure, 'page-manage')
    expect(manage).toContain('rulesText: data.community.rules_text')
    expect(manage).toContain("useState(props.rulesText !== undefined ? props.rulesText : '')")
  })

  it('keeps the access guard of a protected page in front of the forum read', () => {
    const result = rewriteForumPage(guarded(TOPIC_PAGE), {
      kind: 'topic',
      column: 'slug',
      exposeAs: 'topic',
      rootPrefix: '../../../',
      dataModulePath: 'utils/forum-page-data',
      pageArrivalPath: 'utils/page-arrival',
    })!
    expect(() => parses(result.content)).not.toThrow()
    expect(result.content).toContain(
      "import * as __tqPageAccess from '../../../utils/auth/page-access'"
    )
    const body = result.content.slice(
      result.content.indexOf('export async function getServerSideProps')
    )
    expect(body.indexOf('__tqPageAccess.guardPageAccess')).toBeGreaterThan(0)
    expect(body.indexOf('__tqPageAccess.guardPageAccess')).toBeLessThan(
      body.indexOf('loadTopicPage')
    )
    expect(result.seededStates).toEqual(['viewer', 'topicDetails', 'replies', 'score', 'replySort'])
  })

  it('keeps the locale’s messages of a project with internationalization', () => {
    const rewrite = {
      kind: 'topic' as const,
      column: 'slug',
      exposeAs: 'topic',
      rootPrefix: '../../../',
      dataModulePath: 'utils/forum-page-data',
      pageArrivalPath: 'utils/page-arrival',
    }
    // What the locale fetcher leaves in the page's getStaticProps.
    const localizedPage = TOPIC_PAGE.replace(
      'const { params = {} } = context',
      "const messages = (await import('/locales/' + context.locale + '.json')).default\n  const { params = {} } = context"
    ).replace(
      'return { props: { ...context?.params,',
      'return { props: { messages, ...context?.params,'
    )
    const localized = rewriteForumPage(localizedPage, rewrite)!
    expect(() => parses(localized.content)).not.toThrow()
    const body = localized.content.slice(
      localized.content.indexOf('export async function getServerSideProps')
    )
    expect(body).toContain("(await import('/locales/' + context.locale + '.json')).default")
    expect(body).toMatch(/props: \{\s*\.\.\.params,\s*messages,/)
    // The messages are read only for a page that renders: never before a refusal.
    expect(body.indexOf('/locales/')).toBeGreaterThan(body.indexOf('notFound: true'))

    // A project without internationalization has no messages file to read.
    const plain = rewriteForumPage(TOPIC_PAGE, rewrite)!
    expect(plain.content).not.toContain('/locales/')
    expect(plain.content).not.toMatch(/\bmessages\b/)
  })

  it('keeps what the module seeded: no copy of the record over a seeded state on mount', () => {
    // What the workflows plugin adds to a details page: the record copied into its first object state.
    const recordCopy = (statements: string[]): string =>
      `  useEffect(() => {\n    if (props.topic) {\n${statements
        .map((statement) => `      ${statement}`)
        .join('\n')}\n    }\n  }, [])`
    const rewrite = {
      kind: 'topic' as const,
      column: 'slug',
      exposeAs: 'topic',
      rootPrefix: '../../../',
      dataModulePath: 'utils/forum-page-data',
      pageArrivalPath: 'utils/page-arrival',
    }
    const copyOverViewer =
      'setViewer(__normalizeAdminFormRow(props.topic, { signed_in: false, can_post: false }))'
    const page = (statements: string[]): string =>
      pageSource('Topic', 'topic', [
        'const [viewer, setViewer] = useState({ signed_in: false, can_post: false })',
        "const [draft, setDraft] = useState({ title: '' })",
        recordCopy(statements).trimStart(),
      ]).replace('{ useState }', '{ useState, useEffect }')

    // The only statement of the effect: the effect goes with it.
    const alone = rewriteForumPage(page([copyOverViewer]), rewrite)!
    expect(() => parses(alone.content)).not.toThrow()
    expect(alone.content).toContain('useState(props.viewer !== undefined ? props.viewer : {')
    expect(alone.content).not.toContain('setViewer(')
    expect(alone.content).not.toContain('useEffect(')

    // Beside a state the module does not seed: that copy and its effect stay.
    const copyOverDraft = "setDraft(__normalizeAdminFormRow(props.topic, { title: '' }))"
    const beside = rewriteForumPage(page([copyOverViewer, copyOverDraft]), rewrite)!
    expect(() => parses(beside.content)).not.toThrow()
    expect(beside.content).not.toContain('setViewer(')
    expect(beside.content).toContain('setDraft(__normalizeAdminFormRow(props.topic')
    expect(beside.content).toContain('useEffect(')
  })

  describe('a forum without communities', () => {
    it('reads how the forum is organised: in communities unless the record says topics', () => {
      const structureOf = (settings: Record<string, unknown>) =>
        resolveForumConfig(makeStructure({ record: { settings: settings as never } }).uidl)!
          .settings.structure
      expect(structureOf({})).toBe('communities')
      expect(structureOf({ structure: 'communities' })).toBe('communities')
      expect(structureOf({ structure: 'topics' })).toBe('topics')
      for (const junk of ['Topics', 'topics ', 'forum', '', 0, true, null, ['topics']]) {
        expect(structureOf({ structure: junk })).toBe('communities')
      }
      expect(FORUM_MAIN_COMMUNITY_SLUG).toBe('main')
    })

    it('has the topic page and a static composer, and none of a community’s pages', () => {
      const config = resolveForumConfig(makeTopicsOnlyStructure().uidl)!
      expect(config.pages).toEqual(TOPICS_ONLY_PAGES)
      // The composer is a static page: no details route, no fallback column.
      expect(config.routes).toEqual({
        topic: { staticBase: '/forum/t', column: 'slug' },
        community: null,
        manage: null,
        newTopic: null,
      })
      expect(config.composerPath).toBe('/forum/new')

      // A page of the other structure is not served, even when the record still names it.
      const stale = resolveForumConfig(
        makeTopicsOnlyStructure({
          pages: { ...FORUM_PAGES, communities: '/forum/communities' },
        }).uidl
      )!
      expect(stale.pages).toEqual(TOPICS_ONLY_PAGES)
      expect(stale.routes.community).toBeNull()
      expect(stale.routes.manage).toBeNull()
      expect(stale.routes.newTopic).toBeNull()
      // A forum with no composer page has none to serve.
      const bare = resolveForumConfig(
        makeTopicsOnlyStructure({ pages: { home: '/forum', topic: '/forum/t' } }).uidl
      )!
      expect(bare.composerPath).toBeNull()

      // With communities the composer is a community's details page.
      const communities = resolveForumConfig(makeStructure({ record: {} }).uidl)!
      expect(communities.composerPath).toBeNull()
      expect(communities.routes.newTopic).toEqual({ staticBase: '/forum/new', column: 'slug' })
    })

    it('serves the static composer through the gate of the main community, never cached nor indexed', async () => {
      const structure = makeTopicsOnlyStructure()
      await new NextForumProjectPlugin().runAfter(structure)

      const composer = fileContent(structure, 'page-new-topic')
      expect(() => parses(composer)).not.toThrow()
      expect(composer).toContain('import __tqForumData from "../../utils/forum-page-data"')
      const body = composer.slice(composer.indexOf('export async function getServerSideProps'))
      expect(composer.match(/export async function getServerSideProps/g)).toHaveLength(1)
      // The sign-in guard stays in front of the gate.
      expect(body.indexOf('__tqPageAccess.guardPageAccess')).toBeGreaterThan(0)
      expect(body.indexOf('__tqPageAccess.guardPageAccess')).toBeLessThan(
        body.indexOf('loadCommunityGate')
      )
      // The community is the main one, whatever the address: the page has no route column.
      expect(body).toContain('const slug = "main"')
      expect(body).not.toContain('params["slug"]')
      expect(body).toMatch(
        /__tqForumData\.loadCommunityGate\(\{\s*slug,\s*session,\s*need: 'post'\s*\}\)/
      )
      expect(body).toContain('__tqForumData.readSession(req)')
      expect(body).toContain('notFound: true')
      expect(body).toContain("res.setHeader('Cache-Control', 'private, no-store')")
      expect(body).not.toContain('s-maxage')
      expect(body).not.toContain('pageUrl')
      // No record prop: the viewer is all the page is given, beside the head's noindex.
      expect(body).toContain('viewer: data.viewer')
      expect(body).not.toContain('data.community')
      expect(body).toMatch(/__tqForum: \{\s*seo: \{\s*noindex: true\s*\}\s*\}/)
      expect(composer).toContain(
        'useState(props.viewer !== undefined ? props.viewer : {\n    signed_in: false,\n    can_post: false\n  })'
      )
      expect(composer).toContain("useState('')")
      expect(composer).toContain('<meta name="robots" content="noindex" />')
      expect(composer).toContain('export default remountOnPageArrival(NewTopic)')
      expect(composer).toContain('import remountOnPageArrival from "../../utils/page-arrival"')
      expect(structure.files.get(FORUM_FILE_KEYS.pageArrival)!.files[0].name).toBe('page-arrival')

      // The topic page is served as in any forum.
      const topic = fileContent(structure, 'page-topic')
      expect(() => parses(topic)).not.toThrow()
      expect(topic).toContain('__tqForumData.loadTopicPage({')
      expect(topic).toContain('slug = one(params["slug"])')
    })

    it('finds the composer wherever its address puts the file', async () => {
      const at = async (route: string, path: string[], name: string) => {
        const structure = makeTopicsOnlyStructure({
          pages: { ...TOPICS_ONLY_PAGES, 'new-topic': route },
        })
        structure.files.set('page-new-topic', {
          path,
          files: [{ name, fileType: FileType.JS, content: STATIC_COMPOSER_PAGE }],
        })
        await new NextForumProjectPlugin().runAfter(structure)
        return fileContent(structure, 'page-new-topic')
      }
      expect(await at('/ask', ['pages'], 'ask')).toContain(
        'import __tqForumData from "../utils/forum-page-data"'
      )
      expect(await at('/talk/topics/new', ['pages', 'talk', 'topics'], 'new')).toContain(
        'import __tqForumData from "../../../utils/forum-page-data"'
      )
      // A file at another address is not the composer.
      expect(await at('/forum/new', ['pages', 'forum'], 'compose')).toBe(STATIC_COMPOSER_PAGE)
    })

    it('rewrites no page it lacks and names no community in its index pages', async () => {
      // The files of a forum with communities, in a project whose record says topics.
      const structure = makeStructure({ record: { settings: { structure: 'topics' } } })
      await new NextForumProjectPlugin().runAfter(structure)
      expect(fileContent(structure, 'page-community')).toBe(COMMUNITY_PAGE)
      expect(fileContent(structure, 'page-manage')).toBe(MANAGE_PAGE)
      // A details page under the composer's address is not the static composer.
      expect(fileContent(structure, 'page-new-topic')).toBe(NEW_TOPIC_PAGE)
      expect(fileContent(structure, 'page-topic')).toContain('__tqForumData.loadTopicPage({')

      for (const key of [FORUM_FILE_KEYS.sitemap, FORUM_FILE_KEYS.llms]) {
        const source = fileContent(structure, key)
        expect(() => parses(source)).not.toThrow()
        expect(source).toContain('var TOPIC_BASE = "/forum/t"')
        expect(source).not.toMatch(/communit/i)
        expect(source).not.toContain('/forum/c')
      }
      // The data module is the same one, told its structure, with no community page to link to.
      const data = fileContent(structure, FORUM_FILE_KEYS.pageData)
      expect(data).toContain('"structure":"topics"')
      expect(data).toContain('var URLS = {"topic":"/forum/t","community":""};')
      expect(data).not.toContain('/forum/c')
    })
  })

  it('generates a forum with communities the same whether or not the record names its structure', async () => {
    const generate = async (settings: Record<string, unknown>) => {
      const structure = makeStructure({ record: { settings: settings as never }, auth: true })
      await new NextForumProjectPlugin().runAfter(structure)
      return { files: generatedFiles(structure), dependencies: structure.dependencies }
    }
    const unnamed = await generate({})
    expect(await generate({ structure: 'communities' })).toEqual(unnamed)
    expect(await generate({ structure: 'nonsense' })).toEqual(unnamed)

    // Its index pages list the communities; the module links a topic to its community's page.
    const project = makeStructure({ record: {} })
    await new NextForumProjectPlugin().runAfter(project)
    const sitemap = fileContent(project, FORUM_FILE_KEYS.sitemap)
    expect(sitemap).toContain('var COMMUNITY_BASE = "/forum/c"')
    expect(sitemap).toContain('index.communities.forEach(')
    const llms = fileContent(project, FORUM_FILE_KEYS.llms)
    expect(llms).toContain("var lines = ['# Forum', '', '## Communities', '']")
    expect(llms).toContain('index.communities.forEach(')
    const data = fileContent(project, FORUM_FILE_KEYS.pageData)
    expect(data).toContain('"structure":"communities"')
    expect(data).toContain('var URLS = {"topic":"/forum/t","community":"/forum/c"};')
  })

  it('offers the topics to Instant search only while the forum is on', () => {
    const on = makeStructure({ record: {} }).uidl
    const config = resolveInstantSearchConfig({
      ...on,
      plugins: { ...on.plugins, instantSearch: { settings: {} } },
    } as never)!
    const sections = resolveDbSearchSections(
      { ...on, plugins: { ...on.plugins, instantSearch: { settings: {} } } } as never,
      config
    )
    expect(sections.map((section) => section.key)).toEqual(['topics'])
    expect(sections[0]).toMatchObject({
      tableName: 'teleport_forum_topics',
      route: { staticBase: '/forum/t', column: 'slug' },
      searchColumns: ['title', 'body_text', 'tags'],
      activeColumn: null,
    })
    const off = makeStructure({ record: null }).uidl
    const offConfig = resolveInstantSearchConfig({
      ...off,
      plugins: { instantSearch: { settings: {} } },
    } as never)!
    expect(
      resolveDbSearchSections(
        { ...off, plugins: { instantSearch: { settings: {} } } } as never,
        offConfig
      )
    ).toEqual([])
  })
})
