import * as types from '@babel/types'
import generator from '@babel/generator'
import {
  ComponentStructure,
  ChunkType,
  FileType,
  ChunkDefinition,
} from '@teleporthq/teleport-types'
import { createNextUrlSearchParamsPlugin } from '../src/url-search-params-plugin'

// The jsx-component chunk the plugin mutates in-place: a `const Comp = () => {
// return <div/>; }` shell with an empty body where the plugin should prepend
// `const router = useRouter()`.
const makeJsxComponentChunk = (): ChunkDefinition => {
  const body = types.blockStatement([
    types.returnStatement(
      types.jsxElement(
        types.jsxOpeningElement(types.jsxIdentifier('div'), [], true),
        null,
        [],
        true
      )
    ),
  ])
  const arrow = types.arrowFunctionExpression([], body)
  const declaration = types.variableDeclaration('const', [
    types.variableDeclarator(types.identifier('Comp'), arrow),
  ])
  return {
    type: ChunkType.AST,
    fileType: FileType.JS,
    name: 'jsx-component',
    content: declaration,
    linkAfter: [],
    meta: {},
  }
}

const codeOfChunk = (chunk: ChunkDefinition): string => generator(chunk.content as types.Node).code

describe('createNextUrlSearchParamsPlugin', () => {
  const plugin = createNextUrlSearchParamsPlugin()

  it('is a no-op when neither page-level searchParams nor state-level urlSearchParamBinding are present', async () => {
    const chunk = makeJsxComponentChunk()
    const structure: ComponentStructure = {
      uidl: {
        name: 'NoOp',
        node: { type: 'element', content: { elementType: 'container' } },
      } as never,
      options: {},
      chunks: [chunk],
      dependencies: {},
    }
    await plugin(structure)
    expect(structure.dependencies.useRouter).toBeUndefined()
    expect(codeOfChunk(chunk)).not.toContain('useRouter')
  })

  it('injects useRouter AND a write-back useEffect for state-level urlSearchParamBinding', async () => {
    // The state's *initial* value is still seeded from
    // `window.location.search` (see `createStateHookAST`), so the read side
    // does not depend on Next's router. But user-driven changes to the state
    // must propagate back to the URL bar — otherwise cross-page deep links
    // built off the URL break and a reload loses the user's selection.
    //
    // This plugin is the canonical place for that wiring: it emits
    //   const router = useRouter()
    //   useEffect(() => {
    //     ...if (state === '' || state == null) delete query.<key>
    //        else query.<key> = String(state)...
    //     router.replace({ pathname, query }, undefined, { shallow: true })
    //   }, [state])
    // The `useRouter` dep + the `useEffect` dep both need to land in
    // `structure.dependencies` so the import plugin emits them on the page.
    const chunk = makeJsxComponentChunk()
    const structure: ComponentStructure = {
      uidl: {
        name: 'Products',
        node: { type: 'element', content: { elementType: 'container' } },
        stateDefinitions: {
          selectedCategory: {
            type: 'string',
            defaultValue: '',
            urlSearchParamBinding: { key: 'categoryFilter' },
          },
        },
      } as never,
      options: {},
      chunks: [chunk],
      dependencies: {},
    }
    await plugin(structure)

    expect(structure.dependencies.useRouter).toBeDefined()
    expect(structure.dependencies.useRouter.path).toBe('next/router')
    expect(structure.dependencies.useEffect).toBeDefined()

    const code = codeOfChunk(chunk)
    expect(code).toContain('const router = useRouter()')
    expect(code).toContain('router.replace(')
    expect(code).toContain('categoryFilter')
    expect(code).toContain('shallow: true')
    // Write-back deps include the state and `router.isReady` so the effect
    // re-runs once the SSG-mounted router hydrates and `router.query` is no
    // longer empty.
    expect(code).toContain('selectedCategory')
    expect(code).toContain('router.isReady')
    // Read-back effect must also exist and key off `router.query.categoryFilter`
    // so external URL changes (back/forward, programmatic shallow pushes)
    // flow back into state.
    expect(code).toContain('router.query.categoryFilter')
    expect(code).toContain('setSelectedCategory')
  })

  it('is idempotent — running twice does not double-emit write-back or read-back', async () => {
    const chunk = makeJsxComponentChunk()
    const structure: ComponentStructure = {
      uidl: {
        name: 'Products',
        node: { type: 'element', content: { elementType: 'container' } },
        stateDefinitions: {
          selectedCategory: {
            type: 'string',
            defaultValue: '',
            urlSearchParamBinding: { key: 'categoryFilter' },
          },
        },
      } as never,
      options: {},
      chunks: [chunk],
      dependencies: {},
    }
    await plugin(structure)
    await plugin(structure)

    const code = codeOfChunk(chunk)
    // Write-back marker: exactly one `router.replace(` should land.
    expect((code.match(/router\.replace\(/g) || []).length).toBe(1)
    // Read-back marker: exactly one `setSelectedCategory(` should land.
    expect((code.match(/setSelectedCategory\(/g) || []).length).toBe(1)
    // And there should be exactly two `useEffect(` calls (write-back +
    // read-back) — re-running the plugin must not silently double either.
    expect((code.match(/useEffect\(/g) || []).length).toBe(2)
  })

  it('handles URL keys that are not valid JS identifiers via bracket notation', async () => {
    // GUI sometimes ships URL keys with hyphens or dots (e.g. `category-filter`,
    // `q.cat`). Emitting `__nextQuery.category-filter` would parse as
    // subtraction; the plugin must use bracket notation for these.
    const chunk = makeJsxComponentChunk()
    const structure: ComponentStructure = {
      uidl: {
        name: 'Products',
        node: { type: 'element', content: { elementType: 'container' } },
        stateDefinitions: {
          selectedCategory: {
            type: 'string',
            defaultValue: '',
            urlSearchParamBinding: { key: 'category-filter' },
          },
        },
      } as never,
      options: {},
      chunks: [chunk],
      dependencies: {},
    }
    await plugin(structure)

    const code = codeOfChunk(chunk)
    expect(code).toContain('__nextQuery["category-filter"]')
    expect(code).toContain('delete __nextQuery["category-filter"]')
    // And critically the bad form must NOT appear.
    expect(code).not.toContain('__nextQuery.category-filter')
  })

  it('dedupes state defs that bind to the same URL param key', async () => {
    // Two states binding the same URL key would race: each write-back would
    // overwrite the other's value on every render. The collector picks the
    // first binding and silently drops subsequent ones for the same key.
    const chunk = makeJsxComponentChunk()
    const structure: ComponentStructure = {
      uidl: {
        name: 'Products',
        node: { type: 'element', content: { elementType: 'container' } },
        stateDefinitions: {
          selectedCategory: {
            type: 'string',
            defaultValue: '',
            urlSearchParamBinding: { key: 'categoryFilter' },
          },
          legacyCategoryAlias: {
            type: 'string',
            defaultValue: '',
            urlSearchParamBinding: { key: 'categoryFilter' },
          },
        },
      } as never,
      options: {},
      chunks: [chunk],
      dependencies: {},
    }
    await plugin(structure)

    const code = codeOfChunk(chunk)
    // Exactly one write-back, exactly one read-back — for the FIRST state
    // that claimed the key (selectedCategory).
    expect((code.match(/router\.replace\(/g) || []).length).toBe(1)
    expect((code.match(/setSelectedCategory\(/g) || []).length).toBe(1)
    expect(code).not.toContain('setLegacyCategoryAlias(')
  })

  it('URL→state read-back uses functional setState to avoid loops with write-back', async () => {
    const chunk = makeJsxComponentChunk()
    const structure: ComponentStructure = {
      uidl: {
        name: 'Products',
        node: { type: 'element', content: { elementType: 'container' } },
        stateDefinitions: {
          selectedCategory: {
            type: 'string',
            defaultValue: '',
            urlSearchParamBinding: { key: 'categoryFilter' },
          },
        },
      } as never,
      options: {},
      chunks: [chunk],
      dependencies: {},
    }
    await plugin(structure)

    const code = codeOfChunk(chunk)
    // Functional setter: setSelectedCategory(prev => prev === __nextValue ? prev : __nextValue)
    // Returning `prev` when equal triggers React's bail-out and breaks the
    // loop with the write-back effect.
    expect(code).toMatch(/setSelectedCategory\(prev => prev === __nextValue/)
    // Array→string normalization (router.query[key] can be string | string[])
    expect(code).toContain('Array.isArray(__urlValue)')
  })

  it('drops the URL param when the bound state value goes empty (the "All categories" case)', async () => {
    const chunk = makeJsxComponentChunk()
    const structure: ComponentStructure = {
      uidl: {
        name: 'Products',
        node: { type: 'element', content: { elementType: 'container' } },
        stateDefinitions: {
          selectedCategory: {
            type: 'string',
            defaultValue: '',
            urlSearchParamBinding: { key: 'categoryFilter' },
          },
        },
      } as never,
      options: {},
      chunks: [chunk],
      dependencies: {},
    }
    await plugin(structure)

    const code = codeOfChunk(chunk)
    // The emitted code must DELETE the key on empty value, not write
    // `?categoryFilter=` — that would leave a sticky empty filter in the URL.
    expect(code).toContain('delete __nextQuery.categoryFilter')
  })

  it('activates for page-level searchParams (dynamic references via router.query)', async () => {
    const chunk = makeJsxComponentChunk()
    const structure: ComponentStructure = {
      uidl: {
        name: 'Products',
        node: { type: 'element', content: { elementType: 'container' } },
        searchParams: [{ key: 'category' }],
      } as never,
      options: {},
      chunks: [chunk],
      dependencies: {},
    }
    await plugin(structure)

    expect(structure.dependencies.useRouter).toBeDefined()
    expect(structure.dependencies.useRouter.path).toBe('next/router')
    expect(structure.dependencies.useRouter.meta?.namedImport).toBe(true)
    expect(codeOfChunk(chunk)).toContain('const router = useRouter()')
  })

  it('is idempotent — does not emit a second `const router = useRouter()` if one already exists (internationalization plugin may have added it first)', async () => {
    const chunk = makeJsxComponentChunk()
    // Simulate the internationalization plugin having already injected the
    // declaration — our plugin must not duplicate it.
    const arrow = (chunk.content as types.VariableDeclaration).declarations[0]
      .init as types.ArrowFunctionExpression
    const body = arrow.body as types.BlockStatement
    body.body.unshift(
      types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('router'),
          types.callExpression(types.identifier('useRouter'), [])
        ),
      ])
    )

    const structure: ComponentStructure = {
      uidl: {
        name: 'Page',
        node: { type: 'element', content: { elementType: 'container' } },
        searchParams: [{ key: 'q' }],
      } as never,
      options: {},
      chunks: [chunk],
      dependencies: {},
    }
    await plugin(structure)

    const code = codeOfChunk(chunk)
    const occurrences = (code.match(/const router = useRouter\(\)/g) || []).length
    expect(occurrences).toBe(1)
  })

  it('treats an empty searchParams array as absent (no useRouter)', async () => {
    const chunk = makeJsxComponentChunk()
    const structure: ComponentStructure = {
      uidl: {
        name: 'Empty',
        node: { type: 'element', content: { elementType: 'container' } },
        searchParams: [],
      } as never,
      options: {},
      chunks: [chunk],
      dependencies: {},
    }
    await plugin(structure)
    expect(structure.dependencies.useRouter).toBeUndefined()
    expect(codeOfChunk(chunk)).not.toContain('useRouter')
  })
})
