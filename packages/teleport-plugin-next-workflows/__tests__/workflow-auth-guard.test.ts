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

/** Boots the emitted guard file with getToken stubbed to read `req.__token`. */
function bootGuard(secret: string | undefined): Guard {
  const code = generateWorkflowAuthHelperFile()
  const moduleObj: { exports: any } = { exports: {} }
  const fakeRequire = (name: string): any => {
    if (name === 'next-auth/jwt') {
      return { getToken: async ({ req }: any) => (req && req.__token) || null }
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
})
