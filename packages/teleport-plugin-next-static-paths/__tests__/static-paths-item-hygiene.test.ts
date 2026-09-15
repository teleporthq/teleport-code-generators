import * as types from '@babel/types'
import generate from '@babel/generator'
import { generateInitialPathsAST } from '../src/utils'
import { UIDLInitialPathsData } from '@teleporthq/teleport-types'

const initialPathsData: UIDLInitialPathsData = {
  exposeAs: { name: 'productPaths', valuePath: ['data'], itemValuePath: ['slug'] },
  resource: { id: 'TQ_products' },
}

/**
 * Evaluates the emitted `getStaticPaths` against a canned response, so these
 * assert on the paths it actually produces rather than on generated text.
 */
const runStaticPaths = async (response: unknown) => {
  const ast = generateInitialPathsAST(
    initialPathsData,
    'fetchProducts',
    initialPathsData.resource,
    undefined,
    'slug'
  )
  const { code } = generate(types.program([ast]))

  const factory = new Function(
    'fetchProducts',
    `${code.replace('export async function getStaticPaths', 'async function getStaticPaths')}
    return getStaticPaths`
  )

  return factory(() => Promise.resolve(response))()
}

describe('getStaticPaths item hygiene', () => {
  it('produces one path per record for clean data, in order — unchanged', async () => {
    const result = await runStaticPaths({ data: [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }] })

    expect(result.paths).toEqual([
      { params: { slug: 'a' } },
      { params: { slug: 'b' } },
      { params: { slug: 'c' } },
    ])
    expect(result.fallback).toBe('blocking')
  })

  it('stringifies a numeric differentiator, as before', async () => {
    const result = await runStaticPaths({ data: [{ slug: 1 }, { slug: 2 }] })
    expect(result.paths).toEqual([{ params: { slug: '1' } }, { params: { slug: '2' } }])
  })

  it('skips records with no differentiator instead of losing every path', async () => {
    const result = await runStaticPaths({
      data: [{ slug: 'a' }, {}, { slug: null }, { slug: '' }, { slug: 'b' }],
    })

    expect(result.paths).toEqual([{ params: { slug: 'a' } }, { params: { slug: 'b' } }])
  })

  it('emits one path per distinct differentiator', async () => {
    const result = await runStaticPaths({
      data: [{ slug: 'a' }, { slug: 'b' }, { slug: 'a' }],
    })

    expect(result.paths).toEqual([{ params: { slug: 'a' } }, { params: { slug: 'b' } }])
  })

  it('returns no paths, not an error, for an empty or absent collection', async () => {
    expect((await runStaticPaths({ data: [] })).paths).toEqual([])
    expect((await runStaticPaths({})).paths).toEqual([])
  })
})
