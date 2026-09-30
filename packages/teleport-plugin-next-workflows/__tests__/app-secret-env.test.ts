import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'

// Server code tells itself apart from a browser with the app secret: it keys
// the signatures on results relayed between workflow steps and the
// internal-call token, and server code presents it to its own data, invoice
// and notification routes. An app with such routes but no authentication
// used to ship without one — every one of those keyed from ''.

const structure = (uidl: unknown): any => ({
  uidl,
  strategy: { pages: { options: {} } },
  files: new Map(),
  dependencies: {},
  devDependencies: {},
})

const app = (extra: Record<string, unknown> = {}): any => ({
  name: 'Site',
  globals: { settings: { title: 'Site' } },
  root: { name: 'Root', stateDefinitions: {}, node: { type: 'element', content: {} } },
  ...extra,
})

const secretOf = async (uidl: any): Promise<unknown> => {
  await new NextWorkflowProjectPlugin().runBefore(structure(uidl))
  return uidl.globals.env?.NEXTAUTH_SECRET
}

describe('the app secret of a generated app', () => {
  it('is written for an app with server routes and no authentication', async () => {
    for (const extra of [
      { workflows: { workflows: { w1: { nodes: [], edges: [] } }, customNodes: {} } },
      { dataSources: { ds1: { type: 'postgresql' } } },
      { invoiceSettings: { enabled: true } },
      { ecommerceSettings: { currency: 'USD' } },
    ]) {
      expect(await secretOf(app(extra))).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('is a fresh value each time, never a constant', async () => {
    const extra = { dataSources: { ds1: { type: 'postgresql' } } }
    expect(await secretOf(app(extra))).not.toBe(await secretOf(app(extra)))
  })

  it('keeps a secret the project already has', async () => {
    const uidl = app({ dataSources: { ds1: { type: 'postgresql' } } })
    uidl.globals.env = { NEXTAUTH_SECRET: 'configured-secret' }
    expect(await secretOf(uidl)).toBe('configured-secret')
  })

  it('is not written for a static site', async () => {
    expect(await secretOf(app())).toBeUndefined()
  })
})
