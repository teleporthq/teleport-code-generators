import { parameterizeAllWorkflowRawSql } from '../src/raw-sql-param-binding'
import { generateSqlValidatorCode } from '../src/sql-validator'

/**
 * The AI Assistant Chat's RAG pipeline used to assemble its SQL inside
 * `general-custom-js` nodes and bind the resulting string to a `data-raw-query`.
 * Every node result in a server segment is relayed to the visitor's browser, so
 * that published the database schema: on the shipped store the browser received
 *
 *   INSERT INTO teleport_ai_chat_conversations (id, user_id, username, title,
 *   status, message_count, last_message_at, created_at, updated_at) VALUES
 *   ('ddefa366-…', '16017882-…', 'test', …)
 *
 * table names, column list, join keys and the signed-in user's uuid included.
 *
 * The statements now ship as static `query` strings with `{{ name }}` variables.
 * These fixtures are the exact shapes the chat builder emits (kept in
 * `teleport-gui/.../process-chat-message-custom-node-builder.ts`); this suite is
 * the PUBLISH-side half of the guarantee — the GUI has the same check against
 * `workflow-schema`'s copy of the net, and the two copies must agree or a chat
 * that passes in the editor fails to generate.
 */

const SEMANTIC_QUERY = [
  'SELECT d.id, d.content, d.search_content, d.keywords,',
  '       1 - (d.embedding_json::vector <=> q.query_vector) AS similarity',
  'FROM teleport_ai_chat_documents d',
  "CROSS JOIN (SELECT NULLIF({{ queryEmbedding }}::text, '')::vector AS query_vector) q",
  'WHERE d.embedding_json IS NOT NULL',
  '  AND q.query_vector IS NOT NULL',
  'ORDER BY d.embedding_json::vector <=> q.query_vector ASC',
  'LIMIT 6',
].join('\n')

const LEXICAL_QUERY = [
  'WITH search_query AS (',
  '  SELECT (',
  "    SELECT string_agg(quote_literal(lexeme), ' | ')",
  '    FROM (',
  '      SELECT lexeme',
  "      FROM unnest(tsvector_to_array(to_tsvector('english', {{ question }}::text))) AS lexeme",
  '      LIMIT 12',
  '    ) capped',
  '  )::tsquery AS tsq',
  ')',
  'SELECT ranked.id, ranked.content, ranked.rank',
  'FROM (',
  '  SELECT d.id, d.content,',
  "         ts_rank_cd(to_tsvector('english', COALESCE(d.content, '')), sq.tsq, 1) AS rank,",
  '         row_number() OVER (',
  '           PARTITION BY s.source_type',
  "           ORDER BY ts_rank_cd(to_tsvector('english', COALESCE(d.content, '')), sq.tsq, 1) DESC",
  '         ) AS rn',
  '  FROM teleport_ai_chat_documents d',
  '  JOIN teleport_ai_chat_knowledge_sources s ON s.id = d.knowledge_source_id',
  '  CROSS JOIN search_query sq',
  "  WHERE to_tsvector('english', COALESCE(d.content, '')) @@ sq.tsq",
  ') ranked',
  'WHERE ranked.rn <= 2',
  'ORDER BY ranked.rank DESC',
  'LIMIT 4',
].join('\n')

const UPSERT_QUERY = [
  'WITH conversation_input AS (',
  '  SELECT',
  "    NULLIF({{ conversationId }}::text, '')::uuid AS conversation_id,",
  "    NULLIF({{ userId }}::text, '')::uuid AS user_id,",
  '    {{ username }}::text AS username,',
  '    LEFT({{ title }}::text, 80) AS title,',
  "    NULLIF({{ timestamp }}::text, '')::timestamp AS occurred_at",
  ')',
  'INSERT INTO teleport_ai_chat_conversations',
  '  (id, user_id, username, title, status, message_count,',
  '   last_message_at, created_at, updated_at)',
  'SELECT conversation_id, user_id, username, title,',
  "       'active', 1, occurred_at, occurred_at, occurred_at",
  'FROM conversation_input',
  'WHERE conversation_id IS NOT NULL AND occurred_at IS NOT NULL',
  'ON CONFLICT (id) DO UPDATE SET',
  '  message_count = teleport_ai_chat_conversations.message_count + 1,',
  '  last_message_at = EXCLUDED.last_message_at,',
  '  updated_at = EXCLUDED.updated_at',
].join('\n')

const BUMP_QUERY = [
  'UPDATE teleport_ai_chat_conversations',
  'SET message_count = message_count + 1,',
  '    last_message_at = NOW(),',
  '    updated_at = NOW()',
  "WHERE id = NULLIF({{ conversationId }}::text, '')::uuid",
].join('\n')

const contextRef = (nodeId: string, field: string) => ({
  type: 'workflowContext',
  nodeId,
  path: [nodeId, field],
})

interface ChatQueryFixture {
  label: string
  query: string
  variables: Array<{ name: string; value: unknown }>
  expectedParams: number
}

const FIXTURES: ChatQueryFixture[] = [
  {
    label: 'Search Knowledge by Embedding Similarity',
    query: SEMANTIC_QUERY,
    variables: [{ name: 'queryEmbedding', value: contextRef('embed-1', 'vectorLiteral') }],
    expectedParams: 1,
  },
  {
    label: 'Search Knowledge by Keywords',
    query: LEXICAL_QUERY,
    variables: [{ name: 'question', value: contextRef('rephrase-1', 'response') }],
    expectedParams: 1,
  },
  {
    label: 'Upsert Conversation Row',
    query: UPSERT_QUERY,
    variables: [
      { name: 'conversationId', value: contextRef('init-1', 'conversationId') },
      { name: 'userId', value: contextRef('user-1', 'userId') },
      { name: 'username', value: contextRef('user-1', 'username') },
      { name: 'title', value: contextRef('init-1', 'userMessageText') },
      { name: 'timestamp', value: contextRef('init-1', 'timestamp') },
    ],
    expectedParams: 5,
  },
  {
    label: 'Bump Conversation After Reply',
    query: BUMP_QUERY,
    variables: [{ name: 'conversationId', value: contextRef('init-1', 'conversationId') }],
    expectedParams: 1,
  },
]

function buildCustomNode() {
  return {
    customNodes: {
      'process-chat-message': {
        nodes: FIXTURES.map((fixture, index) => ({
          id: `node-${index}`,
          data: {
            nodeType: 'data-raw-query',
            label: fixture.label,
            config: {
              dataSourceId: 'ds-1',
              query: fixture.query,
              queryVariables: fixture.variables,
            },
          },
        })),
      },
    },
  }
}

describe('the chat RAG statements survive the publish-time parameterization net', () => {
  it('binds every interpolation without a single residual', () => {
    // A residual makes parameterizeAllWorkflowRawSql throw and refuse to
    // generate the project, so this is also the "the chat still publishes" test.
    const uidl = buildCustomNode()
    expect(() => parameterizeAllWorkflowRawSql(uidl)).not.toThrow()
  })

  it.each(FIXTURES.map((f, i) => [f.label, i] as const))(
    '"%s" ends up fully parameterized',
    (_label, index) => {
      const uidl = buildCustomNode()
      parameterizeAllWorkflowRawSql(uidl)
      const config = uidl.customNodes['process-chat-message'].nodes[index].data.config as Record<
        string,
        unknown
      >

      expect(String(config.query)).not.toContain('{{')
      expect(config.queryVariables).toBeUndefined()
      expect((config.params as unknown[]).length).toBe(FIXTURES[index].expectedParams)
    }
  )

  it('keeps the table and column names out of the bound values', () => {
    // The bound params are what a value-injection attempt could reach; the SQL
    // structure must stay in the query text, server-side.
    const uidl = buildCustomNode()
    parameterizeAllWorkflowRawSql(uidl)
    for (const node of uidl.customNodes['process-chat-message'].nodes) {
      const params = (node.data.config as { params: unknown[] }).params
      for (const param of params) {
        expect(JSON.stringify(param)).not.toContain('teleport_ai_chat')
      }
    }
  })

  it('numbers the placeholders from $1 upward in declaration order', () => {
    const uidl = buildCustomNode()
    parameterizeAllWorkflowRawSql(uidl)
    const upsert = uidl.customNodes['process-chat-message'].nodes[2].data.config as {
      query: string
      params: Array<{ path?: string[] }>
    }
    expect(upsert.query).toContain('NULLIF($1::text')
    expect(upsert.query).toContain('LEFT($4::text, 80)')
    expect(upsert.params[0].path?.[1]).toBe('conversationId')
    expect(upsert.params[3].path?.[1]).toBe('userMessageText')
  })
})

describe('the chat RAG statements pass the guard the generated app runs', () => {
  // The generated /api/data route calls assertQuerySafe on every raw query
  // before executing it. A statement that trips it fails at request time, which
  // for the chat means a silent empty retrieval rather than a build error — so
  // the check has to run against the RUNTIME validator, the one baked into the
  // route, not the design-time `sql-query-validator` (which has no call sites
  // and rejects any `UPDATE … SET`).
  const assertQuerySafe = new Function(
    `${generateSqlValidatorCode()}\nreturn assertQuerySafe;`
  )() as (sql: string) => void

  it.each(FIXTURES.map((f) => [f.label] as const))('"%s" is allowed', (label) => {
    const uidl = buildCustomNode()
    parameterizeAllWorkflowRawSql(uidl)
    const node = uidl.customNodes['process-chat-message'].nodes.find(
      (entry) => entry.data.label === label
    )
    const { query } = node?.data.config as { query: string }
    expect(() => assertQuerySafe(query)).not.toThrow()
  })

  it('still rejects the operations the guard exists for', () => {
    expect(() => assertQuerySafe('DROP TABLE teleport_ai_chat_documents')).toThrow()
    expect(() => assertQuerySafe('SET ROLE postgres')).toThrow()
  })
})
