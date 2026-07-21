import { generateDataAPIRoute } from '../src/data-api-route-generator'
import { dataCreateItem } from '../src/nodes/data/data-create-item'

// Idempotent insert support. The "Resolve Current User" custom node re-ensures
// a guest's anonymous `users` row on EVERY resolution so the identity is
// self-healing after a database reset / re-provision. That insert targets a
// row that usually already exists, so it MUST be a no-op on conflict rather
// than a 23505 error that aborts the resolve-user (and therefore checkout).

describe('data-api handleCreate — ON CONFLICT DO NOTHING', () => {
  const code = generateDataAPIRoute()

  it('appends ON CONFLICT DO NOTHING only when the caller opts in', () => {
    expect(code).toContain('body.onConflictDoNothing')
    expect(code).toContain('ON CONFLICT DO NOTHING')
    // Default path stays a plain insert — the clause is gated behind the flag.
    expect(code).toMatch(/onConflictClause\s*=\s*body\.onConflictDoNothing\s*\?/)
  })

  it('falls back to the supplied id when a conflict returns no row', () => {
    // With ON CONFLICT DO NOTHING a pre-existing row yields no RETURNING row,
    // so the response must still surface the intended id for downstream nodes.
    expect(code).toContain("var idIdx = columns.indexOf('id')")
    expect(code).toMatch(/resolvedId\s*=\s*item\s*\?/)
  })
})

describe('data_create_item — forwards the idempotency flag', () => {
  const handlerCode = dataCreateItem.generateHandler()

  it('passes config.onConflictDoNothing through to the data-api request body', () => {
    expect(handlerCode).toContain('config.onConflictDoNothing === true')
    expect(handlerCode).toContain('reqBody.onConflictDoNothing = true')
  })
})
