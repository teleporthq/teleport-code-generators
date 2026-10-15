import { generateBlogPostTransformationCode } from '../src/transformations/blog-post'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'

/**
 * A post that stores no reading time gets one from its body — its words at
 * about 200 a minute, at least one, as the editor's post form computes it —
 * so a card or post page never prints "min read" with no number before it.
 * The SAME cases as teleport-gui `packages/renderer/src/utils/__tests__/
 * blog-reading-time.test.ts`: the canvas and the site must agree.
 */

const buildPost = (headingAnchors = false): ((record: unknown) => Record<string, unknown>) => {
  const code =
    generateSharedTransformationCode() +
    '\n' +
    generateBlogPostTransformationCode({ headingAnchors })
  return new Function(code + '\nreturn buildBlogPost;')() as (
    record: unknown
  ) => Record<string, unknown>
}

const words = (count: number) => `<p>${Array.from({ length: count }, () => 'word').join(' ')}</p>`
const POST = { id: 'p1', title: 'Connect a domain', slug: 'connect-a-domain', status: 'published' }

describe('a post’s reading time', () => {
  it('is the one the post stores', () => {
    expect(
      buildPost()({ ...POST, reading_time_minutes: 7, content: words(401) }).readingTimeMinutes
    ).toBe(7)
  })

  it('comes from the body when the post stores none', () => {
    expect(buildPost()({ ...POST, content: words(401) }).readingTimeMinutes).toBe(3)
    expect(
      buildPost()({ ...POST, reading_time_minutes: null, content: words(12) }).readingTimeMinutes
    ).toBe(1)
    expect(
      buildPost()({
        ...POST,
        content: '<h2>Steps</h2><ul><li>Open the panel</li><li>Click Save</li></ul>',
      }).readingTimeMinutes
    ).toBe(1)
  })

  it('counts the words, not the heading anchors a site adds', () => {
    const content = `<h2>One</h2>${words(399)}`
    expect(buildPost(true)({ ...POST, content }).readingTimeMinutes).toBe(2)
    expect(buildPost(false)({ ...POST, content }).readingTimeMinutes).toBe(2)
  })

  it('is none for a post with no body', () => {
    expect(buildPost()({ ...POST, content: '' }).readingTimeMinutes).toBeNull()
    expect(buildPost()({ ...POST, content: '<p> </p>' }).readingTimeMinutes).toBeNull()
  })
})
