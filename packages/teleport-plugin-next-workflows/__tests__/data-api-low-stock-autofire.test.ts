import { generateDataAPIRoute } from '../src/data-api-route-generator'

// Regression guard for "merchant configured low-stock alerts but
// no email arrives after a purchase". The workflow's place-order
// chain decrements stock and then runs a follow-up SELECT to find
// products at or below the threshold — but the AI-generated email-
// payload node returns skip: true and never dispatches. We close
// that gap from the data-api side: when handleRawQuery sees the
// post-decrement SELECT pattern with rows, it fires a POST to
// /api/ecommerce/low-stock-alert (the actual sender).
//
// Detection has to be precise enough to avoid false positives on
// unrelated stock queries (e.g. an inventory dashboard SELECT).
// We do that by requiring THREE signals in the SAME query string:
// SELECT, FROM teleport_products, WHERE...quantity...<=

const extractFn = (haystack: string, decl: string): string => {
  const start = haystack.indexOf(decl)
  if (start === -1) {
    throw new Error('decl not found: ' + decl)
  }
  let depth = 0
  let i = haystack.indexOf('{', start)
  if (i === -1) {
    throw new Error('no brace after ' + decl)
  }
  for (; i < haystack.length; i++) {
    const ch = haystack.charAt(i)
    if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        return haystack.slice(start, i + 1)
      }
    }
  }
  throw new Error('unbalanced braces in ' + decl)
}

describe('data-api emits LOW_STOCK_ALERTS_ENABLED + threshold constants', () => {
  it('emits LOW_STOCK_ALERTS_ENABLED = false by default', () => {
    const code = generateDataAPIRoute()
    expect(code).toContain('const LOW_STOCK_ALERTS_ENABLED = false')
    expect(code).toContain('const LOW_STOCK_THRESHOLD = 5')
  })

  it('emits LOW_STOCK_ALERTS_ENABLED = true when option is set', () => {
    const code = generateDataAPIRoute({ lowStockAlertsEnabled: true, lowStockThreshold: 12 })
    expect(code).toContain('const LOW_STOCK_ALERTS_ENABLED = true')
    expect(code).toContain('const LOW_STOCK_THRESHOLD = 12')
  })

  it('coerces a negative threshold to the safe default', () => {
    const code = generateDataAPIRoute({ lowStockAlertsEnabled: true, lowStockThreshold: -1 })
    expect(code).toContain('const LOW_STOCK_THRESHOLD = 5')
  })
})

describe('looksLikeLowStockProductSelect — SQL pattern detector', () => {
  const code = generateDataAPIRoute({ lowStockAlertsEnabled: true })
  const detector = new Function(
    `${extractFn(
      code,
      'function looksLikeLowStockProductSelect'
    )}\nreturn looksLikeLowStockProductSelect;`
  )() as (q: string) => boolean

  it('matches the canonical post-decrement low-stock SELECT', () => {
    const query =
      "SELECT id, name, quantity AS stock, COALESCE(sku, '') AS sku FROM teleport_products " +
      "WHERE quantity IS NOT NULL AND quantity <= 5 AND id IN ('a','b')"
    expect(detector(query)).toBe(true)
  })

  it('matches even with lowercase and odd whitespace', () => {
    expect(detector('select * from teleport_products where quantity<=3')).toBe(true)
    expect(detector('SELECT\nx\nFROM teleport_products\nWHERE quantity <= 0')).toBe(true)
  })

  it('rejects an UPDATE that touches quantity (not a SELECT)', () => {
    expect(detector("UPDATE teleport_products SET quantity = quantity - 1 WHERE id IN ('a')")).toBe(
      false
    )
  })

  it('rejects a SELECT on a different table', () => {
    expect(detector('SELECT * FROM teleport_orders WHERE quantity <= 5')).toBe(false)
  })

  it('rejects a SELECT without a <= comparator on quantity', () => {
    expect(detector('SELECT id FROM teleport_products WHERE quantity > 0')).toBe(false)
  })

  it('rejects empty / null / non-string queries', () => {
    expect(detector('')).toBe(false)
    expect(detector(null as any)).toBe(false)
    expect(detector(123 as any)).toBe(false)
  })
})

describe('extractThresholdFromQuery — read threshold from WHERE', () => {
  const code = generateDataAPIRoute({ lowStockAlertsEnabled: true, lowStockThreshold: 5 })
  const extractor = new Function(
    `const LOW_STOCK_THRESHOLD = 5;\n${extractFn(
      code,
      'function extractThresholdFromQuery'
    )}\nreturn extractThresholdFromQuery;`
  )() as (q: string) => number

  it('reads an integer threshold', () => {
    expect(extractor('SELECT FROM teleport_products WHERE quantity <= 7')).toBe(7)
  })

  it('reads a float threshold', () => {
    expect(extractor('SELECT FROM teleport_products WHERE quantity <= 0.5')).toBe(0.5)
  })

  it('falls back to LOW_STOCK_THRESHOLD when the comparison is via a placeholder', () => {
    expect(extractor('SELECT FROM teleport_products WHERE quantity <= $1')).toBe(5)
  })

  it('falls back when the query has no <= at all', () => {
    expect(extractor('SELECT * FROM teleport_products')).toBe(5)
  })
})

describe('handleRawQuery — wires the auto-fire correctly', () => {
  const code = generateDataAPIRoute({ lowStockAlertsEnabled: true, lowStockThreshold: 5 })

  it('passes req to handleRawQuery from the dispatcher', () => {
    // The dispatcher (case 'raw-query') must forward req so the
    // auto-fire can derive the self base URL from the request
    // host header. Without it we fall back to env vars only,
    // which aren't set in typical dev.
    expect(code).toContain('handleRawQuery(client, body, req)')
  })

  it('handleRawQuery accepts (client, body, req)', () => {
    expect(code).toContain('async function handleRawQuery(client, body, req)')
  })

  it('only fires the alert under the three required guards', () => {
    // Guard 1: LOW_STOCK_ALERTS_ENABLED at codegen time
    // Guard 2: rows.length > 0 at request time
    // Guard 3: looksLikeLowStockProductSelect at request time
    expect(code).toContain(
      'if (LOW_STOCK_ALERTS_ENABLED && rows.length > 0 && looksLikeLowStockProductSelect(query))'
    )
  })

  it('the alert call is fire-and-forget — does NOT await the response', () => {
    // The auto-fire MUST not block the data-api response back to
    // the workflow. The workflow proceeds; the alert email is
    // dispatched asynchronously by the alert endpoint.
    const fireFn = extractFn(code, 'function fireAndForgetLowStockAlert')
    expect(fireFn).not.toMatch(/await\s+fetchImpl\(/)
    expect(fireFn).toContain('.catch(function(err)')
  })

  it("posts to the store's own origin, never to a host the request named", () => {
    // Outside Vercel the Host header is whatever the caller sent, and the POST
    // carries the store's stock levels: it goes to NEXTAUTH_URL's origin, the
    // rule of the server runtime's trustedBaseUrl. A local dev server on another
    // port than a local NEXTAUTH_URL (stuck at :3000 while `next dev` runs on
    // :3001) keeps its own address; on Vercel the routed host is the store's.
    const resolveFn =
      extractFn(code, 'function isLoopbackHost') +
      '\n' +
      extractFn(code, 'function resolveSelfBaseUrl')
    const resolveWith = (env: Record<string, string>, headers: Record<string, string> | null) =>
      // tslint:disable-next-line:function-constructor
      new Function('process', 'req', `${resolveFn}\nreturn resolveSelfBaseUrl(req);`)(
        { env },
        headers ? { headers } : null
      )

    const shop = { NEXTAUTH_URL: 'https://shop.example/some/path' }
    expect(resolveWith(shop, { host: 'evil.test' })).toBe('https://shop.example')
    expect(resolveWith(shop, { host: 'evil.test', 'x-forwarded-proto': 'http' })).toBe(
      'https://shop.example'
    )
    expect(resolveWith({ ...shop, VERCEL: '1' }, { host: 'shop.vercel.app' })).toBe(
      'https://shop.vercel.app'
    )
    expect(resolveWith({ NEXTAUTH_URL: 'http://localhost:3000' }, { host: 'localhost:3001' })).toBe(
      'http://localhost:3001'
    )
    expect(resolveWith({}, { host: 'localhost:3001' })).toBe('http://localhost:3001')
    // No request context: the configured origins, as before.
    expect(resolveWith(shop, null)).toBe('https://shop.example/some/path')
    expect(resolveWith({ VERCEL_URL: 'shop.vercel.app' }, null)).toBe('https://shop.vercel.app')
  })

  it('presents the app secret to the alert route, on the store origin', () => {
    // The alert route emails the merchant only for the store's own server code.
    const fireFn = [
      'function isLoopbackHost',
      'function resolveSelfBaseUrl',
      'function fireAndForgetLowStockAlert',
    ]
      .map((decl) => extractFn(code, decl))
      .join('\n')
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const fetchImpl = (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers })
      return Promise.resolve({ ok: true })
    }
    // tslint:disable-next-line:function-constructor
    new Function(
      'process',
      'fetch',
      'console',
      'LOW_STOCK_ALERTS_ENABLED',
      `${fireFn}\nfireAndForgetLowStockAlert({ headers: { host: 'evil.test' } }, [{ id: 'p1', name: 'Mug', quantity: 1 }], 5);`
    )(
      { env: { NEXTAUTH_SECRET: 'app-secret', NEXTAUTH_URL: 'https://shop.example' } },
      fetchImpl,
      { log: () => undefined, warn: () => undefined, error: () => undefined },
      true
    )
    expect(calls).toEqual([
      {
        url: 'https://shop.example/api/ecommerce/low-stock-alert',
        headers: { 'Content-Type': 'application/json', 'x-internal-data-secret': 'app-secret' },
      },
    ])
  })

  it('skips the auto-fire when LOW_STOCK_ALERTS_ENABLED is false (no flag, no detection cost)', () => {
    const noopCode = generateDataAPIRoute({ lowStockAlertsEnabled: false })
    expect(noopCode).toContain('const LOW_STOCK_ALERTS_ENABLED = false')
    // The guard still appears (single conditional), so the
    // short-circuit is a no-op at runtime — what matters is that
    // the flag wins.
    expect(noopCode).toContain(
      'if (LOW_STOCK_ALERTS_ENABLED && rows.length > 0 && looksLikeLowStockProductSelect(query))'
    )
  })
})
