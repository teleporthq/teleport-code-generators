import { generateCustomPageTransformationCode } from '../src/transformations/custom-page'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'
import {
  detectTransformationType,
  getTransformExpression,
  getTransformWrapperCode,
} from '../src/transformations'

// The `teleport_pages` transform is what lets a custom page's <Head> bind its
// SEO with plain `??` fallbacks, and what lets getStaticProps answer the row's
// own redirect — every field it emits is read by generated code somewhere. So
// these evaluate the EMITTED code, the same way the runtime does.

type Build = (record: unknown, options?: Record<string, unknown>) => Record<string, unknown>

const evalTransform = (): Build => {
  const bundle = generateSharedTransformationCode() + '\n' + generateCustomPageTransformationCode()
  return new Function(bundle + '\nreturn buildCustomPage;')() as Build
}

const buildCustomPage = evalTransform()

const page = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  title: 'About us',
  slug: 'about-us',
  status: 'published',
  blocks: '[{"id":"b1","component":"tq:heading","props":{"text":"Hi"}}]',
  ...overrides,
})

describe('custom page transform — the row itself', () => {
  it('keeps every stored column, the blocks column above all', () => {
    const built = buildCustomPage(page({ extra_column: 'kept' }))
    expect(built.blocks).toBe('[{"id":"b1","component":"tq:heading","props":{"text":"Hi"}}]')
    expect(built.slug).toBe('about-us')
    expect(built.extra_column).toBe('kept')
  })

  it('is routed for the platform pages table only', () => {
    expect(detectTransformationType('teleport_pages')).toBe('custom-page')
    expect(detectTransformationType('public.TELEPORT_PAGES')).toBe('custom-page')
    expect(detectTransformationType('pages')).toBeNull()
    expect(detectTransformationType('my_pages')).toBeNull()
    expect(getTransformExpression('teleport_pages')).toContain('transformRecords')
  })

  it('wraps the transform without the related-items or variant enrichment', () => {
    const wrapper = getTransformWrapperCode('teleport_pages')
    expect(wrapper).toContain('transformCustomPages(records, options)')
    expect(wrapper).not.toContain('relatedPostsById')
    expect(wrapper).not.toContain('relatedProductsById')
    expect(wrapper).not.toContain('variantsByProductId')
  })
})

describe('custom page transform — the meta pair', () => {
  it('falls the meta title back to the page title, and trims what was typed', () => {
    expect(buildCustomPage(page()).metaTitle).toBe('About us')
    expect(buildCustomPage(page({ meta_title: '  Our story  ' })).metaTitle).toBe('Our story')
    expect(buildCustomPage(page({ meta_title: '   ' })).metaTitle).toBe('About us')
  })

  it('emits null for an unset description so the page-level value inherits', () => {
    expect(buildCustomPage(page()).metaDescription).toBeNull()
    expect(buildCustomPage(page({ meta_description: ' A page. ' })).metaDescription).toBe('A page.')
  })
})

describe('custom page transform — robots, canonical, redirect', () => {
  it('emits robotsContent as "noindex" or NULL, never "" or false', () => {
    expect(buildCustomPage(page()).robotsContent).toBeNull()
    expect(buildCustomPage(page({ no_index: false })).robotsContent).toBeNull()
    expect(buildCustomPage(page({ no_index: true })).robotsContent).toBe('noindex')
    expect(buildCustomPage(page({ no_index: 'true' })).robotsContent).toBe('noindex')
  })

  it('normalises the canonical URL', () => {
    expect(buildCustomPage(page()).canonicalUrl).toBeNull()
    expect(buildCustomPage(page({ canonical_url: ' https://x.io/a ' })).canonicalUrl).toBe(
      'https://x.io/a'
    )
  })

  it('keeps a redirect type only beside a real destination, and only 301/302', () => {
    expect(buildCustomPage(page({ redirect_type: '301' })).redirectType).toBeNull()
    expect(buildCustomPage(page({ redirect_url: '/new', redirect_type: '302' }))).toMatchObject({
      redirectUrl: '/new',
      redirectType: '302',
    })
    expect(
      buildCustomPage(page({ redirect_url: '/new', redirect_type: '307' })).redirectType
    ).toBeNull()
    expect(buildCustomPage(page({ redirect_url: '   ' })).redirectUrl).toBeNull()
  })
})

describe('custom page transform — Open Graph', () => {
  it('falls og title/description back to the meta pair', () => {
    const built = buildCustomPage(page({ meta_description: 'Meta' }))
    expect(built.ogTitle).toBe('About us')
    expect(built.ogDescription).toBe('Meta')

    const own = buildCustomPage(page({ og_title: 'Share me', og_description: 'Shared' }))
    expect(own.ogTitle).toBe('Share me')
    expect(own.ogDescription).toBe('Shared')
  })

  it('resolves an asset id to its URL and passes a plain URL through', () => {
    const assetMap = { TQ_asset1: { remoteSrc: 'https://cdn.example/a.png' } }
    expect(buildCustomPage(page({ og_image: 'TQ_asset1' }), { assetMap }).ogImage).toBe(
      'https://cdn.example/a.png'
    )
    expect(buildCustomPage(page({ og_image: 'https://x.io/b.png' }), { assetMap }).ogImage).toBe(
      'https://x.io/b.png'
    )
    expect(buildCustomPage(page()).ogImage).toBeNull()
  })
})
