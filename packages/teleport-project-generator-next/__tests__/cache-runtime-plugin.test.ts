import { InMemoryFileRecord, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { NextCacheRuntimePlugin } from '../src/cache/project-plugin'

const cachedRepeater = {
  type: 'cms-list-repeater',
  content: {
    renderPropIdentifier: 'product',
    cache: { enabled: true, ttlSeconds: 60, client: true, server: true },
    nodes: { list: { type: 'element', content: { elementType: 'div' } } },
  },
}

const uncachedRepeater = {
  type: 'cms-list-repeater',
  content: {
    renderPropIdentifier: 'product',
    nodes: { list: { type: 'element', content: { elementType: 'div' } } },
  },
}

const buildStructure = (options: {
  // tslint:disable-next-line:no-any
  repeater?: any
  dataSourceType?: string
  // tslint:disable-next-line:no-any
  workflowNodes?: any[]
}): ProjectPluginStructure => {
  const dataSources = options.dataSourceType
    ? { ds1: { id: 'ds1', name: 'Store', type: options.dataSourceType, config: {} } }
    : {}

  return {
    uidl: {
      name: 'Store',
      globals: { settings: {}, meta: [], assets: [], env: {} },
      root: {
        name: 'App',
        node: {
          type: 'element',
          content: {
            elementType: 'container',
            children: options.repeater ? [options.repeater] : [],
          },
        },
      },
      components: {},
      dataSources,
      ...(options.workflowNodes
        ? {
            workflows: {
              workflows: {
                w1: { id: 'w1', name: 'W', nodes: options.workflowNodes, edges: [] },
              },
            },
          }
        : {}),
      // tslint:disable-next-line:no-any
    } as any,
    files: new Map<string, InMemoryFileRecord>(),
    // tslint:disable-next-line:no-any
  } as any
}

const run = async (structure: ProjectPluginStructure) => {
  await new NextCacheRuntimePlugin().runAfter(structure)
  return structure
}

const contentOf = (structure: ProjectPluginStructure, key: string, name: string) =>
  structure.files.get(key)?.files.find((file) => file.name === name)?.content || ''

describe('NextCacheRuntimePlugin', () => {
  /** A project that never asked for caching must not grow five new files. */
  it('emits nothing when nothing caches', async () => {
    const structure = await run(buildStructure({ repeater: uncachedRepeater }))

    expect(structure.files.size).toBe(0)
    expect(structure.uidl.globals.env).toEqual({})
  })

  it('emits the runtime and both routes for a cached array mapper', async () => {
    const structure = await run(
      buildStructure({ repeater: cachedRepeater, dataSourceType: 'teleport' })
    )

    expect(structure.files.get('tq-cache-client')?.path).toEqual(['utils', 'tq-cache'])
    expect(structure.files.get('tq-cache-server')?.path).toEqual(['utils', 'tq-cache'])
    expect(structure.files.get('tq-cache-version-store')?.path).toEqual(['utils', 'tq-cache'])
    expect(structure.files.get('tq-cache-api-routes')?.path).toEqual(['pages', 'api', 'tq-cache'])
  })

  it('emits the runtime for a workflow that uses a cache node', async () => {
    const structure = await run(
      buildStructure({ repeater: uncachedRepeater, workflowNodes: [{ type: 'cache-invalidate' }] })
    )

    expect(structure.files.has('tq-cache-client')).toBe(true)
  })

  it('backs the version store with Postgres when the project has one', async () => {
    const structure = await run(
      buildStructure({ repeater: cachedRepeater, dataSourceType: 'teleport' })
    )
    const store = contentOf(structure, 'tq-cache-version-store', 'version-store')

    expect(store).toContain('teleport_cache_versions')
    expect(store).toContain("require('pg')")
    expect(store).toContain('ON CONFLICT (scope) DO UPDATE')
  })

  /**
   * Always emitted, never omitted: Next resolves `require` at build time, so a
   * conditionally-absent module is a build failure rather than a graceful
   * fallback to TTL-only caching.
   */
  it('emits a no-op version store when there is no database to bump', async () => {
    const structure = await run(
      buildStructure({ repeater: cachedRepeater, dataSourceType: 'rest-api' })
    )
    const store = contentOf(structure, 'tq-cache-version-store', 'version-store')

    expect(store).toContain('isEnabled')
    expect(store).toContain('return false')
    expect(store).not.toContain("require('pg')")
  })

  it('registers the invalidate secret as a project secret placeholder', async () => {
    const structure = await run(
      buildStructure({ repeater: cachedRepeater, dataSourceType: 'teleport' })
    )

    expect(structure.uidl.globals.env?.TQ_CACHE_SECRET).toBe('teleporthq.secrets.TQ_CACHE_SECRET')
  })

  /**
   * "No secret configured" must never be read as "no authentication required" —
   * that would leave a public cache-busting endpoint on every published site.
   */
  it('makes the invalidate route fail closed without a secret', async () => {
    const structure = await run(
      buildStructure({ repeater: cachedRepeater, dataSourceType: 'teleport' })
    )
    const route = contentOf(structure, 'tq-cache-api-routes', 'invalidate')

    expect(route).toContain("if (!secret || typeof provided !== 'string')")
    expect(route).toContain('return false')
    expect(route).toContain('res.status(401)')
    expect(route).toContain('timingSafeEqual')
  })
})

/**
 * Pages are not a top-level field — they are conditional route nodes nested
 * inside `uidl.root.node`, which is where a cached products list actually
 * lives. A detector that only looked at `uidl.components` would emit no runtime
 * at all for the exact case this feature exists for.
 */
describe('NextCacheRuntimePlugin — page detection', () => {
  it('finds a cached mapper nested inside a route conditional', async () => {
    const structure = buildStructure({ dataSourceType: 'teleport' })
    // tslint:disable-next-line:no-any
    ;(structure.uidl.root as any).node = {
      type: 'element',
      content: {
        elementType: 'container',
        children: [
          {
            type: 'conditional',
            content: {
              value: 'products-list',
              node: {
                type: 'element',
                content: {
                  elementType: 'container',
                  children: [
                    {
                      type: 'data-source-list',
                      content: { nodes: { success: cachedRepeater } },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    }

    await run(structure)

    expect(structure.files.has('tq-cache-client')).toBe(true)
    expect(structure.files.has('tq-cache-server')).toBe(true)
  })
})
