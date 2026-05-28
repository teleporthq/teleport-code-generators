import generator from '@babel/generator'
import { createDynamicValueExpression } from '../../../src/node-handlers/node-to-jsx/utils'
import type { JSXGenerationOptions } from '../../../src/node-handlers/node-to-jsx/types'
import type { UIDLDynamicReference } from '@teleporthq/teleport-types'

const gen = (ast: unknown): string => generator(ast as never).code

const buildOptions = (
  prefixMap: Record<string, string> = { urlSearchParams: 'router.query' },
  registry?: Record<string, { defaultValue?: string }>
): JSXGenerationOptions => {
  return {
    dynamicReferencePrefixMap: prefixMap,
    dependencyHandling: 'import',
    stateHandling: 'mutation',
    slotHandling: 'native',
    ...(registry ? { urlSearchParamsRegistry: registry } : {}),
  } as unknown as JSXGenerationOptions
}

const buildRef = (key: string): UIDLDynamicReference => ({
  type: 'dynamic',
  content: {
    referenceType: 'urlSearchParams',
    id: key,
    refPath: [key],
  },
})

describe('createDynamicValueExpression — urlSearchParams', () => {
  it('emits router.query.<key> for Next.js generators', () => {
    const ast = createDynamicValueExpression(buildRef('category'), buildOptions())
    expect(gen(ast)).toBe('router.query?.category')
  })

  it('appends a nullish-coalescing default from the registry', () => {
    const ast = createDynamicValueExpression(
      buildRef('category'),
      buildOptions({ urlSearchParams: 'router.query' }, { category: { defaultValue: 'food' } })
    )
    expect(gen(ast)).toBe('router.query?.category ?? "food"')
  })

  it('honors a custom prefix for static generators', () => {
    const ast = createDynamicValueExpression(
      buildRef('category'),
      buildOptions({ urlSearchParams: '__urlSearchParams' })
    )
    expect(gen(ast)).toBe('__urlSearchParams?.category')
  })

  it('uses refPath[0] when no registry default is set and key has no fallback', () => {
    const ast = createDynamicValueExpression(
      buildRef('minPrice'),
      buildOptions({ urlSearchParams: 'router.query' })
    )
    expect(gen(ast)).toBe('router.query?.minPrice')
  })
})
