import {
  CONTENT_COMMENTS_TABLES,
  CONTENT_POSTS_TABLES,
  CONTENT_POSTS_VISITOR_ROW_POLICY,
  CONTENT_TABLES,
  VISITOR_ROW_POLICIES,
  contentTableRole,
  contentTablesByKey,
  isContentPostsTable,
} from '../../src/utils/content-tables'
import { CUSTOMER_RECORD_TABLES } from '../../src/utils/table-access'

describe('content tables', () => {
  it('registers the Blog with its posts and comments tables', () => {
    expect(contentTablesByKey('blog')).toEqual({
      key: 'blog',
      posts: 'teleport_blog_posts',
      comments: 'teleport_blog_comments',
    })
    expect(CONTENT_POSTS_TABLES).toContain('teleport_blog_posts')
    expect(CONTENT_COMMENTS_TABLES).toContain('teleport_blog_comments')
  })

  it('registers the Help Center with an articles table and no comments', () => {
    expect(contentTablesByKey('help')).toEqual({
      key: 'help',
      posts: 'teleport_help_articles',
      comments: null,
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

  it('keeps every comments table a customer record: a browser never lists one', () => {
    for (const table of CONTENT_COMMENTS_TABLES) {
      expect(CUSTOMER_RECORD_TABLES).toContain(table)
    }
  })
})
