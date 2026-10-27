import * as types from '@babel/types'
import generate from '@babel/generator'
import { createStaticPathsPlugin } from '../src'
import {
  generateInitialPathsAST,
  PRERENDERED_RECORDS,
  PRERENDERED_RECORDS_CODE,
} from '../src/utils'
import { ChunkType, ComponentStructure, UIDLInitialPathsData } from '@teleporthq/teleport-types'

/**
 * A publish builds the pages of a details page's newest PRERENDERED_RECORDS
 * records; every other record's page is built on its first visit
 * (`fallback: 'blocking'`) and cached. Building all of them made a 486-article
 * help center take 9 minutes to publish.
 */
const initialPathsData: UIDLInitialPathsData = {
  exposeAs: { name: 'postPaths', valuePath: ['data'], itemValuePath: ['slug'] },
  resource: { id: 'TQ_posts' },
}

const runStaticPaths = async (rows: unknown[]) => {
  const ast = generateInitialPathsAST(
    initialPathsData,
    'fetchPosts',
    initialPathsData.resource,
    undefined,
    'slug'
  )
  const { code } = generate(types.program([ast]))
  const getStaticPaths = new Function(
    'fetchPosts',
    `${PRERENDERED_RECORDS_CODE}
    ${code.replace('export async function getStaticPaths', 'async function getStaticPaths')}
    return getStaticPaths`
  )(() => Promise.resolve({ data: rows }))
  const result = await getStaticPaths()
  return {
    slugs: result.paths.map((path: { params: { slug: string } }) => path.params.slug),
    fallback: result.fallback,
  }
}

const day = (n: number) => Date.UTC(2026, 0, 1) + n * 86400000

describe('the records a publish builds', () => {
  it('builds the newest 50 and leaves the rest to their first visit', async () => {
    const rows = Array.from({ length: 120 }, (_, n) => ({ slug: `post-${n}`, publishedAt: day(n) }))
    const { slugs, fallback } = await runStaticPaths(rows)
    expect(PRERENDERED_RECORDS).toBe(50)
    expect(slugs).toHaveLength(50)
    expect(slugs[0]).toBe('post-119')
    expect(slugs[49]).toBe('post-70')
    expect(fallback).toBe('blocking')
  })

  it('reads the date a post was published, then created, in either spelling', async () => {
    const { slugs } = await runStaticPaths([
      { slug: 'created-iso', created_at: new Date(day(3)).toISOString() },
      { slug: 'published-snake', published_at: new Date(day(5)).toISOString() },
      { slug: 'created-ms', createdAt: day(4) },
      { slug: 'published-over-created', publishedAt: day(1), createdAt: day(9) },
    ])
    expect(slugs).toEqual([
      'published-snake',
      'created-ms',
      'created-iso',
      'published-over-created',
    ])
  })

  it("puts undated records after dated ones, in the source's order", async () => {
    const { slugs } = await runStaticPaths([
      { slug: 'a' },
      { slug: 'dated', createdAt: day(1) },
      { slug: 'b', createdAt: 'not a date' },
      { slug: 'c' },
    ])
    expect(slugs).toEqual(['dated', 'a', 'b', 'c'])
  })

  it('keeps a small source whole, in its own order when nothing is dated', async () => {
    const { slugs } = await runStaticPaths([{ slug: 'x' }, { slug: 'y' }, { slug: 'z' }])
    expect(slugs).toEqual(['x', 'y', 'z'])
  })
})

describe('the page the plugin writes', () => {
  const run = async (pagination?: unknown) => {
    const structure = {
      uidl: {
        name: 'Post',
        node: { type: 'element', content: { elementType: 'container' } },
        outputOptions: {
          fileName: '[slug]',
          dynamicRouteAttribute: 'slug',
          initialPathsData: {
            ...initialPathsData,
            resource: { name: 'fetchPosts', dependency: { type: 'local', path: './posts' } },
          },
          ...(pagination ? { pagination } : {}),
        },
      },
      chunks: [
        {
          name: 'jsx-component',
          type: ChunkType.AST,
          fileType: 'js',
          content: types.emptyStatement(),
          linkAfter: [],
        },
      ],
      dependencies: {},
      options: { resources: { items: {}, path: ['resources'] } },
    } as unknown as ComponentStructure
    return (await createStaticPathsPlugin()(structure)).chunks.map((chunk) => chunk.name)
  }

  it('carries the record picker beside a details page’s getStaticPaths', async () => {
    expect(await run()).toEqual(['jsx-component', 'getStaticPaths', 'prerendered-records'])
  })

  it('lists every page number of a paginated listing, without the picker', async () => {
    expect(
      await run({ pageSize: 20, totalCountPath: { type: 'body', path: ['meta', 'total'] } })
    ).toEqual(['jsx-component', 'getStaticPaths'])
  })
})

describe('a content preset’s category pages', () => {
  it('lists every category, without the picker: listings are few and lead to every post', async () => {
    const structure = {
      uidl: {
        name: 'HelpCategory',
        node: { type: 'element', content: { elementType: 'container' } },
        outputOptions: {
          fileName: '[slug]',
          dynamicRouteAttribute: 'slug',
          initialPathsData: {
            exposeAs: { name: 'helpCategoryPaths', valuePath: ['data'], itemValuePath: ['slug'] },
            resource: {
              name: 'listHelpCategoryPaths',
              dependency: { type: 'local', path: '@/content-category-pages' },
            },
          },
        },
      },
      chunks: [
        {
          name: 'jsx-component',
          type: ChunkType.AST,
          fileType: 'js',
          content: types.emptyStatement(),
          linkAfter: [],
        },
      ],
      dependencies: {},
      options: { resources: { items: {}, path: ['resources'] } },
    } as unknown as ComponentStructure
    const result = await createStaticPathsPlugin()(structure)
    expect(result.chunks.map((chunk) => chunk.name)).toEqual(['jsx-component', 'getStaticPaths'])

    const pathsChunk = result.chunks.find((chunk) => chunk.name === 'getStaticPaths')
    const { code } = generate(types.program([pathsChunk!.content as types.Statement]))
    const categories = Array.from({ length: 71 }, (_, n) => ({ slug: `category-${n}` }))
    const getStaticPaths = new Function(
      'listHelpCategoryPaths',
      `${code.replace('export async function getStaticPaths', 'async function getStaticPaths')}
      return getStaticPaths`
    )(() => Promise.resolve({ data: categories }))
    expect((await getStaticPaths()).paths).toHaveLength(71)
  })
})
