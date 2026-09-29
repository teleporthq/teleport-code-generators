import { initialPropsDecoder, navLinkNodeDecoder } from '../../src/decoders/utils'

// Custom product pages: the object decoders are strict whitelists and the
// decoded UIDL REPLACES the input, so every field the feature adds is pinned
// here — a decoder that dropped one would silently turn the feature off.

describe('initialPropsDecoder: a page that shows a subset of the rows', () => {
  const base = {
    exposeAs: { name: 'ecommerceProduct', valuePath: ['data', '0'] },
    resource: { id: 'TQ_teleport_productsDetail' },
  }

  it('keeps the guard and the status of the redirect', () => {
    const decoded = initialPropsDecoder.runWithException({
      ...base,
      redirect: {
        destinationField: 'productPageUrl',
        unlessFieldEquals: { field: 'productPageKey', value: 'personalise' },
        statusCode: 302,
      },
    })

    expect(decoded.redirect).toEqual({
      destinationField: 'productPageUrl',
      unlessFieldEquals: { field: 'productPageKey', value: 'personalise' },
      statusCode: 302,
    })
  })

  it('keeps the filter that selects the page’s own rows', () => {
    const ownRowsFilter = [
      {
        type: 'group',
        operator: 'or',
        children: [
          { type: 'condition', source: 'product_page', destination: null, operand: '=' },
          { type: 'condition', source: 'product_page', destination: '', operand: '=' },
        ],
      },
    ]
    const decoded = initialPropsDecoder.runWithException({
      ...base,
      redirect: {
        destinationField: 'productPageUrl',
        unlessFieldEquals: { field: 'productPageKey', value: '' },
        ownRowsFilter,
        statusCode: 302,
      },
    })
    expect(decoded.redirect?.ownRowsFilter).toEqual(ownRowsFilter)
  })

  it('refuses a status that is not a redirect', () => {
    expect(() =>
      initialPropsDecoder.runWithException({
        ...base,
        redirect: { destinationField: 'productPageUrl', statusCode: 200 },
      })
    ).toThrow()
  })
})

describe('navLinkNodeDecoder: the canonical address of the linked record', () => {
  it('keeps canonicalValue next to the differentiator', () => {
    const decoded = navLinkNodeDecoder.runWithException({
      type: 'navlink',
      content: {
        routeName: '/products',
        differentiatorValue: {
          type: 'dynamic',
          content: { referenceType: 'prop', id: 'product', refPath: ['slug'] },
        },
        canonicalValue: {
          type: 'dynamic',
          content: { referenceType: 'prop', id: 'product', refPath: ['productPageUrl'] },
        },
      },
    })

    expect(decoded.content.canonicalValue).toEqual({
      type: 'dynamic',
      content: { referenceType: 'prop', id: 'product', refPath: ['productPageUrl'] },
    })
  })

  it('decodes a navlink without one exactly as before', () => {
    const decoded = navLinkNodeDecoder.runWithException({
      type: 'navlink',
      content: { routeName: '/about' },
    })
    expect(decoded.content).toEqual({ routeName: '/about' })
  })
})
