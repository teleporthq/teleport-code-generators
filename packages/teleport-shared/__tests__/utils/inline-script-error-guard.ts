import {
  INLINE_SCRIPT_ERROR_GUARD,
  documentRunsProjectScripts,
} from '../../src/utils/inline-script-error-guard'

/**
 * A project's custom code threw `Cannot read properties of null (reading
 * 'addEventListener')` from an inline script on every page, and the generated
 * Next.js app showed it as an "Unhandled Runtime Error" overlay. The guard runs
 * first in the document and stops errors whose file is the document itself —
 * the project's inline scripts — before any other listener sees them.
 */

const PAGE_URL = 'https://site.test/category/architecture?ref=nav'

interface FakeErrorEvent {
  error: unknown
  filename: string
  preventDefault: jest.Mock
  stopImmediatePropagation: jest.Mock
}

const installGuard = () => {
  const listeners: Array<{
    type: string
    handler: (event: FakeErrorEvent) => void
    capture: boolean
  }> = []
  const fakeWindow = {
    addEventListener: (type: string, handler: (event: FakeErrorEvent) => void, capture: boolean) =>
      listeners.push({ type, handler, capture }),
  }
  const fakeConsole = { warn: jest.fn() }
  // tslint:disable-next-line:function-constructor
  new Function('window', 'document', 'console', INLINE_SCRIPT_ERROR_GUARD)(
    fakeWindow,
    { URL: `${PAGE_URL}#top` },
    fakeConsole
  )

  const dispatch = (filename: string, error: unknown = new TypeError('boom')) => {
    const event: FakeErrorEvent = {
      error,
      filename,
      preventDefault: jest.fn(),
      stopImmediatePropagation: jest.fn(),
    }
    listeners.forEach((listener) => listener.handler(event))
    return event
  }

  return { listeners, dispatch, fakeConsole }
}

describe('INLINE_SCRIPT_ERROR_GUARD', () => {
  it('listens for errors in the capture phase, ahead of every later listener', () => {
    const { listeners } = installGuard()

    expect(listeners).toHaveLength(1)
    expect(listeners[0]).toMatchObject({ type: 'error', capture: true })
  })

  it("stops an error thrown by one of the document's own inline scripts", () => {
    const { dispatch, fakeConsole } = installGuard()
    const error = new TypeError("Cannot read properties of null (reading 'addEventListener')")

    const event = dispatch(PAGE_URL, error)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopImmediatePropagation).toHaveBeenCalled()
    expect(fakeConsole.warn).toHaveBeenCalledWith(expect.any(String), error)
  })

  it('leaves errors from the app bundles and from external scripts alone', () => {
    const { dispatch, fakeConsole } = installGuard()

    const fromBundle = dispatch('https://site.test/_next/static/chunks/pages/index.js')
    const fromCdn = dispatch('https://unpkg.com/blaze-slider/dist/blaze-slider.min.js')

    expect(fromBundle.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(fromCdn.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(fakeConsole.warn).not.toHaveBeenCalled()
  })

  it('leaves events that carry no error alone', () => {
    // A failed image or stylesheet, or a muted cross-origin "Script error."
    const { dispatch } = installGuard()

    expect(dispatch(PAGE_URL, null).stopImmediatePropagation).not.toHaveBeenCalled()
  })
})

describe('documentRunsProjectScripts', () => {
  it('is true for custom code with a script, in the head or the body', () => {
    expect(
      documentRunsProjectScripts({ customCode: { head: '<script>init()</script>' }, assets: [] })
    ).toBe(true)
    expect(
      documentRunsProjectScripts({
        customCode: { body: '<SCRIPT src="/a.js"></SCRIPT>' },
        assets: [],
      })
    ).toBe(true)
  })

  it('is true for an inline script asset', () => {
    expect(
      documentRunsProjectScripts({ assets: [{ type: 'script', content: 'console.log(1)' }] })
    ).toBe(true)
  })

  it('is false when the project runs no script of its own', () => {
    expect(documentRunsProjectScripts({ assets: [] })).toBe(false)
    expect(
      documentRunsProjectScripts({
        customCode: { head: '<style>body { margin: 0 }</style>', body: '<noscript>JS</noscript>' },
        assets: [{ type: 'script', path: 'https://cdn.test/lib.js' }],
      })
    ).toBe(false)
  })
})
