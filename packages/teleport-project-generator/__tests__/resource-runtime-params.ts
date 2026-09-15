import { UIDLResourceItem } from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import generate from '@babel/generator'

import { resourceGenerator } from '../src/resource'

/**
 * A data source resource is generated as a direct `fetchData` call, and the
 * params it declares serve two different purposes: `dataSourceId`,
 * `dataSourceType` and `tableName` pick the utility module at generation time,
 * while anything else is a value the handler reads out of `req.query`.
 *
 * Forwarding only the caller's arguments dropped the second kind. For a details
 * page over a REST endpoint that wraps its list, that meant the handler never
 * learned where the records were: `getStaticPaths` produced no paths and every
 * `/page/<slug>` answered 404, with nothing in the output to point at why.
 */

const staticParam = (content: string) => ({ type: 'static' as const, content })

const dataSourceResource = (params: Record<string, unknown> = {}): UIDLResourceItem =>
  ({
    id: 'TQ_resource',
    name: 'fetch_data_detail',
    path: {
      baseUrl: staticParam('/api/data-source'),
      route: staticParam('/92c59975/data'),
    },
    params: {
      dataSourceId: staticParam('92c59975-43bc-47aa-99fd-114912138d5b'),
      dataSourceType: staticParam('rest-api'),
      tableName: staticParam('data'),
      ...params,
    },
  } as unknown as UIDLResourceItem)

const generatedCode = (resource: UIDLResourceItem): string => {
  const { chunks } = resourceGenerator(resource, {})
  return chunks
    .map((chunk) => generate(chunk.content as types.Node).code)
    .join('\n')
    .replace(/\s+/g, ' ')
}

describe('data source resource params', () => {
  it('forwards a runtime param the handler needs, so a wrapped list is unwrapped', () => {
    const code = generatedCode(
      dataSourceResource({ collectionPath: staticParam('["categories"]') })
    )

    expect(code).toContain('collectionPath: "[\\"categories\\"]"')
    expect(code).toContain('...params')
  })

  it("lets the caller's own argument win over the baked-in default", () => {
    const code = generatedCode(
      dataSourceResource({ collectionPath: staticParam('["categories"]') })
    )

    // The spread has to come LAST, or a resource default would silently
    // override what the page passed at the call site.
    expect(code.indexOf('...params')).toBeGreaterThan(code.indexOf('collectionPath'))
  })

  it('never forwards the params that already picked the module', () => {
    const code = generatedCode(
      dataSourceResource({ collectionPath: staticParam('["categories"]') })
    )

    expect(code).not.toContain('dataSourceId:')
    expect(code).not.toContain('dataSourceType:')
    expect(code).not.toContain('tableName:')
  })

  it('passes params through untouched when there is no runtime param', () => {
    // Every table-backed resource takes this path, and its generated code has
    // to stay exactly what it was.
    expect(generatedCode(dataSourceResource())).toContain('fetchData(params)')
  })

  it('skips a dynamic param, which has no value at generation time', () => {
    const code = generatedCode(
      dataSourceResource({
        collectionPath: { type: 'dynamic', content: { referenceType: 'prop', id: 'path' } },
      })
    )

    expect(code).toContain('fetchData(params)')
  })
})

describe('structured resource params', () => {
  it('JSON-encodes a param that is not a primitive rather than dropping it', () => {
    // `req.query` carries everything structured as JSON already (`filters`,
    // `sorts`, `collectionPath`), and the handlers parse it back. Skipping it
    // would reintroduce the silent drop this whole path exists to prevent.
    const code = generatedCode(
      dataSourceResource({
        collectionPath: { type: 'static', content: ['response', 'items'] },
      } as never)
    )

    expect(code).toContain('collectionPath: "[\\"response\\",\\"items\\"]"')
  })

  it('skips a param with no value at all', () => {
    const code = generatedCode(
      dataSourceResource({ collectionPath: { type: 'static', content: null } } as never)
    )

    expect(code).toContain('fetchData(params)')
  })
})
