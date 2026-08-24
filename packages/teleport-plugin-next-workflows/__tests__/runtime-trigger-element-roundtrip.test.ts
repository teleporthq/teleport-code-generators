import { generateClientRuntimeCode } from '../src/executor-generator'

// Regression guard for the "/cart + button does nothing in production" bug.
//
// A workflow that mixes a server segment (stock check, which filters a product
// by `trigger.element.dataset.productId`) with a client segment (cart-update,
// which reads `trigger.element.dataset.cartItemId`) used to break on deploy:
//
//   1. `pruneContext` could not serialize the live DOM trigger element, so it
//      crossed to the server as `{ __serializationError: true }`. The server's
//      data-select then filtered on an undefined productId and matched the
//      wrong product.
//   2. The server echoed that `{ __serializationError: true }` placeholder
//      back, and `Object.assign(context, serverResults)` overwrote the
//      client's REAL trigger element with it — so the subsequent client
//      cart-update read `undefined` for cartItemId and silently no-opped.
//
// The fix makes `pruneContext` emit a serializable DOM snapshot (carrying the
// dataset) and `mergeServerResults` keep the client's authoritative live
// element. These tests lock both halves in.

type Fn = (...args: unknown[]) => unknown

function extractFn(name: string, returnExpr = name): Fn {
  const src = generateClientRuntimeCode()
  // Each helper is generated as `function <name>(...) { ... }\n}` — grab it up
  // to the closing brace on its own line, then eval to expose it. Same
  // approach as runtime-absolutize-url.test.ts.
  const re = new RegExp(`function ${name}\\b[\\s\\S]*?\\n\\}`)
  const match = src.match(re)
  if (!match) {
    throw new Error(`${name} not found in generated runtime`)
  }
  // pruneContext depends on isDomNode/snapshotDomNode/domSerializationReplacer
  // plus the recursive pruner (serializeForPrune/prunedValue) and its two size
  // constants; mergeServerResults depends on isDomNode. Pull those in too.
  const constDecls = ['PRUNE_MAX_SERIALIZED_LENGTH', 'PRUNE_MAX_DEPTH']
    .map((c) => {
      const m = src.match(new RegExp(`const ${c} = \\d+;`))
      return m ? m[0] : ''
    })
    .join('\n')
  const deps = [
    'isDomNode',
    'snapshotDomNode',
    'domSerializationReplacer',
    'serializeForPrune',
    'prunedValue',
  ]
    .filter((d) => d !== name)
    .map((d) => {
      const m = src.match(new RegExp(`function ${d}\\b[\\s\\S]*?\\n\\}`))
      return m ? m[0] : ''
    })
    .join('\n')
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${constDecls}\n${deps}\n${match[0]}\nreturn ${returnExpr};`)() as Fn
}

// Minimal stand-in for a DOM element with a dataset (jsdom is not loaded here).
function fakeButton(dataset: Record<string, string>) {
  return {
    nodeType: 1,
    tagName: 'BUTTON',
    id: 'inc-btn',
    name: '',
    type: 'button',
    className: 'qty-up',
    dataset,
    // Live DOM method that must NOT survive the network — its presence proves
    // we kept the real element rather than a frozen snapshot.
    closest: () => 'real-element',
  }
}

describe('trigger element survives the server-segment round-trip', () => {
  const pruneContext = extractFn('pruneContext') as (
    ctx: Record<string, unknown>
  ) => Record<string, any>
  const mergeServerResults = extractFn('mergeServerResults') as (
    ctx: Record<string, unknown>,
    results: Record<string, unknown>,
    triggerNodeId?: string
  ) => void

  const TRIGGER_ID = 'c0bc751c-250c-41b0-b4db-0adbd2867574'

  it('pruneContext keeps the trigger element dataset (no __serializationError)', () => {
    const el = fakeButton({
      productId: '1117ddda-a771-4198-80e0-45fd3e7babe0',
      cartItemId: 'cart_1780265668470_nwqtc3wtm',
      currentQuantity: '1',
    })
    const context = {
      [TRIGGER_ID]: { element: el, triggerElement: el },
      triggerElement: el,
      __baseUrl: 'https://example.teleporthq.dev',
    }

    const pruned = pruneContext(context)

    // The pruned trigger node must carry the dataset the server filters on —
    // not the old { __serializationError: true } placeholder.
    expect(pruned[TRIGGER_ID].__serializationError).toBeUndefined()
    expect(pruned[TRIGGER_ID].element.dataset.productId).toBe(
      '1117ddda-a771-4198-80e0-45fd3e7babe0'
    )
    expect(pruned[TRIGGER_ID].element.dataset.cartItemId).toBe('cart_1780265668470_nwqtc3wtm')
    expect(pruned.triggerElement.dataset.currentQuantity).toBe('1')
    // The whole pruned context must be JSON-serializable for the fetch body —
    // i.e. no live DOM node / method leaked through.
    expect(() => JSON.stringify({ context: pruned })).not.toThrow()
    expect(pruned[TRIGGER_ID].element.closest).toBeUndefined()
    expect(pruned.__baseUrl).toBe('https://example.teleporthq.dev')
  })

  it('mergeServerResults preserves the live client trigger element', () => {
    const el = fakeButton({
      productId: '1117ddda-a771-4198-80e0-45fd3e7babe0',
      cartItemId: 'cart_1780265668470_nwqtc3wtm',
      currentQuantity: '1',
    })
    const context: Record<string, any> = {
      [TRIGGER_ID]: { element: el, triggerElement: el },
      triggerElement: el,
    }

    // What the server returns: its own node results PLUS the trigger echoed
    // back as the unhelpful placeholder (pre-fix) and snapshot (post-fix).
    const serverResults = {
      [TRIGGER_ID]: { __serializationError: true },
      triggerElement: { __serializationError: true },
      'c83827c1-stock': { rows: [{ id: 'x', quantity: 25 }], count: 12 },
      '3d274382-if': { result: true },
    }

    mergeServerResults(context, serverResults, TRIGGER_ID)

    // Server node results merged in...
    expect(context['3d274382-if']).toEqual({ result: true })
    expect(context['c83827c1-stock'].count).toBe(12)
    // ...but the trigger element is still the REAL one (method intact), so the
    // downstream client cart-update reads the genuine cartItemId.
    expect(context[TRIGGER_ID].element.closest()).toBe('real-element')
    expect(context[TRIGGER_ID].element.dataset.cartItemId).toBe('cart_1780265668470_nwqtc3wtm')
    expect(context.triggerElement.dataset.cartItemId).toBe('cart_1780265668470_nwqtc3wtm')
  })

  it('mergeServerResults never lets a placeholder clobber a real value', () => {
    const context: Record<string, any> = {
      keep: { real: true },
    }
    mergeServerResults(context, { keep: { __truncated: true }, fresh: { ok: 1 } }, undefined)
    expect(context.keep).toEqual({ real: true })
    expect(context.fresh).toEqual({ ok: 1 })
  })

  it('mergeServerResults never replaces the client __stateValues snapshot', () => {
    // The server only ever READS __stateValues (template tokens, state-get-*
    // handlers) and echoes back the PRUNED copy it was given — in which an
    // oversized state (a picked photo's dataURL) has been replaced by a
    // truncation marker. Merging that copy back would poison the snapshot the
    // remaining client nodes resolve their object-property updates against.
    const live = {
      accountFormData: { name: 'Ada Lovelace', image: 'data:image/png;base64,AAAA' },
      currentUser: { id: 'u-1', image: 'https://cdn/old.png' },
    }
    const context: Record<string, any> = { __stateValues: live }

    mergeServerResults(
      context,
      {
        __stateValues: { accountFormData: { name: 'Ada Lovelace', image: { __truncated: true } } },
        'server-node': { updatedCount: 1 },
      },
      undefined
    )

    expect(context.__stateValues).toBe(live)
    expect(context.__stateValues.currentUser.image).toBe('https://cdn/old.png')
    expect(context['server-node']).toEqual({ updatedCount: 1 })
  })

  it('mergeServerResults still protects the trigger node without an id (custom node)', () => {
    const el = fakeButton({ cartItemId: 'cart_abc' })
    const context: Record<string, any> = {
      [TRIGGER_ID]: { element: el },
      triggerElement: el,
    }
    // Custom-node executor calls without the outer trigger id; the generic
    // .element guard must still preserve it.
    mergeServerResults(context, { [TRIGGER_ID]: { __serializationError: true } }, undefined)
    expect(context[TRIGGER_ID].element.dataset.cartItemId).toBe('cart_abc')
  })
})
