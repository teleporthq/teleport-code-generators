import { generateBlogPostTransformationCode } from '../src/transformations/blog-post'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'
import { buildProductTransformOptions, getTransformationCode } from '../src/transformations'
import type { UIDLBlogSettings, UIDLEcommerceCategory } from '@teleporthq/teleport-types'

/**
 * A blog post's assigned categories are resolved AT REQUEST TIME against a
 * taxonomy baked into the generated fetcher — there is no DB table for it, it
 * lives only in `blogSettings.categories`. The post-details BREADCRUMBS map over
 * the resulting `categories` array and gate each crumb on it, so a post whose
 * ids resolve to nothing renders no crumbs at all.
 *
 * The editor produces the same array through `resolveAssignedCategories`
 * (teleport-gui `features/shared/taxonomy/category-tree.ts`); a difference
 * between the two is a canvas that shows crumbs the deployed blog does not.
 */

const category = (
  id: string,
  name: string,
  slug: string,
  children: UIDLEcommerceCategory[] = [],
  translations?: UIDLEcommerceCategory['translations']
): UIDLEcommerceCategory => ({
  id,
  name,
  slug,
  parentId: null,
  order: 0,
  children,
  ...(translations ? { translations } : {}),
})

const TAXONOMY: UIDLEcommerceCategory[] = [
  category('news', 'News', 'news', [
    { ...category('releases', 'Releases', 'releases'), parentId: 'news' },
  ]),
  category('guides', 'Guides', 'guides', [], { fr: { name: 'Guides FR' } }),
]

const buildPost = (
  categories: UIDLEcommerceCategory[] | undefined
): ((record: unknown, options?: unknown) => Record<string, unknown>) => {
  const code =
    generateSharedTransformationCode() + '\n' + generateBlogPostTransformationCode({ categories })
  return new Function(code + '\nreturn buildBlogPost;')() as (
    record: unknown,
    options?: unknown
  ) => Record<string, unknown>
}

const POST = { id: 'p1', title: 'T', slug: 't', status: 'published' }

describe('blog post transform — assigned categories', () => {
  it('resolves category_ids to {id,name,slug}, in the order they were assigned', () => {
    const post = buildPost(TAXONOMY)({
      ...POST,
      category_ids: JSON.stringify(['releases', 'guides']),
    })
    expect(post.categories).toEqual([
      { id: 'releases', name: 'Releases', slug: 'releases' },
      { id: 'guides', name: 'Guides', slug: 'guides' },
    ])
  })

  it('drops ids that resolve to nothing — a deleted category leaves no ghost crumb', () => {
    const post = buildPost(TAXONOMY)({
      ...POST,
      category_ids: JSON.stringify(['gone', 'news']),
    })
    expect(post.categories).toEqual([{ id: 'news', name: 'News', slug: 'news' }])
  })

  it('is empty (never undefined) for a post that names no category at all', () => {
    expect(buildPost(TAXONOMY)({ ...POST, category_ids: null }).categories).toEqual([])
    expect(buildPost(TAXONOMY)(POST).categories).toEqual([])
    expect(
      buildPost(undefined)({ ...POST, category_ids: JSON.stringify(['news']) }).categories
    ).toEqual([])
  })

  it('falls back to the row’s own NAME when it has no resolvable ids', () => {
    // ⛔ A row written before `category_ids` existed still carries `category`.
    // Templates iterate `categories` now, so without this the card and the post
    // header go blank exactly where a bound text used to be. The id is EMPTY, so
    // a filter link built from it carries no value — which every listing reads
    // as "no filter" — rather than pointing at a category that does not exist.
    const legacy = buildPost(TAXONOMY)({ ...POST, category_ids: null, category: 'Old News' })
    expect(legacy.categories).toEqual([{ id: '', name: 'Old News', slug: 'old-news' }])

    // A row with real ids never reaches the fallback.
    const modern = buildPost(TAXONOMY)({
      ...POST,
      category: 'Old News',
      category_ids: JSON.stringify(['news']),
    })
    expect(modern.categories).toEqual([{ id: 'news', name: 'News', slug: 'news' }])
  })

  it('localizes the NAME per request and leaves id/slug language-neutral', () => {
    const post = buildPost(TAXONOMY)(
      { ...POST, category_ids: JSON.stringify(['guides']) },
      { currentLanguage: 'fr', mainLanguage: 'en' }
    )
    expect(post.categories).toEqual([{ id: 'guides', name: 'Guides FR', slug: 'guides' }])
  })

  it('keeps `category` as the denormalized primary NAME beside the resolved array', () => {
    const post = buildPost(TAXONOMY)({
      ...POST,
      category: 'News',
      category_ids: JSON.stringify(['news']),
    })
    expect(post.category).toBe('News')
    expect(post.categories).toHaveLength(1)
  })
})

describe('blog taxonomy plumbing', () => {
  it('routes blogSettings.categories into the blog-post fetcher, not the product one', () => {
    const options = buildProductTransformOptions({
      blogSettings: { categories: TAXONOMY } as UIDLBlogSettings,
    })
    expect(options.blogCategories).toBe(TAXONOMY)
    expect(options.categories).toBeUndefined()

    const code = getTransformationCode('teleport_blog_posts', options)
    expect(code).toContain('var BLOG_CATEGORIES_BY_ID = ')
    expect(code).toContain('"releases"')
  })
})
