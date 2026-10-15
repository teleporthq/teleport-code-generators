import { ContentTables, TableAccess } from '@teleporthq/teleport-shared'
import {
  BROWSER_READABLE_TABLES,
  BROWSER_ROW_POLICIES as DATA_API_ROW_POLICIES,
} from '../../teleport-plugin-next-workflows/src/data-api-route-generator'
import {
  BROWSER_ROW_POLICIES,
  isViewDependentTable,
} from '../src/fetchers/utils/browser-row-policy'
import {
  buildProductTransformOptions,
  contentSettingsFor,
  detectTransformationType,
  getTransformWrapperCode,
  getTransformationCode,
} from '../src/transformations'
import { generateBlogContextFileContent } from '../../teleport-project-generator-next/src/blog/blog-context-generator'

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

  it('bakes each preset\u2019s own settings into its transform, never another\u2019s', () => {
    const blogTaxonomy = [{ id: 'b1', name: 'Blog cat', slug: 'blog-cat' }]
    const helpTaxonomy = [{ id: 'h1', name: 'Help cat', slug: 'help-cat' }]
    const options = buildProductTransformOptions({
      blogSettings: { categories: blogTaxonomy as never, headingAnchors: false, comments: true },
      helpCenterSettings: {
        categories: helpTaxonomy as never,
        headingAnchors: true,
        comments: false,
      },
    })
    expect(contentSettingsFor(options, 'teleport_blog_posts')).toEqual({
      categories: blogTaxonomy,
      headingAnchors: false,
      comments: true,
    })
    expect(contentSettingsFor(options, 'teleport_help_articles')).toEqual({
      categories: helpTaxonomy,
      headingAnchors: true,
      comments: false,
    })
    expect(contentSettingsFor(options, 'teleport_products')).toEqual({})
    // The Blog's legacy fields still answer for a caller that set only them.
    expect(contentSettingsFor({ blogComments: true }, 'teleport_blog_posts').comments).toBe(true)

    // The article transform carries the Help Center's taxonomy and anchors, not the Blog's.
    const helpCode = getTransformationCode('teleport_help_articles', options)
    expect(helpCode).toContain('Help cat')
    expect(helpCode).not.toContain('Blog cat')
    expect(helpCode).toContain('var BLOG_HEADING_ANCHORS = true')
    // Comments are a Blog feature: the article wrapper never queries a comments table.
    expect(getTransformWrapperCode('teleport_help_articles', options)).not.toContain(
      'getBlogCommentsMap('
    )
    expect(getTransformWrapperCode('teleport_blog_posts', options)).toContain('getBlogCommentsMap(')
  })

  it('exposes both taxonomies from the one generated context module', () => {
    const code = generateBlogContextFileContent(
      { categories: [{ id: 'b1', name: 'Blog cat', slug: 'blog-cat' }] as never },
      { categories: [{ id: 'h1', name: 'Help cat', slug: 'help-cat' }] as never }
    )
    expect(code).toContain('const BLOG_CATEGORIES = [{"id":"b1"')
    expect(code).toContain('const HELP_CATEGORIES = [{"id":"h1"')
    expect(code).toContain('export const useBlogCategories = ()')
    expect(code).toContain('export const useHelpCategories = ()')
  })
})
