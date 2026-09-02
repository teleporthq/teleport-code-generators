import * as types from '@babel/types'
import generate from '@babel/generator'
import { ChunkType, ComponentStructure, FileType } from '@teleporthq/teleport-types'
import { createNextLocaleFetcherPlugin } from '../src/internationalization/locale-fetcher-component'

/**
 * `pageProps.messages` is what `_app.js` hands to `NextIntlProvider`. Without it
 * next-intl has nothing to look up and every `translate.raw('key')` on the page
 * renders the KEY — which is exactly what a generated product-details page did:
 * "Reviews Heading_iuc43E" where "Reseñas de Clientes" belonged.
 *
 * The pages that broke are the ones that already OWN a getStaticProps because a
 * resource feeds them — every `[slug]`/`[id]` details page, and every list page
 * the admin panel generates. So these tests pin the merge against the real
 * shapes the other page plugins produce, not just against an empty page.
 */

const jsxChunk = () => ({
  name: 'jsx-component',
  type: ChunkType.AST,
  fileType: FileType.JS,
  content: types.jsxElement(
    types.jsxOpeningElement(types.jsxIdentifier('div'), [], true),
    null,
    [],
    true
  ),
  linkAfter: [] as string[],
})

/** `export async function getStaticProps(context) { <body> }` */
const getStaticPropsChunk = (body: types.Statement[], meta?: Record<string, unknown>) => {
  const declaration = types.functionDeclaration(
    types.identifier('getStaticProps'),
    [types.identifier('context')],
    types.blockStatement(body),
    false,
    true
  )
  declaration.async = true

  return {
    name: 'getStaticProps',
    type: ChunkType.AST,
    fileType: FileType.JS,
    content: types.exportNamedDeclaration(declaration),
    linkAfter: ['jsx-component'],
    ...(meta ? { meta } : {}),
  }
}

const returnProps = (properties: types.ObjectExpression['properties'] = []) =>
  types.returnStatement(
    types.objectExpression([
      types.objectProperty(types.identifier('props'), types.objectExpression(properties)),
      types.objectProperty(types.identifier('revalidate'), types.numericLiteral(60)),
    ])
  )

const returnNotFound = () =>
  types.returnStatement(
    types.objectExpression([
      types.objectProperty(types.identifier('notFound'), types.booleanLiteral(true)),
    ])
  )

/** The shape `teleport-plugin-next-static-props` emits for a details page. */
const resourceBackedBody = () => [
  types.variableDeclaration('const', [
    types.variableDeclarator(
      types.objectPattern([
        types.objectProperty(
          types.identifier('params'),
          types.assignmentPattern(types.identifier('params'), types.objectExpression([])),
          false,
          true
        ),
      ]),
      types.identifier('context')
    ),
  ]),
  types.tryStatement(
    types.blockStatement([
      types.ifStatement(
        types.unaryExpression('!', types.identifier('response')),
        types.blockStatement([returnNotFound()])
      ),
      returnProps([
        types.objectProperty(
          types.identifier('ecommerceProduct'),
          types.identifier('response'),
          false,
          false
        ),
      ]),
    ]),
    types.catchClause(types.identifier('error'), types.blockStatement([returnNotFound()]))
  ),
]

const run = async (chunks: ComponentStructure['chunks'], skipI18n = false) => {
  const structure = {
    uidl: { name: 'ProductDetails', node: { type: 'element', content: {} } },
    chunks,
    dependencies: {},
    options: { skipI18n },
  } as unknown as ComponentStructure

  await createNextLocaleFetcherPlugin()(structure)
  return structure
}

const codeOf = (structure: ComponentStructure): string => {
  const chunk = structure.chunks.find((item) => item.name === 'getStaticProps')
  if (!chunk) {
    return ''
  }
  // Quote style is decided by the prettier post-processor, not here.
  return generate(chunk.content as types.Node).code.replace(/"/g, `'`)
}

/** How many `props` objects received the shorthand `messages` entry. */
const messagesPropCount = (code: string): number => code.match(/^\s*messages,?$/gm)?.length ?? 0

describe('a page that already owns a getStaticProps', () => {
  it('merges the messages into the props a resource-backed details page returns', async () => {
    const structure = await run([jsxChunk(), getStaticPropsChunk(resourceBackedBody())] as never)
    const code = codeOf(structure)

    expect(code).toContain(
      `const messages = (await import('/locales/' + context.locale + '.json'))`
    )
    expect(code).toMatch(/props:\s*{\s*messages,\s*ecommerceProduct/)
  })

  it('reads the locale file before the try, so the fallback render is localized too', async () => {
    // Several page plugins answer a failed fetch with `{ props: {} }` rather than
    // a 404. That page still renders — and has to render translated.
    const body = [
      types.tryStatement(
        types.blockStatement([returnProps()]),
        types.catchClause(types.identifier('error'), types.blockStatement([returnProps()]))
      ),
    ]
    const code = codeOf(await run([jsxChunk(), getStaticPropsChunk(body)] as never))

    expect(code.indexOf('const messages')).toBeLessThan(code.indexOf('try'))
    expect(messagesPropCount(code)).toBe(2)
  })

  it('leaves a `notFound` return alone — it has no props to localize', async () => {
    const body = [types.tryStatement(types.blockStatement([returnNotFound()]), null, null)]
    const code = codeOf(await run([jsxChunk(), getStaticPropsChunk(body)] as never))

    expect(code).toContain('notFound: true')
    expect(messagesPropCount(code)).toBe(0)
  })

  it('never adds the messages twice when the plugin runs again', async () => {
    const chunks = [jsxChunk(), getStaticPropsChunk(resourceBackedBody())] as never
    const structure = await run(chunks)
    await createNextLocaleFetcherPlugin()(structure)

    expect(messagesPropCount(codeOf(structure))).toBe(1)
    expect(codeOf(structure).match(/const messages =/g)).toHaveLength(1)
  })

  it('keeps working for the admin CRUD pages that become getServerSideProps', async () => {
    // The rename happens in a finalizer that runs AFTER this plugin, so the chunk
    // is still called getStaticProps here — only the meta flag marks it.
    const structure = await run([
      jsxChunk(),
      getStaticPropsChunk(resourceBackedBody(), { useServerSideProps: true }),
    ] as never)

    expect(messagesPropCount(codeOf(structure))).toBe(1)
  })
})

describe('a page with no data fetching of its own', () => {
  it('gets a getStaticProps that loads the messages', async () => {
    const code = codeOf(await run([jsxChunk()] as never))

    expect(code).toContain('export async function getStaticProps(context)')
    expect(messagesPropCount(code)).toBe(1)
    expect(code).toContain('...context')
  })
})

describe('a project without internationalization', () => {
  it('adds nothing at all', async () => {
    const structure = await run([jsxChunk()] as never, true)

    expect(structure.chunks.find((chunk) => chunk.name === 'getStaticProps')).toBeUndefined()
  })
})
