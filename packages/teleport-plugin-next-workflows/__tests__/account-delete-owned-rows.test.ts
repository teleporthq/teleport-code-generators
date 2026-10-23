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
  // A business record with a user link and no handling of its own: kept as it is.
  teleport_subscriptions: { columns: ['id', 'user_id', 'customer_email', 'status'] },
}

const USER_ROW = 'SELECT * FROM users WHERE id = $1'
const COLUMNS_OF_ONE_TABLE =
  "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1"
const COLUMNS_OF_EVERY_TABLE =
  'SELECT c.table_name, c.column_name FROM information_schema.columns c'
const FOREIGN_KEYS = 'FROM pg_constraint'

const columnRows = (schema: FixtureSchema) => {
  const rows: Array<{ table_name: string; column_name: string }> = []
  for (const tableName of Object.keys(schema)) {
    for (const columnName of schema[tableName].columns) {
      rows.push({ table_name: tableName, column_name: columnName })
    }
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
  await handler({ method: 'POST', headers: {} }, res)
  return run
}

const sqlOf = (run: Run): string[] => run.statements.map((statement) => statement.sql)

/** The statements that change something, in order — the catalogue reads left out. */
const writesOf = (run: Run): string[] =>
  sqlOf(run).filter((sql) => /^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|DELETE|UPDATE)/.test(sql))

const deletesOf = (run: Run): Statement[] =>
  run.statements.filter((statement) => statement.sql.indexOf('DELETE') === 0)

describe("closing an account — the rows the visitor owns in the site's own tables", () => {
  it('deletes them through every owner column, each under a savepoint, before the account', async () => {
    const run = await runRoute({
      ...PLATFORM,
      saved_items: { columns: ['id', 'user_id', 'title'], links: { user_id: 'users.id' } },
      requests: {
        columns: ['id', 'owner_user_id', 'subject'],
        links: { owner_user_id: 'users.id' },
      },
      // An older project: the link to users was dropped, the name is all there is.
      reviews: { columns: ['id', 'created_by', 'body'] },
    })

    expect(run.status).toBe(200)
    expect(run.body).toEqual({ success: true })
    const deletes = deletesOf(run)
    expect(deletes.map((statement) => statement.sql)).toEqual([
      'DELETE FROM teleport_cart WHERE user_id = $1',
      'DELETE FROM "saved_items" WHERE "user_id" = $1',
      'DELETE FROM "requests" WHERE "owner_user_id" = $1',
      'DELETE FROM "reviews" WHERE "created_by" = $1',
      'DELETE FROM password_reset_tokens WHERE email = $1',
      'DELETE FROM users WHERE id = $1',
    ])
    for (const owned of deletes.slice(1, 4)) {
      expect(owned.params).toEqual([USER_ID])
    }

    const writes = writesOf(run)
    expect(writes[0]).toBe('BEGIN')
    expect(writes[writes.length - 1]).toBe('COMMIT')
    const at = writes.indexOf('DELETE FROM "requests" WHERE "owner_user_id" = $1')
    expect(writes.slice(at - 1, at + 2)).toEqual([
      'SAVEPOINT owned_rows',
      'DELETE FROM "requests" WHERE "owner_user_id" = $1',
      'RELEASE SAVEPOINT owned_rows',
    ])
    expect(run.errors).toEqual([])
  })

  it("leaves other people's rows alone: actor links, audit links, domain links, platform records", async () => {
    const run = await runRoute({
      ...PLATFORM,
      tasks: {
        columns: ['id', 'title', 'assigned_to', 'updated_by'],
        links: { assigned_to: 'users.id', updated_by: 'users.id' },
      },
      accounts: { columns: ['id', 'user_id', 'label'], links: { user_id: 'users.id' } },
      // `account_id` names an account, not a user: a domain link.
      transactions: {
        columns: ['id', 'account_id', 'amount'],
        links: { account_id: 'accounts.id' },
      },
    })

    expect(run.status).toBe(200)
    expect(deletesOf(run).map((statement) => statement.sql)).toEqual([
      'DELETE FROM teleport_cart WHERE user_id = $1',
      'DELETE FROM "accounts" WHERE "user_id" = $1',
      'DELETE FROM password_reset_tokens WHERE email = $1',
      'DELETE FROM users WHERE id = $1',
    ])
    const touched = sqlOf(run).join('\n')
    expect(touched).not.toContain('"tasks"')
    expect(touched).not.toContain('"transactions"')
    expect(touched).not.toContain('DELETE FROM teleport_subscriptions')
    expect(touched).not.toContain('"teleport_subscriptions"')
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
    const updates = run.statements.filter((statement) => statement.sql.indexOf('UPDATE') === 0)
    expect(updates).toEqual([
      {
        sql: 'UPDATE teleport_orders SET user_id = NULL, billing_email = $2 WHERE user_id = $1',
        params: [USER_ID, SYNTHETIC_EMAIL],
      },
      {
        sql: 'UPDATE teleport_bookings SET user_id = NULL, customer_email = $2, customer_name = NULL, customer_phone = NULL WHERE user_id = $1',
        params: [USER_ID, SYNTHETIC_EMAIL],
      },
    ])
    const writes = writesOf(run)
    expect(writes.indexOf(updates[1].sql)).toBeLessThan(
      writes.indexOf('DELETE FROM users WHERE id = $1')
    )
    expect(sqlOf(run).join('\n')).not.toContain('DELETE FROM teleport_bookings')
    expect(sqlOf(run).join('\n')).not.toContain('"teleport_bookings"')
  })

  it('a project with no tables of its own deletes exactly what it did before', async () => {
    const run = await runRoute(PLATFORM)

    expect(run.status).toBe(200)
    expect(writesOf(run)).toEqual([
      'BEGIN',
      'UPDATE teleport_orders SET user_id = NULL, billing_email = $2 WHERE user_id = $1',
      'DELETE FROM teleport_cart WHERE user_id = $1',
      'DELETE FROM password_reset_tokens WHERE email = $1',
      'DELETE FROM users WHERE id = $1',
      'COMMIT',
    ])
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
    expect(writes.filter((sql) => sql === 'ROLLBACK TO SAVEPOINT owned_rows')).toHaveLength(4)
    expect(writes).not.toContain('ROLLBACK')
    expect(run.errors).toEqual([
      [`[account-delete] rows kept in posts (user_id): ${someoneElsesCommentPointsAtPost.message}`],
    ])
  })

  it('carries the shared owner vocabulary, byte for byte', () => {
    const code = generateAccountDeleteRoute({ authUsersTableName: 'users' })
    expect(code).toContain(
      `const OWNER_COLUMN_NAMES = ${JSON.stringify(OwnerColumns.OWNER_COLUMN_NAMES)};`
    )
    expect(code).toContain(
      `const OWNER_COLUMN_SUFFIX = ${JSON.stringify(OwnerColumns.OWNER_COLUMN_SUFFIX)};`
    )
  })
})
