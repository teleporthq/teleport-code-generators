import { generateServerSegmentAPIRoute } from '../src'
import { splitIntoSegments } from '../src/segment-splitter'
import { buildSegmentTrust } from '../src/segment-trust'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'

// A run of server segments is ONE chain: every reply signs the results the
// caller may hand on, and a later call accepts a relayed result only with the
// very signature its link lists. A crafted client that calls a segment twice in
// one run (a cheap cart and a big one, a refused payment method and an
// accepted one) can continue either fork, never a mix of the two — which used
// to reach an underpriced or unpaid "settled" order (Task 4 review, X1).

type Context = Record<string, any>

const runtime = loadServerRuntime()
const savedSecret = process.env.NEXTAUTH_SECRET
beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'step-chain-test-secret'
})
afterAll(() => {
  if (savedSecret === undefined) {
    delete process.env.NEXTAUTH_SECRET
  } else {
    process.env.NEXTAUTH_SECRET = savedSecret
  }
})

const script = (body: string) => `function customHandler(params) { ${body} }`
const server = (
  id: string,
  stepNumber: number,
  body: string,
  params?: Record<string, unknown>
) => ({
  id,
  type: 'general-custom-js',
  label: id,
  stepNumber,
  config: { context: 'server', code: script(body), ...(params ? { params } : {}) },
})
const browser = (id: string, stepNumber: number) => ({
  id,
  type: 'state-update-local-state',
  label: id,
  stepNumber,
  config: { property: id, value: true },
})
const ref = (nodeId: string, ...path: string[]) => ({
  type: 'workflowContext',
  nodeId,
  path: [nodeId, ...path],
})
const named = 'var named = params[params.length - 1] || {};'

function bootWorkflow(id: string, nodes: any[]) {
  const edges = nodes
    .slice(1)
    .map((node, i) => ({ id: `e${i}`, source: nodes[i].id, target: node.id }))
  const workflow = { id, nodes, edges, trigger: { type: 'event-element-clicked' } } as any
  const segments = splitIntoSegments(workflow)
  const routes: Record<string, (context: Context) => Promise<{ status: number; body: any }>> = {}
  for (const segment of segments.filter((s) => s.env === 'server') as WorkflowSegment[]) {
    const source = generateServerSegmentAPIRoute(segment, id, undefined, {
      trust: buildSegmentTrust(segment, { id, nodes, edges, segments }),
    })
    const routeModule: { exports: any } = { exports: {} }
    const requireStub = (name: string) => (name.endsWith('server-runtime') ? runtime : {})
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('module', 'exports', 'require', source)(
      routeModule,
      routeModule.exports,
      requireStub
    )
    routes[segment.nodes[0].id] = async (context: Context) => {
      const reply = { status: 0, body: null as any }
      const res = {
        setHeader: (): undefined => undefined,
        status(code: number) {
          reply.status = code
          return this
        },
        json(payload: unknown) {
          reply.body = payload
          return this
        },
      }
      await routeModule.exports(
        {
          method: 'POST',
          body: { context: JSON.parse(JSON.stringify(context)) },
          headers: { host: 'shop.test' },
        },
        res
      )
      return reply
    }
  }
  return routes
}

const merge = (context: Context, results: Context = {}): Context => ({ ...context, ...results })

describe('the reviewer probe: one segment called twice in a run', () => {
  // open → (browser) → price → (browser) → use
  const routes = bootWorkflow('wf-mix', [
    server('open', 1, 'return { opened: true }'),
    browser('cart', 2),
    server('price', 3, `${named} return { value: named.cart }`, { cart: ref('trigger', 'cart') }),
    browser('gap', 4),
    server('use', 5, `${named} return { used: named.value }`, { value: ref('price', 'value') }),
  ])

  it('lets a later step continue one fork, never a mix of two', async () => {
    const opened = merge({}, (await routes.open({})).body.results)
    const cheap = merge(
      merge(opened, { trigger: { cart: 'CHEAP' }, cart: {} }),
      (await routes.price(merge(opened, { trigger: { cart: 'CHEAP' }, cart: {} }))).body.results
    )
    const big = merge(
      merge(opened, { trigger: { cart: 'BIG' }, cart: {} }),
      (await routes.price(merge(opened, { trigger: { cart: 'BIG' }, cart: {} }))).body.results
    )
    expect(cheap.__sigRun.id).toBe(big.__sigRun.id)

    // The crafted client continues the CHEAP fork with the BIG result and its signature.
    const crafted = {
      ...cheap,
      gap: {},
      price: big.price,
      __sig: { ...cheap.__sig, price: big.__sig.price },
    }
    const mixed = await routes.use(crafted)
    expect(mixed.status).toBe(200)
    expect(mixed.body.results.use).toEqual({})
    expect(JSON.stringify(mixed.body.results)).not.toContain('BIG')

    // Each fork, continued whole, is a run of its own.
    expect((await routes.use({ ...cheap, gap: {} })).body.results.use).toEqual({ used: 'CHEAP' })
    expect((await routes.use({ ...big, gap: {} })).body.results.use).toEqual({ used: 'BIG' })
  })

  it('also refuses the BIG result presented under the CHEAP link with its own order', async () => {
    const opened = merge({}, (await routes.open({})).body.results)
    const ask = (cart: string) => merge(opened, { trigger: { cart }, cart: {} })
    const cheap = merge(ask('CHEAP'), (await routes.price(ask('CHEAP'))).body.results)
    const big = merge(ask('BIG'), (await routes.price(ask('BIG'))).body.results)
    // BIG's link over CHEAP's value: the value no longer matches the listed signature.
    const crafted = { ...cheap, gap: {}, __sigOrder: big.__sigOrder, __sig: big.__sig }
    expect((await routes.use(crafted)).body.results.use).toEqual({})
  })
})

describe('the checkout shape: pricing called twice', () => {
  // price → (browser) → assemble → (browser) → settle. The assemble refuses an
  // order without a priced result; settle writes the priced lines and settles
  // what the assemble said needs no payment.
  const routes = bootWorkflow('wf-checkout', [
    server('form', 1, 'return { ok: true }'),
    browser('method', 2),
    server(
      'price',
      3,
      `${named} return named.method === 'stripe' ? { priced: true, total: 90, lines: ['TV'] } : { priced: false, total: 0, lines: [] }`,
      { method: ref('trigger', 'method') }
    ),
    browser('review', 4),
    server(
      'assemble',
      5,
      `${named} var p = named.price || {}; if (p.priced !== true && p.total !== 0) { return { refused: true } } ` +
        `if (!p.lines) { return { refused: true } } return { refused: false, total: p.total, requiresPayment: p.total > 0 }`,
      { price: ref('price') }
    ),
    browser('confirm', 6),
    server(
      'settle',
      7,
      `${named} var p = named.price || {}; var a = named.assemble || {}; ` +
        `return { items: p.lines || [], settled: a.requiresPayment === false }`,
      { price: ref('price'), assemble: ref('assemble') }
    ),
  ])

  it('refuses to assemble or settle from two pricing calls of one run', async () => {
    const formed = merge({}, (await routes.form({})).body.results)
    const ask = (method: string) => merge(formed, { trigger: { method }, method: {} })
    const refused = merge(
      ask('cash_on_delivery'),
      (await routes.price(ask('cash_on_delivery'))).body.results
    )
    const accepted = merge(ask('stripe'), (await routes.price(ask('stripe'))).body.results)
    expect(refused.price).toMatchObject({ priced: false })
    expect(accepted.price).toMatchObject({ priced: true })

    // The assemble is handed the accepted price under the refused call's link.
    const assembleMix = await routes.assemble({
      ...refused,
      review: {},
      price: accepted.price,
      __sig: { ...refused.__sig, price: accepted.__sig.price },
    })
    expect(assembleMix.body.results.assemble).toEqual({ refused: true })

    // The honest refused fork assembles a 0-total order...
    const afterRefused = merge(
      { ...refused, review: {} },
      (await routes.assemble({ ...refused, review: {} })).body.results
    )
    expect(afterRefused.assemble).toMatchObject({ requiresPayment: false })
    // ...and settle, handed the accepted call's lines under that fork's link,
    // never sees them: it settles the refused fork's empty order, no goods.
    const settleMix = await routes.settle({
      ...afterRefused,
      confirm: {},
      price: accepted.price,
      __sig: { ...afterRefused.__sig, price: accepted.__sig.price },
    })
    expect(settleMix.body.results.settle.items).toEqual([])
    expect(JSON.stringify(settleMix.body.results)).not.toContain('TV')
  })
})
