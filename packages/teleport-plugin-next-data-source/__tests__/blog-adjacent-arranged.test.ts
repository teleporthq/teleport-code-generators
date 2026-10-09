import { generateBlogPostTransformationCode } from '../src/transformations/blog-post'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'
import { getTransformationCode } from '../src/transformations'
import { ContentTables } from '@teleporthq/teleport-shared'

/**
 * Previous / Next in Manual Order: a post walks the published posts of its
 * primary category the way the author arranged them. These evaluate the
 * EMITTED code against a fake database client, the way the runtime calls it.
 *
 * The fixture and the expectations are the SAME as teleport-gui
 * `features/blog/utils/__tests__/arranged-order.spec.ts` ("Previous / Next the
 * published site mirrors"): the canvas and the site must agree.
 */

interface Row {
  id: string
  status: string
  category_ids: string | null
  sort_order: number | null
  created_at: string
  redirect_url?: string | null
}

type AdjacentMap = Record<string, { previous: Row | null; next: Row | null }>
type GetAdjacent = (getClient: () => unknown, records: unknown[]) => Promise<AdjacentMap>

const HELP_TABLE = ContentTables.contentTablesByKey('help').posts

const load = (arranged: boolean): GetAdjacent =>
  // tslint:disable-next-line:function-constructor
  new Function(
    `${generateSharedTransformationCode()}\n${generateBlogPostTransformationCode({
      tables: ContentTables.contentTablesByKey('help'),
      arranged,
    })}\nreturn getAdjacentPostsMap;`
  )() as GetAdjacent

const row = (
  id: string,
  categories: string[] | null,
  sortOrder: number | null,
  createdAt: string,
  overrides: Partial<Row> = {}
): Row => ({
  id,
  status: 'published',
  category_ids: categories ? JSON.stringify(categories) : null,
  sort_order: sortOrder,
  created_at: createdAt,
  ...overrides,
})

const TABLE: Row[] = [
  row('a1', ['guides'], 1, '2026-01-01T00:00:00.000Z'),
  row('a2', ['guides'], 2, '2026-01-05T00:00:00.000Z'),
  row('a3', ['guides'], 3, '2026-01-03T00:00:00.000Z', { redirect_url: '/help/a1' }),
  row('a4', ['guides'], 4, '2026-01-02T00:00:00.000Z'),
  row('a5', ['guides'], null, '2026-02-01T00:00:00.000Z'),
  row('a6', ['guides'], null, '2026-01-20T00:00:00.000Z'),
  row('draft', ['guides'], 2, '2026-03-01T00:00:00.000Z', { status: 'draft' }),
  // Filed under guides as a second category: not on guides' path.
  row('b1', ['billing', 'guides'], 1, '2026-01-04T00:00:00.000Z'),
  // A comma-separated cell, as the generated admin panel's text field writes it.
  row('c1', null, 1, '2026-01-06T00:00:00.000Z', { category_ids: 'guides, billing' }),
  row('lone', null, null, '2026-01-07T00:00:00.000Z'),
]

/** A client over `TABLE` that answers the statements the code sends, and records them. */
const fakeClient = (options: { failArranged?: boolean } = {}) => {
  const statements: string[] = []
  const client = {
    connect: async (): Promise<void> => undefined,
    end: async (): Promise<void> => undefined,
    query: async (sql: string, params: unknown[]) => {
      statements.push(sql)
      if (sql.startsWith('SELECT id, category_ids, sort_order, created_at FROM')) {
        if (options.failArranged) {
          throw new Error('column "sort_order" does not exist')
        }
        return {
          rows: TABLE.filter((entry) => entry.status === 'published' || entry.id === params[0]),
        }
      }
      if (sql.includes('= ANY($1::text[])')) {
        const ids = params[0] as string[]
        return { rows: TABLE.filter((entry) => ids.includes(entry.id)) }
      }
      // The newest-first lookups: (created_at, id) before / after the post's.
      const current = TABLE.find((entry) => entry.id === params[0]) as Row
      const older = sql.includes(') < (cur.created_at')
      const rows = TABLE.filter((entry) => entry.status === 'published')
        .filter((entry) =>
          older ? entry.created_at < current.created_at : entry.created_at > current.created_at
        )
        .sort((a, b) =>
          older
            ? b.created_at.localeCompare(a.created_at)
            : a.created_at.localeCompare(b.created_at)
        )
      return { rows }
    },
  }
  return { client, statements }
}

const neighbours = async (postId: string, arranged = true, failArranged = false) => {
  const { client, statements } = fakeClient({ failArranged })
  const map = await load(arranged)(
    () => client,
    [TABLE.find((candidate) => candidate.id === postId)]
  )
  const found = map[postId]
  return {
    previous: found?.previous?.id ?? null,
    next: found?.next?.id ?? null,
    statements,
  }
}

describe('Previous / Next in Manual Order', () => {
  it('walks the primary category as arranged: places first, then the rest newest first', async () => {
    // c1 shares place 1 and is newer, so it comes first.
    expect(await neighbours('a1')).toMatchObject({ previous: 'c1', next: 'a2' })
    // a3 redirects elsewhere: stepped over both ways.
    expect(await neighbours('a2')).toMatchObject({ previous: 'a1', next: 'a4' })
    expect(await neighbours('a4')).toMatchObject({ previous: 'a2', next: 'a5' })
    expect(await neighbours('a5')).toMatchObject({ previous: 'a4', next: 'a6' })
    expect(await neighbours('a6')).toMatchObject({ previous: 'a5', next: null })
  })

  it('leaves out drafts and posts filed there through a second category, yet places a draft it shows', async () => {
    const draft = await neighbours('draft')
    expect(draft).toMatchObject({ previous: 'a1', next: 'a2' })
    expect(await neighbours('b1')).toMatchObject({ previous: null, next: null })
  })

  it('reads a comma-separated category cell like a JSON one', async () => {
    // c1's primary is guides; place 1 ties with a1, the newer first.
    expect(await neighbours('c1')).toMatchObject({ previous: null, next: 'a1' })
  })

  it('walks the newest-first order for a post without a category, or a table it cannot read', async () => {
    const lone = await neighbours('lone')
    expect(lone.statements.some((sql) => sql.includes('(cur.created_at, cur.id)'))).toBe(true)
    expect(lone).toMatchObject({ previous: 'c1', next: 'a6' })

    const unreadable = await neighbours('a2', true, true)
    expect(unreadable).toMatchObject({ previous: 'b1', next: 'c1' })
  })

  it('never asks for the arranged order when the pages are newest first', async () => {
    const plain = await neighbours('a2', false)
    expect(plain.statements.some((sql) => sql.includes('sort_order'))).toBe(false)
    expect(plain).toMatchObject({ previous: 'b1', next: 'c1' })
  })

  it('is emitted for a table whose preset is in Manual Order, and only then', () => {
    const arranged = getTransformationCode(HELP_TABLE, {
      contentSettings: { help: { order: 'manual' } },
    })
    expect(arranged).toContain('var BLOG_ARRANGED_ORDER = true')
    expect(getTransformationCode(HELP_TABLE, {})).toContain('var BLOG_ARRANGED_ORDER = false')
  })
})

describe('the post a page is given', () => {
  it('carries its place, or null', () => {
    const build = new Function(
      `${generateSharedTransformationCode()}\n${generateBlogPostTransformationCode()}\nreturn buildBlogPost;`
    )() as (record: unknown) => Record<string, unknown>
    expect(build(row('a', ['guides'], 3, '2026-01-01T00:00:00.000Z')).sortOrder).toBe(3)
    expect(build(row('a', ['guides'], null, '2026-01-01T00:00:00.000Z')).sortOrder).toBeNull()
    expect(build({ id: 'old', title: 'Old', slug: 'old' }).sortOrder).toBeNull()
  })
})
