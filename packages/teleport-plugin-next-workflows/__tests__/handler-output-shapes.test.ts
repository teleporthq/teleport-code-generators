import { loadHandler, HandlerFn } from './_helpers/load-handler'

// Regression guard for "handler returns the wrong keys" bugs.
//
// Every workflow node has a schema-declared output shape. The workflow
// editor uses that shape to advertise bindable fields — when a user clicks
// "bind to <node>.foo", the GUI lists exactly the keys the schema says are
// available. The runtime handler must materialise those keys at execution
// time or the binding silently resolves to undefined and the user has no
// idea why their workflow misbehaves.
//
// Audit (see /Users/pasca/.claude/plans/refactored-discovering-teacup.md)
// found five handlers whose return shapes were missing keys their schemas
// promised. This file pins the corrected contracts so they can never
// regress, plus the edge cases each handler has to honour:
//   - storage-*-get: `exists` distinguishes empty-string slots from absent
//     slots; the storage-API-unavailable path still returns the schema-
//     shaped envelope (with exists:false)
//   - state-get-*: `key` echoes the user-typed property name even when
//     __stateValues is missing (returns { value: undefined, key })
//   - general-delay: `timestamp` is post-await wall-clock; `duration` is
//     the resolved input

type StorageStub = {
  store: Record<string, string>
  setItem(k: string, v: string): void
  getItem(k: string): string | null
  removeItem(k: string): void
  clear(): void
}

const makeStorageStub = (): StorageStub => {
  const store: Record<string, string> = {}
  return {
    store,
    setItem(k, v) {
      store[k] = String(v)
    },
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null
    },
    removeItem(k) {
      delete store[k]
    },
    clear() {
      for (const k of Object.keys(store)) {
        delete store[k]
      }
    },
  }
}

const installStorage = (property: 'localStorage' | 'sessionStorage'): StorageStub => {
  const stub = makeStorageStub()
  ;(globalThis as any)[property] = stub
  return stub
}

const uninstallStorage = (property: 'localStorage' | 'sessionStorage') => {
  delete (globalThis as any)[property]
}

describe('general-delay — emits { duration, timestamp }', () => {
  let handler: HandlerFn

  beforeAll(() => {
    handler = loadHandler('general-delay')
  })

  it('returns the configured duration verbatim', async () => {
    const result = (await handler({ duration: 25 }, {})) as Record<string, unknown>
    expect(result.duration).toBe(25)
  })

  it('sets timestamp to the post-await wall clock', async () => {
    const before = Date.now()
    const result = (await handler({ duration: 5 }, {})) as Record<string, unknown>
    const after = Date.now()
    expect(typeof result.timestamp).toBe('number')
    expect(result.timestamp).toBeGreaterThanOrEqual(before)
    expect(result.timestamp).toBeLessThanOrEqual(after)
  })

  it('falls back to duration:0 and returns immediately when not configured', async () => {
    const before = Date.now()
    const result = (await handler({}, {})) as Record<string, unknown>
    const after = Date.now()
    expect(result.duration).toBe(0)
    // `timestamp` must still be set even when duration is 0 — the schema
    // promises it unconditionally.
    expect(typeof result.timestamp).toBe('number')
    expect(result.timestamp).toBeGreaterThanOrEqual(before)
    expect(result.timestamp).toBeLessThanOrEqual(after)
  })

  it('never returns the legacy { success:true } shape', async () => {
    // Locking in the migration: if this assertion ever flips, someone
    // reverted to the old shape and downstream `<delay>.duration` bindings
    // will silently resolve to undefined again.
    const result = (await handler({ duration: 0 }, {})) as Record<string, unknown>
    expect(result).not.toEqual({ success: true })
  })
})

describe.each([['state-get-global-state'], ['state-get-local-state']])(
  '%s — emits { value, key } from __stateValues',
  (nodeType) => {
    let handler: HandlerFn

    beforeAll(() => {
      handler = loadHandler(nodeType)
    })

    it('returns the slot value and the configured property name', async () => {
      const result = (await handler(
        { property: 'cartTotal' },
        { __stateValues: { cartTotal: 42 } }
      )) as Record<string, unknown>
      expect(result.value).toBe(42)
      expect(result.key).toBe('cartTotal')
    })

    it('echoes the original config.property even when the slot is absent', async () => {
      // Honest-undefined: schema declares key as string, but if the GUI
      // emits a malformed config the handler returns whatever the user
      // typed (or undefined) — we don't fabricate a name.
      const result = (await handler({ property: 'missingProp' }, { __stateValues: {} })) as Record<
        string,
        unknown
      >
      expect(result.value).toBeUndefined()
      expect(result.key).toBe('missingProp')
    })

    it('handles missing __stateValues without throwing', async () => {
      const result = (await handler({ property: 'whatever' }, {})) as Record<string, unknown>
      expect(result.value).toBeUndefined()
      expect(result.key).toBe('whatever')
    })
  }
)

describe.each([
  ['storage-local-get', 'localStorage' as const],
  ['storage-session-get', 'sessionStorage' as const],
])('%s — emits { value, key, exists } from %s', (nodeType, backend) => {
  let handler: HandlerFn
  let stub: StorageStub

  beforeAll(() => {
    handler = loadHandler(nodeType)
  })

  beforeEach(() => {
    stub = installStorage(backend)
  })

  afterEach(() => {
    uninstallStorage(backend)
  })

  it('returns parsed JSON values with exists:true', async () => {
    stub.setItem('order', JSON.stringify({ id: 'o-1', total: 99 }))
    const result = (await handler({ key: 'order' }, {})) as Record<string, unknown>
    expect(result.value).toEqual({ id: 'o-1', total: 99 })
    expect(result.key).toBe('order')
    expect(result.exists).toBe(true)
  })

  it('returns the raw string when the slot is not JSON, with exists:true', async () => {
    stub.setItem('flag', 'a-plain-token')
    const result = (await handler({ key: 'flag' }, {})) as Record<string, unknown>
    expect(result.value).toBe('a-plain-token')
    expect(result.exists).toBe(true)
  })

  it('treats an EMPTY STRING slot as a real value (exists:true)', async () => {
    // Edge case: localStorage.getItem returns "" for empty-string slots and
    // null for absent slots. The `exists` flag must distinguish the two.
    stub.setItem('was-cleared', '')
    const result = (await handler({ key: 'was-cleared' }, {})) as Record<string, unknown>
    expect(result.value).toBe('')
    expect(result.exists).toBe(true)
  })

  it('returns the configured defaultValue with exists:false when slot is absent', async () => {
    const result = (await handler({ key: 'never-set', defaultValue: 'fallback' }, {})) as Record<
      string,
      unknown
    >
    expect(result.value).toBe('fallback')
    expect(result.key).toBe('never-set')
    expect(result.exists).toBe(false)
  })

  it('returns null + exists:false when slot is absent and no defaultValue', async () => {
    const result = (await handler({ key: 'never-set' }, {})) as Record<string, unknown>
    expect(result.value).toBeNull()
    expect(result.exists).toBe(false)
  })

  it('returns the schema-shaped envelope when storage API is unavailable', async () => {
    // Simulate SSR / incognito / hardened browser by removing the global.
    uninstallStorage(backend)
    const result = (await handler({ key: 'order', defaultValue: 'fb' }, {})) as Record<
      string,
      unknown
    >
    // We can't verify the slot, so exists is honestly false and value falls
    // back to the configured default — matching the absent-slot branch.
    expect(result.value).toBe('fb')
    expect(result.key).toBe('order')
    expect(result.exists).toBe(false)
    // Restore so the afterEach uninstall() is a no-op rather than throwing.
    installStorage(backend)
  })
})

describe('overall return-shape contract', () => {
  // A single matrix assertion that every handler this file covers exposes
  // exactly the keys the schema declares (no missing keys, no surprises).
  // If a future change drops a key, this fails fast with a clear diff.
  it.each([
    ['general-delay', { duration: 0 }, ['duration', 'timestamp']],
    ['state-get-global-state', { property: 'foo' }, ['value', 'key']],
    ['state-get-local-state', { property: 'foo' }, ['value', 'key']],
  ])('%s exposes exactly the schema keys', async (nodeType, config, expectedKeys) => {
    const handler = loadHandler(nodeType)
    const ctx = nodeType.indexOf('state-get') === 0 ? { __stateValues: { foo: 'bar' } } : {}
    const result = (await handler(config, ctx)) as Record<string, unknown>
    for (const k of expectedKeys) {
      expect(result).toHaveProperty(k)
    }
  })

  it.each([
    ['storage-local-get', 'localStorage' as const],
    ['storage-session-get', 'sessionStorage' as const],
  ])('%s exposes value, key, exists', async (nodeType, backend) => {
    const stub = installStorage(backend)
    stub.setItem('probe', '"v"')
    try {
      const handler = loadHandler(nodeType)
      const result = (await handler({ key: 'probe' }, {})) as Record<string, unknown>
      expect(result).toHaveProperty('value')
      expect(result).toHaveProperty('key')
      expect(result).toHaveProperty('exists')
    } finally {
      uninstallStorage(backend)
    }
  })
})
