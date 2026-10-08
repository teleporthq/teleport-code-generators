import { ContentTables } from '@teleporthq/teleport-shared'
import { generateBlogPostTransformationCode } from '../src/transformations/blog-post'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'

/**
 * What a post without a picture carries to its card and post page. The Blog
 * shows the grey "No image" stand-in; the Help Center's articles are text, so
 * an article without a picture carries none and its card closes up (the card
 * draws the picture only when there is one). The editor reads the same
 * `ContentTables.pictureStandIn`, so the canvas and the site agree.
 */

const buildPost = (
  key: ContentTables.ContentPresetKey
): ((record: unknown) => Record<string, unknown>) => {
  const code =
    generateSharedTransformationCode() +
    '\n' +
    generateBlogPostTransformationCode({ tables: ContentTables.contentTablesByKey(key) })
  return new Function(code + '\nreturn buildBlogPost;')() as (
    record: unknown
  ) => Record<string, unknown>
}

const POST = { id: 'p1', title: 'Connect a domain', slug: 'connect-a-domain', status: 'published' }
const DEFAULT_PICTURE = 'https://play.teleporthq.io/static/svg/default-img.svg'

describe('a post without a picture', () => {
  it('gets the grey stand-in on the Blog', () => {
    expect(buildPost('blog')(POST).featuredImageUrl).toMatch(/^data:image\/svg\+xml/)
  })

  it('carries none in the Help Center, so its card closes up', () => {
    expect(buildPost('help')(POST).featuredImageUrl).toBeNull()
  })

  it('counts the platform default picture as none', () => {
    const record = { ...POST, featured_image_url: DEFAULT_PICTURE }
    expect(buildPost('help')(record).featuredImageUrl).toBeNull()
    expect(buildPost('blog')(record).featuredImageUrl).toMatch(/^data:image\/svg\+xml/)
  })

  it('keeps a picture of its own in both', () => {
    const record = { ...POST, featured_image_url: 'https://cdn.example.com/domains.png' }
    expect(buildPost('help')(record).featuredImageUrl).toBe('https://cdn.example.com/domains.png')
    expect(buildPost('blog')(record).featuredImageUrl).toBe('https://cdn.example.com/domains.png')
  })
})
