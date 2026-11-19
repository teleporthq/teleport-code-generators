/* tslint:disable:function-constructor no-any */
import { SessionCookieResolver } from '@teleporthq/teleport-shared'
import { generateLazyPgClientCode } from '@teleporthq/teleport-plugin-next-workflows'
import { buildForumMarkdownSource } from '../src/forum/markdown-source'
import {
  buildForumLlmsPageSource,
  buildForumSitemapPageSource,
  FORUM_SEO_RUNTIME,
} from '../src/forum/seo'
import { buildForumPageDataSource } from '../src/forum/page-data-source'
import { ForumConfig, resolveForumConfig } from '../src/forum/settings'

/**
 * The data module, loaded as the generated site would require it, over a fake
 * `pg` whose Client answers each statement from the fixture below and keeps
 * every statement it was asked. The fixture is one private community with a
 * topic, a three-level thread under it and a pending reply; a test changes the
 * community, the topic and who the viewer is there through `load`'s options.
 */

interface Statement {
  sql: string
  params: unknown[]
}

const COMMUNITY = {
  id: 'c0000000-0000-4000-8000-000000000001',
  slug: 'private-club',
  name: 'Private club',
  description: 'Members only.',
  rules: '[{"title":"Be kind","text":"Always."}]',
  kind: 'questions',
  visibility: 'private',
  posting: 'members',
  status: 'active',
  created_by: 'owner',
  member_count: 2,
  topic_count: 1,
  created_at: new Date('2026-10-01T10:00:00Z'),
}

const TOPIC = {
  id: 't0000000-0000-4000-8000-000000000001',
  community_id: COMMUNITY.id,
  community_slug: 'private-club',
  community_visibility: 'private',
  author_id: 'author',
  author_handle: 'jane',
  author_name: 'Jane Doe',
  author_avatar: null as string | null,
  title: 'How do I start?',
  slug: 'how-do-i-start-abc123',
  body: 'Hello **world**',
  body_text: 'Hello world',
  tags: '["help"]',
  attachments: '[]',
  status: 'published',
  is_pinned: false,
  is_locked: false,
  accepted_reply_id: 'r0000000-0000-4000-8000-000000000002',
  score: 3,
  upvotes: 3,
  downvotes: 0,
  reply_count: 4,
  view_count: 10,
  last_activity_at: new Date('2026-10-02T10:00:00Z'),
  created_at: new Date('2026-10-01T12:00:00Z'),
  updated_at: new Date('2026-10-01T12:00:00Z'),
  author_reputation: 42,
  author_badges: '["first-topic"]',
}

const reply = (
  n: number,
  parent: number | null,
  depth: number,
  extra: Record<string, unknown> = {}
) => ({
  id: `r0000000-0000-4000-8000-00000000000${n}`,
  topic_id: TOPIC.id,
  community_id: COMMUNITY.id,
  parent_id: parent === null ? null : `r0000000-0000-4000-8000-00000000000${parent}`,
  depth,
  path: `0000000000000${n}.r${n}`,
  author_id: `user-${n}`,
  author_handle: `user${n}`,
  author_name: `User ${n}`,
  author_avatar: null as string | null,
  body: `Reply ${n}`,
  body_text: `Reply ${n}`,
  attachments: '[]',
  status: 'published',
  score: n,
  upvotes: n,
  downvotes: 0,
  is_accepted: false,
  created_at: new Date(`2026-10-0${n}T12:00:00Z`),
  ...extra,
})

const HEADS = [
  reply(1, null, 0),
  reply(2, null, 0, { is_accepted: true }),
  reply(5, null, 0, { status: 'removed' }),
]
const CHILDREN = [reply(3, 1, 1), reply(4, 3, 2)]

// Who runs the community, as the database orders them: the owner first.
const MODERATORS: Array<Record<string, string | null>> = [
  { user_id: 'owner', role: 'owner', handle: 'olga', display_name: 'Olga Owner', avatar_url: null },
  { user_id: 'mod', role: 'moderator', handle: 'max', display_name: null, avatar_url: '/max.png' },
  { user_id: 'new', role: 'moderator', handle: null, display_name: null, avatar_url: null },
]

interface Loaded {
  module: any
  statements: Statement[]
}

interface Fixture {
  /** The viewer is an active member of the community. */
  member?: boolean
  /** The viewer's membership as stored, when it is not a plain active member's. */
  membership?: { role: string; status: string }
  /** The viewer's forum profile says `moderator` (a site moderator). */
  moderator?: boolean
  /** The viewer's forum profile role, when it is neither `member` nor `moderator`. */
  profileRole?: string
  community?: Record<string, unknown>
  topic?: Record<string, unknown>
  /** How many topics the community holds for the viewer (one unless said). */
  topicCount?: number
  /** The community page's "per page" setting, as the editor exports it. */
  topicsPerPage?: unknown
  /** How the forum is organised, as the record says it (communities unless said). */
  structure?: string
  /** More of the plugin's settings, as the editor stores them. */
  settings?: Record<string, unknown>
  /** What the database answers for a flat list of replies (every reply of the fixture unless said). */
  flatReplies?: Array<Record<string, unknown>>
}

/** A reply that is in no page of the tree: what the accepted answer is read by id for. */
const OFF_PAGE = reply(6, null, 0, { is_accepted: true, author_id: 'user-1' })

/** A moment `minutes` ago, as the database stores a row's `created_at`. */
const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60000)

/** The plugin's configuration for a fixture, as the generator resolves it from the project. */
const configOf = (options: Fixture = {}): ForumConfig =>
  resolveForumConfig({
    plugins: {
      forum: {
        settings: {
          reactions: true,
          ...(options.structure !== undefined ? { structure: options.structure } : {}),
          ...options.settings,
        },
        ...(options.topicsPerPage !== undefined
          ? { data: { communityTopicsPerPage: options.topicsPerPage } }
          : {}),
      },
    },
    dataSources: {},
    root: { stateDefinitions: { route: { values: [] } } },
  } as any)!

const load = (options: Fixture = {}): Loaded => {
  const statements: Statement[] = []
  const community = { ...COMMUNITY, ...options.community }
  const topic = { ...TOPIC, ...options.topic }
  const membership =
    options.membership ?? (options.member ? { role: 'member', status: 'active' } : null)
  const answer = (sql: string, params: unknown[]): unknown[] => {
    if (/FROM teleport_forum_topics t .*WHERE t\.slug = \$1/.test(sql)) {
      return params[0] === TOPIC.slug ? [topic] : []
    }
    if (/FROM teleport_forum_topics t .*WHERE t\.id = \$1/.test(sql)) {
      return params[0] === TOPIC.id ? [topic] : []
    }
    if (/FROM teleport_forum_communities c WHERE c\.(id|slug) = \$1/.test(sql)) {
      return params[0] === community.id || params[0] === community.slug ? [community] : []
    }
    // The live index: every community and topic a visitor may read, by the columns it selects.
    if (/FROM teleport_forum_communities c WHERE c\.status = 'active'/.test(sql)) {
      const { slug, name, description, updated_at } = community as Record<string, unknown>
      return [{ slug, name, description, updated_at }]
    }
    if (/FROM teleport_forum_topics t WHERE t\.status = 'published'/.test(sql)) {
      const { slug, title, body_text, updated_at } = topic
      return [{ slug, title, body_text, updated_at }]
    }
    if (/FROM teleport_forum_profiles p WHERE p\.user_id = \$1/.test(sql)) {
      return [
        {
          user_id: params[0],
          handle: 'me',
          display_name: 'Me',
          role: options.profileRole ?? (options.moderator ? 'moderator' : 'member'),
          reputation: 1,
          badges: '[]',
        },
      ]
    }
    if (
      /FROM teleport_forum_memberships m WHERE m\.community_id = \$1 AND m\.user_id = \$2/.test(sql)
    ) {
      return membership ? [membership] : []
    }
    if (/FROM teleport_forum_memberships m LEFT JOIN teleport_forum_profiles p/.test(sql)) {
      return MODERATORS
    }
    if (/FROM teleport_forum_memberships m WHERE .*m\.status = 'pending'/.test(sql)) {
      return [{ total: 3 }]
    }
    if (/FROM teleport_forum_reports x WHERE /.test(sql)) {
      return [{ total: '2' }]
    }
    if (/SELECT r\.id, r\.depth, r\.path FROM teleport_forum_replies r/.test(sql)) {
      return CHILDREN.filter((child) => child.id === params[1])
    }
    if (/FROM teleport_forum_replies r .*r\.parent_id (IS NULL|= \$2)/.test(sql)) {
      return HEADS
    }
    if (/FROM teleport_forum_replies r .*r\.path LIKE ANY/.test(sql)) {
      return CHILDREN
    }
    // Flat replies: every reply of the topic, in the order the database was asked for.
    if (/FROM teleport_forum_replies r .*WHERE r\.topic_id = \$1 AND \(r\.status/.test(sql)) {
      return options.flatReplies ?? [...HEADS, ...CHILDREN]
    }
    if (/FROM teleport_forum_replies r .*WHERE r\.topic_id = \$1 AND r\.id = \$2 AND /.test(sql)) {
      return params[1] === OFF_PAGE.id ? [OFF_PAGE] : []
    }
    if (/FROM teleport_forum_topics t .*t\.community_id = \$1/.test(sql)) {
      return /COUNT\(\*\)/.test(sql) ? [{ total: options.topicCount ?? 1 }] : [topic]
    }
    if (/FROM teleport_forum_notifications n WHERE n\.user_id = \$1 ORDER BY/.test(sql)) {
      return [
        {
          id: 'n1',
          kind: 'reply',
          title: 'Jane replied',
          body: 'Hi',
          url: '/forum/t/x',
          read_at: null,
          created_at: new Date('2026-10-03T12:00:00Z'),
        },
      ]
    }
    if (/COUNT\(\*\)/.test(sql)) {
      return [{ total: 0 }]
    }
    return []
  }
  class Client {
    async connect(): Promise<void> {
      return undefined
    }
    async query(sql: string, params: unknown[]) {
      statements.push({ sql, params })
      return { rows: answer(sql, params) }
    }
    async end(): Promise<void> {
      return undefined
    }
  }
  const markdown = { exports: {} as any }
  new Function('module', 'exports', buildForumMarkdownSource())(markdown, markdown.exports)
  const source = buildForumPageDataSource(configOf(options), { withSessionRevocation: false })
  const module = { exports: {} as any }
  const fakeRequire = (name: string) => {
    if (name === 'pg') {
      return { Client }
    }
    if (name === './forum-markdown') {
      return markdown.exports
    }
    throw new Error(`Cannot find module '${name}'`)
  }
  new Function('require', 'module', 'exports', 'process', source)(
    fakeRequire,
    module,
    module.exports,
    { env: {} }
  )
  return { module: module.exports, statements }
}

const sqlOf = (loaded: Loaded) => loaded.statements.map((statement) => statement.sql).join('\n')

/**
 * What an index page (`/sitemap-forum.xml`, `/llms-forum.txt`) sends for a
 * request to `site.example`, its `listPublicIndex` being the module's own.
 */
const sendIndexPage = async (
  source: string,
  loaded: Loaded,
  context: Record<string, unknown> = {}
): Promise<string> => {
  const body = source
    .replace(/^import \{ listPublicIndex \} from .*$/m, '')
    .replace('export async function getServerSideProps', 'async function getServerSideProps')
    .replace(/export default function \w+\(\) \{\s*return null\s*\}/, '')
  expect(body).not.toMatch(/^(import|export) /m)
  const getServerSideProps = new Function('listPublicIndex', `${body}\nreturn getServerSideProps`)(
    loaded.module.listPublicIndex
  )
  let sent = ''
  const res = {
    statusCode: 0,
    setHeader: (): void => undefined,
    end: (text: string): void => {
      sent = text
    },
  }
  await getServerSideProps({ req: { headers: { host: 'site.example' } }, res, ...context })
  expect(res.statusCode).toBe(200)
  return sent
}

describe('the forum data module', () => {
  it('stays within its line budget, the shared driver and session blocks aside', () => {
    const config = resolveForumConfig({
      plugins: { forum: { settings: {} } },
      dataSources: {},
      root: {},
    } as any)!
    const own = buildForumPageDataSource(config, { withSessionRevocation: false })
      .replace(generateLazyPgClientCode(), '')
      .replace(
        SessionCookieResolver.generateCommonJsSessionTokenResolverCode('..', {
          withRevocation: false,
        }),
        ''
      )
      .replace(FORUM_SEO_RUNTIME, '')
    // The plan's budget is 450; the module runs over it (reported): the shapes the
    // pages bind (forum-shapes.ts in the editor) added the accepted answer and the URLs,
    // round 2 the gate of the Manage and New topic pages, round 7 the pictures a post
    // still shows (the pictures route asks before it removes one), round 8 flat replies,
    // who may edit a post and the page of a community waiting for approval, round 12 who
    // may delete a community and the pictures a community still shows.
    expect(own.split('\n').length).toBeLessThanOrEqual(645)
  })

  it('refuses a private community’s topic to a visitor who is not a member', async () => {
    const anonymous = load()
    expect(await anonymous.module.loadTopicPage({ slug: TOPIC.slug, session: null })).toBeNull()
    expect(sqlOf(anonymous)).not.toContain('FROM teleport_forum_replies')

    const outsider = load({ member: false })
    expect(
      await outsider.module.loadTopicPage({ slug: TOPIC.slug, session: { id: 'someone' } })
    ).toBeNull()
    expect(sqlOf(outsider)).toContain(
      'FROM teleport_forum_memberships m WHERE m.community_id = $1 AND m.user_id = $2'
    )

    const missing = load({ member: true })
    expect(
      await missing.module.loadTopicPage({ slug: 'nope', session: { id: 'someone' } })
    ).toBeNull()
  })

  it('serves a member the topic with its viewer block, the tree and the counts', async () => {
    const loaded = load({ member: true })
    const page = await loaded.module.loadTopicPage({
      slug: TOPIC.slug,
      session: { id: 'user-1', role: 'member' },
      sort: 'best',
      url: 'https://site.example/forum/t/how-do-i-start-abc123',
    })
    expect(page).not.toBeNull()
    expect(page.viewer).toMatchObject({
      signed_in: true,
      my_membership: 'active',
      my_role: 'member',
      can_read: true,
      can_moderate: false,
      can_post: true,
      is_author: false,
      is_subscribed: false,
      // A member who is not the author may not accept an answer; the vote on the topic is a number.
      can_accept: false,
      my_vote: 0,
    })
    // The row is JSON-plain, rendered and masked where it must be.
    expect(page.topic.body_html).toBe('<p>Hello <strong>world</strong></p>')
    expect(page.topic.created_at).toBe('2026-10-01T12:00:00.000Z')
    expect(page.topic.tag_list).toEqual(['help'])
    // The shapes the pages bind (forum-shapes.ts in the editor).
    expect(page.topic.tags).toEqual([{ name: 'help' }])
    expect(page.topic.attachments).toEqual([])
    expect(page.topic.author_reputation).toBe(42)
    // A topic written before the column existed is named by its community's row.
    expect(page.topic.community_name).toBe('Private club')
    expect(page.topic.community_url).toBe('/forum/c/private-club')
    expect(page.topic.is_mine).toBe(false)
    expect(page.topic.excerpt).toBe('Hello world')
    expect(page.topic.accepted_reply).toMatchObject({
      id: TOPIC.accepted_reply_id,
      is_accepted: true,
    })
    expect(page.topic.author).toMatchObject({
      handle: 'jane',
      reputation: 42,
      badges: ['first-topic'],
      initials: 'JD',
    })
    expect(page.topic).not.toHaveProperty('author_badges')
    expect(page.score).toBe(3)
    expect(page.community.rule_list).toEqual([{ title: 'Be kind', text: 'Always.' }])
    expect(page.community.rules_text).toBe('Be kind: Always.')
    // The accepted answer first, then by score; the removed one keeps its place, masked.
    expect(page.replies.map((r: any) => r.id.slice(-1))).toEqual(['2', '5', '1'])
    expect(page.replies[1].body_html).toBe('<p><em>[removed]</em></p>')
    expect(page.replies[1].body).toBe('')
    const first = page.replies[2]
    expect(first.children.map((r: any) => r.id.slice(-1))).toEqual(['3'])
    expect(first.children[0].children.map((r: any) => r.id.slice(-1))).toEqual(['4'])
    expect(first.children[0].children[0].is_author).toBe(false)
    expect(page.replies[2].is_author).toBe(true)
    expect(page.replies[2].is_mine).toBe(true)
    expect(page.replies[2].thread_url).toBe(
      `/forum/t/how-do-i-start-abc123?reply=${page.replies[2].id}`
    )
    expect(page.replies[2].attachments).toEqual([])
    expect(page.hasMoreReplies).toBe(false)
    expect(page.nextReplyOffset).toBe(3)
    expect(page.seo.noindex).toBe(true)
    expect(page.seo.jsonLd).toBeNull()

    const sql = sqlOf(loaded)
    // Only published and removed rows for a member; pending ones only their own.
    expect(sql).toContain(
      "(r.status IN ('published', 'removed') OR (r.status = 'pending' AND r.author_id = $"
    )
    expect(sql).not.toContain("'pending'))\n")
    // Three levels are drawn from the root (depths 0, 1 and 2 under a topic); the fourth is read
    // only so a reply of the third can say its thread goes on.
    expect(sql).toContain('r.path LIKE ANY($2::text[]) AND r.depth <= $3')
    const children = loaded.statements.find((statement) =>
      statement.sql.includes('r.path LIKE ANY')
    )!
    expect(children.params[2]).toBe(3)
    expect(children.params[1]).toEqual(HEADS.map((head) => `${head.path}%`))
    // Nothing is interpolated: every value travels as a parameter.
    for (const statement of loaded.statements) {
      expect(statement.sql).not.toContain(TOPIC.slug)
      expect(statement.sql).not.toContain('user-1')
    }
    // Reactions were counted (the setting is on), the viewer's vote asked by id.
    expect(sql).toContain('FROM teleport_forum_reactions x WHERE x.target_id = ANY($1::uuid[])')
    expect(sql).toContain(
      'FROM teleport_forum_votes v WHERE v.user_id = $1 AND v.target_id = ANY($2::uuid[])'
    )
    // Follow / Following is the topic's own subscription.
    const follows = loaded.statements.find((statement) =>
      statement.sql.includes('FROM teleport_forum_subscriptions')
    )!
    expect(follows.sql).toContain("s.user_id = $1 AND s.target_kind = 'topic' AND s.target_id = $2")
    expect(follows.params).toEqual(['user-1', TOPIC.id])
  })

  it('continues a thread from one reply: three levels under it, and one more as the signal', async () => {
    const loaded = load({ member: true })
    // The reply the visitor continues from sits two levels deep.
    const root = CHILDREN[1]
    const page = await loaded.module.loadTopicPage({
      slug: TOPIC.slug,
      session: { id: 'user-1' },
      rootReplyId: root.id,
    })
    expect(page.replyTo).toBe(root.id)
    const heads = loaded.statements.find((statement) => statement.sql.includes('r.parent_id = $2'))!
    expect(heads.params.slice(0, 2)).toEqual([TOPIC.id, root.id])
    const children = loaded.statements.find((statement) =>
      statement.sql.includes('r.path LIKE ANY')
    )!
    // Its children are the first level (depth 3); drawn to depth 5, read to depth 6.
    expect(root.depth).toBe(2)
    expect(children.params[2]).toBe(6)

    // A reply that is not this topic's opens nothing.
    const none = await load({ member: true }).module.loadTopicPage({
      slug: TOPIC.slug,
      session: { id: 'user-1' },
      rootReplyId: 'not-a-reply',
    })
    expect(none.replies).toEqual([])
  })

  it('names a topic’s community by the topic’s own column when it has one', async () => {
    const loaded = load({ member: true, topic: { community_name: 'The club' } })
    const session = { id: 'user-1' }
    const page = await loaded.module.loadTopicPage({ slug: TOPIC.slug, session })
    expect(page.topic.community_name).toBe('The club')
    const list = await loaded.module.loadCommunityPage({ slug: COMMUNITY.slug, session })
    expect(list.topics[0].community_name).toBe('The club')
    expect(sqlOf(loaded)).toContain('t.community_slug, t.community_name, t.community_visibility')
  })

  it('lets a site moderator read everything, pending rows included', async () => {
    const loaded = load({ member: false, moderator: true })
    const page = await loaded.module.loadTopicPage({ slug: TOPIC.slug, session: { id: 'mod' } })
    expect(page.viewer.can_moderate).toBe(true)
    expect(page.viewer.can_read).toBe(true)
    expect(sqlOf(loaded)).toContain("(r.status IN ('published', 'removed', 'pending'))")
  })

  it('shows a non-member only the About side of a private community, members its topics', async () => {
    const outsider = load()
    const closed = await outsider.module.loadCommunityPage({ slug: COMMUNITY.slug, session: null })
    expect(closed.viewer.can_read).toBe(false)
    expect(closed.viewer.can_post).toBe(false)
    // Joining is following: a community has no subscription of its own.
    expect(closed.viewer).not.toHaveProperty('is_subscribed')
    expect(closed.topics).toEqual([])
    expect(closed.community.name).toBe('Private club')
    // The About card's lists are served with the shell.
    expect(closed.rules).toEqual([{ title: 'Be kind', text: 'Always.' }])
    expect(closed.moderators).toEqual([
      { user_id: 'owner', handle: 'olga', name: 'Olga Owner', avatar: null, role: 'owner' },
      { user_id: 'mod', handle: 'max', name: 'max', avatar: '/max.png', role: 'moderator' },
      { user_id: 'new', handle: '', name: 'Member', avatar: null, role: 'moderator' },
    ])
    expect(sqlOf(outsider)).not.toContain('FROM teleport_forum_topics')
    // The owner first; the role read is the membership's (a profile has a role too).
    expect(sqlOf(outsider)).toContain(
      "SELECT m.user_id, m.role, p.handle, p.display_name, p.avatar_url FROM teleport_forum_memberships m LEFT JOIN teleport_forum_profiles p ON p.user_id = m.user_id WHERE m.community_id = $1 AND m.status = 'active' AND m.role IN ('owner', 'moderator') AND COALESCE(p.role, '') <> 'banned' ORDER BY (m.role = 'owner') DESC, m.joined_at LIMIT 20"
    )

    const member = load({ member: true, topicsPerPage: 10, topicCount: 25 })
    const open = await member.module.loadCommunityPage({
      slug: COMMUNITY.slug,
      session: { id: 'user-1' },
      sort: 'top',
      page: 2,
    })
    expect(open.viewer.can_read).toBe(true)
    expect(open.topics).toHaveLength(1)
    expect(open.topics[0].body_html).toBe('')
    expect(open.topics[0].excerpt).toBe('Hello world')
    expect(open.topics[0].community_name).toBe('Private club')
    expect(open.topics[0].community_url).toBe('/forum/c/private-club')
    expect(open.sortBy).toBe('top')
    // The second of three pages: the pager's links open the first and the third.
    expect(open.paging).toEqual({ page: 2, pages: 3, previous: 1, next: 3 })
    expect(open.pendingJoinCount).toBe(0)
    expect(open.openReportCount).toBe(0)
    const sql = sqlOf(member)
    expect(sql).toContain(
      "t.community_id = $1 AND (t.status = 'published' OR (t.status = 'pending' AND t.author_id = $2))"
    )
    expect(sql).toContain(
      'ORDER BY t.is_pinned DESC, t.score DESC, t.created_at DESC LIMIT $3 OFFSET $4'
    )
    const list = member.statements.find((statement) => statement.sql.includes('OFFSET $4'))!
    expect(list.params).toEqual([COMMUNITY.id, 'user-1', 10, 10])
    // A moderator's counts were not asked for a member.
    expect(sql).not.toContain("m.status = 'pending'")
    // Joining is following: no subscription is read for a community.
    expect(open.viewer).not.toHaveProperty('is_subscribed')
    expect(sql).not.toContain('FROM teleport_forum_subscriptions')
  })

  it('pages a community’s topics by the page’s own setting, never by the address', async () => {
    const pagingOf = async (fixture: Fixture, args: Record<string, unknown> = {}) => {
      const loaded = load({ community: { visibility: 'public' }, ...fixture })
      const page = await loaded.module.loadCommunityPage({
        slug: COMMUNITY.slug,
        session: null,
        ...args,
      })
      const list = loaded.statements.find((statement) => statement.sql.includes('OFFSET'))!
      return { paging: page.paging, sortBy: page.sortBy, limit: list.params.slice(-2) }
    }

    // One page: no pager, the default order, twenty topics a page when the editor set nothing.
    expect(await pagingOf({})).toEqual({
      paging: { page: 1, pages: 1, previous: 0, next: 0 },
      sortBy: 'latest',
      limit: [20, 0],
    })
    // The first of several has only a next one; an order the forum does not have is the default.
    expect(await pagingOf({ topicCount: 45 }, { sort: 'created_at-desc' })).toEqual({
      paging: { page: 1, pages: 3, previous: 0, next: 2 },
      sortBy: 'latest',
      limit: [20, 0],
    })
    // A page past the last one (an old link) is the last one; what the address asks per page is ignored.
    expect(await pagingOf({ topicCount: 45 }, { page: 9, perPage: 1 })).toEqual({
      paging: { page: 3, pages: 3, previous: 2, next: 0 },
      sortBy: 'latest',
      limit: [20, 40],
    })
    // The setting is kept within what one page may hold.
    expect((await pagingOf({ topicsPerPage: 500 })).limit).toEqual([50, 0])
    expect((await pagingOf({ topicsPerPage: 0 })).limit).toEqual([1, 0])
    expect((await pagingOf({ topicsPerPage: 'many' })).limit).toEqual([20, 0])
  })

  it('counts what waits for a moderator as numbers', async () => {
    const loaded = load({ membership: { role: 'owner', status: 'active' } })
    const page = await loaded.module.loadCommunityPage({
      slug: COMMUNITY.slug,
      session: { id: 'owner' },
    })
    expect(page.viewer).toMatchObject({ can_moderate: true, my_role: 'owner', can_post: true })
    expect(page.pendingJoinCount).toBe(3)
    expect(page.openReportCount).toBe(2)
  })

  it('lets anyone signed in post where the community is public, its members elsewhere, and only who moderates where moderators post', async () => {
    const canPost = async (fixture: Fixture, session: unknown = { id: 'user-1' }) => {
      const page = await load({
        community: { visibility: 'public' },
        ...fixture,
      }).module.loadCommunityPage({ slug: COMMUNITY.slug, session })
      return page.viewer.can_post
    }
    const restricted = { visibility: 'restricted' }
    const moderatorsOnly = { visibility: 'public', posting: 'moderators' }
    const announcements = { visibility: 'public', kind: 'announcements' }

    // Public: anyone signed in, joined or not; never a visitor or a ban.
    expect(await canPost({ member: true })).toBe(true)
    expect(await canPost({})).toBe(true)
    expect(await canPost({ member: true }, null)).toBe(false)
    expect(await canPost({ membership: { role: 'member', status: 'banned' } })).toBe(false)
    expect(await canPost({ member: true, profileRole: 'banned' })).toBe(false)
    expect(await canPost({}, { id: 'boss', role: 'admin' })).toBe(true)

    // Restricted: its active members only; a request still pending does not count.
    expect(await canPost({ community: restricted, member: true })).toBe(true)
    expect(await canPost({ community: restricted })).toBe(false)
    expect(
      await canPost({ community: restricted, membership: { role: 'member', status: 'pending' } })
    ).toBe(false)
    expect(await canPost({ community: restricted, moderator: true })).toBe(false)

    // Where only moderators post — the setting, or an announcements community.
    for (const community of [moderatorsOnly, announcements]) {
      expect(await canPost({ community, member: true })).toBe(false)
      expect(
        await canPost({ community, membership: { role: 'moderator', status: 'active' } })
      ).toBe(true)
      expect(await canPost({ community, membership: { role: 'owner', status: 'active' } })).toBe(
        true
      )
      expect(await canPost({ community, moderator: true })).toBe(true)
      expect(await canPost({ community }, { id: 'boss', role: 'admin' })).toBe(true)
    }
  })

  it('lets a visitor reply as the reply statement does: members of an announcements community too', async () => {
    const canReply = async (fixture: Fixture, session: unknown = { id: 'user-1' }) => {
      const page = await load({
        community: { visibility: 'public' },
        ...fixture,
      }).module.loadTopicPage({ slug: TOPIC.slug, session })
      return page.viewer.can_reply
    }
    expect(await canReply({})).toBe(true)
    expect(await canReply({}, null)).toBe(false)
    expect(await canReply({ member: true, profileRole: 'banned' })).toBe(false)
    expect(await canReply({ community: { visibility: 'restricted' } })).toBe(false)
    expect(await canReply({ community: { visibility: 'restricted' }, member: true })).toBe(true)
    // Announcements keep new topics to moderators; their replies are open to members.
    expect(await canReply({ community: { visibility: 'public', kind: 'announcements' } })).toBe(
      true
    )
    expect(await canReply({ community: { visibility: 'public', posting: 'moderators' } })).toBe(
      false
    )
    expect(
      await canReply({
        community: { visibility: 'public', posting: 'moderators' },
        moderator: true,
      })
    ).toBe(true)
  })

  describe('the gate of the Manage and New topic pages', () => {
    const SESSION = { id: 'user-1' }
    const VIEWERS: Record<string, { fixture: Fixture; session: unknown }> = {
      'signed out': { fixture: {}, session: null },
      stranger: { fixture: {}, session: SESSION },
      member: { fixture: { member: true }, session: SESSION },
      moderator: {
        fixture: { membership: { role: 'moderator', status: 'active' } },
        session: SESSION,
      },
    }
    const gate = async (who: string, visibility: string, need: string) => {
      const { fixture, session } = VIEWERS[who]
      const loaded = load({ ...fixture, community: { visibility } })
      const answer = await loaded.module.loadCommunityGate({ slug: COMMUNITY.slug, session, need })
      return { answer, loaded }
    }

    it.each(['public', 'private'])(
      'opens Manage of a %s community to who moderates it only',
      async (visibility) => {
        for (const who of ['signed out', 'stranger', 'member']) {
          expect((await gate(who, visibility, 'moderate')).answer).toBeNull()
        }
        const { answer, loaded } = await gate('moderator', visibility, 'moderate')
        expect(answer.viewer).toMatchObject({
          signed_in: true,
          can_moderate: true,
          community_id: COMMUNITY.id,
          community_slug: 'private-club',
          community_name: 'Private club',
        })
        // The record the page binds is the shaped community.
        expect(answer.community).toMatchObject({
          id: COMMUNITY.id,
          visibility,
          rules_text: 'Be kind: Always.',
          created_at: '2026-10-01T10:00:00.000Z',
        })
        // Read whatever its visibility: the membership decides, not the visitor's row policy.
        expect(sqlOf(loaded)).not.toContain("visibility <> 'private'")
      }
    )

    it('opens New topic of a public community to every signed-in viewer, saying who may post', async () => {
      expect((await gate('signed out', 'public', 'post')).answer).toBeNull()
      // A public community takes posts from anyone signed in; joining is not required.
      const stranger = (await gate('stranger', 'public', 'post')).answer
      expect(stranger.viewer).toMatchObject({
        signed_in: true,
        my_membership: null,
        can_post: true,
      })
      expect(stranger.community.slug).toBe('private-club')
      const member = (await gate('member', 'public', 'post')).answer
      expect(member.viewer).toMatchObject({
        signed_in: true,
        my_membership: 'active',
        can_post: true,
      })
      expect((await gate('moderator', 'public', 'post')).answer.viewer.can_post).toBe(true)
    })

    it('opens New topic of a private community to its members and moderators only', async () => {
      expect((await gate('signed out', 'private', 'post')).answer).toBeNull()
      expect((await gate('stranger', 'private', 'post')).answer).toBeNull()
      const member = (await gate('member', 'private', 'post')).answer
      expect(member.viewer).toMatchObject({ my_membership: 'active', can_post: true })
      expect((await gate('moderator', 'private', 'post')).answer.viewer.can_post).toBe(true)
    })

    it('admits a site moderator and an admin, and refuses what it cannot name', async () => {
      const site = load({ moderator: true })
      expect(
        (
          await site.module.loadCommunityGate({
            slug: COMMUNITY.slug,
            session: SESSION,
            need: 'moderate',
          })
        ).viewer.can_moderate
      ).toBe(true)
      const admin = await load().module.loadCommunityGate({
        slug: COMMUNITY.slug,
        session: { id: 'boss', role: 'admin' },
        need: 'moderate',
      })
      expect(admin.viewer.can_moderate).toBe(true)

      // A signed-out visitor is refused before the database is asked anything.
      const anonymous = await gate('signed out', 'public', 'post')
      expect(anonymous.loaded.statements).toEqual([])
      const moderator = load({ membership: { role: 'owner', status: 'active' } })
      const ask = (args: Record<string, unknown>) =>
        moderator.module.loadCommunityGate({ slug: COMMUNITY.slug, session: SESSION, ...args })
      expect(await ask({ need: 'anything' })).toBeNull()
      expect(await ask({})).toBeNull()
      expect(await ask({ need: 'moderate', slug: 'nope' })).toBeNull()
      // An archived community: still managed, no longer written in by its members.
      const archived = { status: 'archived', visibility: 'public' }
      const closed = load({ member: true, community: archived })
      expect(
        await closed.module.loadCommunityGate({
          slug: COMMUNITY.slug,
          session: SESSION,
          need: 'post',
        })
      ).toBeNull()
      const kept = load({ membership: { role: 'owner', status: 'active' }, community: archived })
      const managed = await kept.module.loadCommunityGate({
        slug: COMMUNITY.slug,
        session: SESSION,
        need: 'moderate',
      })
      expect(managed.viewer).toMatchObject({ can_moderate: true, can_post: false })
    })

    it('lets the owner, a site moderator and an admin delete the community, never a community moderator', async () => {
      const canDelete = async (fixture: Fixture, session: unknown = SESSION) =>
        (
          await load(fixture).module.loadCommunityGate({
            slug: COMMUNITY.slug,
            session,
            need: 'moderate',
          })
        ).viewer.can_delete
      expect(await canDelete({ membership: { role: 'owner', status: 'active' } })).toBe(true)
      expect(await canDelete({ moderator: true })).toBe(true)
      expect(
        await canDelete(
          { membership: { role: 'moderator', status: 'active' } },
          { id: 'boss', role: 'admin' }
        )
      ).toBe(true)
      expect(await canDelete({}, { id: 'boss', role: 'admin' })).toBe(true)
      expect(await canDelete({ membership: { role: 'moderator', status: 'active' } })).toBe(false)
      // The community a forum keeps its topics in has no Manage page at all.
      expect(
        await load({
          membership: { role: 'owner', status: 'active' },
          community: { slug: 'main' },
        }).module.loadCommunityGate({ slug: COMMUNITY.slug, session: SESSION, need: 'moderate' })
      ).toBeNull()
    })
  })

  it('answers the replies route through the same rules, from an offset', async () => {
    const loaded = load({ member: true })
    const page = await loaded.module.loadReplies({
      topicId: TOPIC.id,
      session: { id: 'user-1' },
      sort: 'new',
      after: 50,
    })
    expect(page.replies.map((r: any) => r.id.slice(-1))).toEqual(['5', '2', '1'])
    // The page's count follows a reply posted: the topic's published replies as stored now.
    expect(page.replyCount).toBe(TOPIC.reply_count)
    const heads = loaded.statements.find((statement) =>
      statement.sql.includes('r.parent_id IS NULL')
    )!
    expect(heads.sql).toContain('ORDER BY r.created_at DESC LIMIT $3 OFFSET $4')
    expect(heads.params).toEqual([TOPIC.id, 'user-1', 51, 50])
    expect(await load().module.loadReplies({ topicId: TOPIC.id, session: null })).toBeNull()
  })

  describe('flat replies', () => {
    const FLAT: Fixture = { member: true, settings: { replyNesting: 'flat' } }
    const SESSION = { id: 'user-1' }
    const idsOf = (replies: any[]) => replies.map((r: any) => r.id.slice(-1))

    it('reads every reply of the topic as one level, in the order asked', async () => {
      const loaded = load(FLAT)
      const page = await loaded.module.loadTopicPage({
        slug: TOPIC.slug,
        session: SESSION,
        sort: 'old',
      })
      // The database's order, nothing nested: a reply to a reply is a row of the list, not lost.
      expect(idsOf(page.replies)).toEqual(['1', '2', '5', '3', '4'])
      expect(page.replies.every((r: any) => Array.isArray(r.children) && !r.children.length)).toBe(
        true
      )
      expect(page.replies[4].parent_id).toBe(CHILDREN[0].id)
      // The removed one keeps its place, masked; the accepted answer is the list's own row.
      expect(page.replies[2].body_html).toBe('<p><em>[removed]</em></p>')
      expect(page.topic.accepted_reply).toMatchObject({ id: TOPIC.accepted_reply_id })
      expect(page.hasMoreReplies).toBe(false)
      expect(page.nextReplyOffset).toBe(5)
      const heads = loaded.statements.find((statement) => statement.sql.includes('OFFSET $4'))!
      expect(heads.sql).toContain(
        "WHERE r.topic_id = $1 AND (r.status IN ('published', 'removed') OR (r.status = 'pending' AND r.author_id = $2)) ORDER BY r.created_at ASC LIMIT $3 OFFSET $4"
      )
      expect(heads.params).toEqual([TOPIC.id, 'user-1', 51, 0])
      expect(sqlOf(loaded)).not.toContain('r.parent_id IS NULL')
      expect(sqlOf(loaded)).not.toContain('r.path LIKE ANY')
    })

    it('answers the same list to "Continue this thread" and pages it on the replies route', async () => {
      const continued = load(FLAT)
      const page = await continued.module.loadTopicPage({
        slug: TOPIC.slug,
        session: SESSION,
        rootReplyId: CHILDREN[0].id,
      })
      expect(idsOf(page.replies)).toEqual(['1', '2', '5', '3', '4'])
      expect(sqlOf(continued)).not.toContain('SELECT r.id, r.depth, r.path')
      expect(sqlOf(continued)).not.toContain('r.parent_id = $2')

      // One more row than a page holds says there is more.
      const many = Array.from({ length: 51 }, (_, i) => reply(1, null, 0, { id: `r-${i}` }))
      const route = load({ ...FLAT, flatReplies: many })
      const more = await route.module.loadReplies({
        topicId: TOPIC.id,
        session: SESSION,
        sort: 'new',
        after: 50,
        rootReplyId: CHILDREN[0].id,
      })
      expect(more.replies).toHaveLength(50)
      expect(more.hasMore).toBe(true)
      expect(more.nextOffset).toBe(100)
      const heads = route.statements.find((statement) => statement.sql.includes('OFFSET $4'))!
      expect(heads.sql).toContain('ORDER BY r.created_at DESC LIMIT $3 OFFSET $4')
      expect(heads.params).toEqual([TOPIC.id, 'user-1', 51, 50])
    })
  })

  describe('who may edit a post', () => {
    const AUTHOR = { id: 'author' }
    const SESSION = { id: 'user-1' }
    const RECENT: Fixture = { topic: { created_at: minutesAgo(5) } }
    const topicViewer = async (fixture: Fixture, session: unknown) =>
      (
        await load({ community: { visibility: 'public' }, ...fixture }).module.loadTopicPage({
          slug: TOPIC.slug,
          session,
        })
      ).viewer
    // Every reply's can_edit, by the reply's number, through the whole tree.
    const canEditOf = (replies: any[]): Record<string, boolean> => {
      const out: Record<string, boolean> = {}
      const walk = (nodes: any[]) =>
        nodes.forEach((node) => {
          out[node.id.slice(-1)] = node.can_edit
          walk(node.children)
        })
      walk(replies)
      return out
    }

    it('lets the topic’s author edit it within the edit window, and who moderates it always', async () => {
      expect((await topicViewer(RECENT, AUTHOR)).can_edit).toBe(true)
      // Thirty minutes unless set; 0 is no window at all.
      expect((await topicViewer({ topic: { created_at: minutesAgo(31) } }, AUTHOR)).can_edit).toBe(
        false
      )
      expect(
        (
          await topicViewer(
            { settings: { editWindowMinutes: 120 }, topic: { created_at: minutesAgo(90) } },
            AUTHOR
          )
        ).can_edit
      ).toBe(true)
      expect((await topicViewer({ settings: { editWindowMinutes: 0 } }, AUTHOR)).can_edit).toBe(
        true
      )
      // Anyone else, a visitor: never.
      expect((await topicViewer(RECENT, SESSION)).can_edit).toBe(false)
      expect((await topicViewer(RECENT, null)).can_edit).toBe(false)
      // Who moderates it, however old: the community's moderator, a site moderator, an admin.
      const communityModerator = { membership: { role: 'moderator', status: 'active' } }
      expect((await topicViewer(communityModerator, SESSION)).can_edit).toBe(true)
      expect((await topicViewer({ moderator: true }, SESSION)).can_edit).toBe(true)
      expect((await topicViewer({}, { id: 'boss', role: 'admin' })).can_edit).toBe(true)
      // Never someone banned, never a removed post.
      expect((await topicViewer({ ...RECENT, profileRole: 'banned' }, AUTHOR)).can_edit).toBe(false)
      const removed = { moderator: true, topic: { status: 'removed' } }
      expect((await topicViewer(removed, SESSION)).can_edit).toBe(false)
    })

    it('says it on every reply: the tree, the accepted answer and the replies route', async () => {
      const always: Fixture = { member: true, settings: { editWindowMinutes: 0 } }
      const ask = (fixture: Fixture, session: unknown = SESSION) =>
        load(fixture).module.loadTopicPage({ slug: TOPIC.slug, session })
      // user-1 wrote reply 1 only; reply 5 is removed.
      const own = { '1': true, '2': false, '3': false, '4': false, '5': false }
      expect(canEditOf((await ask(always)).replies)).toEqual(own)
      // The fixture's replies were written weeks ago: past the window, its author no longer.
      expect(canEditOf((await ask({ member: true })).replies)['1']).toBe(false)
      // Who moderates: every reply but the removed one.
      expect(canEditOf((await ask({ moderator: true })).replies)).toEqual({
        '1': true,
        '2': true,
        '3': true,
        '4': true,
        '5': false,
      })
      // A visitor of a public community's topic: none.
      const visitor = await ask({ ...always, community: { visibility: 'public' } }, null)
      expect(Object.values(canEditOf(visitor.replies)).some(Boolean)).toBe(false)
      // The accepted answer read by id, off the page, carries it too.
      const offPage = await ask({ ...always, topic: { accepted_reply_id: OFF_PAGE.id } })
      expect(offPage.topic.accepted_reply).toMatchObject({ id: OFF_PAGE.id, can_edit: true })
      const more = await load(always).module.loadReplies({ topicId: TOPIC.id, session: SESSION })
      expect(canEditOf(more.replies)).toEqual(own)
    })
  })

  describe('a community that is not active', () => {
    // The fixture's community was created by `owner`, who holds no membership unless said.
    const CREATOR = { id: 'owner' }
    const SESSION = { id: 'user-1' }
    const communityPage = (status: string, session: unknown, fixture: Fixture = {}) =>
      load({ community: { status, visibility: 'public' }, ...fixture }).module.loadCommunityPage({
        slug: COMMUNITY.slug,
        session,
      })

    it('shows one waiting for approval to its creator and who moderates it, to nobody else', async () => {
      expect(await communityPage('pending', null)).toBeNull()
      expect(await communityPage('pending', SESSION)).toBeNull()
      expect(await communityPage('pending', SESSION, { member: true })).toBeNull()
      const mine = await communityPage('pending', CREATOR)
      expect(mine.community.status).toBe('pending')
      expect(mine.viewer).toMatchObject({ is_creator: true, can_moderate: false, can_post: false })
      expect(mine.seo.noindex).toBe(true)
      const moderated = await communityPage('pending', SESSION, { moderator: true })
      expect(moderated.viewer).toMatchObject({
        is_creator: false,
        can_moderate: true,
        can_post: false,
      })
      expect(moderated.seo.noindex).toBe(true)
    })

    it('shows an archived one to who moderates it only, its creator too only as one', async () => {
      expect(await communityPage('archived', CREATOR)).toBeNull()
      expect(await communityPage('archived', SESSION)).toBeNull()
      const owner = { membership: { role: 'owner', status: 'active' } }
      const kept = await communityPage('archived', CREATOR, owner)
      expect(kept.viewer).toMatchObject({ is_creator: true, can_moderate: true, can_post: false })
      expect(kept.seo.noindex).toBe(true)
    })

    it('says who created an active one', async () => {
      expect((await communityPage('active', CREATOR)).viewer.is_creator).toBe(true)
      expect((await communityPage('active', SESSION)).viewer.is_creator).toBe(false)
      expect((await communityPage('active', null)).viewer.is_creator).toBe(false)
    })
  })

  it('has no "Top" order of a community’s topics without votes', async () => {
    const orderOf = async (settings: Record<string, unknown>, sort: string) => {
      const loaded = load({ community: { visibility: 'public' }, settings })
      const page = await loaded.module.loadCommunityPage({
        slug: COMMUNITY.slug,
        session: null,
        sort,
      })
      const list = loaded.statements.find((statement) => statement.sql.includes('OFFSET'))!
      return { sortBy: page.sortBy, sql: list.sql }
    }
    const off = await orderOf({ votes: 'off' }, 'top')
    expect(off.sortBy).toBe('latest')
    expect(off.sql).toContain('ORDER BY t.is_pinned DESC, t.last_activity_at DESC NULLS LAST')
    // The other orders stay; with votes, upvotes only too, "Top" is the score's.
    expect((await orderOf({ votes: 'off' }, 'new')).sortBy).toBe('new')
    expect((await orderOf({ votes: 'up' }, 'top')).sortBy).toBe('top')
  })

  it('reads and marks notifications for the session’s user only', async () => {
    const loaded = load()
    expect(await loaded.module.loadNotifications(null, {})).toEqual({ items: [], unreadCount: 0 })
    const mine = await loaded.module.loadNotifications({ sub: 'user-9' }, { limit: 5 })
    // `text` beside `title`: the profile tab binds one, the overlay the other.
    expect(mine.items[0]).toMatchObject({
      title: 'Jane replied',
      text: 'Jane replied',
      created_at: '2026-10-03T12:00:00.000Z',
    })
    await loaded.module.markNotificationsRead({ id: 'user-9' }, ['n1'])
    const sql = sqlOf(loaded)
    expect(sql).toContain(
      'FROM teleport_forum_notifications n WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT $2'
    )
    expect(sql).toContain(
      'SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::uuid[])'
    )
    expect(loaded.statements.every((statement) => statement.params[0] === 'user-9')).toBe(true)
  })

  it('names the pictures a topic or a reply still shows, by the file id in their address', async () => {
    const loaded = load()
    expect(await loaded.module.filesStillShown(['f-1', 'f-2'])).toEqual([])
    const statement = loaded.statements[loaded.statements.length - 1]
    expect(statement.params).toEqual([['f-1', 'f-2']])
    expect(statement.sql).toContain('FROM unnest($1::text[]) AS f(id)')
    expect(statement.sql).toContain(
      "FROM teleport_forum_topics t WHERE t.attachments::text LIKE '%/' || f.id || '/%'"
    )
    expect(statement.sql).toContain(
      "FROM teleport_forum_replies r WHERE r.attachments::text LIKE '%/' || f.id || '/%'"
    )
    // A community's icon or banner is a picture the forum still shows too.
    expect(statement.sql).toContain(
      "FROM teleport_forum_communities c WHERE COALESCE(c.icon_url, '') LIKE '%/' || f.id || '/%' OR COALESCE(c.banner_url, '') LIKE '%/' || f.id || '/%'"
    )
  })

  it('lists only public, published rows for the live index', async () => {
    const loaded = load()
    await loaded.module.listPublicIndex()
    const sql = sqlOf(loaded)
    expect(sql).toContain("c.status = 'active' AND c.visibility <> 'private'")
    // A topic of an archived community, or of one still waiting for approval, is not listed.
    expect(sql).toContain(
      "t.status = 'published' AND t.community_visibility <> 'private' AND EXISTS (SELECT 1 FROM teleport_forum_communities c WHERE c.id = t.community_id AND c.status = 'active')"
    )
  })

  describe('a forum without communities', () => {
    // The one community its topics are kept in, as the editor writes it at activation.
    const MAIN = {
      slug: 'main',
      name: 'General',
      description: 'Everything that has no community of its own.',
      kind: 'discussion',
      visibility: 'public',
    }
    const IN_MAIN = {
      community_slug: 'main',
      community_name: 'General',
      community_visibility: 'public',
    }
    const SESSION = { id: 'user-1' }
    const TOPIC_URL = `https://site.example/forum/t/${TOPIC.slug}`
    const topicsOnly = (fixture: Fixture = {}) =>
      load({ structure: 'topics', community: MAIN, topic: IN_MAIN, ...fixture })
    // The same rows in a forum that has communities.
    const withCommunities = (fixture: Fixture = {}) =>
      load({ community: MAIN, topic: IN_MAIN, ...fixture })
    const namesTheCommunity = (answer: unknown): boolean =>
      /General|"main"|\/forum\/c|no community of its own/.test(JSON.stringify(answer))

    it('names and links no community on a topic, and still decides the rights on it', async () => {
      const loaded = topicsOnly()
      const page = await loaded.module.loadTopicPage({
        slug: TOPIC.slug,
        session: SESSION,
        url: TOPIC_URL,
      })
      expect(page.topic.community_name).toBe('')
      expect(page.topic.community_url).toBe('')
      expect(page.topic.community_slug).toBe('')
      expect(page.community).toBeNull()
      // A public topic is indexed, and its JSON-LD names the topic and its author alone.
      expect(page.seo.noindex).toBe(false)
      expect(page.seo.jsonLd).toMatchObject({
        '@type': 'DiscussionForumPosting',
        url: TOPIC_URL,
        headline: 'How do I start?',
      })
      expect(namesTheCommunity(page)).toBe(false)
      // The rest of the topic is what any forum answers.
      expect(page.topic.title).toBe('How do I start?')
      expect(page.topic.body_html).toBe('<p>Hello <strong>world</strong></p>')
      expect(page.replies.map((r: any) => r.id.slice(-1))).toEqual(['2', '5', '1'])
      // The community row is still read: anyone signed in posts, nobody is a member.
      expect(sqlOf(loaded)).toContain('FROM teleport_forum_communities c WHERE c.id = $1')
      expect(page.viewer).toMatchObject({
        signed_in: true,
        my_membership: null,
        my_role: null,
        can_read: true,
        can_post: true,
        can_moderate: false,
      })
      const moderator = await topicsOnly({ moderator: true }).module.loadTopicPage({
        slug: TOPIC.slug,
        session: SESSION,
      })
      expect(moderator.viewer.can_moderate).toBe(true)
      const banned = await topicsOnly({ profileRole: 'banned' }).module.loadTopicPage({
        slug: TOPIC.slug,
        session: SESSION,
      })
      expect(banned.viewer).toMatchObject({ can_read: true, can_post: false })
      // An archived main community closes its topics to everyone but who moderates.
      const archived = { ...MAIN, status: 'archived' }
      expect(
        await topicsOnly({ community: archived }).module.loadTopicPage({
          slug: TOPIC.slug,
          session: SESSION,
        })
      ).toBeNull()

      // The same rows in a forum with communities name it, link it and answer it.
      const named = await withCommunities().module.loadTopicPage({
        slug: TOPIC.slug,
        session: SESSION,
        url: TOPIC_URL,
      })
      expect(named.topic.community_name).toBe('General')
      expect(named.topic.community_url).toBe('/forum/c/main')
      expect(named.topic.community_slug).toBe('main')
      expect(named.community).toMatchObject({ slug: 'main', name: 'General' })
      expect(named.viewer).toEqual(page.viewer)
    })

    it('opens the composer by the main community’s slug, answering the rights alone', async () => {
      const ask = (loaded: Loaded, session: unknown) =>
        loaded.module.loadCommunityGate({ slug: 'main', session, need: 'post' })

      const anonymous = topicsOnly()
      expect(await ask(anonymous, null)).toBeNull()
      expect(anonymous.statements).toEqual([])

      const answer = await ask(topicsOnly(), SESSION)
      expect(answer.community).toBeNull()
      expect(answer.viewer).toMatchObject({ signed_in: true, can_read: true, can_post: true })
      expect(Object.keys(answer.viewer).filter((key) => key.startsWith('community'))).toEqual([])
      expect(namesTheCommunity(answer)).toBe(false)
      // Someone banned from posting still gets the page, which tells them so.
      expect((await ask(topicsOnly({ profileRole: 'banned' }), SESSION)).viewer.can_post).toBe(
        false
      )
      // No main community (a database that lost the row): there is nothing to write in.
      expect(
        await topicsOnly().module.loadCommunityGate({
          slug: 'nope',
          session: SESSION,
          need: 'post',
        })
      ).toBeNull()

      // A forum with communities answers the community with the rights, as its pages bind it.
      const named = await ask(withCommunities(), SESSION)
      expect(named.community).toMatchObject({ slug: 'main', name: 'General' })
      expect(named.viewer).toMatchObject({ community_slug: 'main', community_name: 'General' })
    })

    it('has no community page and no community in the public index', async () => {
      const loaded = topicsOnly()
      expect(await loaded.module.loadCommunityPage({ slug: 'main', session: SESSION })).toBeNull()
      expect(loaded.statements).toEqual([])

      const index = await loaded.module.listPublicIndex()
      expect(index.communities).toEqual([])
      expect(index.topics).toEqual([
        {
          slug: TOPIC.slug,
          title: 'How do I start?',
          updated_at: '2026-10-01T12:00:00.000Z',
          excerpt: 'Hello world',
        },
      ])
      // No community is listed: only the main one's status is asked, for its topics.
      expect(sqlOf(loaded)).not.toContain('SELECT c.slug')
      expect(sqlOf(loaded)).toContain(
        "t.status = 'published' AND t.community_visibility <> 'private' AND EXISTS (SELECT 1 FROM teleport_forum_communities c WHERE c.id = t.community_id AND c.status = 'active')"
      )

      expect((await withCommunities().module.listPublicIndex()).communities).toHaveLength(1)
    })

    it('lists the topics alone in the sitemap and the llms file', async () => {
      const config = configOf({ structure: 'topics' })
      const sitemap = await sendIndexPage(buildForumSitemapPageSource(config), topicsOnly())
      expect(sitemap.match(/<loc>[^<]*<\/loc>/g)).toEqual([`<loc>${TOPIC_URL}</loc>`])
      const llms = await sendIndexPage(buildForumLlmsPageSource(config), topicsOnly())
      expect(llms).toBe(`# Forum\n\n## Topics\n\n- [How do I start?](${TOPIC_URL}): Hello world\n`)

      // With communities both name each community first, as before.
      const named = configOf()
      const namedSitemap = await sendIndexPage(
        buildForumSitemapPageSource(named),
        withCommunities()
      )
      expect(namedSitemap.match(/<loc>[^<]*<\/loc>/g)).toEqual([
        '<loc>https://site.example/forum/c/main</loc>',
        `<loc>${TOPIC_URL}</loc>`,
      ])
      const namedLlms = await sendIndexPage(buildForumLlmsPageSource(named), withCommunities())
      expect(namedLlms).toBe(
        '# Forum\n\n## Communities\n\n' +
          '- [General](https://site.example/forum/c/main): Everything that has no community of its own.\n' +
          `\n## Topics\n\n- [How do I start?](${TOPIC_URL}): Hello world\n`
      )
    })

    /**
     * A site in several languages serves every forum page under each language's
     * prefix too: the sitemap lists each address with the others as alternates
     * and the default one as `x-default`, as the editor's static sitemap does.
     */
    it('lists each page in every language of a site in several languages', async () => {
      const named = configOf()
      const languages = { locales: ['en', 'es'], defaultLocale: 'en', locale: 'en' }
      const sitemap = await sendIndexPage(
        buildForumSitemapPageSource(named, { multilingual: true }),
        withCommunities(),
        languages
      )
      const community = 'https://site.example/forum/c/main'
      const spanishCommunity = 'https://site.example/es/forum/c/main'
      const spanishTopic = `https://site.example/es/forum/t/${TOPIC.slug}`

      expect(sitemap).toContain(
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'
      )
      expect(sitemap.match(/<loc>[^<]*<\/loc>/g)).toEqual([
        `<loc>${community}</loc>`,
        `<loc>${spanishCommunity}</loc>`,
        `<loc>${TOPIC_URL}</loc>`,
        `<loc>${spanishTopic}</loc>`,
      ])
      const topicEntries = sitemap.split('<url>').filter((entry) => entry.includes('/forum/t/'))
      expect(topicEntries).toHaveLength(2)
      topicEntries.forEach((entry) => {
        expect(entry.match(/<xhtml:link [^>]*\/>/g)).toEqual([
          `<xhtml:link rel="alternate" hreflang="en" href="${TOPIC_URL}" />`,
          `<xhtml:link rel="alternate" hreflang="es" href="${spanishTopic}" />`,
          `<xhtml:link rel="alternate" hreflang="x-default" href="${TOPIC_URL}" />`,
        ])
        expect(entry).toContain('<lastmod>2026-10-01T12:00:00.000Z</lastmod>')
      })

      // A site in one language reads exactly as the single-language sitemap.
      const alone = await sendIndexPage(
        buildForumSitemapPageSource(named, { multilingual: true }),
        withCommunities(),
        { locales: ['en'], defaultLocale: 'en', locale: 'en' }
      )
      expect(alone.replace(' xmlns:xhtml="http://www.w3.org/1999/xhtml"', '')).toBe(
        await sendIndexPage(buildForumSitemapPageSource(named), withCommunities())
      )
      // Without languages the page is generated as it always was.
      expect(buildForumSitemapPageSource(named, { multilingual: false })).toBe(
        buildForumSitemapPageSource(named)
      )
      expect(buildForumSitemapPageSource(named)).not.toContain('xhtml')
    })
  })
})
