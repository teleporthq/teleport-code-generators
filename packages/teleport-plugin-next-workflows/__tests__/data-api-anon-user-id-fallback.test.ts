import { generateDataAPIRoute } from '../src/data-api-route-generator'

// Regression guard for "guest places order, lands on
// /order-details/<num>, then bounces to home before the page can
// load". Root cause: `coerceUuidColumnValue` was NULL'ing the
// "user" / "" sentinel that the AI-generated workflow stamps on
// `teleport_orders.user_id` for a not-signed-in buyer. With
// user_id = NULL, the page-load SQL
// `WHERE user_id::text = anonymousUserId` returns 0 rows, the
// post-SQL `found === true` IF takes its FALSE branch, and the
// navigation-go-to-page node sends the buyer home before the
// order they just paid for can render.
//
// The fix: `data-create-item` / `data-update-item` now scan the
// workflow context for a resolve-user output and forward the
// `anonymousUserId` to the data-api as `body.__anonymousUserId`.
// The data-api's coercion helper substitutes that UUID for any
// non-UUID string destined for a `user_id`-shaped ownership
// column (`user_id`, `*_user_id`). Non-ownership uuid foreign
// keys still get the safer "drop garbage to NULL" treatment so
// we don't invent a non-existent reference for an unrelated FK.

const extractFunctionSource = (haystack: string, funcDecl: string): string => {
  const startIdx = haystack.indexOf(funcDecl)
  if (startIdx === -1) {
    throw new Error('Helper not found: ' + funcDecl)
  }
  let depth = 0
  let i = haystack.indexOf('{', startIdx)
  if (i === -1) {
    throw new Error('No opening brace after ' + funcDecl)
  }
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

describe('data-api route generator: anonymousUserId fallback', () => {
  const code = generateDataAPIRoute()

  it('emits the ownership-column predicate', () => {
    // Pin the column-shape detection so a refactor can't silently
    // expand it to non-ownership columns (which would corrupt
    // unrelated UUID FKs by aliasing them to the anon user).
    expect(code).toContain('function isUserOwnershipColumn')
    expect(code).toContain("if (col === 'user_id') return true")
    expect(code).toContain("col.lastIndexOf('_user_id') === col.length - 8")
  })

  it('coerceUuidColumnValue accepts the fallback as a 4th argument', () => {
    // Old signature was (col, val, colTypes). The new 4th
    // argument carries the workflow's anonymousUserId hint.
    expect(code).toContain(
      'function coerceUuidColumnValue(col, val, colTypes, anonymousUserIdFallback)'
    )
  })

  it('handleCreate reads body.__anonymousUserId and passes it through to coercion', () => {
    expect(code).toContain('var anonymousUserIdFallback = body.__anonymousUserId')
    expect(code).toContain('coerceUuidColumnValue(col, val, colTypes, anonymousUserIdFallback)')
  })

  it('handleUpdate reads body.__anonymousUserId and passes it through to coercion', () => {
    const updateBody = code.slice(
      code.indexOf('async function handleUpdate'),
      code.indexOf('async function handleDelete')
    )
    expect(updateBody).toContain('var anonymousUserIdFallback = body.__anonymousUserId')
    expect(updateBody).toContain(
      'coerceUuidColumnValue(col, val, colTypes, anonymousUserIdFallback)'
    )
  })

  it('substitutes the fallback UUID for `user_id` when the value is a non-UUID string', () => {
    // Spin up the helper in a sandbox and exercise the contract:
    // the "user" sentinel for `user_id` becomes the anon UUID
    // when a valid one is provided.
    const helperSource = extractFunctionSource(code, 'function coerceUuidColumnValue')
    const predicateSource = extractFunctionSource(code, 'function isUserOwnershipColumn')
    const uuidReSource =
      'var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;'
    const factory = new Function(
      uuidReSource +
        '\n' +
        predicateSource +
        '\n' +
        helperSource +
        '\nreturn coerceUuidColumnValue;'
    )
    const coerce = factory() as (
      col: string,
      val: unknown,
      colTypes: Record<string, string>,
      anon?: string
    ) => unknown

    const ANON = '11111111-2222-3333-4444-555555555555'
    const colTypes = {
      user_id: 'uuid',
      created_by_user_id: 'uuid',
      pickup_location_id: 'uuid',
      notes: 'text',
    }

    // user_id gets the anon UUID when sentinel + fallback present.
    expect(coerce('user_id', 'user', colTypes, ANON)).toBe(ANON)
    expect(coerce('user_id', '', colTypes, ANON)).toBe(ANON)
    expect(coerce('user_id', 'anonymous', colTypes, ANON)).toBe(ANON)
    expect(coerce('user_id', 'guest', colTypes, ANON)).toBe(ANON)

    // *_user_id columns (e.g. created_by_user_id) follow the same rule.
    expect(coerce('created_by_user_id', 'user', colTypes, ANON)).toBe(ANON)

    // A real UUID coming in is kept verbatim regardless of fallback.
    const real = '550e8400-e29b-41d4-a716-446655440000'
    expect(coerce('user_id', real, colTypes, ANON)).toBe(real)
  })

  it('falls back to NULL for non-ownership uuid columns even when fallback is present', () => {
    // Non-ownership UUID FK columns must NOT get the anon UUID
    // substituted in — that would invent a foreign-key reference
    // to a row that doesn't exist (e.g. pickup_location_id =
    // <anon UUID> would point at a non-existent pickup location).
    const helperSource = extractFunctionSource(code, 'function coerceUuidColumnValue')
    const predicateSource = extractFunctionSource(code, 'function isUserOwnershipColumn')
    const uuidReSource =
      'var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;'
    const factory = new Function(
      uuidReSource +
        '\n' +
        predicateSource +
        '\n' +
        helperSource +
        '\nreturn coerceUuidColumnValue;'
    )
    const coerce = factory() as (
      col: string,
      val: unknown,
      colTypes: Record<string, string>,
      anon?: string
    ) => unknown

    const ANON = '11111111-2222-3333-4444-555555555555'
    const colTypes = { user_id: 'uuid', pickup_location_id: 'uuid' }

    expect(coerce('pickup_location_id', '', colTypes, ANON)).toBe(null)
    expect(coerce('pickup_location_id', 'user', colTypes, ANON)).toBe(null)
  })

  it('ignores a non-UUID fallback rather than passing garbage to PG', () => {
    // Belt and braces: even if someone constructs a request with
    // `__anonymousUserId = "not-a-uuid"`, the helper must reject
    // the substitution so PG never sees an invalid UUID.
    const helperSource = extractFunctionSource(code, 'function coerceUuidColumnValue')
    const predicateSource = extractFunctionSource(code, 'function isUserOwnershipColumn')
    const uuidReSource =
      'var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;'
    const factory = new Function(
      uuidReSource +
        '\n' +
        predicateSource +
        '\n' +
        helperSource +
        '\nreturn coerceUuidColumnValue;'
    )
    const coerce = factory() as (
      col: string,
      val: unknown,
      colTypes: Record<string, string>,
      anon?: string
    ) => unknown

    const colTypes = { user_id: 'uuid' }
    expect(coerce('user_id', 'user', colTypes, 'not-a-uuid')).toBe(null)
    expect(coerce('user_id', 'user', colTypes, '')).toBe(null)
    expect(coerce('user_id', 'user', colTypes, undefined)).toBe(null)
  })

  it('still skips the id PK column regardless of fallback', () => {
    // The id PK has its own auto-generate-a-fresh-UUID path
    // elsewhere in handleCreate. The coercion helper must early-
    // return on `id` so the PK's value is never replaced with the
    // anon UUID.
    const helperSource = extractFunctionSource(code, 'function coerceUuidColumnValue')
    const predicateSource = extractFunctionSource(code, 'function isUserOwnershipColumn')
    const uuidReSource =
      'var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;'
    const factory = new Function(
      uuidReSource +
        '\n' +
        predicateSource +
        '\n' +
        helperSource +
        '\nreturn coerceUuidColumnValue;'
    )
    const coerce = factory() as (
      col: string,
      val: unknown,
      colTypes: Record<string, string>,
      anon?: string
    ) => unknown

    expect(coerce('id', 'not-a-uuid', { id: 'uuid' }, '11111111-2222-3333-4444-555555555555')).toBe(
      'not-a-uuid'
    )
  })
})

describe('data-create-item / data-update-item workflow handlers: anon-id hint', () => {
  // The compiled package emits these handlers verbatim inside
  // `node-handlers-server.js`. We can import the generators
  // directly and check the emitted string.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { dataCreateItem } = require('../src/nodes/data/data-create-item')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { dataUpdateItem } = require('../src/nodes/data/data-update-item')

  it('data-create-item scans context for anonymousUserId before POSTing', () => {
    const src = dataCreateItem.generateHandler() as string
    expect(src).toContain('__anonymousUserId')
    expect(src).toContain('anonymousUserId')
    expect(src).toContain('reqBody.__anonymousUserId = __anonymousUserId')
  })

  it('data-update-item scans context for anonymousUserId before PATCHing', () => {
    const src = dataUpdateItem.generateHandler() as string
    expect(src).toContain('__anonymousUserId')
    expect(src).toContain('reqBody.__anonymousUserId = __anonymousUserId')
  })

  it('only forwards the hint when context carries a non-empty anonymousUserId', () => {
    // Pin the conditional: the handler emits a guard that skips
    // the hint when `__anonymousUserId` is empty, so a logged-in
    // flow with empty anonymousUserId never sends it. We assert
    // on the substring fragment that survives both ES5 and
    // ES2017 ts-jest compilation targets — the
    // `reqBody.__anonymousUserId = __anonymousUserId` assignment
    // and an `if (__anonymousUserId)` guard.
    const src = dataCreateItem.generateHandler() as string
    expect(src).toContain('reqBody.__anonymousUserId = __anonymousUserId')
    expect(/if\s*\(\s*__anonymousUserId\s*\)/.test(src)).toBe(true)

    const updSrc = dataUpdateItem.generateHandler() as string
    expect(updSrc).toContain('reqBody.__anonymousUserId = __anonymousUserId')
    expect(/if\s*\(\s*__anonymousUserId\s*\)/.test(updSrc)).toBe(true)
  })

  it('skips empty / missing anonymousUserId entries during context scan', () => {
    // The scan must NOT latch onto a node output whose
    // anonymousUserId is the empty string (logged-in users get
    // resolveUser({ ..., anonymousUserId: "" })). The emitted
    // length check is the guard.
    const src = dataCreateItem.generateHandler() as string
    expect(src).toContain('__cv.anonymousUserId.length > 0')
  })
})
