/* tslint:disable:function-constructor */
import {
  generateForumFeedTransformationCode,
  isForumFeedTable,
} from '../src/transformations/forum-feed'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'
import {
  detectTransformationType,
  getTransformationCode,
  getTransformWrapperCode,
} from '../src/transformations'

// The forum feed and directory cards bind the row as stored plus the fields
// derived here. These evaluate the EMITTED code, the way the runtime does.

type Transform = (records: unknown[]) => Array<Record<string, unknown>>

const transformForumFeed = new Function(
  `${generateSharedTransformationCode()}\n${generateForumFeedTransformationCode()}\nreturn transformForumFeed;`
)() as Transform

const topic = {
  id: 't1',
  title: 'Hello',
  body_text: 'word '.repeat(80).trim(),
  tags: '["help", 3, "tips"]',
  community_slug: 'garden',
  community_name: 'Garden club',
  author_id: 'u1',
  author_name: 'Jane Mary Doe',
  accepted_reply_id: null,
  reply_count: '2',
  status: 'published',
}

const community = {
  id: 'c1',
  name: 'Garden club',
  description: '<p>About <b>plants</b>.</p>',
  rules: '[{"title":"Be kind"}, "junk"]',
  visibility: 'private',
  status: 'active',
}

describe('the forum feed transform', () => {
  it('is chosen for the topics and communities tables only', () => {
    expect(isForumFeedTable('teleport_forum_topics')).toBe(true)
    expect(isForumFeedTable('teleport_forum_communities')).toBe(true)
    expect(isForumFeedTable('teleport_forum_replies')).toBe(false)
    expect(detectTransformationType('teleport_forum_topics')).toBe('forum-feed')
    expect(detectTransformationType('public.teleport_forum_communities')).toBe('forum-feed')
    expect(detectTransformationType('forum_topics')).toBeNull()
    expect(getTransformationCode('teleport_forum_topics')).toContain('function transformForumFeed')
    expect(getTransformWrapperCode('teleport_forum_topics')).toContain(
      'transformForumFeed(records, options)'
    )
  })

  it('keeps a topic row whole and adds what its card shows', () => {
    const [row] = transformForumFeed([topic])
    expect(row.title).toBe('Hello')
    expect(row.status).toBe('published')
    expect((row.excerpt as string).length).toBeLessThanOrEqual(241)
    expect(row.excerpt as string).toMatch(/…$/)
    expect(row.excerpt as string).not.toMatch(/\s…$/)
    expect(row.is_solved).toBe(false)
    expect(row.is_answered).toBe(true)
    expect(row.tag_list).toEqual(['help', 'tips'])
    expect(row.author_initials).toBe('JM')
    const [solved] = transformForumFeed([
      { ...topic, accepted_reply_id: 'r1', reply_count: 0, body_text: 'short' },
    ])
    expect(solved.is_solved).toBe(true)
    expect(solved.is_answered).toBe(false)
    expect(solved.excerpt).toBe('short')
  })

  it('names a topic’s community by its slug when the row has no name of its own', () => {
    const [named, older, empty, neither] = transformForumFeed([
      topic,
      { ...topic, community_name: null },
      { ...topic, community_name: '' },
      { ...topic, community_name: undefined, community_slug: null },
    ])
    expect(named.community_name).toBe('Garden club')
    expect(older.community_name).toBe('garden')
    expect(empty.community_name).toBe('garden')
    expect(neither.community_name).toBe('')
    // A community row is not given one.
    expect(transformForumFeed([community])[0]).not.toHaveProperty('community_name')
  })

  it('keeps a community row whole and adds what its card shows', () => {
    const [row] = transformForumFeed([community])
    expect(row.name).toBe('Garden club')
    expect(row.excerpt).toBe('About plants .')
    expect(row.is_private).toBe(true)
    expect(row.initials).toBe('GC')
    expect(row.rule_list).toEqual([{ title: 'Be kind' }])
    expect(row.rules_text).toBe('Be kind')
    const [ruled] = transformForumFeed([
      { ...community, rules: '[{"title":"Be kind","text":"Always."},{"title":"Stay on topic"}]' },
    ])
    expect(ruled.rules_text).toBe('Be kind: Always.\nStay on topic')
  })

  it('tolerates rows that are not objects and columns that are not JSON', () => {
    expect(transformForumFeed([null, 'x'] as unknown[])).toEqual([null, 'x'])
    const [row] = transformForumFeed([{ ...topic, tags: 'not json', body_text: null }])
    expect(row.tag_list).toEqual([])
    expect(row.excerpt).toBe('')
    expect(transformForumFeed(null as unknown as unknown[])).toEqual([])
  })
})
