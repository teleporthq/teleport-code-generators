import * as types from '@babel/types'
import generator from '@babel/generator'
import {
  ComponentStructure,
  ChunkType,
  FileType,
  ChunkDefinition,
} from '@teleporthq/teleport-types'
import { createStaticPropsPlugin } from '@teleporthq/teleport-plugin-next-static-props'
import { createNextLocaleFetcherPlugin } from '../src/internationalization/locale-fetcher-component'

/*
  Regression guard for: "internationalised details pages render raw i18n keys
  once published (e.g. the auth Profile page shows `profile-page-subtitle_gAd_QG`
  instead of the translated text)".

  Root cause: `next-static-props` builds a details-page getStaticProps whose body
  is `[ const { params = {} } = context , try { ... } ]` — i.e. the try block is
  NOT the first statement. The locale fetcher used to read `body.body[0]` and
  bail unless it was a `TryStatement`, so it never injected `messages` into the
  page props. With `pageProps.messages` undefined, `<NextIntlProvider>` has no
  catalogue and next-intl falls back to echoing the key for the page AND every
  shared component it renders (navigation, footer).

  The fetcher now searches the whole function body for the try block and for the
  return statement that actually carries `props`, mirroring what the inline-fetch
  plugin already does.
*/

const codeOfChunk = (chunk: ChunkDefinition): string => generator(chunk.content as types.Node).code

const makeJsxComponentChunk = (): ChunkDefinition => ({
  type: ChunkType.AST,
  fileType: FileType.JS,
  name: 'jsx-component',
  content: types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('Profile'),
      types.arrowFunctionExpression(
        [],
        types.blockStatement([
          types.returnStatement(
            types.jsxElement(
              types.jsxOpeningElement(types.jsxIdentifier('div'), [], true),
              null,
              [],
              true
            )
          ),
        ])
      )
    ),
  ]),
  linkAfter: [],
  meta: {},
})

// Builds the exact structure a details page goes through: static-props first
// emits the getStaticProps chunk, then the locale fetcher runs over it.
const buildDetailsPageStructure = (skipI18n = false): ComponentStructure => ({
  uidl: {
    name: 'Profile',
    node: { type: 'element', content: { elementType: 'container' } },
    outputOptions: {
      folderPath: ['pages', 'profile'],
      fileName: '[id]',
      initialPropsData: {
        exposeAs: { name: 'user', valuePath: ['data', '0'] },
        resource: { id: 'users-detail' },
      },
    },
  } as never,
  options: {
    skipI18n,
    resources: {
      items: { 'users-detail': { name: 'fetch_users_detail' } },
      path: ['resources'],
    },
  } as never,
  chunks: [makeJsxComponentChunk()],
  dependencies: {},
})

describe('createNextLocaleFetcherPlugin on details pages', () => {
  const staticPropsPlugin = createStaticPropsPlugin()
  const localeFetcherPlugin = createNextLocaleFetcherPlugin()

  it('injects the locale catalogue into getStaticProps even when params destructuring precedes the try block', async () => {
    const structure = buildDetailsPageStructure()

    await staticPropsPlugin(structure)

    const generatedChunk = structure.chunks.find((chunk) => chunk.name === 'getStaticProps')
    expect(generatedChunk).toBeDefined()
    // Sanity-check the precondition that used to defeat the fetcher: the first
    // statement of the function is the params destructuring, not the try block.
    const fnBody = (
      (generatedChunk.content as types.ExportNamedDeclaration)
        .declaration as types.FunctionDeclaration
    ).body.body
    expect(fnBody[0].type).toBe('VariableDeclaration')
    expect(fnBody.some((s) => s.type === 'TryStatement')).toBe(true)

    await localeFetcherPlugin(structure)

    const code = codeOfChunk(generatedChunk)
    // The catalogue must be loaded for the requested locale (quote-agnostic:
    // @babel/generator emits double quotes, prettier later normalises them).
    expect(code).toMatch(/import\(['"]\/locales\/['"] \+ context\.locale \+ ['"]\.json['"]\)/)
    // ...and handed to the page as `messages` so <NextIntlProvider> can use it.
    expect(code).toMatch(/props:\s*{[\s\S]*messages[\s\S]*}/)
    // The original entity prop must survive the injection.
    expect(code).toContain('user')
    // We must not have nailed `messages` onto an early `return { notFound: true }`.
    expect(code).not.toMatch(/notFound:\s*true,\s*\n?\s*messages/)
  })

  it('does NOT inject the catalogue when i18n is skipped for the project', async () => {
    const structure = buildDetailsPageStructure(true)

    await staticPropsPlugin(structure)
    await localeFetcherPlugin(structure)

    const generatedChunk = structure.chunks.find((chunk) => chunk.name === 'getStaticProps')
    const code = codeOfChunk(generatedChunk)
    expect(code).not.toContain('/locales/')
    expect(code).not.toMatch(/props:\s*{[\s\S]*messages/)
  })

  it('still injects the catalogue for a plain page whose getStaticProps starts with the try block', async () => {
    // A non-details page (try block IS the first statement) must keep working.
    const tryFirstGetStaticProps: ChunkDefinition = {
      type: ChunkType.AST,
      fileType: FileType.JS,
      name: 'getStaticProps',
      content: types.exportNamedDeclaration(
        (() => {
          const fn = types.functionDeclaration(
            types.identifier('getStaticProps'),
            [types.identifier('context')],
            types.blockStatement([
              types.tryStatement(
                types.blockStatement([
                  types.returnStatement(
                    types.objectExpression([
                      types.objectProperty(types.identifier('props'), types.objectExpression([])),
                    ])
                  ),
                ]),
                types.catchClause(
                  types.identifier('error'),
                  types.blockStatement([
                    types.returnStatement(
                      types.objectExpression([
                        types.objectProperty(types.identifier('props'), types.objectExpression([])),
                      ])
                    ),
                  ])
                )
              ),
            ]),
            false,
            true
          )
          fn.async = true
          return fn
        })()
      ),
      linkAfter: ['jsx-component'],
      meta: {},
    }

    const structure: ComponentStructure = {
      uidl: {
        name: 'Home',
        node: { type: 'element', content: { elementType: 'container' } },
      } as never,
      options: {} as never,
      chunks: [makeJsxComponentChunk(), tryFirstGetStaticProps],
      dependencies: {},
    }

    await localeFetcherPlugin(structure)

    const code = codeOfChunk(tryFirstGetStaticProps)
    expect(code).toMatch(/import\(['"]\/locales\/['"] \+ context\.locale \+ ['"]\.json['"]\)/)
    expect(code).toMatch(/props:\s*{[\s\S]*messages/)
  })
})
