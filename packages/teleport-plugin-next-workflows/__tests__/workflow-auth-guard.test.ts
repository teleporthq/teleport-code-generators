import {
  generateWorkflowAuthHelperFile,
  buildWorkflowAuthInjection,
} from '../src/workflow-auth-generator'
import {
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
} from '../src/api-route-generator'
import { UIDLWorkflowProtection } from '@teleporthq/teleport-types'
import { WorkflowSegment } from '../src/types'

// The generated workflow-auth.js guard is the single stateless enforcement
// point. Booting it with a mocked next-auth/jwt proves the runtime behaviour;
// the route generators prove the guard is wired in BEFORE any node runs.

type Guard = (
  req: any,
  context: any,
  policy: any
) => Promise<{ status: number; message: string } | null>

/** What the stubbed `utils/auth/subscriber-access` module answers, and what it was asked. */
interface SubscriberAccessStub {
  entitled?: boolean
  throws?: boolean
  /** `null` boots the guard with the module ABSENT (a project with no subscriber-only page). */
  absent?: boolean
  calls: Array<{ userId: string; productIds: string[] }>
}

/** Boots the emitted guard file with getToken stubbed to read `req.__token`. */
function bootGuard(secret: string | undefined, subscriberAccess?: SubscriberAccessStub): Guard {
  const code = generateWorkflowAuthHelperFile({
    withSubscriberAccess: Boolean(subscriberAccess && !subscriberAccess.absent),
  })
  const moduleObj: { exports: any } = { exports: {} }
  const fakeRequire = (name: string): any => {
    if (name === 'next-auth/jwt') {
      return { getToken: async ({ req }: any) => (req && req.__token) || null }
    }
    if (name === '../auth/subscriber-access') {
      if (!subscriberAccess || subscriberAccess.absent) {
        throw new Error(`Cannot find module '${name}'`)
      }
      return {
        isSubscriberEntitled: async (userId: string, productIds: string[]) => {
          subscriberAccess.calls.push({ userId, productIds })
          if (subscriberAccess.throws) {
            throw new Error('database down')
          }
          return subscriberAccess.entitled === true
        },
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(name)
  }
  // tslint:disable-next-line:function-constructor
  new Function('require', 'module', 'exports', 'process', code)(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    { env: { NEXTAUTH_SECRET: secret } }
  )
  return moduleObj.exports.guardWorkflowRequest as Guard
}

const reqWith = (extra: Record<string, unknown> = {}): any => ({ headers: {}, ...extra })

describe('guardWorkflowRequest (runtime enforcement)', () => {
  const guard = bootGuard('server-secret')

  it('is a no-op when there is no policy', async () => {
    const context = { n: { userId: 'victim' } }
    expect(await guard(reqWith(), context, null)).toBeNull()
    expect(context.n.userId).toBe('victim')
  })

  it('rejects with 401 when auth is required and there is no session', async () => {
    const res = await guard(reqWith(), {}, { requiresAuth: true, allowedRoles: [] })
    expect(res).toEqual({ status: 401, message: 'Unauthenticated' })
  })

  it('allows any authenticated user when allowedRoles is empty', async () => {
    const res = await guard(
      reqWith({ __token: { id: 'u1', role: 'user' } }),
      {},
      {
        requiresAuth: true,
        allowedRoles: [],
      }
    )
    expect(res).toBeNull()
  })

  it('rejects with 403 when the session role is not allowed', async () => {
    const res = await guard(
      reqWith({ __token: { id: 'u1', role: 'user' } }),
      {},
      {
        requiresAuth: true,
        allowedRoles: ['admin'],
      }
    )
    expect(res).toEqual({ status: 403, message: 'Forbidden' })
  })

  it('allows a matching role (incl. roleName / roles[] spellings)', async () => {
    for (const token of [
      { id: 'u1', role: 'admin' },
      { id: 'u1', roleName: 'admin' },
      { id: 'u1', roles: ['admin'] },
    ]) {
      expect(
        await guard(
          reqWith({ __token: token }),
          {},
          { requiresAuth: true, allowedRoles: ['admin'] }
        )
      ).toBeNull()
    }
  })

  it('OVERWRITES a forged user id with the session id (the IDOR fix)', async () => {
    const context = { resolver: { userId: 'victim-id', email: 'x' } }
    const res = await guard(reqWith({ __token: { id: 'attacker-real-id' } }), context, {
      requiresAuth: true,
      allowedRoles: [],
      userScoped: { ownerColumn: 'user_id', bindings: [{ nodeId: 'resolver', path: ['userId'] }] },
    })
    expect(res).toBeNull()
    expect(context.resolver.userId).toBe('attacker-real-id') // forced to the caller
    expect(context.resolver.email).toBe('x') // other fields untouched
  })

  it('binds a role claim to the SESSION role, never the one the browser sent', async () => {
    const policy = {
      requiresAuth: true,
      allowedRoles: [],
      userScoped: {
        ownerColumn: 'user_id',
        bindings: [
          { nodeId: 'evaluate', path: ['role'], claim: 'role' },
          { nodeId: 'evaluate', path: ['userId'] },
        ],
      },
    }
    const shopper = { evaluate: { role: 'admin', userId: 'victim-id' } }
    expect(
      await guard(reqWith({ __token: { id: 'shopper-id', role: 'user' } }), shopper, policy)
    ).toBeNull()
    expect(shopper.evaluate).toEqual({ role: 'user', userId: 'shopper-id' })

    // A session without a role binds '' — an admin check can only fail.
    const roleless = { evaluate: { role: 'admin', userId: 'x' } }
    await guard(reqWith({ __token: { id: 'roleless-id' } }), roleless, policy)
    expect(roleless.evaluate).toEqual({ role: '', userId: 'roleless-id' })

    const admin = { evaluate: { role: '', userId: '' } }
    await guard(reqWith({ __token: { id: 'admin-id', roleName: 'admin' } }), admin, policy)
    expect(admin.evaluate).toEqual({ role: 'admin', userId: 'admin-id' })
  })

  it('binds a GUEST role claim to an empty role, so a signed-out request cannot claim admin', async () => {
    // A public (no requiresAuth) route: the guest gets through, but the role it
    // posted must not reach the query. Its anonymous user id is kept.
    const guest = { evaluate: { role: 'admin', userId: 'guest-anon-uuid' } }
    const res = await guard(reqWith(), guest, {
      requiresAuth: false,
      allowedRoles: [],
      userScoped: {
        ownerColumn: 'user_id',
        bindings: [
          { nodeId: 'evaluate', path: ['role'], claim: 'role' },
          { nodeId: 'evaluate', path: ['userId'] },
        ],
      },
    })
    expect(res).toBeNull()
    expect(guest.evaluate).toEqual({ role: '', userId: 'guest-anon-uuid' })
  })

  it('binds a signedInUserId claim to the session id, and to an empty id for a guest', async () => {
    const policy = {
      requiresAuth: false,
      allowedRoles: [],
      userScoped: {
        ownerColumn: 'user_id',
        bindings: [{ nodeId: 'collect', path: ['signedInUserId'], claim: 'signedInUserId' }],
      },
    }
    const shopper = { collect: { signedInUserId: 'victim-id', city: 'Austin' } }
    await guard(reqWith({ __token: { id: 'shopper-id' } }), shopper, policy)
    expect(shopper.collect).toEqual({ signedInUserId: 'shopper-id', city: 'Austin' })

    const guest = { collect: { signedInUserId: 'victim-id', city: 'Austin' } }
    expect(await guard(reqWith(), guest, policy)).toBeNull()
    expect(guest.collect).toEqual({ signedInUserId: '', city: 'Austin' })

    // A segment that runs before the node produced its result still gets the
    // binding, so the node's own later output is what overwrites it.
    const early: any = {}
    await guard(reqWith(), early, policy)
    expect(early.collect).toEqual({ signedInUserId: '' })
  })

  it('binds a nested path and creates missing context nodes', async () => {
    const context: any = {}
    await guard(reqWith({ __token: { id: 'sess-1' } }), context, {
      requiresAuth: false,
      allowedRoles: [],
      userScoped: { ownerColumn: 'user_id', bindings: [{ nodeId: 'n', path: ['user', 'id'] }] },
    })
    expect(context.n.user.id).toBe('sess-1')
  })

  it('falls back to token.sub when token.id is absent', async () => {
    const context = { n: { userId: 'victim' } }
    await guard(reqWith({ __token: { sub: 'sub-id' } }), context, {
      requiresAuth: false,
      allowedRoles: [],
      userScoped: { ownerColumn: 'user_id', bindings: [{ nodeId: 'n', path: ['userId'] }] },
    })
    expect(context.n.userId).toBe('sub-id')
  })

  it('leaves the client value for a GUEST (no session) on a non-required userScoped write', async () => {
    // Guest checkout: no token, requiresAuth false → the anonymous client id is
    // kept (there is no server session to bind), and the request proceeds.
    const context = { n: { userId: 'guest-anon-uuid' } }
    const res = await guard(reqWith(), context, {
      requiresAuth: false,
      allowedRoles: [],
      userScoped: { ownerColumn: 'user_id', bindings: [{ nodeId: 'n', path: ['userId'] }] },
    })
    expect(res).toBeNull()
    expect(context.n.userId).toBe('guest-anon-uuid')
  })

  it('honours the internal server-to-server secret bypass', async () => {
    const res = await guard(
      reqWith({ headers: { 'x-internal-data-secret': 'server-secret' } }),
      {},
      { requiresAuth: true, allowedRoles: ['admin'] }
    )
    expect(res).toBeNull()
  })

  it('does not treat a wrong internal secret as a bypass', async () => {
    const res = await guard(
      reqWith({ headers: { 'x-internal-data-secret': 'wrong' } }),
      {},
      { requiresAuth: true, allowedRoles: [] }
    )
    expect(res).toEqual({ status: 401, message: 'Unauthenticated' })
  })
})

describe('guardWorkflowRequest with next-auth absent / no secret', () => {
  it('treats a missing NEXTAUTH_SECRET as no session (401 when required)', async () => {
    const guard = bootGuard(undefined)
    const res = await guard(
      reqWith({ __token: { id: 'u1' } }),
      {},
      { requiresAuth: true, allowedRoles: [] }
    )
    expect(res).toEqual({ status: 401, message: 'Unauthenticated' })
  })
})

// ---------------------------------------------------------------------------
// Route wiring
// ---------------------------------------------------------------------------

const dataSegment = (): WorkflowSegment =>
  ({
    id: 'server-1',
    env: 'server',
    nodes: [
      {
        id: 'w1',
        type: 'data-create-item',
        label: 'Write',
        config: { tableName: 'teleport_favourites' },
        stepNumber: 1,
      },
    ],
    edges: [],
  } as unknown as WorkflowSegment)

const protection: UIDLWorkflowProtection = {
  requiresAuth: true,
  allowedRoles: ['admin'],
  derivedFrom: 'page',
}

describe('route generators wire the guard in', () => {
  it('injects the guard into a protected non-streaming route BEFORE the node loop', () => {
    const code = generateServerSegmentAPIRoute(dataSegment(), 'Admin CRUD', protection)
    expect(code).toContain("require('../../../utils/workflows/workflow-auth')")
    expect(code).toContain('const __WF_AUTH = {')
    expect(code).toContain('__wfAuth.guardWorkflowRequest(req, context, __WF_AUTH)')
    // The guard (and its early 401/403 return) must precede the node loop.
    expect(code.indexOf('guardWorkflowRequest')).toBeLessThan(
      code.indexOf('SEGMENT_CONFIG.nodes.slice()')
    )
    // The baked policy carries the runtime fields, not the build-only derivedFrom.
    expect(code).toContain('"requiresAuth":true')
    expect(code).toContain('"allowedRoles":["admin"]')
    expect(code).not.toContain('derivedFrom')
  })

  it('injects the guard into a protected streaming route BEFORE the stream starts', () => {
    const code = generateStreamingServerSegmentAPIRoute(dataSegment(), 'Streaming', {
      requiresAuth: true,
      allowedRoles: [],
      derivedFrom: 'graph',
    })
    expect(code).toContain('__wfAuth.guardWorkflowRequest(req, context, __WF_AUTH)')
    // The guard runs before the node loop. `ensureStream()` (which calls
    // res.writeHead for the event-stream) is only invoked DURING node execution,
    // so a 401/403 is sent as an HTTP status before the stream ever starts.
    expect(code.indexOf('guardWorkflowRequest')).toBeLessThan(
      code.indexOf('SEGMENT_CONFIG.nodes.slice()')
    )
    // The only ensureStream CALL (not its definition) is inside the node loop.
    expect(code.indexOf('guardWorkflowRequest')).toBeLessThan(code.lastIndexOf('ensureStream()'))
  })

  it('emits NOTHING guard-related for an unprotected route (byte-compatible)', () => {
    const code = generateServerSegmentAPIRoute(dataSegment(), 'Public')
    expect(code).not.toContain('workflow-auth')
    expect(code).not.toContain('__WF_AUTH')
    expect(code).not.toContain('guardWorkflowRequest')
  })

  it('bakes the userScoped bindings into the policy', () => {
    const code = generateServerSegmentAPIRoute(dataSegment(), 'Favourites', {
      requiresAuth: true,
      allowedRoles: [],
      userScoped: { ownerColumn: 'user_id', bindings: [{ nodeId: 'resolve', path: ['userId'] }] },
      derivedFrom: 'graph',
    })
    expect(code).toContain('"userScoped"')
    expect(code).toContain('"nodeId":"resolve"')
    expect(code).toContain('"path":["userId"]')
  })
})

describe('buildWorkflowAuthInjection', () => {
  it('returns empty pieces when there is no meaningful policy', () => {
    expect(buildWorkflowAuthInjection(undefined)).toEqual({
      requireLine: '',
      policyConst: '',
      guardCall: '',
    })
    expect(
      buildWorkflowAuthInjection({ requiresAuth: false, allowedRoles: [], derivedFrom: 'default' })
    ).toEqual({ requireLine: '', policyConst: '', guardCall: '' })
  })

  it('emits pieces for a userScoped-only (guest-capable) policy', () => {
    const injection = buildWorkflowAuthInjection({
      requiresAuth: false,
      allowedRoles: [],
      userScoped: { ownerColumn: 'user_id', bindings: [{ nodeId: 'n', path: ['userId'] }] },
      derivedFrom: 'graph',
    })
    expect(injection.requireLine).toContain('workflow-auth')
    expect(injection.policyConst).toContain('"userScoped"')
    expect(injection.guardCall).toContain('guardWorkflowRequest')
  })

  it('bakes the subscription requirement and its product ids into the policy', () => {
    const injection = buildWorkflowAuthInjection({
      requiresAuth: true,
      allowedRoles: [],
      requiresSubscription: true,
      subscriptionProductIds: [' prod-1 ', 'prod-2', ''],
      derivedFrom: 'page',
    })
    const policy = JSON.parse(
      injection.policyConst.replace('const __WF_AUTH = ', '').replace(/;\s*$/, '')
    )
    expect(policy).toEqual({
      requiresAuth: true,
      allowedRoles: [],
      requiresSubscription: true,
      subscriptionProductIds: ['prod-1', 'prod-2'],
    })
    const plain = buildWorkflowAuthInjection({
      requiresAuth: true,
      allowedRoles: [],
      derivedFrom: 'page',
    })
    expect(plain.policyConst).not.toContain('requiresSubscription')
  })
})

describe('guardWorkflowRequest on a subscriber-only page', () => {
  const policy = {
    requiresAuth: true,
    allowedRoles: [] as string[],
    requiresSubscription: true,
    subscriptionProductIds: ['prod-1'],
  }
  const anyProduct = {
    requiresAuth: true,
    allowedRoles: [] as string[],
    requiresSubscription: true,
  }

  it('still answers 401 to a guest before asking about any subscription', async () => {
    const access: SubscriberAccessStub = { entitled: true, calls: [] }
    const res = await bootGuard('server-secret', access)(reqWith(), {}, policy)
    expect(res).toEqual({ status: 401, message: 'Unauthenticated' })
    expect(access.calls).toHaveLength(0)
  })

  it('lets an entitled member through, asking with the SESSION id and the product ids', async () => {
    const access: SubscriberAccessStub = { entitled: true, calls: [] }
    const guard = bootGuard('server-secret', access)
    expect(await guard(reqWith({ __token: { id: 'u1' } }), {}, policy)).toBeNull()
    expect(access.calls).toEqual([{ userId: 'u1', productIds: ['prod-1'] }])
    expect(await guard(reqWith({ __token: { sub: 'u2' } }), {}, anyProduct)).toBeNull()
    expect(access.calls[1]).toEqual({ userId: 'u2', productIds: [] })
  })

  it('answers 403 Subscription required to a member without one', async () => {
    const access: SubscriberAccessStub = { entitled: false, calls: [] }
    const res = await bootGuard('server-secret', access)(
      reqWith({ __token: { id: 'u1' } }),
      {},
      policy
    )
    expect(res).toEqual({ status: 403, message: 'Subscription required' })
  })

  it('checks the role first, and fails closed when the check itself fails or is missing', async () => {
    const access: SubscriberAccessStub = { entitled: true, calls: [] }
    const wrongRole = await bootGuard('server-secret', access)(
      reqWith({ __token: { id: 'u1', role: 'user' } }),
      {},
      { ...policy, allowedRoles: ['admin'] }
    )
    expect(wrongRole).toEqual({ status: 403, message: 'Forbidden' })
    expect(access.calls).toHaveLength(0)

    const down = await bootGuard('server-secret', { throws: true, calls: [] })(
      reqWith({ __token: { id: 'u1' } }),
      {},
      policy
    )
    expect(down).toEqual({ status: 403, message: 'Subscription required' })
    const absent = await bootGuard('server-secret', { absent: true, calls: [] })(
      reqWith({ __token: { id: 'u1' } }),
      {},
      policy
    )
    expect(absent).toEqual({ status: 403, message: 'Subscription required' })
  })

  it('never asks for a policy without the requirement, and lets an internal caller through', async () => {
    const access: SubscriberAccessStub = { entitled: false, calls: [] }
    const guard = bootGuard('server-secret', access)
    expect(
      await guard(reqWith({ __token: { id: 'u1' } }), {}, { requiresAuth: true, allowedRoles: [] })
    ).toBeNull()
    expect(
      await guard(reqWith({ headers: { 'x-internal-data-secret': 'server-secret' } }), {}, policy)
    ).toBeNull()
    expect(access.calls).toHaveLength(0)
  })
})

describe('subscriber-access require', () => {
  // A require is a static import to the bundler even inside a function, so it
  // must not appear when utils/auth/subscriber-access.js is not emitted.
  it('is absent from a project with no subscriber-only page', () => {
    expect(generateWorkflowAuthHelperFile()).not.toContain('../auth/subscriber-access')
  })

  it('is present when a page is subscriber-only', () => {
    expect(generateWorkflowAuthHelperFile({ withSubscriberAccess: true })).toContain(
      "require('../auth/subscriber-access')"
    )
  })
})
