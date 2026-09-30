import { getAPIRouteFileName } from '../src/api-route-generator'

/**
 * A workflow's server segments each get their own API route file, and the
 * client's URL map is built from the same names. Capping the segment id at
 * eight characters spelled `server-10`, `server-11` and `server-12` as
 * `server-1`: the tenth segment's file overwrote the first, and the client
 * sent the first call of the workflow to whatever the last segment held. On
 * the checkout that was the payment charge, reached before the cart was
 * validated or the order written.
 */
describe('getAPIRouteFileName', () => {
  it('gives every server segment its own file, past the ninth', () => {
    const names = Array.from({ length: 14 }, (_, index) =>
      getAPIRouteFileName(
        '19df4d9e-6409-40a4-bbb9-3645b2afcf3b',
        `server-${index + 1}`,
        'Place Order 2'
      )
    )
    expect(new Set(names).size).toBe(names.length)
    expect(names[0]).toBe('place-order-2-19df4d9e-seg-server-1')
    expect(names[9]).toBe('place-order-2-19df4d9e-seg-server-10')
    expect(names[11]).toBe('place-order-2-19df4d9e-seg-server-12')
  })

  it('keeps the workflow-id suffix that tells two same-named workflows apart', () => {
    const a = getAPIRouteFileName('aaaaaaaa-1111', 'server-1', 'Place Order')
    const b = getAPIRouteFileName('bbbbbbbb-2222', 'server-1', 'Place Order')
    expect(a).not.toBe(b)
    expect(a).toBe('place-order-aaaaaaaa-seg-server-1')
  })
})
