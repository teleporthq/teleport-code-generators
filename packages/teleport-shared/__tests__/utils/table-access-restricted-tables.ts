/* tslint:disable:function-constructor */
import {
  generateTableAccessHelperCode,
  resolveRestrictedTables,
} from '../../src/utils/table-access'

/**
 * An internal tool's tables are staff-only end to end: the generated data
 * routes serve them to a browser only with a session whose role the table
 * lists (`UIDLAuthentication.restrictedTables`), and to the app's own server
 * code as before. The verdicts below come from the EMITTED guard, executed —
 * not from its source text.
 */

const SECRET = 'server-secret'

interface Session {
  role?: string
}

interface GuardModule {
  guardRead: (req: unknown, tableName: string | null, rawQuery: string | null) => Promise<any>
  mayRead: (req: unknown, tables: string[]) => Promise<boolean>
  assertSqlTextAllowed: (sql: string) => void
  restrictedRead: (tableName: string | null, rawQuery: string | null) => string[]
  setSession: (session: Session | null) => void
}

const bootGuard = (
  params: {
    trustedReaderRoles?: string[]
    restrictedTables?: Record<string, string[]>
  },
  options: { appSecret?: string | null } = {}
): GuardModule => {
  const appSecret = options.appSecret === undefined ? SECRET : options.appSecret
  const code = generateTableAccessHelperCode({
    trustedReaderRoles: params.trustedReaderRoles || ['admin'],
    restrictedTables: params.restrictedTables,
  })
  let session: Session | null = null
  // The host route inlines the session resolver; the guard only calls it.
  const exported = new Function(
    'process',
    '__tqSessionToken',
    `${code}
return {
  guardRead: __taGuardRead,
  mayRead: typeof __taMayReadRestricted === 'function' ? __taMayReadRestricted : null,
  assertSqlTextAllowed: __taAssertSqlTextAllowed,
  restrictedRead: typeof __taRestrictedTablesRead === 'function' ? __taRestrictedTablesRead : null,
}`
  )({ env: appSecret ? { NEXTAUTH_SECRET: appSecret } : {} }, async () =>
    session ? { sub: 'u1', role: session.role } : null
  )
  return {
    ...exported,
    setSession: (next: Session | null) => {
      session = next
    },
  }
}

const browser = (headers: Record<string, string> = {}) => ({ method: 'GET', query: {}, headers })
const internal = browser({ 'x-internal-data-secret': SECRET })

const TOOL = { tasks: ['admin', 'staff'], projects: ['admin', 'staff'] }

const verdict = async (
  guard: GuardModule,
  session: Session | null,
  tableName: string | null,
  rawQuery: string | null = null,
  req: unknown = browser()
): Promise<number> => {
  guard.setSession(session)
  const result = await guard.guardRead(req, tableName, rawQuery)
  return result ? result.status : 200
}

describe('restricted tables — the emitted guard', () => {
  const guard = bootGuard({ restrictedTables: TOOL })

  it('refuses a guest (401) and a signed-in member of another role (403), on every spelling', async () => {
    for (const table of ['tasks', 'TASKS', 'public.tasks', '"tasks"', 'public."projects"']) {
      expect(await verdict(guard, null, table)).toBe(401)
      expect(await verdict(guard, { role: 'user' }, table)).toBe(403)
      expect(await verdict(guard, {}, table)).toBe(403)
    }
  })

  it('serves the staff and the administrators', async () => {
    expect(await verdict(guard, { role: 'staff' }, 'tasks')).toBe(200)
    expect(await verdict(guard, { role: 'admin' }, 'projects')).toBe(200)
  })

  it("serves the app's own server code: the secret, and the module's in-process fetchData", async () => {
    expect(await verdict(guard, null, 'tasks', null, internal)).toBe(200)
    expect(await verdict(guard, null, 'tasks', null, { ...browser(), __tqServerCall: true })).toBe(
      200
    )
  })

  it('does not trust a node that runs SQL it did not write (the AI data-query node) with them', async () => {
    const restrictedSql = browser({ 'x-internal-data-secret': SECRET, 'x-tq-restricted-sql': '1' })
    expect(await verdict(guard, null, 'tasks', null, restrictedSql)).toBe(401)
  })

  it('leaves every other table exactly as it was', async () => {
    expect(await verdict(guard, null, 'team_members')).toBe(200)
    expect(await verdict(guard, null, 'tasks_archive')).toBe(200)
    expect(await verdict(guard, { role: 'user' }, 'teleport_products')).toBe(200)
  })

  it('refuses a raw statement from a browser whatever it names, and lets the server run one', async () => {
    for (const session of [null, { role: 'user' }, { role: 'staff' }, { role: 'admin' }]) {
      expect(await verdict(guard, session, 'team_members', 'SELECT * FROM tasks')).toBe(403)
    }
    expect(await verdict(guard, null, 'team_members', 'SELECT * FROM tasks', internal)).toBe(200)
  })

  it('reads a raw statement for restricted tables where the app cannot tell its callers apart', async () => {
    // No secret: no browser is refused raw SQL outright, so the statement scan
    // stands between it and the staff's tables — fail closed on what it cannot read.
    const open = bootGuard({ restrictedTables: TOOL }, { appSecret: null })
    for (const rawQuery of [
      'SELECT * FROM tasks',
      'SELECT t.title FROM team_members m JOIN public."tasks" t ON t.owner = m.id',
      "SELECT query_to_xml('select * from tasks', true, false, '')",
      "SELECT 'unterminated FROM team_members",
    ]) {
      expect(await verdict(open, null, 'team_members', rawQuery)).toBe(401)
      expect(await verdict(open, { role: 'user' }, 'team_members', rawQuery)).toBe(403)
    }
    expect(await verdict(open, { role: 'staff' }, 'team_members', 'SELECT * FROM tasks')).toBe(200)
    // A table name inside a literal or a comment names nothing.
    expect(
      await verdict(open, null, 'team_members', "SELECT 1 FROM team_members WHERE t = 'tasks'")
    ).toBe(200)
    expect(
      await verdict(open, null, 'team_members', 'SELECT 1 /* tasks */ FROM team_members')
    ).toBe(200)
  })

  it('admits only the roles a table lists, and nobody but the server to a table that lists none', async () => {
    const narrow = bootGuard({ restrictedTables: { payroll: ['admin'], audit_log: [] } })
    expect(await verdict(narrow, { role: 'staff' }, 'payroll')).toBe(403)
    expect(await verdict(narrow, { role: 'admin' }, 'payroll')).toBe(200)
    expect(await verdict(narrow, { role: 'admin' }, 'audit_log')).toBe(403)
    expect(await verdict(narrow, null, 'audit_log', null, internal)).toBe(200)
  })

  it('never widens a protected table: a staff role it lists still needs the admin trust', async () => {
    const both = bootGuard({
      trustedReaderRoles: ['admin'],
      restrictedTables: { teleport_orders: ['admin', 'staff'] },
    })
    expect(await verdict(both, { role: 'staff' }, 'teleport_orders')).toBe(403)
    expect(await verdict(both, { role: 'admin' }, 'teleport_orders')).toBe(200)
  })

  it('scans for a `$` in a table name literally', async () => {
    const dollar = bootGuard({ restrictedTables: { a$b: ['staff'] } }, { appSecret: null })
    expect(await verdict(dollar, null, 'team_members', 'SELECT * FROM a$b')).toBe(401)
    expect(await verdict(dollar, null, 'team_members', 'SELECT * FROM ab')).toBe(200)
    expect(await verdict(dollar, null, 'a$b')).toBe(401)
  })

  it('refuses a caller-written statement that names one (the data API and its restricted-SQL node)', () => {
    for (const sql of ['SELECT * FROM tasks', 'SELECT * FROM public."projects"']) {
      expect(() => guard.assertSqlTextAllowed(sql)).toThrow(/Forbidden/)
    }
    expect(() => guard.assertSqlTextAllowed('SELECT * FROM team_members')).not.toThrow()
  })

  it('answers who may read a set of restricted tables, for the response cache', async () => {
    guard.setSession({ role: 'staff' })
    expect(await guard.mayRead(browser(), ['tasks', 'projects'])).toBe(true)
    guard.setSession({ role: 'user' })
    expect(await guard.mayRead(browser(), ['tasks'])).toBe(false)
    guard.setSession(null)
    expect(await guard.mayRead(browser(), ['tasks'])).toBe(false)
    expect(await guard.mayRead(internal, ['tasks'])).toBe(true)
    expect(await guard.mayRead(browser(), [])).toBe(true)
    expect(
      guard.restrictedRead('team_members', 'SELECT * FROM tasks JOIN projects ON 1=1')
    ).toEqual(['projects', 'tasks'])
    expect(guard.restrictedRead('tasks', null)).toEqual(['tasks'])
    expect(guard.restrictedRead('team_members', null)).toEqual([])
  })
})

describe('restricted tables — projects without them are untouched', () => {
  it('emits the same bytes with the field absent, empty, or holding nothing usable', () => {
    for (const trustedReaderRoles of [[], ['admin'], ['admin', 'staff']]) {
      const absent = generateTableAccessHelperCode({ trustedReaderRoles })
      expect(generateTableAccessHelperCode({ trustedReaderRoles, restrictedTables: {} })).toBe(
        absent
      )
      expect(
        generateTableAccessHelperCode({
          trustedReaderRoles,
          restrictedTables: { 'not a table': ['admin'] },
        })
      ).toBe(absent)
      expect(absent).not.toMatch(/__TA_RESTRICTED|__taRestricted|ReadRestricted|MentionsRestricted/)
    }
  })
})

describe('resolveRestrictedTables', () => {
  const auth = (restrictedTables: unknown) =>
    ({ restrictedTables } as unknown as Parameters<typeof resolveRestrictedTables>[0])

  it('is empty without authentication or without the field', () => {
    expect(resolveRestrictedTables(undefined)).toEqual({})
    expect(resolveRestrictedTables(null)).toEqual({})
    expect(resolveRestrictedTables(auth(undefined))).toEqual({})
    expect(resolveRestrictedTables(auth(['tasks']))).toEqual({})
  })

  it('compares bare lower-case names and keeps the roles each table lists, sorted', () => {
    expect(
      resolveRestrictedTables(
        auth({ Tasks: ['staff', 'admin', 'staff', '', 7], 'public."Projects"': ['admin'] })
      )
    ).toEqual({ projects: ['admin'], tasks: ['admin', 'staff'] })
  })

  it('keeps a table with no usable role (server only) and drops a name that is no identifier', () => {
    expect(resolveRestrictedTables(auth({ audit_log: 'admin', 'my table': ['admin'] }))).toEqual({
      audit_log: [],
    })
  })

  it('admits only the roles both spellings of one table list', () => {
    expect(
      resolveRestrictedTables(auth({ tasks: ['admin', 'staff'], 'public.tasks': ['admin'] }))
    ).toEqual({ tasks: ['admin'] })
  })
})
