import type { UIDLWorkflow, UIDLWorkflowEdge, UIDLWorkflowNode } from '@teleporthq/teleport-types'
import { splitIntoSegments } from '../src/segment-splitter'
import type { WorkflowSegment } from '../src/types'

// Every server segment the browser reaches is one awaited round trip. A
// checkout is one long chain of server steps with a refusal branch (a toast, a
// reset) at almost every gate, all at the same depth as the chain's next step.
// Ordered by depth alone, each refusal step sat between two server steps of the
// chain and cut it into one more round trip; the loop over the cart lines held
// everything after it in a depth-only order. Built here the way the editor's
// checkout builds Place Order, with synthetic ids and labels.

type Kind = 'client' | 'server' | 'gate' | 'loop' | 'custom-node' | 'navigate'

const TYPE: Record<Kind, string> = {
  client: 'state-update-local-state',
  server: 'data-raw-query',
  gate: 'general-if-statement',
  loop: 'general-loop',
  'custom-node': 'general-custom-node',
  navigate: 'navigation-go-to-page',
}

const ENV: Record<Kind, UIDLWorkflowNode['executionEnv']> = {
  client: 'client',
  server: 'server',
  gate: 'universal',
  loop: 'universal',
  'custom-node': 'universal',
  navigate: 'client',
}

const buildWorkflow = (
  steps: Array<[string, Kind]>,
  links: Array<[string, string, string?, string?]>
): UIDLWorkflow => {
  const edges: UIDLWorkflowEdge[] = links.map(([source, target, sourceHandle, targetHandle]) => ({
    id: `${source}->${target}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
    ...(targetHandle ? { targetHandle } : {}),
  }))
  // The editor's step numbers: breadth-first depth from the trigger.
  const depth = new Map<string, number>()
  const queue: Array<[string, number]> = [['trigger', 0]]
  while (queue.length > 0) {
    const [id, d] = queue.shift() as [string, number]
    if (depth.has(id)) {
      continue
    }
    depth.set(id, d)
    edges.filter((e) => e.source === id).forEach((e) => queue.push([e.target, d + 1]))
  }
  return {
    id: 'place-order',
    name: 'Place Order',
    trigger: { type: 'event-form-submitted', nodeId: 'trigger' },
    nodes: steps.map(([id, kind]) => ({
      id,
      type: TYPE[kind],
      label: id,
      config: {},
      executionEnv: ENV[kind],
      stepNumber: depth.get(id) || 0,
    })),
    edges,
  } as unknown as UIDLWorkflow
}

// A gate whose condition reads a server step, its refusal branch three or four
// browser steps long, its accepted branch the rest of the chain.
const placeOrder = buildWorkflow(
  [
    ['setBusy', 'client'],
    ['formValid', 'gate'],
    ['formToast', 'client'],
    ['fetchStock', 'server'],
    ['checkStock', 'server'],
    ['inStock', 'gate'],
    ['stockToast', 'client'],
    ['stockReset', 'client'],
    ['resolveUser', 'custom-node'],
    ['loadDiscounts', 'server'],
    ['countOrders', 'server'],
    ['recheckVoucher', 'server'],
    ['voucherValid', 'gate'],
    ['forgetVoucher', 'client'],
    ['voucherToast', 'client'],
    ['voucherReset', 'client'],
    ['voucherClear', 'client'],
    ['priceOrder', 'server'],
    ['assemble', 'server'],
    ['checkAddress', 'server'],
    ['canBill', 'gate'],
    ['billToast', 'client'],
    ['billReset', 'client'],
    ['createOrder', 'server'],
    ['redeem', 'server'],
    ['redeemed', 'gate'],
    ['cancelOrder', 'server'],
    ['redeemToast', 'client'],
    ['orderNumber', 'server'],
    ['eachLine', 'loop'],
    ['buildLine', 'server'],
    ['saveLine', 'server'],
    ['decrementStock', 'server'],
    ['recordPlaced', 'custom-node'],
    ['saveDetails', 'server'],
    ['settled', 'gate'],
    ['markSettled', 'server'],
    ['clearCart', 'client'],
    ['emailPayload', 'server'],
    ['sendEmail', 'server'],
    ['goToOrder', 'navigate'],
    ['redirectUrls', 'server'],
    ['charge', 'server'],
    ['opened', 'gate'],
    ['cancelRefused', 'server'],
    ['refusedToast', 'client'],
    ['recordCheckout', 'server'],
    ['sendToCheckout', 'navigate'],
  ],
  [
    ['trigger', 'setBusy'],
    ['setBusy', 'formValid'],
    ['formValid', 'formToast', 'false'],
    ['formValid', 'fetchStock', 'true'],
    ['fetchStock', 'checkStock'],
    ['checkStock', 'inStock'],
    ['inStock', 'stockToast', 'false'],
    ['stockToast', 'stockReset'],
    ['inStock', 'resolveUser', 'true'],
    ['resolveUser', 'loadDiscounts'],
    ['loadDiscounts', 'countOrders'],
    ['countOrders', 'recheckVoucher'],
    ['recheckVoucher', 'voucherValid'],
    ['voucherValid', 'forgetVoucher', 'false'],
    ['forgetVoucher', 'voucherToast'],
    ['voucherToast', 'voucherReset'],
    ['voucherReset', 'voucherClear'],
    ['voucherValid', 'priceOrder', 'true'],
    ['priceOrder', 'assemble'],
    ['assemble', 'checkAddress'],
    ['checkAddress', 'canBill'],
    ['canBill', 'billToast', 'false'],
    ['billToast', 'billReset'],
    ['canBill', 'createOrder', 'true'],
    ['createOrder', 'redeem'],
    ['redeem', 'redeemed'],
    ['redeemed', 'cancelOrder', 'false'],
    ['cancelOrder', 'redeemToast'],
    ['redeemed', 'orderNumber', 'true'],
    ['orderNumber', 'eachLine'],
    ['eachLine', 'buildLine', 'loop', 'loop-body-in'],
    ['buildLine', 'saveLine'],
    ['saveLine', 'eachLine', 'loop-body-out', 'loop-back'],
    ['eachLine', 'decrementStock', 'exit'],
    ['decrementStock', 'recordPlaced'],
    ['recordPlaced', 'saveDetails'],
    ['saveDetails', 'settled'],
    ['settled', 'markSettled', 'true'],
    ['markSettled', 'clearCart'],
    ['clearCart', 'emailPayload'],
    ['emailPayload', 'sendEmail'],
    ['sendEmail', 'goToOrder'],
    ['settled', 'redirectUrls', 'false'],
    ['redirectUrls', 'charge'],
    ['charge', 'opened'],
    ['opened', 'cancelRefused', 'false'],
    ['cancelRefused', 'refusedToast'],
    ['opened', 'recordCheckout', 'true'],
    ['recordCheckout', 'sendToCheckout'],
  ]
)

const REFUSALS = [
  'formToast',
  'stockToast',
  'stockReset',
  'forgetVoucher',
  'voucherToast',
  'voucherReset',
  'voucherClear',
  'billToast',
  'billReset',
  'cancelOrder',
  'redeemToast',
  'cancelRefused',
  'refusedToast',
]
const CASH_ONLY = ['markSettled', 'clearCart', 'emailPayload', 'sendEmail', 'goToOrder']
const ONLINE_ONLY = ['redirectUrls', 'charge', 'opened', 'recordCheckout', 'sendToCheckout']

// The server segments an order that every gate accepts calls, in order.
const roundTrips = (segments: WorkflowSegment[], skipped: string[]): string[][] =>
  segments
    .filter((s) => s.env === 'server')
    .map((s) => s.nodes.map((n) => n.id).filter((id) => !skipped.includes(id)))
    .filter((ids) => ids.length > 0)

const segmentOf = (segments: WorkflowSegment[], id: string): WorkflowSegment =>
  segments.find((s) => s.nodes.some((n) => n.id === id)) as WorkflowSegment

describe('splitIntoSegments — a checkout waits on as few server round trips as it can', () => {
  const segments = splitIntoSegments(placeOrder)

  it('calls the server once between each pair of steps that need the browser', () => {
    // Browser steps on the accepted path: resolveUser (custom node) and
    // recordPlaced (custom node) — plus clearCart for a cash order.
    expect(roundTrips(segments, [...REFUSALS, ...ONLINE_ONLY])).toEqual([
      ['fetchStock', 'checkStock', 'inStock'],
      [
        'loadDiscounts',
        'countOrders',
        'recheckVoucher',
        'voucherValid',
        'priceOrder',
        'assemble',
        'checkAddress',
        'canBill',
        'createOrder',
        'redeem',
        'redeemed',
        'orderNumber',
        'eachLine',
        'buildLine',
        'saveLine',
        'decrementStock',
      ],
      ['saveDetails', 'settled', 'markSettled'],
      ['emailPayload', 'sendEmail'],
    ])
    expect(roundTrips(segments, [...REFUSALS, ...CASH_ONLY])).toHaveLength(3)
  })

  it('decides every gate that reads a server step inside the server route', () => {
    // A gate the browser decides is one a crafted request can answer: the
    // route then takes the browser's word for which branch was skipped.
    for (const gate of ['inStock', 'voucherValid', 'canBill', 'redeemed', 'settled', 'opened']) {
      expect(segmentOf(segments, gate).env).toBe('server')
    }
    // A refusal step on the server shares its gate's route, which skips it itself.
    expect(segmentOf(segments, 'cancelOrder')).toBe(segmentOf(segments, 'redeemed'))
    expect(segmentOf(segments, 'cancelRefused')).toBe(segmentOf(segments, 'opened'))
  })

  it('keeps the loop and its body in one segment, in order', () => {
    const loopSegment = segmentOf(segments, 'eachLine')
    const ids = loopSegment.nodes.map((n) => n.id)
    expect(ids.slice(ids.indexOf('eachLine'), ids.indexOf('eachLine') + 3)).toEqual([
      'eachLine',
      'buildLine',
      'saveLine',
    ])
    expect(ids.indexOf('decrementStock')).toBeGreaterThan(ids.indexOf('saveLine'))
  })

  it('runs every step after everything it depends on', () => {
    const order = segments.flatMap((s) => s.nodes.map((n) => n.id))
    for (const e of placeOrder.edges) {
      if (e.targetHandle === 'loop-back' || e.source === 'trigger') {
        continue
      }
      expect([e.source, order.indexOf(e.source) < order.indexOf(e.target)]).toEqual([
        e.source,
        true,
      ])
    }
  })
})

describe('splitIntoSegments — a server route runs its steps by step number', () => {
  it('never puts a step in the segment of an input with a later step number', () => {
    // `total` hangs off the trigger (step 1) but reads `line3` (step 3): the
    // route, which sorts its segment by step, would run it before that value.
    const workflow = {
      id: 'w',
      name: 'w',
      trigger: { type: 'event-element-clicked', nodeId: 'trigger' },
      nodes: [
        { id: 'line1', type: 'data-select', stepNumber: 1, executionEnv: 'server', config: {} },
        { id: 'line2', type: 'data-select', stepNumber: 2, executionEnv: 'server', config: {} },
        { id: 'line3', type: 'data-select', stepNumber: 3, executionEnv: 'server', config: {} },
        {
          id: 'total',
          type: 'data-create-item',
          stepNumber: 1,
          executionEnv: 'server',
          config: { columnMappings: [{ value: { type: 'workflowContext', nodeId: 'line3' } }] },
        },
      ],
      edges: [
        { id: 'e0', source: 'trigger', target: 'line1' },
        { id: 'e1', source: 'line1', target: 'line2' },
        { id: 'e2', source: 'line2', target: 'line3' },
        { id: 'e3', source: 'trigger', target: 'total' },
      ],
    } as unknown as UIDLWorkflow
    const segments = splitIntoSegments(workflow)
    expect(segments.map((s) => [s.env, s.nodes.map((n) => n.id)])).toEqual([
      ['server', ['line1', 'line2', 'line3']],
      ['server', ['total']],
    ])
  })
})
