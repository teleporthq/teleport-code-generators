import * as types from '@babel/types'
import generate from '@babel/generator'
import { UIDLStructuredDataObject } from '@teleporthq/teleport-types'
import { buildStructuredDataScript } from '../src/structured-data-ast'

/**
 * The two computed leaves added for Google Merchant / rich-result completeness:
 * `namedEntity` (a `Brand`, an `author`) and `reviewList` (the individual review
 * snippets under a product's stars).
 *
 * Both exist for the same reason `aggregateRating` does — the EMPTY case. A
 * `Brand` with no `name`, an `author` with no `name`, an empty `review` array:
 * each is a validation error Google reports against every page carrying it, and
 * the columns behind all three are nullable on plenty of real rows. So the
 * generated expression has to evaluate to `undefined`, which is what
 * `JSON.stringify` drops.
 *
 * The tests EXECUTE the emitted expression rather than reading it: "the shape
 * looks right" and "the property actually disappears" are different claims.
 */

const entry = (extra: UIDLStructuredDataObject): UIDLStructuredDataObject => ({
  '@context': 'https://schema.org',
  '@type': 'Product',
  ...extra,
})

/** The emitted JavaScript, as text. */
const renderSource = (document: UIDLStructuredDataObject): string => {
  const { scriptTag } = buildStructuredDataScript(document)
  const attribute = scriptTag.openingElement.attributes.find(
    (attr) => types.isJSXAttribute(attr) && attr.name.name === 'dangerouslySetInnerHTML'
  ) as types.JSXAttribute
  const container = attribute.value as types.JSXExpressionContainer
  const objectExpression = container.expression as types.ObjectExpression
  const htmlProperty = objectExpression.properties[0] as types.ObjectProperty
  return generate(htmlProperty.value as types.Expression).code
}

const render = (
  document: UIDLStructuredDataObject,
  props: Record<string, unknown>
): Record<string, unknown> => {
  const { scriptTag } = buildStructuredDataScript(document)
  const attribute = scriptTag.openingElement.attributes.find(
    (attr) => types.isJSXAttribute(attr) && attr.name.name === 'dangerouslySetInnerHTML'
  ) as types.JSXAttribute
  const container = attribute.value as types.JSXExpressionContainer
  const objectExpression = container.expression as types.ObjectExpression
  const htmlProperty = objectExpression.properties[0] as types.ObjectProperty
  const source = generate(htmlProperty.value as types.Expression).code
  // eslint-disable-next-line no-new-func
  const evaluate = new Function('props', `return (${source});`) as (
    p: Record<string, unknown>
  ) => string
  return JSON.parse(evaluate(props))
}

const BRAND_DOC = entry({
  brand: {
    type: 'computed',
    kind: 'namedEntity',
    refPath: ['ecommerceProduct'],
    column: 'brand',
    schemaType: 'Brand',
  },
})

const REVIEW_DOC = entry({
  review: {
    type: 'computed',
    kind: 'reviewList',
    refPath: ['ecommerceProduct'],
    column: 'reviews',
  },
})

describe('structured data — namedEntity', () => {
  it('emits the typed object when the field has a value', () => {
    const json = render(BRAND_DOC, { ecommerceProduct: { brand: 'Acme' } })
    expect(json.brand).toEqual({ '@type': 'Brand', name: 'Acme' })
  })

  // The reason it is computed at all: `brand` is nullable, and a Brand with no
  // name is a missing-required-field error on every product that has none.
  it('removes the property when the field is empty', () => {
    expect(render(BRAND_DOC, { ecommerceProduct: { brand: '' } })).not.toHaveProperty('brand')
    expect(render(BRAND_DOC, { ecommerceProduct: {} })).not.toHaveProperty('brand')
    expect(render(BRAND_DOC, {})).not.toHaveProperty('brand')
  })

  it('carries whatever schema type the caller asked for', () => {
    const authorDoc = entry({
      author: {
        type: 'computed',
        kind: 'namedEntity',
        refPath: ['blogPost'],
        column: 'authorName',
        schemaType: 'Person',
      },
    })
    const json = render(authorDoc, { blogPost: { authorName: 'Ada Lovelace' } })
    expect(json.author).toEqual({ '@type': 'Person', name: 'Ada Lovelace' })
  })
})

describe('structured data — reviewList', () => {
  it('⛔ calls `map` INSIDE the optional chain, never through a parenthesised callee', () => {
    // The defect this guards. `(reviews?.map)(cb)` and `reviews?.map(cb)` read
    // the same and behave the same under native V8 — which is why executing the
    // expression here, as every other test in this file does, cannot catch it.
    //
    // They are different AST nodes, and SWC (what Next compiles a generated page
    // with) lowers the parenthesised one to a CONDITIONAL as the callee:
    //   (ref === null || ref === void 0 ? void 0 : ref.map)(cb)
    // A conditional is a value, not a reference, so `map` runs with
    // `this === undefined` and the page dies with "Array.prototype.map called on
    // null or undefined" — only on a product that HAS a review, since no other
    // path reaches the call.
    const source = renderSource(REVIEW_DOC)

    expect(source).toContain('?.map(')
    expect(source).not.toContain('?.map)')
  })

  it('maps the domain array into schema.org Review objects', () => {
    const json = render(REVIEW_DOC, {
      ecommerceProduct: {
        reviews: [
          { author: 'Sam', rating: 5, body: 'Perfect', datePublished: '2026-01-02T00:00:00.000Z' },
        ],
      },
    })

    expect(json.review).toEqual([
      {
        '@type': 'Review',
        author: { '@type': 'Person', name: 'Sam' },
        reviewRating: { '@type': 'Rating', ratingValue: 5, bestRating: 5, worstRating: 1 },
        reviewBody: 'Perfect',
        datePublished: '2026-01-02T00:00:00.000Z',
      },
    ])
  })

  it('preserves the order the transform returned', () => {
    const json = render(REVIEW_DOC, {
      ecommerceProduct: {
        reviews: [
          { author: 'A', rating: 5, body: 'x', datePublished: null },
          { author: 'B', rating: 4, body: 'y', datePublished: null },
        ],
      },
    })
    expect((json.review as Array<{ author: { name: string } }>).map((r) => r.author.name)).toEqual([
      'A',
      'B',
    ])
  })

  // An empty `review` array is invalid structured data in exactly the way an
  // empty aggregateRating is.
  it('removes the property when there are no reviews', () => {
    expect(render(REVIEW_DOC, { ecommerceProduct: { reviews: [] } })).not.toHaveProperty('review')
    expect(render(REVIEW_DOC, { ecommerceProduct: {} })).not.toHaveProperty('review')
  })

  // A listing page's transform ships no `reviews` field at all, and an older
  // baked transform predates it.
  it('removes the property when the field is not an array', () => {
    expect(
      render(REVIEW_DOC, { ecommerceProduct: { reviews: 'not an array' } })
    ).not.toHaveProperty('review')
    expect(render(REVIEW_DOC, {})).not.toHaveProperty('review')
  })
})
