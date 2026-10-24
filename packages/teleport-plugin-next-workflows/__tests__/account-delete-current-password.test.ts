import { loadHandler, HandlerFn } from './_helpers/load-handler'
import { bindWorkflowUtils } from './_helpers/bind-workflow-utils'

/**
 * The delete-account handler posts to the site's delete route. A template that
 * asks for the password passes what the visitor typed, and the route checks it
 * before deleting anything; a template without a password posts an empty body,
 * as the store's own Delete account always has.
 */

const installBrowser = () => {
  const element = { textContent: '', setAttribute: jest.fn() }
  ;(globalThis as any).window = {
    location: { href: '' },
    localStorage: { setItem: jest.fn(), removeItem: jest.fn() },
    dispatchEvent: jest.fn(),
    setTimeout: (fn: () => void) => fn(),
    document: { createElement: () => element, body: { appendChild: jest.fn() } },
    __teleportNextAuth: { signOut: jest.fn(async () => undefined) },
  }
  ;(globalThis as any).CustomEvent = class {
    constructor(public type: string, public init?: unknown) {}
  }
}

describe('account-delete-current sends the password it is given', () => {
  let unbindWorkflowUtils: () => void
  let fetchMock: jest.Mock

  beforeAll(() => {
    unbindWorkflowUtils = bindWorkflowUtils()
  })

  afterAll(() => {
    unbindWorkflowUtils()
  })

  beforeEach(() => {
    installBrowser()
    fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) }))
    ;(globalThis as any).fetch = fetchMock
  })

  afterEach(() => {
    delete (globalThis as any).window
    delete (globalThis as any).CustomEvent
    delete (globalThis as any).fetch
  })

  const postedBody = () => JSON.parse(fetchMock.mock.calls[0][1].body)

  it('posts the typed password to the delete route', async () => {
    const handler: HandlerFn = loadHandler('account-delete-current')
    await handler({ password: 'typed-secret' }, {})
    expect(fetchMock.mock.calls[0][0]).toBe('/api/account/delete-current')
    expect(postedBody()).toEqual({ password: 'typed-secret' })
  })

  it('posts an empty body when the template asks for no password', async () => {
    const handler: HandlerFn = loadHandler('account-delete-current')
    await handler({ redirectTo: '/' }, {})
    expect(postedBody()).toEqual({})
  })

  it("throws the route's message when the password is refused", async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      json: async () => ({ error: 'Incorrect password' }),
    }))
    const handler: HandlerFn = loadHandler('account-delete-current')
    await expect(handler({ password: 'wrong' }, {})).rejects.toThrow('Incorrect password')
  })
})
