import { GeneratedFolder } from '@teleporthq/teleport-types'
import { generateSafeFileName } from '@teleporthq/teleport-plugin-next-data-source'
import {
  ADMIN_TABLE,
  DATA_SOURCE_ID,
  MEMBER_TABLE,
  PUBLIC_TABLES,
  STAFF_TABLE,
  SUBSCRIBER_TABLE,
  OWNED_TABLE,
  bootReadRoute,
  generateDataExposureProject,
} from './_helpers/data-exposure-fixture'

/**
 * The data-exposure model must never take a table away from a page that shows
 * it to everyone. A store-like and a blog-like project are generated whole —
 * products, posts, bookable items, a merchant's own table and a table bound
 * only inside a component — and every table a page any visitor may open binds
 * is read through its generated read route, anonymously: the list and its
 * count both answer. A table only protected pages bind answers only the
 * sessions those pages admit.
 */

const routeOf = (table: string): string => generateSafeFileName('teleport', table, DATA_SOURCE_ID)

describe('data exposure — every table a public page binds stays readable', () => {
  let project: GeneratedFolder

  beforeAll(async () => {
    project = await generateDataExposureProject()
  }, 120000)

  it.each(PUBLIC_TABLES)('an anonymous visitor reads %s and its count', async (table) => {
    const list = await bootReadRoute(
      project,
      routeOf(table)
    )({ query: { perPage: '12', page: '1' } })
    expect(list.status).toBe(200)
    expect(list.body.success).toBe(true)
    expect(Array.isArray(list.body.data)).toBe(true)
    expect(list.body.data.length).toBe(1)

    const count = await bootReadRoute(project, `${routeOf(table)}-count`)({})
    expect(count.status).toBe(200)
    expect(count.body.count).toBe(1)
  })

  it.each(PUBLIC_TABLES)('%s never serves a credential-named column', async (table) => {
    const list = await bootReadRoute(project, routeOf(table))({})
    expect(list.status).toBe(200)
    expect(list.body.data[0]).not.toHaveProperty('password')
    expect(list.body.data[0]).toHaveProperty('id', 'r1')
  })

  it('a table only a signed-in page binds: 401 anonymously, 200 for any session', async () => {
    const route = bootReadRoute(project, routeOf(MEMBER_TABLE))
    expect((await route({})).status).toBe(401)
    expect((await route({ session: { role: 'user' } })).status).toBe(200)
    const count = bootReadRoute(project, `${routeOf(MEMBER_TABLE)}-count`)
    expect((await count({})).status).toBe(401)
    expect((await count({ session: { role: 'user' } })).status).toBe(200)
  })

  it('a table only a role page binds: 401 anonymously, 403 for another role, 200 for the role', async () => {
    const route = bootReadRoute(project, routeOf(STAFF_TABLE))
    expect((await route({})).status).toBe(401)
    expect((await route({ session: { role: 'user' } })).status).toBe(403)
    expect((await route({ session: { role: 'staff' } })).status).toBe(200)
  })

  it('a protected table on an admin page: only the admin reads it', async () => {
    const route = bootReadRoute(project, routeOf(ADMIN_TABLE))
    expect((await route({})).status).toBe(401)
    expect((await route({ session: { role: 'staff' } })).status).toBe(403)
    const admin = await route({ session: { role: 'admin' } })
    expect(admin.status).toBe(200)
  })

  it('a table only a subscriber-only page binds also needs the entitlement', async () => {
    const route = bootReadRoute(project, routeOf(SUBSCRIBER_TABLE))
    expect((await route({})).status).toBe(401)
    const without = await route({ session: { role: 'user', id: 'u1' } })
    expect(without.status).toBe(403)
    const entitlement = without.queries.find((sql) => /teleport_subscriptions/.test(sql))
    expect(entitlement).toBeDefined()
    expect((await route({ session: { role: 'user', id: 'u1' }, entitled: true })).status).toBe(200)
  })

  it("a row-owned details page's table answers each session its own rows only (I3)", async () => {
    const route = bootReadRoute(project, routeOf(OWNED_TABLE))
    expect((await route({})).status).toBe(401)
    const mine = await route({
      session: { role: 'user', id: 'u-1' },
      // A forged owner never widens the read: the server's condition joins it.
      query: {
        filters: JSON.stringify([{ source: 'user_id', operand: '!=', destination: 'u-1' }]),
      },
    })
    expect(mine.status).toBe(200)
    const read = mine.queries.findIndex(
      (sql) => /FROM job_applications/.test(sql) && !/COUNT/.test(sql)
    )
    expect(mine.queries[read]).toMatch(/user_id = \$1/)
    expect(mine.params[read][0]).toBe('u-1')
  })

  it('a browser read is bounded: whole-number counts only, capped, defaulted', async () => {
    const route = bootReadRoute(project, routeOf('team_members'))
    const injected = await route({ query: { limit: '1;--' } })
    expect(injected.status).toBe(400)
    expect(injected.queries).toHaveLength(0)

    const huge = await route({ query: { limit: '1000000000' } })
    expect(huge.status).toBe(200)
    expect(huge.queries.some((sql) => / LIMIT 500\b/.test(sql))).toBe(true)

    // The team list names no row count of its own (a grid of 12 per page), so a
    // read without one gets the default.
    const unnamed = await route({})
    expect(unnamed.queries.some((sql) => / LIMIT 100\b/.test(sql))).toBe(true)
  })
})
