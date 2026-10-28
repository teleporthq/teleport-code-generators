import * as nodeCrypto from 'crypto'
import { generateCartApiRoute } from '../src/ecommerce/cart-api-routes-generator'
import { generateEcommerceContextFileContent } from '../src/ecommerce/ecommerce-context-generator'
import type { UIDLEcommerceSettings } from '@teleporthq/teleport-types'

/**
 * A guest's cart is keyed by a random id: the storefront's session id (in the
 * browser) and the cart rows' ids (in the cart API routes). Where
 * `crypto.randomUUID` is missing — any page served without HTTPS, an older
 * Node — the id comes from the platform's cryptographic generator
 * (`crypto.getRandomValues`, `crypto.randomBytes`), never `Math.random`, whose
 * output can be predicted and would let one shopper guess another's cart key.
 * EXECUTED: each generated function runs with `randomUUID` taken away.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const settings = {
  cashOnDelivery: true,
  deliveryEnabled: true,
  storePickupEnabled: false,
  guestCheckout: true,
  stockManagement: false,
  orderNotifications: false,
  deliveryConfig: null,
  stockManagementConfig: null,
  orderNotificationConfig: null,
  paymentProviders: [],
} as unknown as UIDLEcommerceSettings

/** The source of `function <name>(…) { … }` in generated code, up to its closing brace at column 0. */
const functionSource = (code: string, name: string): string => {
  const start = code.indexOf(`function ${name}(`)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = code.indexOf('\n}\n', start)
  return code.slice(start, end + 2)
}

describe('the cart API routes key a cart from a cryptographic generator', () => {
  const source = functionSource(
    generateCartApiRoute('postgresql', { connectionString: 'env:DATABASE_URL' }) as string,
    'generateUUID'
  )
  const load = (cryptoGlobal: unknown, nodeModule: unknown) =>
    // eslint-disable-next-line no-new-func
    new Function('crypto', 'require', `${source}\nreturn generateUUID;`)(
      cryptoGlobal,
      (id: string) => (id === 'crypto' ? nodeModule : undefined)
    ) as () => string

  it('never uses Math.random', () => {
    expect(source).not.toContain('Math.random')
  })

  it('falls back to randomBytes where randomUUID is missing, as a v4 UUID', () => {
    const randomBytes = jest.fn((size: number) => nodeCrypto.randomBytes(size))
    const generate = load(undefined, { randomBytes })
    const ids = [generate(), generate()]
    expect(ids[0]).toMatch(UUID_V4)
    expect(ids[1]).toMatch(UUID_V4)
    expect(ids[0]).not.toBe(ids[1])
    expect(randomBytes).toHaveBeenCalledWith(16)
  })

  it('prefers randomUUID, global or from the module', () => {
    expect(load({ randomUUID: () => 'global-id' }, {})()).toBe('global-id')
    expect(load(undefined, { randomUUID: () => 'module-id' })()).toBe('module-id')
  })
})

describe("the storefront's guest session id comes from a cryptographic generator", () => {
  const source = functionSource(
    generateEcommerceContextFileContent(settings, undefined, 'ds-1', true),
    'getOrCreateSessionId'
  )
  const run = (cryptoGlobal: unknown) => {
    const stored: Record<string, string> = {}
    const localStorage = {
      getItem: (key: string) => (key in stored ? stored[key] : null),
      setItem: (key: string, value: string) => {
        stored[key] = value
      },
    }
    // eslint-disable-next-line no-new-func
    const getOrCreateSessionId = new Function(
      'window',
      'localStorage',
      'crypto',
      'CART_SESSION_KEY',
      `${source}\nreturn getOrCreateSessionId;`
    )({}, localStorage, cryptoGlobal, 'workflow_cart_session_id') as () => string | null
    return { id: getOrCreateSessionId(), stored }
  }

  it('never uses Math.random', () => {
    expect(source).not.toContain('Math.random')
  })

  it('falls back to getRandomValues outside a secure context, as a v4 UUID it keeps', () => {
    const getRandomValues = jest.fn((bytes: Uint8Array) => nodeCrypto.randomFillSync(bytes))
    const { id, stored } = run({ getRandomValues })
    expect(id).toMatch(UUID_V4)
    expect(stored.workflow_cart_session_id).toBe(id)
    expect(getRandomValues).toHaveBeenCalledTimes(1)
  })

  it('makes no key at all without a cryptographic generator', () => {
    const random = jest.spyOn(Math, 'random')
    try {
      expect(run(undefined)).toEqual({ id: null, stored: {} })
      expect(random).not.toHaveBeenCalled()
    } finally {
      random.mockRestore()
    }
  })

  it('prefers randomUUID', () => {
    expect(run({ randomUUID: () => 'secure-id' }).id).toBe('secure-id')
  })
})
