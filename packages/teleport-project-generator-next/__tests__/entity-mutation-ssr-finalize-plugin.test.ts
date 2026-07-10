import generator from '@babel/generator'
import * as types from '@babel/types'
import { ChunkType, ComponentStructure, FileType } from '@teleporthq/teleport-types'
import { createEntityMutationSsrFinalizerPlugin } from '../src/entity-mutation-ssr-finalize-plugin'

// Regression guard for the "Edit Press Item" ISR-staleness bug: the tail of
// the page-plugin pipeline must convert a getStaticProps chunk tagged
// `meta.useServerSideProps` (by teleport-plugin-next-static-props) into an
// actual getServerSideProps export, and strip any `revalidate` any
// LATER-running plugin (data-source/pagination/inline-fetch) attached —
// Next.js hard-errors at build time if `revalidate` is present alongside
// getServerSideProps.

const buildGetStaticPropsFunction = (withRevalidate: boolean, nested = false) => {
  const returnProps = types.objectExpression(
    [
      types.objectProperty(types.identifier('props'), types.objectExpression([])),
      withRevalidate
        ? types.objectProperty(types.identifier('revalidate'), types.numericLiteral(60))
        : null,
    ].filter(Boolean) as types.ObjectProperty[]
  )

  const mainReturn = types.returnStatement(returnProps)

  const body = nested
    ? types.blockStatement([
        types.ifStatement(types.booleanLiteral(true), types.blockStatement([mainReturn])),
      ])
    : types.blockStatement([mainReturn])

  const fn = types.functionDeclaration(
    types.identifier('getStaticProps'),
    [types.identifier('context')],
    body,
    false,
    true
  )
  fn.async = true
  return types.exportNamedDeclaration(fn)
}

const makeStructure = (params: {
  taggedForSSR: boolean
  withRevalidate?: boolean
  nestedReturn?: boolean
}): ComponentStructure => {
  const { taggedForSSR, withRevalidate = false, nestedReturn = false } = params
  return {
    uidl: { name: 'EditPressItem', node: { type: 'element', content: {} } },
    chunks: [
      {
        name: 'getStaticProps',
        type: ChunkType.AST,
        fileType: FileType.JS,
        content: buildGetStaticPropsFunction(withRevalidate, nestedReturn),
        linkAfter: ['jsx-component'],
        meta: taggedForSSR ? { useServerSideProps: true } : undefined,
      },
    ],
    dependencies: {},
    options: {},
  } as unknown as ComponentStructure
}

describe('entity-mutation-ssr-finalize-plugin', () => {
  const plugin = createEntityMutationSsrFinalizerPlugin()

  it('renames getStaticProps -> getServerSideProps when tagged useServerSideProps', async () => {
    const structure = makeStructure({ taggedForSSR: true })
    const result = await plugin(structure)

    const chunk = result.chunks.find((c) => c.name === 'getServerSideProps')
    expect(chunk).toBeDefined()
    expect(result.chunks.find((c) => c.name === 'getStaticProps')).toBeUndefined()

    const code = generator(chunk?.content as types.Node).code
    expect(code).toContain('export async function getServerSideProps(context)')
  })

  it('strips a top-level revalidate property added by a later-running plugin', async () => {
    const structure = makeStructure({ taggedForSSR: true, withRevalidate: true })
    const result = await plugin(structure)

    const chunk = result.chunks.find((c) => c.name === 'getServerSideProps')
    const code = generator(chunk?.content as types.Node).code
    expect(code).not.toContain('revalidate')
  })

  it('strips a revalidate property nested inside an if-branch return', async () => {
    const structure = makeStructure({
      taggedForSSR: true,
      withRevalidate: true,
      nestedReturn: true,
    })
    const result = await plugin(structure)

    const chunk = result.chunks.find((c) => c.name === 'getServerSideProps')
    const code = generator(chunk?.content as types.Node).code
    expect(code).not.toContain('revalidate')
    expect(code).toContain('props: {}')
  })

  it('is a no-op when the chunk is not tagged useServerSideProps (regular static page)', async () => {
    const structure = makeStructure({ taggedForSSR: false, withRevalidate: true })
    const result = await plugin(structure)

    const chunk = result.chunks.find((c) => c.name === 'getStaticProps')
    expect(chunk).toBeDefined()
    expect(result.chunks.find((c) => c.name === 'getServerSideProps')).toBeUndefined()

    const code = generator(chunk?.content as types.Node).code
    expect(code).toContain('export async function getStaticProps(context)')
    expect(code).toContain('revalidate')
  })

  it('is a no-op when there is no getStaticProps chunk at all', async () => {
    const structure = {
      uidl: { name: 'Home', node: { type: 'element', content: {} } },
      chunks: [{ name: 'jsx-component', type: ChunkType.AST, fileType: FileType.JS, content: {} }],
      dependencies: {},
      options: {},
    } as unknown as ComponentStructure

    const result = await plugin(structure)
    expect(result.chunks).toHaveLength(1)
    expect(result.chunks[0].name).toBe('jsx-component')
  })
})
