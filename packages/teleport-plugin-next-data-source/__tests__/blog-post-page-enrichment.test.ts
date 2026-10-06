import { generateBlogPostTransformationCode } from '../src/transformations/blog-post'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'
import { buildProductTransformOptions, getTransformWrapperCode } from '../src/transformations'

/**
 * What a blog post DETAILS page carries beyond the row: the author's bio and
 * initials, its approved comments, its previous / next neighbours, and — when
 * the blog asks for it — anchors on its content headings.
 *
 * These evaluate the EMITTED code, the way the runtime does.
 */

type Build = (record: unknown, options?: Record<string, unknown>) => Record<string, unknown>

const evalExport = <T>(code: string, exportName: string): T =>
  new Function(generateSharedTransformationCode() + '\n' + code + `\nreturn ${exportName};`)() as T

const buildWith = (options: { headingAnchors?: boolean } = {}): Build =>
  evalExport<Build>(generateBlogPostTransformationCode(options), 'buildBlogPost')

const buildBlogPost = buildWith()

const post = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Post ${id}`,
  slug: `post-${id}`,
  status: 'published',
  ...overrides,
})

describe('blog post transform — author box fields', () => {
  it('keeps the author email out of the post a page is given, under both spellings', () => {
    const built = buildBlogPost(
      post('a', { author_name: 'Ana', author_email: 'ana@example.com' })
    ) as Record<string, unknown>
    expect(built.authorName).toBe('Ana')
    expect('authorEmail' in built).toBe(false)
    expect('author_email' in built).toBe(false)
    expect(JSON.stringify(built)).not.toContain('ana@example.com')
  })

  it('resolves the bio in the request language, falling back to the main one', () => {
    const record = post('a', {
      author_bio: 'Writes about tea.',
      es_author_bio: 'Escribe sobre té.',
    })
    expect(buildBlogPost(record).authorBio).toBe('Writes about tea.')
    expect(buildBlogPost(record, { currentLanguage: 'es', mainLanguage: 'en' }).authorBio).toBe(
      'Escribe sobre té.'
    )
    expect(
      buildBlogPost(post('b', { author_bio: 'Only English.' }), {
        currentLanguage: 'es',
        mainLanguage: 'en',
      }).authorBio
    ).toBe('Only English.')
  })

  it('reads a missing bio as null', () => {
    expect(buildBlogPost(post('a')).authorBio).toBeNull()
  })

  it('derives initials from the first and last word of the author name', () => {
    expect(buildBlogPost(post('a', { author_name: 'ada  king lovelace' })).authorInitials).toBe(
      'AL'
    )
    expect(buildBlogPost(post('a', { author_name: 'Plato' })).authorInitials).toBe('P')
    expect(buildBlogPost(post('a')).authorInitials).toBe('')
  })
})

describe('blog post transform — comments', () => {
  const comment = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    parent_id: null as string | null,
    author_name: `Reader ${id}`,
    content: `Comment ${id}`,
    is_author_reply: false,
    created_at: '2026-09-01T10:00:00.000Z',
    ...overrides,
  })

  it('emits empty comments on a fetch that did not ask for them', () => {
    const built = buildBlogPost(post('a'))
    expect(built.comments).toEqual([])
    expect(built.commentsCount).toBe(0)
  })

  it('nests replies under the comment they answer, in the order given', () => {
    const built = buildBlogPost(post('a'), {
      commentsByPostId: {
        a: {
          count: 4,
          rows: [
            comment('c1', { author_name: 'Grace Hopper' }),
            comment('c2'),
            comment('r1', { parent_id: 'c1', is_author_reply: true }),
            comment('r2', { parent_id: 'c1' }),
          ],
        },
      },
    })

    const comments = built.comments as Array<Record<string, unknown>>
    expect(comments.map((entry) => entry.id)).toEqual(['c1', 'c2'])
    expect(comments[0]).toMatchObject({
      authorName: 'Grace Hopper',
      authorInitials: 'GH',
      content: 'Comment c1',
      isAuthorReply: false,
      createdAt: Date.parse('2026-09-01T10:00:00.000Z'),
    })
    const replies = comments[0].replies as Array<Record<string, unknown>>
    expect(replies.map((entry) => entry.id)).toEqual(['r1', 'r2'])
    expect(replies[0].isAuthorReply).toBe(true)
    expect(replies[0]).not.toHaveProperty('replies')
    expect(comments[1].replies).toEqual([])
    expect(built.commentsCount).toBe(4)
  })

  it('drops a reply whose comment is not among the rows', () => {
    const built = buildBlogPost(post('a'), {
      commentsByPostId: { a: { count: 1, rows: [comment('r1', { parent_id: 'gone' })] } },
    })
    expect(built.comments).toEqual([])
  })

  it('never hands the related or adjacent cards comments of their own', () => {
    const built = buildBlogPost(post('a', { related_post_ids: '["b"]' }), {
      relatedPostsById: { b: post('b') },
      commentsByPostId: {
        a: { count: 1, rows: [comment('c1')] },
        b: { count: 1, rows: [comment('c9')] },
      },
    })
    const related = built.relatedPosts as Array<Record<string, unknown>>
    expect(related[0].comments).toEqual([])
  })
})

describe('blog post transform — previous / next', () => {
  it('emits 0-or-1-item lists of transformed posts', () => {
    const built = buildBlogPost(post('b'), {
      adjacentPostsById: { b: { previous: post('a', { title: 'Older' }), next: null } },
    })
    const previous = built.previousPosts as Array<Record<string, unknown>>
    expect(previous).toHaveLength(1)
    expect(previous[0]).toMatchObject({ id: 'a', title: 'Older', slug: 'post-a' })
    expect(built.nextPosts).toEqual([])
  })

  it('emits empty lists when nothing was looked up', () => {
    const built = buildBlogPost(post('b'))
    expect(built.previousPosts).toEqual([])
    expect(built.nextPosts).toEqual([])
  })
})

describe('blog post transform — heading anchors', () => {
  it('leaves content alone unless the blog asks for anchors', () => {
    const content = '<h2>Setup</h2><p>Text</p>'
    expect(buildBlogPost(post('a', { content })).content).toBe(content)
  })

  it('gives every h2-h6 a unique id and a hidden # link, keeping ids it already has', () => {
    const built = buildWith({ headingAnchors: true })(
      post('a', {
        content:
          '<h1>Title</h1><h2>Getting Started</h2><h3 class="x" id="custom">Café &amp; Crème</h3>' +
          '<h2>Getting started</h2><h4><br></h4><h2 id="getting-started-2">Clash</h2>',
      })
    )
    expect(built.content).toBe(
      '<h1>Title</h1>' +
        '<h2 id="getting-started">Getting Started<a class="tq-heading-anchor" href="#getting-started" aria-hidden="true" tabindex="-1">#</a></h2>' +
        '<h3 class="x" id="custom">Café &amp; Crème<a class="tq-heading-anchor" href="#custom" aria-hidden="true" tabindex="-1">#</a></h3>' +
        '<h2 id="getting-started-3">Getting started<a class="tq-heading-anchor" href="#getting-started-3" aria-hidden="true" tabindex="-1">#</a></h2>' +
        '<h4><br></h4>' +
        '<h2 id="getting-started-2">Clash<a class="tq-heading-anchor" href="#getting-started-2" aria-hidden="true" tabindex="-1">#</a></h2>'
    )
  })

  it('slugs accented and non-Latin text instead of dropping it', () => {
    const built = buildWith({ headingAnchors: true })(
      post('a', { content: '<h2>Crème brûlée</h2><h2>Привет мир</h2><h2>!!!</h2>' })
    )
    expect(built.content).toContain('id="creme-brulee"')
    expect(built.content).toContain('id="привет-мир"')
    expect(built.content).toContain('id="section"')
  })

  it('is idempotent', () => {
    const build = buildWith({ headingAnchors: true })
    const once = build(post('a', { content: '<h2>Setup</h2>' })).content as string
    expect(build(post('a', { content: once })).content).toBe(once)
  })
})

describe('transform wrapper — post page lookups', () => {
  it('asks for the neighbours on every blog fetch, and for comments only when the blog takes them', () => {
    const withoutComments = getTransformWrapperCode('teleport_blog_posts')
    expect(withoutComments).toContain('getAdjacentPostsMap(getClientFn, records)')
    expect(withoutComments).not.toContain('getBlogCommentsMap(getClientFn, records)')
    expect(withoutComments).toContain('commentsByPostId: commentsByPostId')

    const withComments = getTransformWrapperCode('teleport_blog_posts', { blogComments: true })
    expect(withComments).toContain('getBlogCommentsMap(getClientFn, records)')
  })

  it('never asks for them on another table', () => {
    const products = getTransformWrapperCode('teleport_products', { blogComments: true })
    expect(products).not.toContain('getAdjacentPostsMap')
    expect(products).not.toContain('getBlogCommentsMap')
  })

  it('reads both switches off the blog settings', () => {
    const options = buildProductTransformOptions({
      blogSettings: { categories: [], headingAnchors: true, comments: true },
    })
    expect(options.blogHeadingAnchors).toBe(true)
    expect(options.blogComments).toBe(true)
    expect(buildProductTransformOptions({}).blogComments).toBe(false)
  })
})
