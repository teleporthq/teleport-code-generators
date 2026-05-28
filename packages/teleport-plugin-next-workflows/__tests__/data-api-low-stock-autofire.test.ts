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

  it('prefers the live request host, then falls back to NEXTAUTH_URL / VERCEL_URL', () => {
    // Request host wins because NEXTAUTH_URL is a common source of
    // dev foot-guns (stuck at :3000 while the actual dev server
    // is on :3001 — the symptom is a silent "fetch failed" from
    // the fire-and-forget call). Env vars cover the rare
    // serverless background-work case where the request context
    // isn't visible.
    const resolveFn = extractFn(code, 'function resolveSelfBaseUrl')
    expect(resolveFn).toContain('req && req.headers && req.headers.host')
    expect(resolveFn).toContain('process.env.NEXTAUTH_URL')
    expect(resolveFn).toContain('process.env.VERCEL_URL')
    // Order matters: req.headers.host check must appear BEFORE
    // the env var checks.
    const hostIdx = resolveFn.indexOf('req.headers.host')
    const envIdx = resolveFn.indexOf('process.env.NEXTAUTH_URL')
    expect(hostIdx).toBeGreaterThan(0)
    expect(envIdx).toBeGreaterThan(hostIdx)
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
