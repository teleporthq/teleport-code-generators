import { UIDLWorkflow, UIDLWorkflowEdge, UIDLWorkflowNode } from '@teleporthq/teleport-types'

// Page-load workflows that the AI generates for row-owned details
// pages (orders, favourites, bookings, etc.) consistently wire an
// `isLoggedIn === true` gate in FRONT of the SQL fetch:
//
//   resolve-user → evaluate-auth → IF (isLoggedIn === true)
//     TRUE  → SQL fetch (filtered by user_id OR anonymousUserId)
//     FALSE → navigation-go-to-page  (home, sign-in, etc.)
//
// The SQL itself already supports anonymous buyers — the WHERE
// clause matches both the logged-in user_id and the persistent
// `anonymousUserId` from localStorage — but the gate redirects
// them away before the SQL ever runs. That breaks the guest
// checkout flow: a buyer who paid with Stripe and got redirected
// to `/order-details/<order_number>?payment=success` cannot see
// the order they just created.
//
// For pages whose UIDL marks them as `rowOwnerColumn`-self-guarded
// we neutralise that gate at generation time. Approach: replace
// the IF's `===`/`==`/`equals` comparison with `is-not-empty` over
// the same `isLoggedIn` leaf. `evaluate-auth` always returns
// either the string `"true"` or `"false"` — both non-empty — so
// the IF unconditionally evaluates to TRUE. The runtime's
// branch-skipping logic then only skips the FALSE branch
// (the navigation-go-to-page → home redirect), leaving the SQL
// fetch + downstream `found === true` check reachable for both
// logged-in users AND anonymous guests. The legitimate
// "row not owned by this visitor" defence is preserved because
// the SQL's `user_id = userId OR anonymousUserId` WHERE clause
// still returns zero rows for a stranger; the post-SQL
// `found === true` IF then redirects home.
//
// Edge mutation was considered first but discarded — the client
// runtime in `runtime.js` follows the TAKEN-branch handle to
// decide which nodes to skip, so rewiring only the FALSE edge to
// the TRUE target left the SQL fetch on the "skipped" branch for
// guest visitors. Mutating the IF's CONFIG sidesteps that and
// keeps the data graph intact.

const isLoggedInRef = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const v = value as { type?: unknown; path?: unknown }
  if (v.type !== 'workflowContext') {
    return false
  }
  if (!Array.isArray(v.path) || v.path.length === 0) {
    return false
  }
  const tail = v.path[v.path.length - 1]
  return tail === 'isLoggedIn'
}

// Recognises the canonical comparisons the AI emits:
//   { operator: '===', rightValue: true }              (boolean true)
//   { operator: '===', rightValue: 'true' }            (string  "true")
//   { operator: '==',  rightValue: true | 'true' }     (loose forms)
//   { operator: 'equals', ... }                        (named form)
// `is-truthy` is intentionally NOT matched — the evaluate-auth
// custom-js emits string "true"/"false" so a runtime-`is-truthy`
// check would already let everyone through; touching it would be
// a no-op AND change semantics on adjacent IFs.
export const isIsLoggedInTrueGateConfig = (config: unknown): boolean => {
  if (!config || typeof config !== 'object') {
    return false
  }
  const c = config as Record<string, unknown>
  if (c.conditionType && c.conditionType !== 'simple-comparison') {
    return false
  }
  if (!isLoggedInRef(c.leftValue)) {
    return false
  }
  const op = c.operator
  if (op !== '===' && op !== '==' && op !== 'equals') {
    return false
  }
  const right = c.rightValue
  return right === true || right === 'true'
}

// Mutates the IF node's config in place so the comparison
// becomes `isLoggedIn is-not-empty`. The leftValue keeps pointing
// at the same `isLoggedIn` output, so any downstream references
// to the IF's resolved input continue to work; only the operator
// changes. Edges are deliberately left alone — the runtime's own
// branch-skip logic interprets the IF result, follows the TAKEN
// handle, and skips the not-taken branch. For our always-true IF
// the taken handle is always `true`, so the runtime skips the
// FALSE branch (the navigation-go-to-page → home redirect) and
// runs the SQL fetch.
const neutraliseGateNode = (node: UIDLWorkflowNode): void => {
  const cfg = node.config as Record<string, unknown>
  cfg.conditionType = 'simple-comparison'
  cfg.operator = 'is-not-empty'
  // Some runtimes refuse to evaluate a unary operator when a stale
  // rightValue is present and not an empty string. Clearing it is
  // safer than relying on the runtime to ignore the field.
  delete cfg.rightValue
}

// Walks `wf.nodes`, identifies the `isLoggedIn === true` gate
// pattern emitted by the AI for row-owned page-load workflows, and
// rewrites each match in place. Returns the number of gates
// neutralised so callers can log / assert behaviour. The
// `segments` argument is unused today but kept on the signature so
// future code paths that detect gates via the segment-local node
// list (rather than the workflow-level one) can be wired in
// without a breaking API change.
export const neutraliseIsLoggedInGates = (
  wf: UIDLWorkflow,
  _segments: Array<{ edges: UIDLWorkflowEdge[] }>
): number => {
  let neutralised = 0
  const nodes = (wf.nodes || []) as UIDLWorkflowNode[]
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.type !== 'general-if-statement') {
      continue
    }
    if (!isIsLoggedInTrueGateConfig(node.config)) {
      continue
    }
    neutraliseGateNode(node)
    neutralised++
  }
  return neutralised
}
