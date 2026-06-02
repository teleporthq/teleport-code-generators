/* tslint:disable:no-eval */
import { transformGenerate } from '../src/nodes/transform/transform-generate'

// Regression: the password-reset (and booking) workflow builders, and the
// node-context-schemas contract, all read transform-generate's output as
// `.value` ({ value, type, timestamp }). The node previously returned
// `{ result }`, so `.value` was undefined — which inserted NULL into the
// NOT-NULL `password_reset_tokens.token` column ("null value in column token
// ... violates not-null constraint"). The node must honour its declared
// output contract.

function evalHandler(): any {
  return eval('(' + transformGenerate.generateHandler() + ')')
}

describe('transform-generate output contract', () => {
  it('returns the generated value under `.value` (contract: { value, type, timestamp })', async () => {
    const handler = evalHandler()
    const out = await handler({ generateType: 'uuid' }, {})
    expect(typeof out.value).toBe('string')
    expect(out.value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(out.type).toBe('uuid')
    expect(typeof out.timestamp).toBe('number')
    // `result` retained as a defensive alias so nothing that read it breaks.
    expect(out.result).toBe(out.value)
  })

  it('exposes `.value` for every generate type (random-string, random-number, timestamp)', async () => {
    const handler = evalHandler()
    const s = await handler({ generateType: 'random-string', length: 10 }, {})
    expect(typeof s.value).toBe('string')
    expect(s.value.length).toBe(10)
    const n = await handler({ generateType: 'random-number', min: 1, max: 5 }, {})
    expect(typeof n.value).toBe('number')
    const t = await handler({ generateType: 'timestamp' }, {})
    expect(typeof t.value).toBe('number')
  })

  it('error paths still expose `.value: null` (never undefined)', async () => {
    const handler = evalHandler()
    const out = await handler({ generateType: 'no-such-type' }, {})
    expect(out.value).toBeNull()
    expect(out.error).toContain('Unknown generate type')
  })
})
