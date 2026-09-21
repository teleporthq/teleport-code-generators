import { generateCartApiRoute } from '../src/ecommerce/cart-api-routes-generator'
import { generateEcommerceContextFileContent } from '../src/ecommerce/ecommerce-context-generator'

// The abandoned-cart reminder runs from a cron, with no visitor behind it, so
// the language it emails a shopper in has to be remembered on the cart itself.
// The provider sends the page locale with every sync; the route writes it to
// `teleport_cart.locale` — and ONLY once it has confirmed the column exists,
// because a store provisioned before the column must keep syncing as before
// (a failed UPDATE inside the sync transaction would roll the whole cart back).

const PG_CFG = { connectionString: 'env:DATABASE_URL' }

const extractFunctionSource = (haystack: string, funcDecl: string): string => {
  const startIdx = haystack.indexOf(funcDecl)
  if (startIdx === -1) {
    throw new Error('Helper not found: ' + funcDecl)
  }
  let depth = 0
  let i = haystack.indexOf('{', startIdx)
  for (; i < haystack.length; i++) {
    const ch = haystack.charAt(i)
    if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        return haystack.slice(startIdx, i + 1)
      }
    }
  }
  throw new Error('Unbalanced braces for ' + funcDecl)
}

describe('cart route — storefront language on the cart row', () => {
  const route = generateCartApiRoute('postgresql', PG_CFG) as string

  it('validates the language through the shared locale module', () => {
    expect(route).toContain("var emailLocale = require('../../../utils/email/email-locale')")
    expect(route).toContain('emailLocale.normalizeEmailLocale(body && body.locale)')
  })

  it('checks the column once per process before ever writing it', () => {
    expect(route).toContain("table_name = 'teleport_cart' AND column_name = 'locale' LIMIT 1")
    expect(route).toContain('if (cartLocaleColumnPresent !== null) return cartLocaleColumnPresent')
  })

  it('touches the cart through the locale-aware helper inside the sync transaction', () => {
    expect(route).toContain('await touchCart(client, cartId, body)')
    expect(route).not.toContain(
      "await client.query('UPDATE teleport_cart SET updated_at = NOW() WHERE id = $1', [cartId])\n    await client.query('COMMIT')"
    )
  })

  it('writes the locale only when it is known AND the column exists', async () => {
    const source = extractFunctionSource(route, 'async function touchCart(')
    const queries: Array<{ sql: string; params: unknown[] }> = []
    const client = {
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params })
        return { rows: [] }
      },
    }
    const emailLocale = {
      normalizeEmailLocale: (value: unknown) => (value === 'es' ? 'es' : null),
    }
    const run = async (columnPresent: boolean, body: unknown) => {
      queries.length = 0
      // eslint-disable-next-line no-new-func
      const touchCart = new Function(
        'emailLocale',
        'cartHasLocaleColumn',
        `${source}; return touchCart;`
      )(emailLocale, async () => columnPresent)
      await touchCart(client, 'cart-1', body)
      return queries
    }

    expect(await run(true, { locale: 'es' })).toEqual([
      {
        sql: 'UPDATE teleport_cart SET updated_at = NOW(), locale = $2 WHERE id = $1',
        params: ['cart-1', 'es'],
      },
    ])
    expect(await run(false, { locale: 'es' })).toEqual([
      { sql: 'UPDATE teleport_cart SET updated_at = NOW() WHERE id = $1', params: ['cart-1'] },
    ])
    expect(await run(true, { locale: 'xx' })).toEqual([
      { sql: 'UPDATE teleport_cart SET updated_at = NOW() WHERE id = $1', params: ['cart-1'] },
    ])
    expect(await run(true, undefined)).toEqual([
      { sql: 'UPDATE teleport_cart SET updated_at = NOW() WHERE id = $1', params: ['cart-1'] },
    ])
  })
})

describe('ecommerce provider — cart sync carries the page locale', () => {
  it('reads the live page locale through the shared module and sends it with the synced items', () => {
    const content = generateEcommerceContextFileContent(
      { enabled: true } as any,
      undefined,
      'ds-1',
      true,
      false
    )
    // Live, not `window.__NEXT_DATA__.locale`: the page data keeps the locale
    // the document was served in after a client-side language switch.
    expect(content).toContain("import emailLocale from './utils/email/email-locale'")
    expect(content).toContain('var pageLocale = emailLocale.getClientLocale()')
    expect(content).not.toContain('__NEXT_DATA__')
    expect(content).toContain(
      'body: JSON.stringify({ items: payload, sessionId: getOrCreateSessionId(), locale: pageLocale })'
    )
  })

  it('needs no locale module when the cart is not backed by the database', () => {
    const content = generateEcommerceContextFileContent(
      { enabled: true } as any,
      undefined,
      'ds-1',
      false,
      false
    )
    expect(content).not.toContain('email-locale')
  })
})
