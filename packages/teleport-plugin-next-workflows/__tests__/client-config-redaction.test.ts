// SECURITY regression guard: a generated app must never ship a server node's
// raw SQL (or any other server-only config) inside the CLIENT page bundle.
//
// Data nodes (data-select / data-raw-query / data-count / data-create-item /
// …) and AI nodes run in their own server API route. Before this guard the
// workflow component plugin serialized the FULL workflow — every segment's
// nodes AND the top-level node list — with each node's `config` verbatim into
// the module-level `__wfConfig_*` constant that ships to the browser, leaking
// the SQL text (confirmed live: a published page chunk contained
// `SELECT * FROM vehicles WHERE ... license_plate ILIKE ...`).
//
// The plugin now redacts every server node's config down to a client-safe
// whitelist (only the AI-streaming flag). This test proves the raw SQL is
// ABSENT from the emitted client module while the server API route still
// carries it, and that the metadata the client executor DOES need
// (streaming flag + id/type/stepNumber/edges for branch-skip bookkeeping) and
// client node config are preserved.

import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'
import { splitIntoSegments } from '../src/segment-splitter'
import {
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
  hasStreamingAINode,
} from '../src/api-route-generator'

const RAW_SQL = "SELECT * FROM vehicles WHERE ($1 = '' OR license_plate ILIKE '%' || $1 || '%')"
const DATA_SOURCE_ID = 'vehicles-datasource-id'
const AI_PROMPT = 'Summarize this SENSITIVE_SERVER_PROMPT'
const AI_MODEL = 'gpt-4o-secret-model'
const CLIENT_MARKER = 'CLIENT_VISIBLE_VALUE'

const AISQL_ALLOWED_TABLE = 'secret_allowed_table'
const AISQL_SCHEMA_COLUMN = 'sensitive_schema_column'
const AISQL_PROMPT = 'SENSITIVE_AISQL_PROMPT'

const TRIGGER_ID = 'trigger-1'
const DATA_ID = 'data-1'
const AI_ID = 'ai-1'
const AISQL_ID = 'aisql-1'
const CLIENT_ID = 'client-1'

const buildWorkflow = (): any => ({
  id: 'wf-1',
  name: 'Vehicles Page Load',
  trigger: {
    type: 'event-page-loaded',
    nodeId: TRIGGER_ID,
    scope: 'page',
    config: { pageId: 'page-1' },
  },
  nodes: [
    {
      id: DATA_ID,
      type: 'data-raw-query',
      config: {
        dataSourceId: DATA_SOURCE_ID,
        query: RAW_SQL,
        params: ['secret-plate'],
      },
      executionEnv: 'server',
      stepNumber: 1,
      label: 'Fetch vehicles',
    },
    {
      id: AI_ID,
      type: 'ai-custom-prompt',
      config: {
        prompt: AI_PROMPT,
        model: AI_MODEL,
        streaming: true,
      },
      executionEnv: 'server',
      stepNumber: 2,
      label: 'Summarize',
    },
    {
      id: AISQL_ID,
      type: 'ai-select-database-data',
      config: {
        dataSourceId: DATA_SOURCE_ID,
        allowedTables: [AISQL_ALLOWED_TABLE],
        prompt: AISQL_PROMPT,
        model: AI_MODEL,
        token: 'sk-secret',
        tableSchemas: [
          {
            table: AISQL_ALLOWED_TABLE,
            columns: [{ name: AISQL_SCHEMA_COLUMN, type: 'text' }],
          },
        ],
      },
      executionEnv: 'server',
      stepNumber: 3,
      label: 'AI query',
    },
    {
      id: CLIENT_ID,
      type: 'state-update-local-state',
      config: { property: 'summary', value: CLIENT_MARKER },
      executionEnv: 'client',
      stepNumber: 4,
      label: 'Write summary',
    },
  ],
  edges: [
    { id: 'e1', source: TRIGGER_ID, target: DATA_ID },
    { id: 'e2', source: DATA_ID, target: AI_ID },
    { id: 'e3', source: AI_ID, target: AISQL_ID },
    { id: 'e4', source: AISQL_ID, target: CLIENT_ID },
  ],
})

const buildStructure = (): any => ({
  uidl: {
    name: 'Page',
    outputOptions: { pageId: 'page-1', fileName: 'page-1' },
    node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
    stateDefinitions: {
      summary: { type: 'string', defaultValue: '' },
    },
  },
  chunks: [
    {
      type: 'chunk-type-ast',
      name: 'jsx-component',
      content: {
        type: 'VariableDeclaration',
        declarations: [
          {
            type: 'VariableDeclarator',
            init: {
              type: 'ArrowFunctionExpression',
              body: {
                type: 'BlockStatement',
                body: [{ type: 'ReturnStatement', argument: null }],
              },
            },
          },
        ],
      },
    },
  ],
  options: {
    workflows: { workflows: { 'wf-1': buildWorkflow() }, customNodes: {} },
  },
  dependencies: {},
})

const getModuleCode = async (): Promise<string> => {
  const plugin = createNextWorkflowPlugin({ isPage: true })
  const structure = buildStructure()
  await plugin(structure as any)
  const moduleChunk = (structure.chunks as any[]).find((c: any) => c.name === 'workflow-module')
  if (!moduleChunk) {
    throw new Error('workflow-module chunk not emitted by plugin')
  }
  return String(moduleChunk.content)
}

describe('client bundle redacts server node config', () => {
  let moduleCode: string

  beforeAll(async () => {
    moduleCode = await getModuleCode()
  })

  it('does NOT leak the raw SQL query into the client module', () => {
    expect(moduleCode).not.toContain(RAW_SQL)
    expect(moduleCode).not.toContain('license_plate')
    expect(moduleCode).not.toContain('SELECT * FROM vehicles')
  })

  it('drops every server-only data field from the client copy', () => {
    // Field names + values that only the server API route may see.
    expect(moduleCode).not.toContain(DATA_SOURCE_ID)
    expect(moduleCode).not.toContain('dataSourceId')
    expect(moduleCode).not.toContain('secret-plate')
    // AI server node's prompt/model are server-only too.
    expect(moduleCode).not.toContain(AI_PROMPT)
    expect(moduleCode).not.toContain(AI_MODEL)
    // ai-select-database-data bakes the table allowlist + schemas into its
    // config; none of it may reach the browser.
    expect(moduleCode).not.toContain(AISQL_ALLOWED_TABLE)
    expect(moduleCode).not.toContain(AISQL_SCHEMA_COLUMN)
    expect(moduleCode).not.toContain('tableSchemas')
    expect(moduleCode).not.toContain(AISQL_PROMPT)
  })

  it('preserves the AI streaming flag so streaming detection still works', () => {
    // findStreamingAINodes reads config.streaming off the top-level node list.
    expect(moduleCode).toContain('"streaming":true')
  })

  it('preserves server node identity/edges for branch-skip bookkeeping', () => {
    // The client executor needs { id, type, stepNumber } + edges of server
    // nodes to skip non-taken branches and sort segment results.
    expect(moduleCode).toContain('"data-raw-query"')
    expect(moduleCode).toContain('"ai-custom-prompt"')
    expect(moduleCode).toContain(DATA_ID)
    expect(moduleCode).toContain(AI_ID)
    expect(moduleCode).toContain('"stepNumber"')
  })

  it('keeps client node config intact (only server nodes are redacted)', () => {
    expect(moduleCode).toContain(CLIENT_MARKER)
  })
})

describe('server API route still carries the SQL', () => {
  it('embeds the raw SQL + data source in the generated server route', () => {
    const segments = splitIntoSegments(buildWorkflow())
    const serverSegment = segments.find((s) => s.env === 'server')
    expect(serverSegment).toBeDefined()

    const route = hasStreamingAINode(serverSegment!)
      ? generateStreamingServerSegmentAPIRoute(serverSegment!, 'Vehicles Page Load')
      : generateServerSegmentAPIRoute(serverSegment!, 'Vehicles Page Load')

    // The server copy is legitimate and must remain.
    expect(route).toContain(RAW_SQL)
    expect(route).toContain(DATA_SOURCE_ID)
  })
})
