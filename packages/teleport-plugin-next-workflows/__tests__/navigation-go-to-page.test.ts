/* tslint:disable:no-eval */
import { navigationGoToPage } from '../src/nodes/navigation/navigation-go-to-page'

function createHandler() {
  const fnStr = navigationGoToPage.generateHandler()
  return eval('(' + fnStr + ')')
}

interface FakeWindow {
  location: { href: string }
  open: jest.Mock
}

function withWindow(): FakeWindow {
  const fake: FakeWindow = {
    location: { href: '' },
    open: jest.fn(),
  }
  ;(global as any).window = fake
  return fake
}

describe('navigation-go-to-page', () => {
  let handler: any
  let win: FakeWindow

  beforeAll(() => {
    handler = createHandler()
  })

  beforeEach(() => {
    win = withWindow()
  })

  afterEach(() => {
    delete (global as any).window
  })

  describe('legacy UIDL (no targetPage)', () => {
    it('navigates to the rewritten pageId', async () => {
      const result = await handler({ pageId: '/about', openInNewTab: false }, {})
      expect(win.location.href).toBe('/about')
      expect(result).toEqual({ __terminal: true })
    })

    it('opens the rewritten pageId in a new tab when requested', async () => {
      await handler({ pageId: '/about', openInNewTab: true }, {})
      expect(win.open).toHaveBeenCalledWith('/about', '_blank')
      expect(win.location.href).toBe('')
    })

    it('falls back to "/" when pageId is empty', async () => {
      await handler({ pageId: '', openInNewTab: false }, {})
      expect(win.location.href).toBe('/')
    })
  })

  describe('static target page', () => {
    // For NON-details pages, pageId wins: the project plugin's `runBefore`
    // step rewrites `pageId` to the authoritative Next.js route, while
    // `targetPage.staticUrl` is a mapper best-guess that can diverge from
    // the real route (e.g. home ships as `/home` but Next serves it at `/`).
    it('uses pageId in preference to targetPage.staticUrl for non-details pages', async () => {
      await handler(
        {
          pageId: '/about-us',
          openInNewTab: false,
          targetPage: {
            pageId: 'page_about',
            staticUrl: '/should-be-ignored',
            isDetailsPage: false,
          },
        },
        {}
      )
      expect(win.location.href).toBe('/about-us')
    })

    it('falls back to targetPage.staticUrl when pageId is missing', async () => {
      await handler(
        {
          openInNewTab: false,
          targetPage: {
            pageId: 'page_about',
            staticUrl: '/about-us',
            isDetailsPage: false,
          },
        },
        {}
      )
      expect(win.location.href).toBe('/about-us')
    })
  })

  describe('details page differentiator', () => {
    it('appends a static differentiator as an encoded path segment', async () => {
      await handler(
        {
          openInNewTab: false,
          differentiator: 'ORD-000042',
          targetPage: {
            staticUrl: '/order-success',
            isDetailsPage: true,
            differentiatorColumn: 'order_number',
          },
        },
        {}
      )
      expect(win.location.href).toBe('/order-success/ORD-000042')
    })

    it('URL-encodes a differentiator that contains reserved characters', async () => {
      await handler(
        {
          openInNewTab: false,
          differentiator: 'order #42/?',
          targetPage: { staticUrl: '/order-success', isDetailsPage: true },
        },
        {}
      )
      expect(win.location.href).toBe('/order-success/order%20%2342%2F%3F')
    })

    it('falls back to the static prefix when the differentiator is missing', async () => {
      await handler(
        {
          openInNewTab: false,
          targetPage: { staticUrl: '/order-success', isDetailsPage: true },
        },
        {}
      )
      expect(win.location.href).toBe('/order-success')
    })

    it('falls back to the static prefix when the differentiator resolved to undefined', async () => {
      // Simulates the case where the upstream workflowContext ref pointed at a
      // node that failed at runtime — `resolveConfig` would have left the
      // differentiator as `undefined` after resolution.
      await handler(
        {
          openInNewTab: false,
          differentiator: undefined,
          targetPage: { staticUrl: '/order-success', isDetailsPage: true },
        },
        {}
      )
      expect(win.location.href).toBe('/order-success')
    })

    it('coerces non-string differentiators to strings', async () => {
      await handler(
        {
          openInNewTab: false,
          differentiator: 42,
          targetPage: { staticUrl: '/order-success', isDetailsPage: true },
        },
        {}
      )
      expect(win.location.href).toBe('/order-success/42')
    })
  })

  describe('queryParams', () => {
    it('appends a single static query param', async () => {
      await handler(
        {
          openInNewTab: false,
          queryParams: [{ key: 'ref', value: 'checkout' }],
          targetPage: { staticUrl: '/about', isDetailsPage: false },
        },
        {}
      )
      expect(win.location.href).toBe('/about?ref=checkout')
    })

    it('joins multiple query params with &', async () => {
      await handler(
        {
          openInNewTab: false,
          queryParams: [
            { key: 'ref', value: 'checkout' },
            { key: 'utm_source', value: 'email' },
          ],
          targetPage: { staticUrl: '/about', isDetailsPage: false },
        },
        {}
      )
      expect(win.location.href).toBe('/about?ref=checkout&utm_source=email')
    })

    it('URL-encodes query keys and values', async () => {
      await handler(
        {
          openInNewTab: false,
          queryParams: [{ key: 'q+1', value: 'hello world&more' }],
          targetPage: { staticUrl: '/search', isDetailsPage: false },
        },
        {}
      )
      expect(win.location.href).toBe('/search?q%2B1=hello%20world%26more')
    })

    it('skips entries with an empty key', async () => {
      await handler(
        {
          openInNewTab: false,
          queryParams: [
            { key: '', value: 'ignored' },
            { key: 'ref', value: 'checkout' },
          ],
          targetPage: { staticUrl: '/about', isDetailsPage: false },
        },
        {}
      )
      expect(win.location.href).toBe('/about?ref=checkout')
    })

    it('keeps entries with empty values (emits key=)', async () => {
      await handler(
        {
          openInNewTab: false,
          queryParams: [{ key: 'ref', value: '' }],
          targetPage: { staticUrl: '/about', isDetailsPage: false },
        },
        {}
      )
      expect(win.location.href).toBe('/about?ref=')
    })

    it('combines a details-page differentiator with query params', async () => {
      await handler(
        {
          openInNewTab: false,
          differentiator: 'ORD-000042',
          queryParams: [{ key: 'ref', value: 'checkout' }],
          targetPage: {
            staticUrl: '/order-success',
            isDetailsPage: true,
            differentiatorColumn: 'order_number',
          },
        },
        {}
      )
      expect(win.location.href).toBe('/order-success/ORD-000042?ref=checkout')
    })
  })
})
