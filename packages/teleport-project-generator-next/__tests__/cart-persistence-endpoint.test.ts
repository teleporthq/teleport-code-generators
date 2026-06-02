import {
  generateCartApiRoute,
  isPostgresCartDataSource,
} from '../src/ecommerce/cart-api-routes-generator'

// The /api/cart/[op] endpoint is the database half of the cart: load (hydrate
// the active cart), sync (transactionally replace its items), mark-ordered
// (retire it). It must:
//   - resolve identity server-side (NextAuth token, else guest sessionId),
//   - hardcode status='active' on cart INSERT (the column has NO default),
//   - run the item replace inside a transaction on a single checked-out client,
//   - guard the product FK so a stale productId can't 500,
//   - aggregate quantity per product (no variant column in the table),
//   - NEVER throw / 500 — every op returns 200 so the cart keeps working from
//     localStorage when the DB is unreachable.
// This file pins all of that into the emitted string.

const PG_CFG = { connectionString: 'env:DATABASE_URL' }

describe('generateCartApiRoute — database cart endpoint', () => {
  const route = generateCartApiRoute('postgresql', PG_CFG) as string

  it('generates for Postgres-family datasources only', () => {
    expect(isPostgresCartDataSource('postgresql')).toBe(true)
    expect(isPostgresCartDataSource('teleport')).toBe(true)
    expect(isPostgresCartDataSource('cockroachdb')).toBe(true)
    expect(isPostgresCartDataSource('mysql')).toBe(false)
    expect(isPostgresCartDataSource('turso')).toBe(false)
    expect(isPostgresCartDataSource(null)).toBe(false)
    // Non-pg / no datasource → no route (caller skips registration).
    expect(generateCartApiRoute('mysql', PG_CFG)).toBeNull()
    expect(generateCartApiRoute('turso', PG_CFG)).toBeNull()
    expect(generateCartApiRoute(null, null)).toBeNull()
  })

  it('resolves identity from the NextAuth token with a guest sessionId fallback', () => {
    expect(route).toContain("require('next-auth/jwt')")
    expect(route).toContain('getToken')
    expect(route).toContain('process.env.NEXTAUTH_SECRET')
    // Owner clauses: logged-in by user_id, guest by session_id + user_id IS NULL.
    expect(route).toContain('user_id = $')
    expect(route).toContain('session_id = $')
    expect(route).toContain('user_id IS NULL')
    // getToken throwing must degrade to guest, never 500.
    expect(route).toMatch(/catch[\s\S]*userId = null/)
  })

  it('hardcodes status=active on every cart INSERT (column has no default)', () => {
    expect(route).toContain('INSERT INTO teleport_cart (')
    expect(route).toContain("'active'")
    // No cart INSERT may rely on a default for status.
    const cartInsert = route.slice(route.indexOf('INSERT INTO teleport_cart ('))
    expect(cartInsert.slice(0, 200)).toContain('status')
  })

  it('replaces items inside a transaction on a single checked-out client', () => {
    expect(route).toContain('db.connect()')
    expect(route).toContain("client.query('BEGIN')")
    expect(route).toContain("client.query('COMMIT')")
    expect(route).toContain("client.query('ROLLBACK')")
    expect(route).toContain('client.release()')
    expect(route).toContain('FOR UPDATE')
    expect(route).toContain('DELETE FROM teleport_cart_items WHERE cart_id = $1')
  })

  it('guards the product FK and aggregates quantity per (product, variant)', () => {
    expect(route).toContain('WHERE EXISTS (SELECT 1 FROM teleport_products WHERE id = $3)')
    // load aggregates per product + variant ...
    expect(route).toContain('SUM(quantity)')
    expect(route).toContain('GROUP BY product_id, variant_id')
    // ... and sync sums per (product, variant) line before inserting.
    expect(route).toContain('lineByKey')
    expect(route).toContain('UUID_RE.test(pid)')
  })

  it('persists and returns the variant id (distinct cart lines per variant)', () => {
    // sync writes variant_id ...
    expect(route).toContain(
      'INSERT INTO teleport_cart_items (id, cart_id, product_id, variant_id, quantity, created_at, updated_at)'
    )
    expect(route).toContain('line.variantId')
    expect(route).toContain('it.variantId')
    // ... and load reads it back.
    expect(route).toContain('SELECT product_id, variant_id, SUM(quantity)')
    expect(route).toContain('variantId: r.variant_id')
  })

  it('mark-ordered flips active carts to ordered', () => {
    expect(route).toContain("UPDATE teleport_cart SET status = 'ordered'")
    expect(route).toContain("WHERE status = 'active'")
  })

  it('never throws: every operation returns HTTP 200 and no 500s on caught errors', () => {
    expect(route).not.toContain('status(500)')
    expect(route).toContain('ok: false')
    expect(route).toContain('ok: true')
    // The top-level handler catch returns 200 {ok:false}.
    expect(route).toMatch(/catch \(e\)[\s\S]*status\(200\)[\s\S]*ok: false/)
  })

  it('does not create an empty cart row when syncing an empty cart', () => {
    expect(route).toContain('lines.length === 0')
  })
})
