import { InMemoryFileRecord, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { NextPageRevalidatePlugin } from '../src/page-revalidate/project-plugin'

const buildStructure = (options: {
  // tslint:disable-next-line:no-any
  workflowNodes?: any[]
  // tslint:disable-next-line:no-any
  customNodeNodes?: any[]
}): ProjectPluginStructure =>
  ({
    uidl: {
      name: 'Store',
      globals: { settings: {}, meta: [], assets: [], env: {} },
      root: { name: 'App', node: { type: 'element', content: { elementType: 'container' } } },
      components: {},
      dataSources: {},
      workflows: {
        ...(options.workflowNodes
          ? { workflows: { w1: { id: 'w1', name: 'W', nodes: options.workflowNodes, edges: [] } } }
          : {}),
        ...(options.customNodeNodes
          ? {
              customNodes: {
                c1: { id: 'c1', name: 'C', nodes: options.customNodeNodes, edges: [] },
              },
            }
          : {}),
      },
      // tslint:disable-next-line:no-any
    } as any,
    files: new Map<string, InMemoryFileRecord>(),
    // tslint:disable-next-line:no-any
  } as any)

const run = async (structure: ProjectPluginStructure) => {
  await new NextPageRevalidatePlugin().runAfter(structure)
  return structure
}

const routeOf = (structure: ProjectPluginStructure) =>
  structure.files.get('tq-revalidate-api-route')?.files[0]?.content || ''

describe('NextPageRevalidatePlugin', () => {
  /** A project whose workflows never refresh a page must not grow an endpoint. */
  it('emits nothing when no workflow revalidates a page', async () => {
    const structure = await run(buildStructure({ workflowNodes: [{ type: 'data-create-item' }] }))

    expect(structure.files.size).toBe(0)
    expect(structure.uidl.globals.env).toEqual({})
  })

  it('emits pages/api/tq-revalidate for a workflow that uses the node', async () => {
    const structure = await run(buildStructure({ workflowNodes: [{ type: 'page-revalidate' }] }))

    expect(structure.files.get('tq-revalidate-api-route')?.path).toEqual(['pages', 'api'])
    expect(structure.files.get('tq-revalidate-api-route')?.files[0]?.name).toBe('tq-revalidate')
  })

  /**
   * A node buried in a custom node needs the route just as much, and a missing
   * route surfaces only as the node's warning — never as a build failure — so
   * nothing would say out loud that the site had stopped refreshing.
   */
  it('finds the node inside a custom node', async () => {
    const structure = await run(buildStructure({ customNodeNodes: [{ type: 'page-revalidate' }] }))

    expect(structure.files.has('tq-revalidate-api-route')).toBe(true)
  })

  it('registers the secret as a project secret placeholder', async () => {
    const structure = await run(buildStructure({ workflowNodes: [{ type: 'page-revalidate' }] }))

    expect(structure.uidl.globals.env?.TQ_CACHE_SECRET).toBe('teleporthq.secrets.TQ_CACHE_SECRET')
  })

  /**
   * "No secret configured" must never be read as "no authentication required" —
   * that would leave a public page-rebuilding endpoint on every published site.
   */
  it('makes the route fail closed without a secret', async () => {
    const route = routeOf(
      await run(buildStructure({ workflowNodes: [{ type: 'page-revalidate' }] }))
    )

    expect(route).toContain("if (!secret || typeof provided !== 'string')")
    expect(route).toContain('return false')
    expect(route).toContain('res.status(401)')
    expect(route).toContain('timingSafeEqual')
    expect(route).toContain('res.status(405)')
  })

  /**
   * `res.revalidate` THROWS for a path that was never statically generated —
   * the normal case for a page whose row was just deleted. One such path must
   * not cost the caller the rebuilds it asked for alongside it, so each path is
   * rebuilt inside its own try/catch and failures are reported, never raised.
   */
  it('rebuilds every path inside its own try/catch and reports the failures', async () => {
    const route = routeOf(
      await run(buildStructure({ workflowNodes: [{ type: 'page-revalidate' }] }))
    )

    expect(route).toMatch(/for \(const path of paths\) \{\s*try \{\s*await res\.revalidate\(path\)/)
    expect(route).toContain('failed.push(path)')
    expect(route).toContain('res.status(200).json({ ok: true, revalidated, failed })')
  })

  /**
   * Each path re-runs `getStaticProps`, so an unbounded list is an unbounded
   * serverless invocation driven by whatever the workflow config held.
   */
  it('caps how many paths one request may rebuild', async () => {
    const route = routeOf(
      await run(buildStructure({ workflowNodes: [{ type: 'page-revalidate' }] }))
    )

    expect(route).toContain('const MAX_PATHS = 20')
    expect(route).toContain('.slice(0, MAX_PATHS)')
  })
})
