import * as types from '@babel/types'
import generate from '@babel/generator'
import { UIDLStructuredDataObject } from '@teleporthq/teleport-types'
import { buildStructuredDataScript } from '../src/structured-data-ast'

/**
 * `aggregateRating` on a generated Product page.
 *
 * The whole reason this is a COMPUTED leaf rather than a plain object is the
 * zero case. A `Product` carrying an empty or zeroed `aggregateRating` is
 * invalid structured data — Google's Rich Results report flags it on every
 * product page in the catalogue — so a store with no reviews yet has to emit no
 * rating property at all.
 *
 * `JSON.stringify` drops `undefined` properties, so the emitted expression is a
 * ternary that evaluates to `undefined` below one review. These tests assert the
 * generated JavaScript, then EXECUTE it, because "the shape looks right" and
 * "the property actually disappears" are different claims.
 */

const productEntry = (): UIDLStructuredDataObject => ({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: {
    type: 'dynamic',
    content: { referenceType: 'prop', id: 'root', refPath: ['ecommerceProduct', 'name'] },
  },
  aggregateRating: {
    type: 'computed',
    kind: 'aggregateRating',
    refPath: ['ecommerceProduct'],
    column: 'ratingCount',
    ratingValueColumn: 'ratingAverage',
  },
})

/** Renders the `__html` expression and evaluates it against a page-props object. */
const renderJsonLd = (props: Record<string, unknown>): Record<string, unknown> => {
  const { scriptTag } = buildStructuredDataScript(productEntry())
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

describe('structured data — aggregateRating', () => {
  it('emits the rating block for a product with reviews', () => {
    const json = renderJsonLd({
      ecommerceProduct: { name: 'Chair', ratingAverage: 4.5, ratingCount: 128 },
    })

    expect(json.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.5,
      reviewCount: 128,
      bestRating: 5,
      worstRating: 1,
    })
  })

  // The case this whole design exists for.
  it('OMITS the property entirely at zero reviews — not `{}`, not a zeroed block', () => {
    const json = renderJsonLd({
      ecommerceProduct: { name: 'Chair', ratingAverage: 0, ratingCount: 0 },
    })

    expect(json).not.toHaveProperty('aggregateRating')
    expect(json['@type']).toBe('Product')
    expect(json.name).toBe('Chair')
  })

  it('omits the property when the product row has no rating fields at all', () => {
    // A store published before ratings existed, or a non-product entity.
    const json = renderJsonLd({ ecommerceProduct: { name: 'Chair' } })
    expect(json).not.toHaveProperty('aggregateRating')
  })

  it('omits the property when the entity itself is missing', () => {
    // getStaticProps returned nothing for the slug — the optional chain must not
    // throw on the way to the ternary.
    const json = renderJsonLd({})
    expect(json).not.toHaveProperty('aggregateRating')
  })

  it('reads the average from `ratingValueColumn`, not from `column`', () => {
    // `column` is the COUNT (it is the gate); a builder that swapped the two
    // would emit the review count as the score.
    const json = renderJsonLd({
      ecommerceProduct: { name: 'Chair', ratingAverage: 3.2, ratingCount: 7 },
    })
    const rating = json.aggregateRating as Record<string, unknown>
    expect(rating.ratingValue).toBe(3.2)
    expect(rating.reviewCount).toBe(7)
  })

  it('falls back to `column` when no rating value column was given', () => {
    const { scriptTag } = buildStructuredDataScript({
      '@type': 'Product',
      aggregateRating: {
        type: 'computed',
        kind: 'aggregateRating',
        refPath: ['p'],
        column: 'ratingCount',
      },
    })
    const code = generate(scriptTag).code
    // Degrades to using the count for both rather than emitting `undefined` as
    // the score, which would produce a malformed block.
    expect(code).toContain('ratingCount')
  })
})
