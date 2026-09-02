import { generateEcommerceProductTransformationCode } from '../src/transformations/ecommerce-product'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'

// A product's optional 3D model. The transform must hand the storefront
// resolved URLs, STRING gates ('true' / 'false' — the builders compare with
// `=`/`!=`, so an absent field reads as the IMAGE branch), and the gallery as
// media entries in display order. MUST stay in sync with the renderer mirror
// (packages/renderer/src/utils/ecommerce-products.ts) and the GUI's
// `PRODUCT_PROP_DEFAULT` — see the GUI-side specs.

type Product = Record<string, unknown> & {
  galleryMedia: Array<{ kind: string; src: string; poster: string; thumbnail: string; alt: string }>
  galleryThumbnails: Array<{ kind: string; src: string }>
}

const evalBuildProduct = (): ((record: unknown, options?: unknown) => Product) => {
  const code =
    generateSharedTransformationCode() + '\n' + generateEcommerceProductTransformationCode()
  const fn = new Function(code + '\nreturn buildEcommerceProduct;')
  return fn() as (record: unknown, options?: unknown) => Product
}

const ASSET_MAP = {
  TQ_model: { remoteSrc: 'https://storage.example.com/p/model.glb' },
  TQ_poster: { remoteSrc: 'https://cdn.example.com/poster.png' },
  TQ_img1: { remoteSrc: 'https://cdn.example.com/img1.jpg' },
  TQ_img2: { remoteSrc: 'https://cdn.example.com/img2.jpg' },
}

const baseRecord = {
  id: 'p1',
  name: 'Chair',
  slug: 'chair',
  price: '10',
  currency: 'USD',
  image_url: 'TQ_img1',
  gallery_images: JSON.stringify(['TQ_img2']),
}

describe('ecommerce product transform — 3D model', () => {
  const buildEcommerceProduct = evalBuildProduct()
  const build = (record: Record<string, unknown>) =>
    buildEcommerceProduct(record, { assetMap: ASSET_MAP })

  it('emits the image branch for a product without a model', () => {
    const product = build(baseRecord)
    expect(product.modelUrl).toBeNull()
    expect(product.modelPoster).toBeNull()
    expect(product.hasModel).toBe('false')
    expect(product.showModel).toBe('false')
    expect(product.galleryMedia.map((m) => m.kind)).toEqual(['image', 'image'])
    expect(product.galleryThumbnails.map((m) => m.src)).toEqual([ASSET_MAP.TQ_img2.remoteSrc])
  })

  it('resolves the model and poster asset ids to URLs and shows the model by default', () => {
    const product = build({ ...baseRecord, model_url: 'TQ_model', model_poster_url: 'TQ_poster' })
    expect(product.modelUrl).toBe(ASSET_MAP.TQ_model.remoteSrc)
    expect(product.modelPoster).toBe(ASSET_MAP.TQ_poster.remoteSrc)
    expect(product.hasModel).toBe('true')
    // NULL / absent flag = ON
    expect(product.showModel).toBe('true')
    // hero first, then the images
    expect(product.galleryMedia.map((m) => m.kind)).toEqual(['model', 'image', 'image'])
    expect(product.galleryMedia[0]).toEqual({
      kind: 'model',
      src: ASSET_MAP.TQ_model.remoteSrc,
      poster: ASSET_MAP.TQ_poster.remoteSrc,
      thumbnail: ASSET_MAP.TQ_poster.remoteSrc,
      alt: 'Chair',
    })
    // the main image moves into the strip when the model is the hero
    expect(product.galleryThumbnails.map((m) => m.src)).toEqual([
      ASSET_MAP.TQ_img1.remoteSrc,
      ASSET_MAP.TQ_img2.remoteSrc,
    ])
  })

  it('keeps the image hero when the merchant switched the model off, with the model last', () => {
    const product = build({
      ...baseRecord,
      model_url: 'TQ_model',
      model_poster_url: 'TQ_poster',
      show_model_by_default: false,
    })
    expect(product.hasModel).toBe('true')
    expect(product.showModel).toBe('false')
    expect(product.galleryMedia.map((m) => m.kind)).toEqual(['image', 'image', 'model'])
    expect(product.galleryThumbnails.map((m) => m.kind)).toEqual(['image', 'model'])
    expect(product.galleryThumbnails[1].src).toBe(ASSET_MAP.TQ_model.remoteSrc)
  })

  it.each([
    [true, 'true'],
    [false, 'false'],
    [1, 'true'],
    [0, 'false'],
    ['true', 'true'],
    ['false', 'false'],
    ['t', 'true'],
    ['f', 'false'],
    ['1', 'true'],
    ['0', 'false'],
    [null, 'true'],
    [undefined, 'true'],
    ['', 'true'],
  ])('normalizes show_model_by_default = %p to showModel %s', (raw, expected) => {
    const product = build({ ...baseRecord, model_url: 'TQ_model', show_model_by_default: raw })
    expect(product.showModel).toBe(expected)
  })

  it('always shows the model when it is the only media, whatever the flag says', () => {
    const product = build({
      id: 'p2',
      name: 'Lamp',
      slug: 'lamp',
      price: '5',
      currency: 'USD',
      model_url: 'TQ_model',
      show_model_by_default: false,
    })
    expect(product.showModel).toBe('true')
    expect(product.galleryMedia).toHaveLength(1)
    expect(product.galleryThumbnails).toEqual([])
    // nothing to poster with — the viewer paints its transparent poster
    expect(product.modelPoster).toBeNull()
  })

  it('falls back to the main image as poster and thumbnail when the model has none', () => {
    const product = build({ ...baseRecord, model_url: 'TQ_model', show_model_by_default: false })
    expect(product.modelPoster).toBe(ASSET_MAP.TQ_img1.remoteSrc)
    const modelEntry = product.galleryMedia.find((m) => m.kind === 'model')
    expect(modelEntry?.poster).toBe(ASSET_MAP.TQ_img1.remoteSrc)
    expect(modelEntry?.thumbnail).toBe(ASSET_MAP.TQ_img1.remoteSrc)
  })

  it('treats an asset id the asset map cannot resolve as no model at all', () => {
    // resolveAssetUrl returns unknown ids verbatim; a bare 'TQ_…' must never
    // reach <model-viewer src>.
    const product = build({ ...baseRecord, model_url: 'TQ_deleted', model_poster_url: 'TQ_gone' })
    expect(product.modelUrl).toBeNull()
    expect(product.hasModel).toBe('false')
    expect(product.showModel).toBe('false')
    expect(product.galleryMedia.map((m) => m.kind)).toEqual(['image', 'image'])
  })

  it('drops a stale poster id but keeps the model', () => {
    const product = build({ ...baseRecord, model_url: 'TQ_model', model_poster_url: 'TQ_gone' })
    expect(product.modelUrl).toBe(ASSET_MAP.TQ_model.remoteSrc)
    expect(product.modelPoster).toBe(ASSET_MAP.TQ_img1.remoteSrc)
  })

  it('accepts raw URLs in the model columns', () => {
    const product = build({
      ...baseRecord,
      model_url: 'https://cdn.example.com/raw.glb',
      model_poster_url: '/local/poster.png',
    })
    expect(product.modelUrl).toBe('https://cdn.example.com/raw.glb')
    expect(product.modelPoster).toBe('/local/poster.png')
  })

  it('carries the model fields into related products', () => {
    const related = { ...baseRecord, id: 'p9', slug: 'chair-9', model_url: 'TQ_model' }
    const product = buildEcommerceProduct(
      { ...baseRecord, related_product_ids: JSON.stringify(['p9']) },
      { assetMap: ASSET_MAP, relatedProductsById: { p9: related } }
    )
    const relatedProducts = product.relatedProducts as Product[]
    expect(relatedProducts).toHaveLength(1)
    expect(relatedProducts[0].showModel).toBe('true')
    expect(relatedProducts[0].modelUrl).toBe(ASSET_MAP.TQ_model.remoteSrc)
  })

  it('uses the image alt for pictures and the product name for the model', () => {
    const product = build({ ...baseRecord, image_alt: 'A chair', model_url: 'TQ_model' })
    expect(product.galleryMedia[0].alt).toBe('Chair')
    expect(product.galleryMedia[1].alt).toBe('A chair')
  })
})
