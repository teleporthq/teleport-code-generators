import {
  looksLikeOrderOwnershipHandler,
  buildOrderOwnershipReplacement,
} from '../src/ecommerce/order-ownership'
import { STOCK_DECREMENT_MARKER } from '../src/ecommerce/stock-decrement'

// Verbatim copy of the AI's `orders-list-page-load` customHandler —
// the one that builds the WHERE clause for the orders-list page.
// Trimmed to just the auth + ownership construction (the downstream
// SELECT/FROM string-building is irrelevant to the rewriter).
const AI_ORDERS_LIST_HANDLER = `function customHandler(params) {
  var authResult = null;
  for (var i = 0; i < params.length; i++) {
    var p = params[i];
    if (p && typeof p === "object" && "isLoggedIn" in p && "userId" in p &&
        typeof p.isAnonymous !== "boolean") {
      authResult = p;
      break;
    }
  }
  if (!authResult) authResult = {};
  var userId = authResult.userId != null ? String(authResult.userId) : "";
  var anonymousUserId = authResult.anonymousUserId != null ? String(authResult.anonymousUserId) : "";
  var role = authResult.role != null ? String(authResult.role) : "";
  function escapeSqlString(value) {
    return String(value).replace(/'/g, "''");
  }
  var safeUserId = escapeSqlString(userId);
  var safeAnonUserId = escapeSqlString(anonymousUserId);
  var __ownership;
  if (role === "admin") {
    __ownership = "1=1";
  } else if (anonymousUserId && anonymousUserId !== userId) {
    __ownership = "(o.user_id::text = '" + safeUserId + "' OR o.user_id::text = '" + safeAnonUserId + "')";
  } else {
    __ownership = "o.user_id::text = '" + safeUserId + "'";
  }
  var SELECT_COLS = "o.id AS order_id, o.order_number AS order_number";
  var FROM_CLAUSE = "FROM teleport_orders o";
  var query =
    "SELECT " + SELECT_COLS + " " +
    FROM_CLAUSE + " " +
    "WHERE " + __ownership + " " +
    "ORDER BY o.created_at DESC";
  return { query: query };
}`

// Helper to evaluate the rewritten customHandler with controlled
// upstream inputs. Returns the SQL query string the handler builds.
const runHandler = (code: string, authResult: Record<string, unknown>): string => {
  const fn = new Function('params', code + '\nreturn customHandler(params);') as (
    params: unknown[]
  ) => { query: string }
  return fn([authResult]).query
}

describe('looksLikeOrderOwnershipHandler — pattern detection', () => {
  it('matches the AI verbatim ownership-handler shape', () => {
    expect(looksLikeOrderOwnershipHandler(AI_ORDERS_LIST_HANDLER)).toBe(true)
  })

  it('rejects already-rewritten code (carries the marker)', () => {
    const rewritten = buildOrderOwnershipReplacement(AI_ORDERS_LIST_HANDLER)
    expect(rewritten).toContain(STOCK_DECREMENT_MARKER)
    expect(looksLikeOrderOwnershipHandler(rewritten)).toBe(false)
  })

  it('rejects handlers missing any of the load-bearing fragments', () => {
    expect(looksLikeOrderOwnershipHandler('function customHandler() { return {}; }')).toBe(false)
    // Has __ownership and user_id::text but no safeAnonUserId — not the
    // pattern we're after (some future AI variant might emit a single-
    // identity flow we don't want to touch).
    expect(
      looksLikeOrderOwnershipHandler(
        `var __ownership = "o.user_id::text = 'x'"; var safeUserId = "x";`
      )
    ).toBe(false)
  })

  it('rejects non-string inputs without throwing', () => {
    expect(looksLikeOrderOwnershipHandler(null as unknown as string)).toBe(false)
    expect(looksLikeOrderOwnershipHandler(undefined as unknown as string)).toBe(false)
    expect(looksLikeOrderOwnershipHandler(42 as unknown as string)).toBe(false)
  })
})

describe('buildOrderOwnershipReplacement — runtime semantics', () => {
  const rewritten = buildOrderOwnershipReplacement(AI_ORDERS_LIST_HANDLER)

  it('still emits a function customHandler(params) declaration', () => {
    expect(rewritten).toContain('function customHandler(params)')
  })

  it('stamps the STOCK_DECREMENT_MARKER for idempotent re-runs', () => {
    expect(rewritten).toContain(STOCK_DECREMENT_MARKER)
  })

  it('logged-in user → query scopes to their auth userId ONLY (no anon OR-merge)', () => {
    const q = runHandler(rewritten, {
      userId: 'real-uuid-aaa',
      anonymousUserId: 'spoofed-anon-bbb',
      role: 'user',
      isLoggedIn: 'true',
    })
    // The strict variant must NOT include the anon UUID in the WHERE.
    expect(q).toContain("o.user_id::text = 'real-uuid-aaa'")
    expect(q).not.toContain('spoofed-anon-bbb')
    expect(q).not.toContain(' OR ')
  })

  it('pure-anonymous browser → query scopes to the anon UUID only', () => {
    const q = runHandler(rewritten, {
      userId: '',
      anonymousUserId: 'anon-uuid-xxx',
      role: '',
      isLoggedIn: 'false',
    })
    expect(q).toContain("o.user_id::text = 'anon-uuid-xxx'")
    expect(q).not.toContain(' OR ')
  })

  it('admin role on the buyer "My Orders" page → still scoped to their own auth UUID', () => {
    // This customHandler is wired into the BUYER-facing /orders-list
    // page (titled "My Orders") — an admin landing here should see
    // their own personal purchases, NOT every customer's orders. The
    // admin-wide order view lives at /admin/orders, a separate
    // workflow this rewriter doesn't touch.
    const q = runHandler(rewritten, {
      userId: 'admin-uuid',
      anonymousUserId: '',
      role: 'admin',
      isLoggedIn: 'true',
    })
    expect(q).toContain("o.user_id::text = 'admin-uuid'")
    expect(q).not.toContain('WHERE 1=1')
    expect(q).not.toContain(' OR ')
  })

  it('no identity at all → query matches no rows (1=0)', () => {
    const q = runHandler(rewritten, {
      userId: '',
      anonymousUserId: '',
      role: '',
      isLoggedIn: 'false',
    })
    expect(q).toContain('WHERE 1=0')
    // No accidental `user_id::text = ''` that could leak rows with
    // empty user_id strings.
    expect(q).not.toMatch(/user_id::text\s*=\s*''/)
  })

  it('logged-in user with a quote in their userId → still safely escaped', () => {
    // The original handler already escapes single quotes via
    // \`escapeSqlString\`. We must not regress that.
    const q = runHandler(rewritten, {
      userId: "abc'or'1'='1",
      anonymousUserId: '',
      role: 'user',
      isLoggedIn: 'true',
    })
    expect(q).toContain("o.user_id::text = 'abc''or''1''=''1'")
  })
})
