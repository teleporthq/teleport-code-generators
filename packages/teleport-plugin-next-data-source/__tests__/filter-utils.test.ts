import * as types from '@babel/types'
import generator from '@babel/generator'
import { appendFiltersParam, buildFiltersStringifyCall } from '../src/filter-utils'

// Mimics `buildFilterDestinationExpression` from pagination-plugin for the
// shapes that matter here — static literal, state ref, and url-search-params
// ref — without taking a hard dep on the bigger plugin.
const fakeDestinationBuilder = (destination: unknown): types.Expression => {
  if (typeof destination === 'string') {
    return types.stringLiteral(destination)
  }
  if (
    destination &&
    typeof destination === 'object' &&
    'content' in (destination as Record<string, unknown>)
  ) {
    const content = (destination as { content: { referenceType: string; id: string } }).content
    if (content.referenceType === 'state') {
      return types.identifier(content.id)
    }
    if (content.referenceType === 'urlSearchParams') {
      return types.optionalMemberExpression(
        types.optionalMemberExpression(
          types.identifier('router'),
          types.identifier('query'),
          false,
          true
        ),
        types.identifier(content.id),
        false,
        true
      )
    }
  }
  return types.identifier('undefined')
}

const codeOf = (expr: types.Expression): string => generator(expr).code

describe('filter-utils', () => {
  describe('buildFiltersStringifyCall', () => {
    it('wraps the array in `.filter(...)` so empty destinations get dropped at runtime', () => {
      const call = buildFiltersStringifyCall(
        [
          {
            source: 'category',
            operand: '=',
            destination: {
              type: 'dynamic',
              content: { referenceType: 'state', id: 'selectedCategory' },
            },
          },
        ],
        fakeDestinationBuilder
      )

      const code = codeOf(call)
      // The .filter predicate must reject all three empty-shapes — empty
      // string, null, and undefined — because state defaults can land as any
      // of those depending on the GUI shape.
      expect(code).toContain('.filter(')
      expect(code).toContain('__f.destination !== ""')
      expect(code).toContain('__f.destination !== null')
      expect(code).toContain('__f.destination !== undefined')
      // The wrapper is JSON.stringify so the backend still receives a string.
      expect(code).toMatch(/^JSON\.stringify\(/)
    })

    it('emits a working entry for each filter, with the destination expression inlined', () => {
      const call = buildFiltersStringifyCall(
        [
          {
            source: 'category',
            operand: '=',
            destination: {
              type: 'dynamic',
              content: { referenceType: 'state', id: 'selectedCategory' },
            },
          },
          {
            source: 'tag',
            operand: '!=',
            destination: {
              type: 'dynamic',
              content: { referenceType: 'urlSearchParams', id: 'excludeTag' },
            },
          },
        ],
        fakeDestinationBuilder
      )

      const code = codeOf(call)
      expect(code).toContain('source: "category"')
      expect(code).toContain('destination: selectedCategory')
      expect(code).toContain('operand: "="')
      expect(code).toContain('source: "tag"')
      expect(code).toContain('destination: router?.query?.excludeTag')
      expect(code).toContain('operand: "!="')
    })

    it('preserves static destination strings as literals', () => {
      const call = buildFiltersStringifyCall(
        [{ source: 'status', operand: '=', destination: 'active' }],
        fakeDestinationBuilder
      )
      expect(codeOf(call)).toContain('destination: "active"')
    })

    it('falls back to empty strings for missing source/operand without breaking the entry shape', () => {
      const call = buildFiltersStringifyCall(
        [{ destination: 'x' } as { destination: string }],
        fakeDestinationBuilder
      )
      const code = codeOf(call)
      expect(code).toContain('source: ""')
      expect(code).toContain('operand: ""')
      expect(code).toContain('destination: "x"')
    })
  })

  describe('appendFiltersParam', () => {
    it('pushes a `filters` ObjectProperty onto the array', () => {
      const paramsProps: types.ObjectProperty[] = []
      appendFiltersParam(
        paramsProps,
        [{ source: 'category', operand: '=', destination: 'rings' }],
        fakeDestinationBuilder
      )
      expect(paramsProps).toHaveLength(1)
      const prop = paramsProps[0]
      expect(prop.type).toBe('ObjectProperty')
      const key = prop.key as types.Identifier
      expect(key.name).toBe('filters')
      // The value side must be the JSON.stringify call.
      const code = codeOf(prop.value as types.Expression)
      expect(code).toMatch(/^JSON\.stringify\(/)
    })

    it('is a no-op when filters is undefined or empty', () => {
      const a: types.ObjectProperty[] = []
      appendFiltersParam(a, undefined, fakeDestinationBuilder)
      expect(a).toHaveLength(0)

      const b: types.ObjectProperty[] = []
      appendFiltersParam(b, [], fakeDestinationBuilder)
      expect(b).toHaveLength(0)
    })
  })
})
