import * as types from '@babel/types'
import generate from '@babel/generator'
import { UIDLStructuredDataEntry } from '@teleporthq/teleport-types'
import { buildStructuredDataScript } from '../src/structured-data-ast'

/**
 * The computed entries a blog post page needs: a FAQPage built from the FAQ
 * pairs the post's body holds (present only with two or more), and a
 * BreadcrumbList whose category crumb exists only when the post has one —
 * with positions that stay sequential either way. Both are WHOLE entries, so
 * an absent one has to leave the JSON-LD array, not sit in it as a hole.
 */

const evaluate = (entries: UIDLStructuredDataEntry[], props: Record<string, unknown>): unknown => {
  const { scriptTag } = buildStructuredDataScript(entries)
  const attribute = scriptTag.openingElement.attributes.find(
    (attr) => types.isJSXAttribute(attr) && attr.name.name === 'dangerouslySetInnerHTML'
  ) as types.JSXAttribute
  const container = attribute.value as types.JSXExpressionContainer
  const objectExpression = container.expression as types.ObjectExpression
  const htmlProperty = objectExpression.properties[0] as types.ObjectProperty
  const source = generate(htmlProperty.value as types.Expression).code
  // eslint-disable-next-line no-new-func
  const run = new Function('props', `return (${source});`) as (p: Record<string, unknown>) => string
  const text = run(props)
  return text ? JSON.parse(text) : null
}

const ARTICLE: UIDLStructuredDataEntry = {
  '@context': 'https://schema.org',
  '@type': 'BlogPosting',
  headline: { type: 'dynamic', content: { referenceType: 'prop', refPath: ['blogPost', 'title'] } },
}

const FAQ: UIDLStructuredDataEntry = {
  type: 'computed',
  kind: 'faqPage',
  refPath: ['blogPost'],
  column: 'faq',
}

const TRAIL: UIDLStructuredDataEntry = {
  type: 'computed',
  kind: 'breadcrumbTrail',
  refPath: ['blogPost'],
  column: 'title',
  slugColumn: 'slug',
  urlPrefix: 'https://acme.example/blog/',
  crumbs: [
    { name: 'Home', item: 'https://acme.example' },
    { name: 'Blog', item: 'https://acme.example/blog' },
  ],
  categoryNameColumn: 'categoryName',
  categorySlugColumn: 'categorySlug',
  categoryUrlPrefix: 'https://acme.example/blog/category/',
}

describe('faqPage', () => {
  it('lists the FAQ pairs as a FAQPage beside the article', () => {
    const faq = [
      { question: 'Is it free?', answer: 'Yes.' },
      { question: 'How long?', answer: 'A day.' },
    ]
    const document = evaluate([ARTICLE, FAQ], { blogPost: { title: 'T', faq } }) as unknown[]
    expect(document).toHaveLength(2)
    expect(document[1]).toEqual({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Is it free?',
          acceptedAnswer: { '@type': 'Answer', text: 'Yes.' },
        },
        {
          '@type': 'Question',
          name: 'How long?',
          acceptedAnswer: { '@type': 'Answer', text: 'A day.' },
        },
      ],
    })
  })

  it('leaves the array without a hole when the post has fewer than two pairs', () => {
    const one = [{ question: 'Only one?', answer: 'Yes.' }]
    expect(evaluate([ARTICLE, FAQ], { blogPost: { title: 'T', faq: one } })).toEqual([
      { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: 'T' },
    ])
    expect(evaluate([ARTICLE, FAQ], { blogPost: { title: 'T' } })).toHaveLength(1)
    // Alone, an absent entry leaves an empty script rather than the word "undefined".
    expect(evaluate([FAQ], { blogPost: {} })).toBeNull()
  })
})

describe('breadcrumbTrail', () => {
  it('puts the category between the listing and the post, positions in order', () => {
    const trail = evaluate([TRAIL], {
      blogPost: {
        title: 'Seven checks',
        slug: 'seven-checks',
        categoryName: 'Cars',
        categorySlug: 'cars',
      },
    }) as Record<string, unknown>
    expect(trail).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://acme.example' },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://acme.example/blog' },
        {
          '@type': 'ListItem',
          position: 3,
          name: 'Cars',
          item: 'https://acme.example/blog/category/cars',
        },
        {
          '@type': 'ListItem',
          position: 4,
          name: 'Seven checks',
          item: 'https://acme.example/blog/seven-checks',
        },
      ],
    })
  })

  it('skips the category crumb for a post without one, keeping positions sequential', () => {
    const trail = evaluate([TRAIL], {
      blogPost: { title: 'Seven checks', slug: 'seven-checks', categoryName: null },
    }) as Record<string, unknown>
    expect(
      (trail.itemListElement as Array<{ position: number; name: string }>).map((c) => [
        c.position,
        c.name,
      ])
    ).toEqual([
      [1, 'Home'],
      [2, 'Blog'],
      [3, 'Seven checks'],
    ])
  })
})

describe('a category crumb without an address', () => {
  it('is left out when the row names a category but has no slug for it', () => {
    const trail = evaluate([TRAIL], {
      blogPost: {
        title: 'Seven checks',
        slug: 'seven-checks',
        categoryName: 'Cars',
        categorySlug: null,
      },
    }) as Record<string, unknown>
    expect(
      (trail.itemListElement as Array<{ position: number; name: string }>).map((c) => [
        c.position,
        c.name,
      ])
    ).toEqual([
      [1, 'Home'],
      [2, 'Blog'],
      [3, 'Seven checks'],
    ])
  })
})
