import { assertWorkflowsAreSecure, CodegenSecurityError } from '../src/security-scanner'
import { collectWorkflowPublishRefusals } from '../src/publish-refusals'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'

/**
 * A custom node's custom JS runs on the server as a workflow's does: in the
 * custom node's own server segment routes, and in process inside a cron,
 * webhook or automation route that calls it (they require
 * `utils/workflows/custom-nodes.js`). The generator's custom-code gate reads
 * it too, so a custom node cannot carry what a workflow step may not.
 */

const customNodeWith = (code: string, name = 'Email me') => ({
  'cn-1': {
    id: 'cn-1',
    name,
    parameters: [{ key: 'message' }],
    nodes: [
      { id: 'c-js', type: 'general-custom-js', config: { code, context: 'server' }, stepNumber: 1 },
    ],
    edges: [] as unknown[],
  },
})

const LEAKS: Array<[string, string]> = [
  [
    'reads TELEPORT_DB_CONNECTION_STRING',
    'function customHandler(previousContext, params) { return { v: process.env.TELEPORT_DB_CONNECTION_STRING }; }',
  ],
  [
    'reads NEXTAUTH_SECRET',
    'function customHandler(previousContext, params) { return { v: process.env.NEXTAUTH_SECRET }; }',
  ],
  [
    'reaches the real process through .constructor',
    "function customHandler(previousContext, params) { return (function(){}).constructor('return process')().env; }",
  ],
]

// Custom nodes the editor's builders write, verbatim: the shared Record Event
// writer's "is it new" step (features/shared/builders/record-event-node.ts) and
// the anonymous-visitor key of the resolve-user node
// (templates/builders/shared/resolve-user-custom-node-builder.ts).
const BUILDER_SCRIPTS = [
  [
    'function customHandler(previousContext, params) {',
    '  var selectResult = (params && params[1]) || {};',
    '  var rows = selectResult && selectResult.rows',
    '    ? selectResult.rows',
    '    : (Array.isArray(selectResult) ? selectResult : []);',
    '  return { isNew: rows.length === 0 };',
    '}',
  ].join('\n'),
  [
    'function customHandler(previousContext, params) {',
    '  var host = "";',
    '  try {',
    '    host = (typeof window !== "undefined" && window.location && window.location.host) || "";',
    '  } catch (e) { host = ""; }',
    '  return { key: "teleportAnonymousUser:" + (host || "default") };',
    '}',
  ].join('\n'),
]

const generate = (customNodes: Record<string, unknown>) => {
  const structure = {
    uidl: {
      name: 'Store',
      globals: { settings: { title: 'Store', language: 'en' }, env: {} },
      root: {
        name: 'Root',
        stateDefinitions: {
          route: { type: 'string', defaultValue: 'Home', values: [{ value: 'Home' }] },
        },
        node: { type: 'element', content: { elementType: 'container', children: [] as unknown[] } },
      },
      components: {},
      workflows: { workflows: {}, customNodes: JSON.parse(JSON.stringify(customNodes)) },
    },
    strategy: { pages: { options: {} } },
    files: new Map(),
    dependencies: {},
    devDependencies: {},
  }
  return new NextWorkflowProjectPlugin().runBefore(structure as never)
}

describe('the codegen custom-code gate reads custom nodes', () => {
  it.each(LEAKS)(
    'refuses a custom node whose custom JS %s, naming the custom node',
    (_leak, code) => {
      let error: unknown
      try {
        assertWorkflowsAreSecure({ workflows: {}, customNodes: customNodeWith(code) })
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(CodegenSecurityError)
      expect((error as CodegenSecurityError).violations[0]).toMatchObject({
        workflowId: 'cn-1',
        workflowName: 'Email me',
        nodeId: 'c-js',
      })
    }
  )

  it.each(LEAKS)('refuses generation of a project whose custom node %s', async (_leak, code) => {
    await expect(generate(customNodeWith(code))).rejects.toBeInstanceOf(CodegenSecurityError)
  })

  it('reports the refusal against the custom node to the editor', () => {
    const refusals = collectWorkflowPublishRefusals({
      workflows: {},
      customNodes: customNodeWith(LEAKS[0][1]),
    } as never)
    expect(refusals).toContainEqual(
      expect.objectContaining({
        kind: 'refused',
        check: 'custom-code',
        ownerId: 'cn-1',
        ownerKind: 'custom-node',
        nodeId: 'c-js',
      })
    )
  })

  it.each(BUILDER_SCRIPTS.map((code) => [code]))(
    'publishes a builder custom node: %s',
    async (code) => {
      expect(() =>
        assertWorkflowsAreSecure({ workflows: {}, customNodes: customNodeWith(code) })
      ).not.toThrow()
      await expect(generate(customNodeWith(code))).resolves.toBeDefined()
    }
  )
})
