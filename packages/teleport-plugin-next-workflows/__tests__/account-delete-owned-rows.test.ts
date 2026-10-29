import { OwnerColumns } from '@teleporthq/teleport-shared'
import { generateAccountDeleteRoute } from '../src/account-delete-route-generator'

/**
 * A visitor closes their account. The generated delete route is EXECUTED here
 * against a stubbed `pg` client that answers the catalogue reads from a fixture
 * schema and records every statement, so the proof is behaviour: which rows the
 * route deletes, anonymises and leaves alone.
 *
 * THE DEFECT. The route deleted a fixed list of platform tables and the user
 * row, and nothing in the project's own tables — saved items, requests,
 * reviews, the tables the AI made for the site. Their owner link is
 * `ON DELETE SET NULL`, so the rows stayed with a blank owner, and the "My …"
 * pages read `owner = me OR owner IS NULL`: every other signed-in visitor saw
 * them. `teleport_bookings` has no link to users at all and kept the user id
 * with the customer's name, email and phone.
 *
 * THE RULE. A table's rows are attributed through exactly ONE column — the one
 * its "My …" pages read by (teleport-shared's `resolveOwnerColumn`, shipped
 * into the route as text) — and deleted only when that column says whose the
 * row is, never when it says who acted on it.
 */

const USER_ID = '7d1c4c6a-2f7e-4d3b-9c1e-1a2b3c4d5e6f'
const USER_EMAIL = 'ana@example.com'
const SYNTHETIC_EMAIL = `deleted-user-${USER_ID}@deleted.invalid`

interface FixtureTable {
  columns: string[]
  /** column -> `table.column` it references through a real foreign key. */
  links?: Record<string, string>
}
type FixtureSchema = Record<string, FixtureTable>

interface Statement {
  sql: string
  params: unknown[]
}

interface Run {
  status: number
  body: unknown
  statements: Statement[]
  errors: unknown[][]
}

/** `attempt` counts the executions of that exact statement, from 1. */
type Refuse = (sql: string, attempt: number) => Error | null

/** The platform tables a store carries; how the route treats them is the baseline. */
const PLATFORM: FixtureSchema = {
  users: { columns: ['id', 'email', 'name', 'password'] },
  password_reset_tokens: { columns: ['id', 'email', 'token'] },
  teleport_orders: { columns: ['id', 'user_id', 'billing_email', 'billing_name', 'total'] },
  teleport_cart: { columns: ['id', 'user_id'], links: { user_id: 'users.id' } },
  teleport_subscriptions: {
    columns: ['id', 'user_id', 'customer_email', 'customer_name', 'status'],
  },
  teleport_abandoned_carts: { columns: ['id', 'cart_id', 'user_id', 'customer_email'] },
  teleport_voucher_redemptions: {
    columns: ['id', 'voucher_id', 'order_id', 'user_id', 'billing_email'],
  },
  teleport_push_subscriptions: { columns: ['id', 'endpoint', 'user_id'] },
}

const USER_ROW = 'SELECT * FROM users WHERE id = $1'
const COLUMNS_OF_ONE_TABLE =
  "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1"
const COLUMNS_OF_EVERY_TABLE = 'SELECT c.table_name, c.column_name'
const FOREIGN_KEYS = 'FROM pg_constraint'

const columnRows = (schema: FixtureSchema) => {
  const rows: Array<{ table_name: string; column_name: string; ordinal_position: number }> = []
  for (const tableName of Object.keys(schema)) {
    schema[tableName].columns.forEach((columnName, index) => {
      rows.push({ table_name: tableName, column_name: columnName, ordinal_position: index + 1 })
    })
  }
  return rows
}

const linkRows = (schema: FixtureSchema) => {
  const rows: Array<{
    table_name: string
    column_name: string
    referenced_table: string
    referenced_column: string
  }> = []
  for (const tableName of Object.keys(schema)) {
    const links = schema[tableName].links || {}
    for (const columnName of Object.keys(links)) {
      const [referencedTable, referencedColumn] = links[columnName].split('.')
      rows.push({
        table_name: tableName,
        column_name: columnName,
        referenced_table: referencedTable,
        referenced_column: referencedColumn,
      })
    }
  }
  return rows
}

const runRoute = async (schema: FixtureSchema, refuse: Refuse = () => null): Promise<Run> => {
  const run: Run = { status: 0, body: undefined, statements: [], errors: [] }
  const attempts: Record<string, number> = {}

  class Client {
    public async connect() {
      return
    }
    public async query(sql: string, params: unknown[] = []) {
      run.statements.push({ sql, params })
      if (sql === USER_ROW) {
        return { rows: [{ id: USER_ID, email: USER_EMAIL, name: 'Ana' }] }
      }
      if (sql === COLUMNS_OF_ONE_TABLE) {
        const table = schema[String(params[0])]
        return { rows: table ? table.columns.map((column_name) => ({ column_name })) : [] }
      }
      if (sql.indexOf(COLUMNS_OF_EVERY_TABLE) === 0) {
        return { rows: columnRows(schema) }
      }
      if (sql.indexOf(FOREIGN_KEYS) !== -1) {
        return { rows: linkRows(schema) }
      }
      // A catalogue read this stub does not know would otherwise answer no rows
      // and let every "left alone" scenario pass with nothing looked at.
      if (sql.indexOf('SELECT') === 0) {
        throw new Error(`unexpected catalogue read: ${sql}`)
      }
      attempts[sql] = (attempts[sql] || 0) + 1
      const refusal = refuse(sql, attempts[sql])
      if (refusal) {
        throw refusal
      }
      return { rows: [] }
    }
    public async end() {
      return
    }
  }

  const fakeRequire = (name: string): any => {
    if (name === 'pg') {
      return { Client }
    }
    if (name === 'next-auth/jwt') {
      return { getToken: async () => ({ id: USER_ID }) }
    }
    if (name.endsWith('/utils/email/email-locale')) {
      return { pickLocalizedTemplate: (base: unknown) => base, resolveRequestLocale: () => 'en' }
    }
    throw new Error(`unexpected require: ${name}`)
  }
  const moduleObj: { exports: any } = { exports: {} }
  // tslint:disable-next-line:function-constructor
  new Function(
    'require',
    'module',
    'exports',
    'process',
    'console',
    generateAccountDeleteRoute({ authUsersTableName: 'users' })
  )(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    {
      env: {
        TELEPORT_DB_CONNECTION_STRING: 'postgresql://user:pw@db.test/site',
        NEXTAUTH_SECRET: 'secret',
      },
    },
    { error: (...args: unknown[]) => run.errors.push(args), warn: () => undefined }
  )
  const handler = moduleObj.exports as (req: unknown, res: unknown) => Promise<unknown>
  const res = {
    status(code: number) {
      run.status = code
      return res
    },
    json(body: unknown) {
      run.body = body
      return res
    },
  }
  // No host: the request is local http, so the plain session cookie is the one
  // the reader accepts. getToken is stubbed and ignores its value.
  await handler({ method: 'POST', headers: { cookie: 'next-auth.session-token=signed' } }, res)
  return run
}

const sqlOf = (run: Run): string[] => run.statements.map((statement) => statement.sql)

/** The statements that change something, in order — the catalogue reads left out. */
const writesOf = (run: Run): string[] =>
  sqlOf(run).filter((sql) => /^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|DELETE|UPDATE)/.test(sql))

/** The deletes in the site's own tables: the route quotes those identifiers. */
const ownDeletesOf = (run: Run): Statement[] =>
  run.statements.filter((statement) => statement.sql.indexOf('DELETE FROM "') === 0)

interface Scenario {
  table: string
  columns: string[]
  links?: Record<string, string>
  /** The column the visitor's rows go through, or null when the table is left alone. */
  deletedThrough: string | null
  why: string
}

const SCENARIOS: Scenario[] = [
  {
    table: 'saved_items',
    columns: ['id', 'user_id', 'title'],
    links: { user_id: 'users.id' },
    deletedThrough: 'user_id',
    why: 'the plain owner link',
  },
  {
    table: 'requests',
    columns: ['id', 'owner_user_id', 'subject'],
    links: { owner_user_id: 'users.id' },
    deletedThrough: 'owner_user_id',
    why: 'the <role>_user_id convention, an owning role',
  },
  {
    table: 'reviews',
    columns: ['id', 'created_by', 'body'],
    deletedThrough: 'created_by',
    why: 'an older project whose link to users was dropped: the name is all there is',
  },
  {
    table: 'posts',
    columns: ['id', 'author_id', 'body'],
    links: { author_id: 'users.id' },
    deletedThrough: 'author_id',
    why: 'the pipeline names the signed-in author this way; the page is scoped by it',
  },
  {
    table: 'expenses',
    columns: ['id', 'submitter_user_id', 'approved_by_user_id', 'amount'],
    links: { submitter_user_id: 'users.id', approved_by_user_id: 'users.id' },
    deletedThrough: 'submitter_user_id',
    why: 'an approver leaving must not delete the expenses they approved',
  },
  {
    table: 'tickets',
    columns: ['id', 'user_id', 'created_by', 'subject'],
    links: { user_id: 'users.id', created_by: 'users.id' },
    deletedThrough: 'user_id',
    why: "an agent leaving must not delete the customers' tickets they opened",
  },
  {
    table: 'listing_inquiries',
    columns: ['id', 'sender_user_id', 'recipient_user_id', 'listing_id', 'body'],
    links: { sender_user_id: 'users.id', recipient_user_id: 'users.id' },
    deletedThrough: 'sender_user_id',
    why: "a seller leaving must not delete the buyers' inquiries",
  },
  {
    table: 'wishlists',
    columns: ['id', 'owner_user_id', 'user_id'],
    links: { owner_user_id: 'users.id', user_id: 'users.id' },
    deletedThrough: 'user_id',
    why: 'one column per table — the one the page reads by, whatever the column order',
  },
  {
    table: 'accounts',
    columns: ['id', 'user_id', 'label'],
    links: { user_id: 'users.id' },
    deletedThrough: 'user_id',
    why: "a table named like a platform scope is still the site's own",
  },
  {
    table: 'tasks',
    columns: ['id', 'title', 'assigned_to', 'updated_by'],
    links: { assigned_to: 'users.id', updated_by: 'users.id' },
    deletedThrough: null,
    why: "actor links only: the rows are other people's",
  },
  {
    table: 'approvals',
    columns: ['id', 'approved_by_user_id', 'note'],
    links: { approved_by_user_id: 'users.id' },
    deletedThrough: null,
    why: "the page reads by an acting role; what leaks there is the read side's null-inclusive predicate",
  },
  {
    table: 'transactions',
    columns: ['id', 'account_id', 'amount'],
    links: { account_id: 'accounts.id' },
    deletedThrough: null,
    why: 'account_id names an account of the site, not a user: a domain link',
  },
  {
    table: 'products',
    columns: ['id', 'name', 'price'],
    deletedThrough: null,
    why: 'nobody owns the row',
  },
  {
    table: 'status_changes',
    columns: ['id', 'ticket_id', 'from_status', 'to_status', 'changed_by_user_id'],
    links: { changed_by_user_id: 'users.id' },
    deletedThrough: null,
    why: "the leaver's history rows on everyone's tickets are not theirs: changing is not creating",
  },
]

describe("closing an account — the rows the visitor owns in the site's own tables", () => {
  describe.each(SCENARIOS.map((scenario) => [scenario.table, scenario] as [string, Scenario]))(
    '%s',
    (_table, scenario) => {
      it(scenario.why, async () => {
        const run = await runRoute({
          ...PLATFORM,
          [scenario.table]: { columns: scenario.columns, links: scenario.links },
        })

        expect(run.status).toBe(200)
        expect(run.body).toEqual({ success: true })
        expect(ownDeletesOf(run)).toEqual(
          scenario.deletedThrough === null
            ? []
            : [
                {
                  sql: `DELETE FROM "${scenario.table}" WHERE "${scenario.deletedThrough}" = $1`,
                  params: [USER_ID],
                },
              ]
        )
        expect(run.errors).toEqual([])
      })
    }
  )

  it('deletes them under their own savepoints, inside the one transaction, before the account', async () => {
    const run = await runRoute({
      ...PLATFORM,
      saved_items: { columns: ['id', 'user_id', 'title'], links: { user_id: 'users.id' } },
      posts: { columns: ['id', 'author_id', 'body'], links: { author_id: 'users.id' } },
    })

    const writes = writesOf(run)
    expect(writes[0]).toBe('BEGIN')
    expect(writes[writes.length - 1]).toBe('COMMIT')
    const at = writes.indexOf('DELETE FROM "posts" WHERE "author_id" = $1')
    expect(writes.slice(at - 1, at + 2)).toEqual([
      'SAVEPOINT owned_rows',
      'DELETE FROM "posts" WHERE "author_id" = $1',
      'RELEASE SAVEPOINT owned_rows',
    ])
    expect(writes.indexOf('DELETE FROM "saved_items" WHERE "user_id" = $1')).toBeLessThan(
      writes.indexOf('DELETE FROM users WHERE id = $1')
    )
    expect(at).toBeLessThan(writes.indexOf('DELETE FROM users WHERE id = $1'))
  })

  it('anonymises a booking like an order: no account, no name, no phone, a synthetic email', async () => {
    const run = await runRoute({
      ...PLATFORM,
      teleport_bookings: {
        columns: [
          'id',
          'reference',
          'user_id',
          'customer_name',
          'customer_email',
          'customer_phone',
          'billing_name',
          'notes',
          'starts_at',
        ],
      },
    })

    expect(run.status).toBe(200)
    const booking = run.statements.filter((statement) =>
      statement.sql.startsWith('UPDATE teleport_bookings')
    )
    expect(booking).toEqual([
      {
        sql: 'UPDATE teleport_bookings SET user_id = NULL, customer_email = $2, customer_name = NULL, customer_phone = NULL WHERE user_id = $1',
        params: [USER_ID, SYNTHETIC_EMAIL],
      },
    ])
    const writes = writesOf(run)
    expect(writes.indexOf(booking[0].sql)).toBeLessThan(
      writes.indexOf('DELETE FROM users WHERE id = $1')
    )
    expect(sqlOf(run).join('\n')).not.toContain('DELETE FROM teleport_bookings')
    expect(sqlOf(run).join('\n')).not.toContain('"teleport_bookings"')
  })

  it('a project with no tables of its own touches only the platform tables, in their order', async () => {
    const run = await runRoute(PLATFORM)

    expect(run.status).toBe(200)
    expect(writesOf(run)).toEqual([
      'BEGIN',
      'UPDATE teleport_orders SET user_id = NULL, billing_email = $2 WHERE user_id = $1',
      'UPDATE teleport_subscriptions SET user_id = NULL, customer_email = $2 WHERE user_id = $1',
      'UPDATE teleport_abandoned_carts SET user_id = NULL, customer_email = $2 WHERE user_id = $1',
      'UPDATE teleport_voucher_redemptions SET user_id = NULL, billing_email = $2 WHERE user_id = $1',
      'DELETE FROM teleport_cart WHERE user_id = $1',
      'DELETE FROM teleport_push_subscriptions WHERE user_id = $1',
      'DELETE FROM password_reset_tokens WHERE email = $1',
      'DELETE FROM users WHERE id = $1',
      'COMMIT',
    ])
    for (const update of run.statements.filter((statement) => statement.sql.startsWith('UPDATE'))) {
      expect(update.params).toEqual([USER_ID, SYNTHETIC_EMAIL])
    }
    expect(run.errors).toEqual([])
  })

  it('a table that refuses stops neither the other tables nor the account; its rows are retried, then named', async () => {
    const stepsStillPointAtRecipes = new Error(
      'update or delete on table "recipes" violates foreign key constraint "recipe_steps_recipe_id_fkey" on table "recipe_steps"'
    )
    const someoneElsesCommentPointsAtPost = new Error(
      'update or delete on table "posts" violates foreign key constraint "comments_post_id_fkey" on table "comments"'
    )
    const run = await runRoute(
      {
        ...PLATFORM,
        recipes: { columns: ['id', 'user_id'], links: { user_id: 'users.id' } },
        recipe_steps: {
          columns: ['id', 'recipe_id', 'user_id'],
          links: { recipe_id: 'recipes.id', user_id: 'users.id' },
        },
        posts: { columns: ['id', 'user_id'], links: { user_id: 'users.id' } },
      },
      (sql, attempt) => {
        if (sql === 'DELETE FROM "recipes" WHERE "user_id" = $1' && attempt === 1) {
          return stepsStillPointAtRecipes
        }
        if (sql === 'DELETE FROM "posts" WHERE "user_id" = $1') {
          return someoneElsesCommentPointsAtPost
        }
        return null
      }
    )

    expect(run.status).toBe(200)
    const writes = writesOf(run)
    expect(writes[writes.length - 1]).toBe('COMMIT')
    expect(writes).toContain('DELETE FROM users WHERE id = $1')
    expect(
      writes.filter((sql) => sql === 'DELETE FROM "recipes" WHERE "user_id" = $1')
    ).toHaveLength(2)
    expect(
      writes.filter((sql) => sql === 'DELETE FROM "recipe_steps" WHERE "user_id" = $1')
    ).toHaveLength(1)
    // Refused in the first round, in the round that freed the recipes, and once more alone.
    expect(writes.filter((sql) => sql === 'DELETE FROM "posts" WHERE "user_id" = $1')).toHaveLength(
      3
    )
    const rollbacks = writes
      .map((sql, index) => (sql === 'ROLLBACK TO SAVEPOINT owned_rows' ? index : -1))
      .filter((index) => index !== -1)
    expect(rollbacks).toHaveLength(4)
    for (const index of rollbacks) {
      expect(writes[index + 1]).toBe('RELEASE SAVEPOINT owned_rows')
    }
    expect(writes).not.toContain('ROLLBACK')
    expect(run.errors).toEqual([
      [`[account-delete] rows kept in posts (user_id): ${someoneElsesCommentPointsAtPost.message}`],
    ])
  })

  it('reads the catalogue with the column positions, in table and column order', async () => {
    const run = await runRoute(PLATFORM)
    const catalogue = sqlOf(run).filter((sql) => sql.indexOf(COLUMNS_OF_EVERY_TABLE) === 0)
    expect(catalogue).toHaveLength(1)
    expect(catalogue[0]).toContain('SELECT c.table_name, c.column_name, c.ordinal_position FROM')
    expect(catalogue[0]).toContain(" AND t.table_type = 'BASE TABLE'")
    expect(catalogue[0].endsWith(' ORDER BY c.table_name, c.ordinal_position')).toBe(true)
  })

  it('carries the shared resolver as text, byte for byte', () => {
    const code = generateAccountDeleteRoute({ authUsersTableName: 'users' })
    expect(code).toContain(OwnerColumns.OWNER_COLUMN_SOURCES.resolveOwnerColumn)
    expect(code).toContain(OwnerColumns.OWNER_COLUMN_SOURCES.attributionKind)
    expect(code).toContain(OwnerColumns.OWNER_COLUMN_SOURCES.userIdRole)
    expect(code).toContain(OwnerColumns.OWNER_COLUMN_SOURCES.ownerColumnPriority)
  })
})
