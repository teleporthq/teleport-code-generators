// Rewriter for the AI's `orders-list` / `order-details` ownership SQL.
//
// The AI generates customHandlers (in orders-list page load, orders-list
// search, order-details page load, and similar workflows) that build a
// raw SQL WHERE clause to scope orders to "the current user". The shape
// the AI emits is:
//
//   if (role === "admin") {
//     __ownership = "1=1";
//   } else if (anonymousUserId && anonymousUserId !== userId) {
//     __ownership = "(o.user_id::text = '" + safeUserId + "' OR " +
//                    "o.user_id::text = '" + safeAnonUserId + "')";
//   } else {
//     __ownership = "o.user_id::text = '" + safeUserId + "'";
//   }
//
// This has two issues:
//
//   1. SECURITY — `anonymousUserId` is read by an upstream customHandler
//      from \`window.localStorage\`. It is fully client-controlled. A
//      logged-in user can paste any UUID into their localStorage and
//      see THAT anonymous user's orders. The OR-with-anon clause is the
//      attack surface.
//
//   2. CORRECTNESS — when both `userId` and `anonymousUserId` are
//      missing strings, the else branch emits `o.user_id::text = ''`,
//      which matches any row whose `user_id` is the literal empty
//      string. That's a defence-in-depth concern (such rows shouldn't
//      exist in a well-seeded DB) but it's the kind of footgun that
//      bites in production.
//
// The fix below replaces the construction block with a strict variant:
//
//   * admin               → see everything
//   * authenticated user  → see ONLY orders whose user_id matches their
//                           authenticated UUID
//   * pure-anonymous user → see ONLY orders whose user_id matches the
//                           browser's anon UUID (still client-controlled,
//                           but the worst case is the user seeing their
//                           OWN previous anonymous orders)
//   * no identity at all  → `1=0` so the query matches no rows
//
// We intentionally drop the "merge anonymous orders after sign-in"
// behaviour: it's the load-bearing source of the leak the user reported
// and recovering pre-login anonymous orders should be an explicit "claim
// previous orders" flow, not a passive SQL-level OR.

import { STOCK_DECREMENT_MARKER } from './stock-decrement'

// The exact AI-generated block we're replacing. Matching the whole
// 5-line block is intentional — we want to be 100% sure we're rewriting
// the right thing, not a coincidentally-similar fragment.
//
// The regex tolerates the typical whitespace shapes the AI emits
// (`if (...)` vs `if (...)`, single-quote vs double-quote inside the
// SQL, and the `safeAnonUserId !== userId` order on the OR branch). It
// does NOT tolerate any change to the variable names — by intent, since
// a future AI variant that renames things should produce a freshly-
// reviewable pattern, not a silently-rewritten one.
const AI_OWNERSHIP_BLOCK_RE =
  /var\s+__ownership\s*;\s*if\s*\(\s*role\s*===\s*["']admin["']\s*\)\s*\{\s*__ownership\s*=\s*["']1=1["']\s*;\s*\}\s*else\s+if\s*\(\s*anonymousUserId\s*&&\s*anonymousUserId\s*!==\s*userId\s*\)\s*\{\s*__ownership\s*=\s*["']\(o\.user_id::text\s*=\s*\\?'["']\s*\+\s*safeUserId\s*\+\s*\\?["']'\s*OR\s*o\.user_id::text\s*=\s*\\?'["']\s*\+\s*safeAnonUserId\s*\+\s*\\?["']'\)["']\s*;\s*\}\s*else\s*\{\s*__ownership\s*=\s*["']o\.user_id::text\s*=\s*\\?'["']\s*\+\s*safeUserId\s*\+\s*\\?["']'["']\s*;\s*\}/

// Distinguishing signature: the customHandler must mention all four —
// the per-row user_id comparison, the ownership variable, both safe-id
// variables, AND the literal SQL fragment "user_id::text". This catches
// the four AI variants (orders-list page-load, orders-list search,
// order-details, plus the gym-owners bulk-orders flow) and nothing else.
export const looksLikeOrderOwnershipHandler = (code: string): boolean => {
  if (typeof code !== 'string') {
    return false
  }
  if (code.indexOf(STOCK_DECREMENT_MARKER) >= 0) {
    return false
  }
  if (code.indexOf('user_id::text') < 0) {
    return false
  }
  if (code.indexOf('__ownership') < 0) {
    return false
  }
  if (code.indexOf('safeUserId') < 0) {
    return false
  }
  if (code.indexOf('safeAnonUserId') < 0) {
    return false
  }
  // Bail when the AI shifts away from the OR-merge shape — a future AI
  // version that already does the strict thing should pass through.
  if (!AI_OWNERSHIP_BLOCK_RE.test(code)) {
    return false
  }
  return true
}

// The strict replacement block. Kept tight and well-commented because
// it's the actual SECURITY boundary — every byte gets review.
//
// Note: there is intentionally NO \`role === "admin"\` bypass here. The
// AI's original handler had one, but this customHandler is wired into
// the BUYER-facing "/orders-list" page (and its order-details +
// search variants) — the page literally titled "My Orders". An admin
// landing on that page should see THEIR own purchases as a customer,
// not every customer's orders. The admin-wide view lives at
// /admin/orders, which is generated by a separate workflow that
// doesn't go through this rewriter.
const STRICT_OWNERSHIP_REPLACEMENT = `var __ownership;
  if (safeUserId.length > 0) {
    // Authenticated user: scope to their auth UUID ONLY. We deliberately
    // do NOT OR-merge the localStorage-supplied anonymousUserId — that
    // value is client-controlled and a malicious user could paste any
    // UUID into it to see another anonymous user's orders. The trade
    // -off is that orders the same browser placed BEFORE sign-up are
    // no longer surfaced; that should be a deliberate "claim my old
    // orders" flow, not a passive SQL-level OR.
    //
    // The admin-role bypass that lived here in the AI's original
    // handler has been removed: this page is the BUYER's "My Orders"
    // view (the page is literally titled "My Orders"), so an admin
    // who logs in and lands here should see their own personal
    // purchases, not every customer's orders. The admin-wide view
    // lives at /admin/orders and is generated by a separate workflow.
    __ownership = "o.user_id::text = '" + safeUserId + "'";
  } else if (safeAnonUserId.length > 0) {
    // Pure-anonymous browser: scope to the anonymous UUID this browser
    // tracks. Still client-controlled, but the worst case here is the
    // user seeing their OWN previous anonymous orders.
    __ownership = "o.user_id::text = '" + safeAnonUserId + "'";
  } else {
    // No identity at all — match no rows. Without this guard an empty
    // userId would produce \`o.user_id::text = ''\` and leak any row
    // whose user_id is accidentally empty.
    __ownership = "1=0";
  }`

// We re-emit the FULL customHandler code with the ownership block
// surgically replaced. The detector regex already verified the exact
// AI shape, so a single \`replace()\` is sufficient.
export const buildOrderOwnershipReplacement = (originalCode: string): string => {
  const rewritten = originalCode.replace(AI_OWNERSHIP_BLOCK_RE, STRICT_OWNERSHIP_REPLACEMENT)
  // Stamp the marker at the very top so subsequent rewriter passes (and
  // the auditor) recognise this as already-handled and short-circuit.
  // The runtime's general-custom-js regex tolerates leading comments
  // before the `function` declaration thanks to the
  // skip-leading-comments fix landed earlier in this codebase.
  return `${STOCK_DECREMENT_MARKER}\n${rewritten}`
}
