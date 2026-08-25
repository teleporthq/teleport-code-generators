/**
 * Evaluates an emitted runtime module the way the generated project will, but
 * with every ambient it touches supplied explicitly.
 *
 * Emitted code is only ever exercised in a real deployment, which is the worst
 * possible place to discover that a cache hands back a fresh array reference or
 * throws on a full quota. Running the actual generated source here is the only
 * way these guarantees are tested at all.
 */
export interface FakeStorage {
  readonly length: number
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  key(index: number): string | null
}

export const createFakeStorage = (options: { failOnSet?: boolean } = {}) => {
  const map = new Map<string, string>()
  const storage = {
    get length() {
      return map.size
    },
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      if (options.failOnSet) {
        const error = new Error('quota') as Error & { name: string }
        error.name = 'QuotaExceededError'
        throw error
      }
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    key: (index: number) => Array.from(map.keys())[index] ?? null,
  }
  return { storage: storage as FakeStorage, map }
}

export interface LoadOptions {
  // tslint:disable-next-line:no-any
  requireStub?: (path: string) => any
  // tslint:disable-next-line:no-any
  window?: any
  // tslint:disable-next-line:no-any
  document?: any
  // tslint:disable-next-line:no-any
  performance?: any
  // tslint:disable-next-line:no-any
  fetch?: any
  // tslint:disable-next-line:no-any
  BroadcastChannel?: any
  // tslint:disable-next-line:no-any
  consoleStub?: any
}

const noop = (): undefined => undefined
const NOOP_CONSOLE = { warn: noop, error: noop, log: noop }

// tslint:disable-next-line:no-any
export const loadEmittedModule = (code: string, options: LoadOptions = {}): any => {
  const module = { exports: {} as Record<string, unknown> }
  // tslint:disable-next-line:function-constructor
  const factory = new Function(
    'module',
    'exports',
    'require',
    'window',
    'document',
    'performance',
    'fetch',
    'BroadcastChannel',
    'console',
    code
  )

  factory(
    module,
    module.exports,
    options.requireStub ?? (() => ({})),
    options.window,
    options.document,
    options.performance,
    options.fetch ?? (() => Promise.reject(new Error('no fetch in test'))),
    options.BroadcastChannel,
    options.consoleStub ?? NOOP_CONSOLE
  )

  return module.exports
}

/** A `window` with working session/local storage and an event listener list. */
export const createFakeWindow = (options: { failOnSet?: boolean } = {}) => {
  const session = createFakeStorage(options)
  const local = createFakeStorage()
  const listeners: Record<string, Array<(event: unknown) => void>> = {}

  const documentListeners: Record<string, Array<(event: unknown) => void>> = {}

  return {
    session,
    local,
    listeners,
    documentListeners,
    document: {
      visibilityState: 'visible',
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        documentListeners[type] = documentListeners[type] || []
        documentListeners[type].push(handler)
      },
    },
    window: {
      sessionStorage: session.storage,
      localStorage: local.storage,
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        listeners[type] = listeners[type] || []
        listeners[type].push(handler)
      },
    },
  }
}
