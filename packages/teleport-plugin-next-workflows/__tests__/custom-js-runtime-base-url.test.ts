import { loadHandler, HandlerFn } from './_helpers/load-handler'

/**
 * A custom-JS script that builds an absolute link (an email button) reads the
 * segment's request origin as `runtime.baseUrl` — bound by NAME, in either
 * documented signature — and never touches `process.env`, which the publish
 * scanner flags. On the client, and in a segment with no request behind it,
 * the origin is the empty string.
 */

describe('general-custom-js — runtime.baseUrl', () => {
  const handler: HandlerFn = loadHandler('general-custom-js')

  const TOP_LEVEL = [
    'function customHandler(params, inputs, workflowContext, runtime) {',
    '  return { base: runtime.baseUrl };',
    '}',
  ].join('\n')

  const INSIDE_CUSTOM_NODE = [
    'function customHandler(previousContext, params, runtime) {',
    '  return { base: runtime.baseUrl };',
    '}',
  ].join('\n')

  it('hands a top-level script the segment origin', async () => {
    const result = await handler(
      { code: TOP_LEVEL },
      { trigger: { tag: 'trigger' }, __baseUrl: 'https://shop.example' }
    )
    expect(result).toEqual({ base: 'https://shop.example' })
  })

  it('hands a custom-node script the same origin by name', async () => {
    const result = await handler(
      { code: INSIDE_CUSTOM_NODE },
      {
        __isInsideCustomNode: true,
        __customNodeIds: [],
        __customParams: { orderId: 'o-1' },
        __baseUrl: 'https://shop.example',
      }
    )
    expect(result).toEqual({ base: 'https://shop.example' })
  })

  it('is empty where no request stands behind the segment', async () => {
    const result = await handler({ code: TOP_LEVEL }, { trigger: { tag: 'trigger' } })
    expect(result).toEqual({ base: '' })
  })

  it('does not occupy a positional params slot', async () => {
    const PROBE = [
      'function customHandler(params) {',
      '  return { seen: params.map(function (p) { return p && p.tag ? p.tag : null; }) };',
      '}',
    ].join('\n')
    const result = (await handler(
      { code: PROBE },
      { trigger: { tag: 'trigger' }, cart: { tag: 'cart' }, __baseUrl: 'https://shop.example' }
    )) as { seen: string[] }
    expect(result.seen).toEqual(['trigger', 'cart'])
  })
})
