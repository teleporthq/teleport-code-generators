import { generateBlogPostTransformationCode } from '../src/transformations/blog-post'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'

/**
 * What the post page's head, structured data and "Updated on" line read from
 * a post: meta fields that always have a value, dates as ISO strings, a
 * sharing picture only when the post has one of its own, the slug per
 * locale, the FAQ pairs of the body, and one H1 at most on the page.
 */

const buildPost = (
  options: Parameters<typeof generateBlogPostTransformationCode>[0] = {}
): ((record: unknown, callOptions?: unknown) => Record<string, unknown>) => {
  const code =
    generateSharedTransformationCode() + '\n' + generateBlogPostTransformationCode(options)
  return new Function(code + '\nreturn buildBlogPost;')() as (
    record: unknown,
    callOptions?: unknown
  ) => Record<string, unknown>
}

const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(' ')
const POST = { id: 'p1', title: 'Connect a domain', slug: 'connect-a-domain', status: 'published' }

describe('meta fields always have a value', () => {
  it('falls back to the title, the excerpt, then the opening of the body', () => {
    expect(buildPost()({ ...POST, meta_title: ' Own title ' }).metaTitle).toBe(' Own title ')
    expect(buildPost()({ ...POST }).metaTitle).toBe('Connect a domain')
    expect(buildPost()({ ...POST, excerpt: 'Short summary.' }).metaDescription).toBe(
      'Short summary.'
    )
    const fromBody = buildPost()({ ...POST, content: `<p>${words(60)}</p>` })
      .metaDescription as string
    expect(fromBody.length).toBeLessThanOrEqual(155)
    expect(fromBody).toMatch(/^word0 word1/)
    expect(fromBody.split(' ').every((word) => /^word\d+$/.test(word))).toBe(true)
    expect(buildPost()({ ...POST }).metaDescription).toBeNull()
  })
})

describe('dates and the updated line', () => {
  it('gives ISO dates and shows "updated" only a day after publishing', () => {
    const post = buildPost()({
      ...POST,
      published_at: '2026-03-01T10:00:00.000Z',
      updated_at: '2026-03-03T10:00:00.000Z',
    })
    expect(post.publishedAtIso).toBe('2026-03-01T10:00:00.000Z')
    expect(post.updatedAtIso).toBe('2026-03-03T10:00:00.000Z')
    expect(post.updatedAfterPublishIso).toBe('2026-03-03T10:00:00.000Z')
    const fresh = buildPost()({
      ...POST,
      published_at: '2026-03-01T10:00:00.000Z',
      updated_at: '2026-03-01T20:00:00.000Z',
    })
    expect(fresh.updatedAfterPublishIso).toBeNull()
    expect(buildPost()({ ...POST, status: 'draft' }).publishedAtIso).toBeNull()
  })
})

describe('what the head shares', () => {
  it('shares the post picture only when it has one of its own', () => {
    expect(buildPost()({ ...POST, featured_image_url: 'https://cdn/x.jpg' }).socialImageUrl).toBe(
      'https://cdn/x.jpg'
    )
    const standIn = buildPost()({ ...POST })
    expect(String(standIn.featuredImageUrl)).toMatch(/^data:image/)
    expect(standIn.socialImageUrl).toBeNull()
  })

  it('counts the words, joins the tags and names the primary category', () => {
    const post = buildPost({
      categories: [{ id: 'c1', name: 'Guides', slug: 'guides' } as never],
    })({
      ...POST,
      content: `<h2>Steps</h2><p>${words(40)}</p>`,
      tags: JSON.stringify(['dns', 'hosting']),
      category_ids: JSON.stringify(['c1']),
    })
    expect(post.wordCount).toBe(41)
    expect(post.tagsText).toBe('dns, hosting')
    expect(post.categoryName).toBe('Guides')
    expect(post.categorySlug).toBe('guides')
    expect(buildPost()({ ...POST }).tagsText).toBeNull()
    expect(buildPost()({ ...POST }).categorySlug).toBeNull()
  })

  it('names the slug per locale from the translated columns', () => {
    const post = buildPost({ locales: ['en', 'ro', 'de'] })(
      { ...POST, ro_slug: 'conecteaza-un-domeniu', de_slug: '' },
      { mainLanguage: 'en', currentLanguage: 'ro' }
    )
    expect(post.slugByLocale).toEqual({ en: 'connect-a-domain', ro: 'conecteaza-un-domeniu' })
    expect(buildPost()({ ...POST }).slugByLocale).toEqual({})
  })
})

describe('the body on the page', () => {
  it('reads the FAQ pairs out of the body, text only', () => {
    const post = buildPost()({
      ...POST,
      content:
        '<p>Intro</p><section class="tq-faq"><h2>FAQ</h2>' +
        '<details><summary>Is it <em>free</em>?</summary><p>Yes, <a href="/x">mostly</a>.</p></details>' +
        '<details><summary>How long?</summary><p>A day.</p><p>Sometimes two.</p></details>' +
        '<details><summary></summary><p>No question.</p></details>' +
        '</section>',
    })
    expect(post.faq).toEqual([
      { question: 'Is it free?', answer: 'Yes, mostly.' },
      { question: 'How long?', answer: 'A day. Sometimes two.' },
    ])
    expect(buildPost()({ ...POST, content: '<p>No faq</p>' }).faq).toEqual([])
  })

  it('demotes a body H1 to an H2: the page title is the one H1', () => {
    const post = buildPost({ contents: true })(
      { ...POST, content: '<h1 class="x">Top</h1><p>a</p><h2>Next</h2>' },
      { details: true }
    )
    expect(post.content).toMatch(/<h2 id="top" class="x">Top<\/h2>/)
    expect(post.content).not.toMatch(/<h1[\s>]/)
  })
})
