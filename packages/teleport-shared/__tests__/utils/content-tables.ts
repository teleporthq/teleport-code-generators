import {
  CONTENT_COMMENTS_TABLES,
  CONTENT_POSTS_TABLES,
  CONTENT_POSTS_VISITOR_ROW_POLICY,
  CONTENT_TABLES,
  FORUM_PRIVATE_TABLES,
  FORUM_TABLES,
  FORUM_VISITOR_ROW_POLICIES,
  VISITOR_ROW_POLICIES,
  contentTableRole,
  contentTablesByKey,
  isContentPostsTable,
} from '../../src/utils/content-tables'
import {
  CUSTOMER_RECORD_TABLES,
  PRIVATE_CUSTOMER_RECORD_TABLES,
  PUBLIC_FEED_TABLES,
} from '../../src/utils/table-access'

describe('content tables', () => {
  it('registers the Blog with its posts and comments tables', () => {
    expect(contentTablesByKey('blog')).toEqual({
      key: 'blog',
      posts: 'teleport_blog_posts',
      comments: 'teleport_blog_comments',
      pictureStandIn: true,
    })
    expect(CONTENT_POSTS_TABLES).toContain('teleport_blog_posts')
    expect(CONTENT_COMMENTS_TABLES).toContain('teleport_blog_comments')
  })

  it('registers the Help Center with an articles table and no comments', () => {
    expect(contentTablesByKey('help')).toEqual({
      key: 'help',
      posts: 'teleport_help_articles',
      comments: null,
      // Text articles: one without a picture shows none, not a grey stand-in.
      pictureStandIn: false,
    })
    expect(contentTableRole('teleport_help_articles')).toEqual({ key: 'help', role: 'posts' })
    expect(CONTENT_COMMENTS_TABLES).not.toContain('teleport_help_comments')
    expect(VISITOR_ROW_POLICIES.teleport_help_articles).toBe(CONTENT_POSTS_VISITOR_ROW_POLICY)
  })

  it('tells a content table apart from any other table, with its role', () => {
    expect(contentTableRole('teleport_blog_posts')).toEqual({ key: 'blog', role: 'posts' })
    expect(contentTableRole('teleport_blog_comments')).toEqual({ key: 'blog', role: 'comments' })
    expect(contentTableRole('teleport_products')).toBeNull()
    // A custom table named like a posts table is not one: the exact name decides.
    expect(contentTableRole('blog_posts')).toBeNull()
    expect(isContentPostsTable('teleport_blog_posts')).toBe(true)
    expect(isContentPostsTable('teleport_blog_comments')).toBe(false)
  })

  it('keeps every table name unique across presets and roles', () => {
    const names = CONTENT_TABLES.flatMap((tables) =>
      [tables.posts, tables.comments].filter((table): table is string => table !== null)
    )
    expect(new Set(names).size).toBe(names.length)
  })

  it('serves a visitor only published rows of every posts table, never the author email', () => {
    for (const table of CONTENT_POSTS_TABLES) {
      expect(VISITOR_ROW_POLICIES[table]).toBe(CONTENT_POSTS_VISITOR_ROW_POLICY)
    }
    expect(CONTENT_POSTS_VISITOR_ROW_POLICY.predicate).toBe("status = 'published'")
    expect(CONTENT_POSTS_VISITOR_ROW_POLICY.hiddenColumns).toEqual(['author_email', 'authorEmail'])
    expect(VISITOR_ROW_POLICIES.teleport_products.predicate).toBe("LOWER(TRIM(status)) = 'active'")
  })

  it('serves a visitor only the public side of the forum tables a page binds', () => {
    expect(VISITOR_ROW_POLICIES[FORUM_TABLES.communities]).toBe(
      FORUM_VISITOR_ROW_POLICIES[FORUM_TABLES.communities]
    )
    expect(FORUM_VISITOR_ROW_POLICIES[FORUM_TABLES.communities].predicate).toBe(
      "status = 'active' AND visibility <> 'private'"
    )
    // A topic of an archived community, or of one waiting for approval, is no visitor's. The
    // subquery qualifies its own columns: the predicate is appended to the topics table unaliased.
    expect(FORUM_VISITOR_ROW_POLICIES[FORUM_TABLES.topics].predicate).toBe(
      "status = 'published' AND community_visibility <> 'private' AND community_id IN (SELECT fc.id FROM teleport_forum_communities fc WHERE fc.status = 'active')"
    )
    expect(FORUM_VISITOR_ROW_POLICIES[FORUM_TABLES.replies].predicate).toBe("status = 'published'")
    expect(FORUM_VISITOR_ROW_POLICIES[FORUM_TABLES.profiles]).toEqual({
      predicate: "role <> 'banned'",
      hiddenColumns: [],
    })
    // Readable through a page's own bindings, so never a feed table (refused on the per-table route).
    for (const table of Object.values(FORUM_TABLES)) {
      expect(PUBLIC_FEED_TABLES).not.toHaveProperty(table)
    }
  })

  it('keeps a forum member’s own rows private: a browser never lists one', () => {
    expect(FORUM_PRIVATE_TABLES).toEqual([
      FORUM_TABLES.memberships,
      FORUM_TABLES.votes,
      FORUM_TABLES.reactions,
      FORUM_TABLES.reports,
      FORUM_TABLES.subscriptions,
      FORUM_TABLES.notifications,
      FORUM_TABLES.topicViews,
    ])
    for (const table of FORUM_PRIVATE_TABLES) {
      expect(CUSTOMER_RECORD_TABLES).toContain(table)
      expect(PRIVATE_CUSTOMER_RECORD_TABLES).toContain(table)
      expect(VISITOR_ROW_POLICIES).not.toHaveProperty(table)
    }
  })

  it('keeps every comments table a customer record: a browser never lists one', () => {
    for (const table of CONTENT_COMMENTS_TABLES) {
      expect(CUSTOMER_RECORD_TABLES).toContain(table)
    }
  })
})
