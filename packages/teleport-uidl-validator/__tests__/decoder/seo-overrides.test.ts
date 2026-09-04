import { canonicalAssetDecoder, initialPropsDecoder } from '../../src/decoders/utils'

// The object decoders are strict whitelists: any key they do not declare is
// silently dropped from the decoded UIDL (and the decoded object REPLACES the
// input in the generation pipeline). These tests pin the two per-entity SEO
// fields so a decoder regression cannot silently disable the feature.

describe('canonicalAssetDecoder: per-entity dynamicOverride', () => {
  it('keeps a prop dynamicOverride intact', () => {
    const decoded = canonicalAssetDecoder.runWithException({
      type: 'canonical',
      path: 'https://example.com/blog/[slug]',
      dynamicOverride: {
        type: 'dynamic',
        content: {
          referenceType: 'prop',
          id: 'root',
          refPath: ['blogPost', 'canonicalUrl'],
        },
      },
    })

    expect(decoded.dynamicOverride).toEqual({
      type: 'dynamic',
      content: {
        referenceType: 'prop',
        id: 'root',
        refPath: ['blogPost', 'canonicalUrl'],
      },
    })
  })

  it('decodes a plain canonical asset without one (unchanged behavior)', () => {
    const decoded = canonicalAssetDecoder.runWithException({
      type: 'canonical',
      path: 'https://example.com/about',
    })

    expect(decoded).toEqual({ type: 'canonical', path: 'https://example.com/about' })
  })
})

describe('initialPropsDecoder: entity redirect', () => {
  const base = {
    exposeAs: { name: 'blogPost', valuePath: ['data', '0'] },
    resource: { id: 'TQ_fetchBlogPostDetail' },
  }

  it('keeps the redirect field config intact', () => {
    const decoded = initialPropsDecoder.runWithException({
      ...base,
      redirect: { destinationField: 'redirectUrl', typeField: 'redirectType' },
    })

    expect(decoded.redirect).toEqual({
      destinationField: 'redirectUrl',
      typeField: 'redirectType',
    })
  })

  it('accepts a redirect without typeField', () => {
    const decoded = initialPropsDecoder.runWithException({
      ...base,
      redirect: { destinationField: 'redirectUrl' },
    })

    expect(decoded.redirect).toEqual({ destinationField: 'redirectUrl' })
  })

  it('decodes initialPropsData without a redirect (unchanged behavior)', () => {
    const decoded = initialPropsDecoder.runWithException(base)

    expect(decoded.redirect).toBeUndefined()
  })
})

describe('dynamic metaTag fallback survives decoding', () => {
  it('keeps `fallback` on a dynamic prop reference', () => {
    // The robots meta relies on `fallback` reaching the head plugin — it is the
    // page-level inheritance channel.
    const decoded = canonicalAssetDecoder.runWithException({
      type: 'canonical',
      path: 'https://example.com/x',
      dynamicOverride: {
        type: 'dynamic',
        content: {
          referenceType: 'prop',
          id: 'root',
          refPath: ['blogPost', 'canonicalUrl'],
          fallback: 'https://example.com/fallback',
        },
      },
    })

    expect((decoded.dynamicOverride as { content: { fallback?: string } }).content.fallback).toBe(
      'https://example.com/fallback'
    )
  })
})
