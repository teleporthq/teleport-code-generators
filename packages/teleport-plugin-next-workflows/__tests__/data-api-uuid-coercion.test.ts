import { generateDataAPIRoute } from '../src/data-api-route-generator'

// Regression guard for "guest checkout 500s with `invalid input syntax for
// type uuid: \"user\"`" — surfaced when the e-commerce "Resolve Current
// User" custom node falls back to the string sentinel `"user"` for a not-
// logged-in buyer and that sentinel is fed into the `teleport_orders.user_id`
// column (nullable uuid). Before the fix only the PK `id` column got UUID
// coercion; every other uuid column passed the value straight through to PG.
//
// The fix introduces `coerceUuidColumnValue(col, val, colTypes)` and applies
// it inside both `handleCreate` and `handleUpdate` in the emitted
// `/api/data/[...params].js` route. Empty / null / non-UUID strings land as
// NULL in the database; valid UUIDs pass verbatim. The PK `id` column is
// deliberately skipped — that one still gets a freshly generated UUID via
// the existing branch.
//
// This file pins the exact runtime semantics so a refactor of the generator
// cannot silently re-open the regression.
describe('data-api route generator: non-`id` UUID column coercion', () => {
  const code = generateDataAPIRoute()

  it('emits a coerceUuidColumnValue helper that skips the `id` PK column', () => {
    // The PK keeps the existing "generate a fresh UUID if missing/invalid"
    // branch; the helper must early-return on col === 'id' so we do not
    // overwrite that branch's output with NULL.
    expect(code).toContain('function coerceUuidColumnValue')
    expect(code).toContain("if (col === 'id') return val")
  })

  it('only operates on uuid-typed columns', () => {
    // A non-uuid column (e.g. text) must NOT be affected — text columns
    // legitimately carry arbitrary strings; UUID-shape checks would corrupt
    // them.
    expect(code).toContain("if (colTypes[col] !== 'uuid') return val")
  })

  it('keeps null / undefined / non-string values as-is', () => {
    // null/undefined → null is what PG wants for nullable uuid columns.
    // Numbers, booleans, arrays etc. for a uuid column would already throw
    // at PG; this helper deliberately does not invent values for those.
    expect(code).toContain('if (val == null) return val')
    expect(code).toContain("if (typeof val !== 'string') return val")
  })

  it('keeps valid UUID strings verbatim and drops invalid strings to NULL', () => {
    // The UUID_RE check is the discriminator: matching strings pass
    // through; non-matching strings (e.g. "user", "anonymous", "abc") are
    // coerced to null so the INSERT does not 500 with "invalid input
    // syntax for type uuid" — UNLESS the column is a user-ownership
    // column and the workflow handed us a valid anonymousUserId hint,
    // in which case the row is attributed to the guest session. That
    // ownership-column branch is pinned by `data-api-anon-user-id-fallback.test.ts`.
    expect(code).toContain('if (UUID_RE.test(val)) return val')
    expect(code).toContain('return null')
  })

  it('invokes the helper inside handleCreate AND handleUpdate', () => {
    // Both writes are vulnerable to the same sentinel-strings-from-workflow
    // path. Wiring the helper into one path but not the other would let a
    // workflow that later updates an order (e.g. `data-update-item`
    // stamping `user_id` post-login) silently re-open the regression.
    const handleCreateIdx = code.indexOf('async function handleCreate')
    const handleUpdateIdx = code.indexOf('async function handleUpdate')
    expect(handleCreateIdx).toBeGreaterThan(0)
    expect(handleUpdateIdx).toBeGreaterThan(handleCreateIdx)

    const handleCreateBody = code.slice(handleCreateIdx, handleUpdateIdx)
    const handleUpdateBody = code.slice(
      handleUpdateIdx,
      code.indexOf('async function handleDelete')
    )

    // Both call sites now pass the optional `anonymousUserIdFallback` —
    // see `data-api-anon-user-id-fallback.test.ts` for the rationale.
    expect(handleCreateBody).toContain(
      'coerceUuidColumnValue(col, val, colTypes, anonymousUserIdFallback)'
    )
    expect(handleUpdateBody).toContain(
      'coerceUuidColumnValue(col, val, colTypes, anonymousUserIdFallback)'
    )
  })

  it('leaves the existing PK auto-generation branch intact', () => {
    // Defensive: the new helper runs AFTER the "id PK gets generateUUID()"
    // branch in handleCreate. If a refactor accidentally moves the helper
    // before the PK branch, the PK would also get NULL'd here, and the
    // INSERT would either fail (NOT NULL) or land with a NULL PK.
    expect(code).toContain("if (col === 'id' && colTypes[col] === 'uuid'")
    expect(code).toContain('return generateUUID()')
  })
})

// Behaviour tests: spin up the emitted helper in a fresh JS sandbox and
// exercise every coercion path. Pure-string regex checks above pin the
// source shape; these tests prove the resulting code behaves correctly
// when run.
describe('data-api route generator: coerceUuidColumnValue runtime behaviour', () => {
  const code = generateDataAPIRoute()

  // Extract the helper by matching balanced braces from `function
  // coerceUuidColumnValue` until its closing brace. The generated file is
  // one big string template literal so we cannot import the helper; we
  // build it back into a callable inside the test.
  const extractFunctionSource = (haystack: string, funcDecl: string): string => {
    const startIdx = haystack.indexOf(funcDecl)
    if (startIdx === -1) {
      throw new Error('Helper not found in generated code: ' + funcDecl)
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

  const helperSource = extractFunctionSource(code, 'function coerceUuidColumnValue')
  // `coerceUuidColumnValue` now depends on `isUserOwnershipColumn` for
  // its ownership-column predicate; pull that into the sandbox too.
  const predicateSource = extractFunctionSource(code, 'function isUserOwnershipColumn')
  const uuidReSource =
    'var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;'

  // Evaluate the helper in an isolated scope so the test does not leak
  // globals.
  const factory = new Function(
    uuidReSource + '\n' + predicateSource + '\n' + helperSource + '\nreturn coerceUuidColumnValue;'
  )
  const coerceUuidColumnValue = factory() as (
    col: string,
    val: unknown,
    colTypes: Record<string, string>
  ) => unknown

  const userIdCol = 'user_id'
  const idCol = 'id'
  const textCol = 'name'
  const colTypes: Record<string, string> = {
    user_id: 'uuid',
    id: 'uuid',
    name: 'text',
  }

  it('skips the id PK column even for garbage strings', () => {
    // The PK branch lives elsewhere in handleCreate; this helper must not
    // override it.
    expect(coerceUuidColumnValue(idCol, 'not-a-uuid', colTypes)).toBe('not-a-uuid')
  })

  it('skips non-uuid columns entirely', () => {
    // A text column may legitimately hold "user" — never null it out.
    expect(coerceUuidColumnValue(textCol, 'user', colTypes)).toBe('user')
  })

  it('passes null / undefined through unchanged', () => {
    expect(coerceUuidColumnValue(userIdCol, null, colTypes)).toBe(null)
    expect(coerceUuidColumnValue(userIdCol, undefined, colTypes)).toBe(undefined)
  })

  it('passes non-string non-null values through unchanged', () => {
    // A number for a uuid column will fail at PG, but this helper is not
    // the place to invent a UUID — that would silently mask a real bug
    // (someone fed an integer where a uuid is expected).
    expect(coerceUuidColumnValue(userIdCol, 123, colTypes)).toBe(123)
    expect(coerceUuidColumnValue(userIdCol, true, colTypes)).toBe(true)
  })

  it('keeps valid UUID strings verbatim', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    expect(coerceUuidColumnValue(userIdCol, uuid, colTypes)).toBe(uuid)
  })

  it('coerces the canonical guest-checkout sentinels to NULL', () => {
    // These four sentinels are emitted by the AI-generated "Resolve Current
    // User" custom node for non-logged-in buyers. All four must land in PG
    // as NULL on a nullable uuid column rather than crash the INSERT.
    expect(coerceUuidColumnValue(userIdCol, 'user', colTypes)).toBe(null)
    expect(coerceUuidColumnValue(userIdCol, 'anonymous', colTypes)).toBe(null)
    expect(coerceUuidColumnValue(userIdCol, '', colTypes)).toBe(null)
    expect(coerceUuidColumnValue(userIdCol, 'guest', colTypes)).toBe(null)
  })

  it('coerces case-insensitive valid UUIDs', () => {
    // UUID_RE has the /i flag; either case must pass.
    expect(coerceUuidColumnValue(userIdCol, '550E8400-E29B-41D4-A716-446655440000', colTypes)).toBe(
      '550E8400-E29B-41D4-A716-446655440000'
    )
  })

  it('coerces shape-but-not-canonical strings to NULL', () => {
    // 8-4-4-4-12 is the only accepted shape — too few hex digits, missing
    // hyphens, or extraneous characters all fail.
    expect(coerceUuidColumnValue(userIdCol, '550e8400e29b41d4a716446655440000', colTypes)).toBe(
      null
    )
    expect(coerceUuidColumnValue(userIdCol, '550e8400-e29b-41d4-a716-44665544000', colTypes)).toBe(
      null
    )
    expect(
      coerceUuidColumnValue(userIdCol, '550e8400-e29b-41d4-a716-446655440000-extra', colTypes)
    ).toBe(null)
  })
})
