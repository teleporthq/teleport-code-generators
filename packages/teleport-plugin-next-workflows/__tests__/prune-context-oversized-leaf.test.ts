import { generateClientRuntimeCode } from '../src/executor-generator'

// A server segment resolves its node configs from the context the CLIENT
// POSTs, and `pruneContext` is what builds that payload. It used to replace
// any context entry whose serialization exceeded 100 000 characters with a
// single `{ __truncated: true }` marker — the entire entry, not just the part
// that was too big.
//
// That is exactly the shape the profile form produces. Picking a new photo
// writes the file's base64 dataURL into `accountFormData.image`, so the
// `state-get-local-state` node that reads the form data ends up holding
//   { value: { name: 'Ada Lovelace', image: 'data:image/png;base64,<~2 MB>' } }
// The whole entry blew the budget, the server saw `{ __truncated: true }`,
// `[<node>, 'value', 'name']` resolved to `undefined`, and `data-update-item`
// DROPS an undefined column mapping — so saving a new picture silently stopped
// saving the name (and every custom account property) alongside it.
//
// The pruner now descends: only the oversized LEAF becomes a marker, and every
// sibling still crosses intact.

type PruneFn = (ctx: Record<string, unknown>) => Record<string, any>

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
      'pruneContext',
    ].map((fn) => grab(new RegExp(`function ${fn}\\b[\\s\\S]*?\\n\\}`), fn)),
  ]
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${parts.join('\n')}\nreturn pruneContext;`)() as PruneFn
}

const HUGE = 'data:image/png;base64,' + 'A'.repeat(300000)

describe('pruneContext salvages the small fields next to an oversized one', () => {
  const pruneContext = loadPruneContext()

  it('keeps sibling keys when one property is too large to send', () => {
    const pruned = pruneContext({
      formData: {
        value: { name: 'Ada Lovelace', image: HUGE, role: 'user' },
        key: 'accountFormData',
      },
    })

    expect(pruned.formData.value.name).toBe('Ada Lovelace')
    expect(pruned.formData.value.role).toBe('user')
    expect(pruned.formData.key).toBe('accountFormData')
    expect(pruned.formData.value.image).toEqual({ __truncated: true, type: 'string' })
  })

  it('salvages per-state entries inside the __stateValues bag', () => {
    const pruned = pruneContext({
      __stateValues: {
        accountFormData: { name: 'Ada Lovelace', image: HUGE },
        currentUser: { id: 'u-1', name: 'Ada Lovelace', image: 'https://cdn/old.png' },
        accountFormButtonState: 'updating',
      },
    })

    expect(pruned.__stateValues.currentUser).toEqual({
      id: 'u-1',
      name: 'Ada Lovelace',
      image: 'https://cdn/old.png',
    })
    expect(pruned.__stateValues.accountFormButtonState).toBe('updating')
    expect(pruned.__stateValues.accountFormData.name).toBe('Ada Lovelace')
  })

  it('keeps array element positions stable while truncating a heavy entry', () => {
    const pruned = pruneContext({
      picked: { value: [{ name: 'photo.png', type: 'image/png', dataURL: HUGE }], key: 'files' },
    })

    expect(pruned.picked.value).toHaveLength(1)
    expect(pruned.picked.value[0].name).toBe('photo.png')
    expect(pruned.picked.value[0].type).toBe('image/png')
    expect(pruned.picked.value[0].dataURL).toEqual({ __truncated: true, type: 'string' })
  })

  it('still replaces a bare oversized value with a marker', () => {
    const pruned = pruneContext({ blob: HUGE })
    expect(pruned.blob).toEqual({ __truncated: true, type: 'string' })
  })

  it('leaves values that fit exactly as they were', () => {
    const pruned = pruneContext({ small: { a: 1, b: [2, 3], c: null } })
    expect(pruned.small).toEqual({ a: 1, b: [2, 3], c: null })
  })

  it('bounds what one oversized container may contribute to the payload', () => {
    // Ten ~50 000-char siblings: each fits on its own, but the container as a
    // whole does not. The per-container budget must stop the pruned copy from
    // ballooning past what the old whole-value rule allowed.
    const chunks: Record<string, string> = {}
    for (let i = 0; i < 10; i++) {
      chunks['chunk' + i] = 'x'.repeat(50000)
    }
    const pruned = pruneContext({ chunks })
    expect(JSON.stringify(pruned).length).toBeLessThan(160000)
    expect(pruned.chunks.chunk0).toBe('x'.repeat(50000))
    expect(pruned.chunks.chunk9).toEqual({ __truncated: true, type: 'string' })
  })

  it('never emits a payload that cannot be JSON-serialized', () => {
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular
    const pruned = pruneContext({ circular, ok: { fine: true } })
    expect(() => JSON.stringify({ context: pruned })).not.toThrow()
    expect(pruned.ok).toEqual({ fine: true })
  })
})
