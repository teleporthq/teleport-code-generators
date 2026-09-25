import { generateClientRuntimeCode } from '../src/executor-generator'

// A server segment receives the page state it can read and nothing more: the
// segment descriptor names the state keys (`stateKeys`, see
// segment-context-needs) and `pruneContext` keeps exactly those — at the top
// level and inside the trigger context, which carries the page's own copy of
// the bag. Every other page state stayed in the request before this: a
// checkout page's country list, product grid and order history travelled with
// every voucher check.

type PruneFn = (ctx: Record<string, unknown>, stateKeys?: string[] | '*') => Record<string, any>

function loadPruneContext(): PruneFn {
  const src = generateClientRuntimeCode()
  const grab = (pattern: RegExp, label: string): string => {
    const match = src.match(pattern)
    if (!match) {
      throw new Error(`${label} not found in generated client runtime`)
    }
    return match[0]
  }
  const parts = [
    grab(/const PRUNE_MAX_SERIALIZED_LENGTH = \d+;/, 'PRUNE_MAX_SERIALIZED_LENGTH'),
    grab(/const PRUNE_MAX_DEPTH = \d+;/, 'PRUNE_MAX_DEPTH'),
    ...[
      'isDomNode',
      'snapshotDomNode',
      'domSerializationReplacer',
      'serializeForPrune',
      'prunedValue',
      'pruneStateValues',
      'pruneContext',
    ].map((fn) => grab(new RegExp(`function ${fn}\\b[\\s\\S]*?\\n\\}`), fn)),
  ]
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${parts.join('\n')}\nreturn pruneContext;`)() as PruneFn
}

const pageState = {
  countryCode: 'RO',
  billingCountryInitialItems: [{ label: 'Romania', value: 'RO' }],
  cartItems: [{ id: 'p1' }],
}

const context = () => ({
  trigger: { formData: { code: 'SAVE10' }, __stateValues: { ...pageState } },
  __stateValues: { ...pageState },
  __locale: 'en',
  earlier: { rows: [1, 2] },
})

describe('pruneContext keeps only the page state the segment reads', () => {
  const pruneContext = loadPruneContext()

  it('keeps the named keys, at the top level and inside the trigger context', () => {
    const pruned = pruneContext(context(), ['countryCode'])
    expect(pruned.__stateValues).toEqual({ countryCode: 'RO' })
    expect(pruned.trigger.__stateValues).toEqual({ countryCode: 'RO' })
    // Everything that is not the bag travels as before.
    expect(pruned.trigger.formData).toEqual({ code: 'SAVE10' })
    expect(pruned.earlier).toEqual({ rows: [1, 2] })
    expect(pruned.__locale).toBe('en')
  })

  it('drops the bag altogether when the segment reads no state', () => {
    const pruned = pruneContext(context(), [])
    expect(pruned).not.toHaveProperty('__stateValues')
    expect(pruned.trigger).not.toHaveProperty('__stateValues')
    expect(pruned.trigger.formData).toEqual({ code: 'SAVE10' })
  })

  it('names a key the page does not hold without inventing it', () => {
    const pruned = pruneContext(context(), ['missing', 'cartItems'])
    expect(pruned.__stateValues).toEqual({ cartItems: [{ id: 'p1' }] })
  })

  it('sends the whole bag for "*" and for a caller that names nothing', () => {
    expect(pruneContext(context(), '*').__stateValues).toEqual(pageState)
    expect(pruneContext(context()).__stateValues).toEqual(pageState)
    expect(pruneContext(context()).trigger.__stateValues).toEqual(pageState)
  })

  it('never touches the live context it prunes from', () => {
    const live = context()
    pruneContext(live, ['countryCode'])
    expect(live.__stateValues).toEqual(pageState)
    expect(live.trigger.__stateValues).toEqual(pageState)
  })
})
