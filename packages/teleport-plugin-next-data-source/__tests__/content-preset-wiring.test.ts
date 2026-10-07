import { ContentTables, TableAccess } from '@teleporthq/teleport-shared'
import {
  BROWSER_READABLE_TABLES,
  BROWSER_ROW_POLICIES as DATA_API_ROW_POLICIES,
} from '../../teleport-plugin-next-workflows/src/data-api-route-generator'
import {
  BROWSER_ROW_POLICIES,
  isViewDependentTable,
} from '../src/fetchers/utils/browser-row-policy'
import { detectTransformationType, getTransformationCode } from '../src/transformations'

/**
 * Every content preset in the registry is wired through every generator that
 * tells a content table apart from a custom one. A preset registered in
 * teleport-shared but unknown to one of these would publish its drafts, or
 * serve its rows raw — so each check runs per preset, and a new one fails
 * here before it fails on a site.
 */
describe('content preset wiring in the generators', () => {
  it.each(ContentTables.CONTENT_TABLES.map((tables) => [tables.key, tables]))(
    'the "%s" preset is recognised everywhere',
    (_key, tables: ContentTables.ContentTables) => {
      // Visitors are served published rows only, through both route families.
      expect(BROWSER_ROW_POLICIES[tables.posts]).toBe(
        ContentTables.CONTENT_POSTS_VISITOR_ROW_POLICY
      )
      expect(DATA_API_ROW_POLICIES[tables.posts]).toBe(
        ContentTables.CONTENT_POSTS_VISITOR_ROW_POLICY
      )
      expect(BROWSER_READABLE_TABLES).toContain(tables.posts)
      expect(isViewDependentTable(tables.posts, TableAccess.PROTECTED_TABLES)).toBe(true)

      // The rows go through the post view model, whose SQL names THIS preset's tables.
      expect(detectTransformationType(tables.posts)).toBe('blog-post')
      expect(detectTransformationType(`public.${tables.posts}`)).toBe('blog-post')
      const code = getTransformationCode(tables.posts)
      expect(code).toContain(`SELECT * FROM ${tables.posts} WHERE id = ANY($1)`)
      expect(code).toContain(`SELECT p.* FROM ${tables.posts} p,`)
      if (tables.comments) {
        expect(code).toContain(`FROM ${tables.comments} c`)
        // A browser never lists comments: the table carries the commenters' emails.
        expect(TableAccess.CUSTOMER_RECORD_TABLES).toContain(tables.comments)
        expect(BROWSER_READABLE_TABLES).not.toContain(tables.comments)
      }
    }
  )

  it('leaves a custom table that only sounds like posts alone', () => {
    expect(detectTransformationType('blog_posts')).toBeNull()
    expect(BROWSER_ROW_POLICIES.blog_posts).toBeUndefined()
    expect(BROWSER_READABLE_TABLES).not.toContain('blog_posts')
  })
})
