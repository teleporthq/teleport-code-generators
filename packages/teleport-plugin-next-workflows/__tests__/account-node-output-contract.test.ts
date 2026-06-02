/* tslint:disable:no-eval */
import { accountGetCurrent } from '../src/nodes/account/account-get-current'
import { accountLogin } from '../src/nodes/account/account-login'
import { accountSignup } from '../src/nodes/account/account-signup'
import { accountComparePasswords } from '../src/nodes/account/account-compare-passwords'

// Regression: these account nodes returned the user NESTED under `.user`, but
// their declared output contract (node-context-schemas) and the workflow
// builders read the user's fields FLAT (e.g. wfCtx(node, ['id']) for a row's
// user_id in follow/like/loyalty/review inserts). Nested-only output meant
// `user_id` resolved to undefined. The handlers must expose the fields flat
// (and keep `.user`). account-compare-passwords emitted `isMatch` but the
// delete-account template read `.match`.

function evalHandler(code: string): any {
  return eval('(' + code + ')')
}

describe('account node output contracts (flat user fields)', () => {
  it('account-get-current exposes user fields flat AND keeps .user', async () => {
    const handler = evalHandler(accountGetCurrent.generateHandler())
    const fakeUser = { id: 'u-123', email: 'a@b.com', name: 'Ada', image: 'x.png' }
    ;(global as any).fetch = async () => ({ ok: true, json: async () => ({ user: fakeUser }) })
    ;(global as any).window = undefined
    try {
      const out = await handler({}, {})
      expect(out.id).toBe('u-123')
      expect(out.email).toBe('a@b.com')
      expect(out.name).toBe('Ada')
      expect(out.user).toEqual(fakeUser) // nested still works
    } finally {
      delete (global as any).fetch
    }
  })

  it('account-get-current with no user returns user:null and no flat fields', async () => {
    const handler = evalHandler(accountGetCurrent.generateHandler())
    ;(global as any).fetch = async () => ({ ok: true, json: async () => ({ user: null }) })
    try {
      const out = await handler({}, {})
      expect(out.user).toBeNull()
      expect(out.id).toBeUndefined()
    } finally {
      delete (global as any).fetch
    }
  })

  it('account-login / account-signup client handlers expose flat fields + user + success', async () => {
    for (const gen of [accountLogin, accountSignup]) {
      const code = gen.generateHandler()
      // Both copy the user fields onto a fresh object then set user + success
      // (no Object.assign/spread — would down-level to a missing tslib helper).
      expect(code).toContain('__out.user = user || null')
      expect(code).toContain('__out.success = true')
    }
  })

  it('account-login / account-signup SERVER handlers also flatten the sanitized user', () => {
    for (const gen of [accountLogin, accountSignup]) {
      const code = (gen as any).generateServerHandler()
      expect(code).toContain('Object.assign({}, __su || {}, { user: __su, success: true })')
    }
  })

  it('account-compare-passwords emits both isMatch (contract) and match (alias)', () => {
    const code = accountComparePasswords.generateHandler()
    expect(code).toContain('isMatch, match: isMatch')
  })
})
