import {
  parameterizeRawSqlInterpolations,
  parameterizeWorkflowRawSqlInterpolations,
  parameterizeAllWorkflowRawSql,
  WorkflowSqlInterpolationError,
} from '../src/raw-sql-param-binding'

// Generation-time net (runs in the workflows plugin's runBefore). Converts each
// `{{ name }}` value token in a data node's raw SQL into a positional `$N` +
// a bound params entry, keeping the published-app runtime on the standard
// `$N` + params path. PAIRED with the GUI + worker copies.

function ref(nodeId: string, ...path: string[]) {
  return { type: 'workflowContext' as const, nodeId, path: [nodeId, ...path] }
}

describe('parameterizeRawSqlInterpolations', () => {
  it('binds a context-ref variable token in value position', () => {
    const value = ref('normalize', 'ids')
    const res = parameterizeRawSqlInterpolations(
      'DELETE FROM t WHERE id::text = ANY({{ selectedIds }}::text[])',
      [{ name: 'selectedIds', value }]
    )
    expect(res.query).toBe('DELETE FROM t WHERE id::text = ANY($1::text[])')
    expect(res.params).toEqual([value])
    expect(res.residuals).toEqual([])
  })

  it('keeps an unmatched {{state.X}} token as its own string param', () => {
    const res = parameterizeRawSqlInterpolations(
      'SELECT * FROM t WHERE owner = {{state.userId}}',
      []
    )
    expect(res.query).toBe('SELECT * FROM t WHERE owner = $1')
    expect(res.params).toEqual(['{{state.userId}}'])
  })

  it('reports an identifier-position token as a residual', () => {
    const res = parameterizeRawSqlInterpolations('SELECT * FROM {{ t }}', [
      { name: 't', value: ref('n', 't') },
    ])
    expect(res.residuals).toEqual(['{{ t }}'])
    expect(res.params).toEqual([])
  })
})

describe('parameterizeWorkflowRawSqlInterpolations', () => {
  it('rewrites a data-raw-query node and drops queryVariables', () => {
    const value = ref('n', 'ids')
    const workflow = {
      nodes: [
        {
          id: 'q',
          type: 'data-raw-query',
          config: {
            query: 'DELETE FROM t WHERE id = ANY({{ ids }}::text[])',
            queryVariables: [{ name: 'ids', value }],
          },
        },
      ],
    }
    parameterizeWorkflowRawSqlInterpolations(workflow)
    expect(workflow.nodes[0].config).toEqual({
      query: 'DELETE FROM t WHERE id = ANY($1::text[])',
      params: [value],
    })
  })

  it('rewrites a data-select rawQueryUserPart', () => {
    const value = ref('n', 'v')
    const workflow = {
      nodes: [
        {
          id: 's',
          type: 'data-select',
          config: {
            rawQueryUserPart: 'owner_id = {{ v }}',
            rawQueryUserPartVariables: [{ name: 'v', value }],
          },
        },
      ],
    }
    parameterizeWorkflowRawSqlInterpolations(workflow)
    expect(workflow.nodes[0].config).toEqual({
      rawQueryUserPart: 'owner_id = $1',
      rawQueryUserPartParams: [value],
    })
  })

  it('throws on an unbindable token and mutates nothing', () => {
    const workflow = {
      nodes: [
        {
          id: 'bad',
          type: 'data-raw-query',
          config: {
            query: 'SELECT * FROM {{ table }}',
            queryVariables: [{ name: 'table', value: ref('n', 't') }],
          },
        },
      ],
    }
    expect(() => parameterizeWorkflowRawSqlInterpolations(workflow)).toThrow(
      WorkflowSqlInterpolationError
    )
    expect((workflow.nodes[0].config as { query: string }).query).toContain('{{ table }}')
  })
})

describe('parameterizeAllWorkflowRawSql', () => {
  it('walks both workflows and customNodes (id-keyed records)', () => {
    const value = ref('n', 'ids')
    const uidlWorkflows = {
      workflows: {
        wf1: {
          nodes: {
            n1: {
              type: 'data-raw-query',
              config: {
                query: 'DELETE FROM t WHERE id = ANY({{ ids }}::text[])',
                queryVariables: [{ name: 'ids', value }],
              },
            },
          },
        },
      },
      customNodes: {},
    }
    parameterizeAllWorkflowRawSql(uidlWorkflows)
    const cfg = uidlWorkflows.workflows.wf1.nodes.n1.config as { query: string; params: unknown[] }
    expect(cfg.query).toBe('DELETE FROM t WHERE id = ANY($1::text[])')
    expect(cfg.params).toEqual([value])
  })

  it('is a no-op when workflows is undefined', () => {
    expect(() => parameterizeAllWorkflowRawSql(undefined)).not.toThrow()
  })
})
