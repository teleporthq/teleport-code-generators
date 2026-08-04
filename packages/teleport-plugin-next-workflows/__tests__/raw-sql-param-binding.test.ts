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

describe('CASE/WHEN/THEN/ELSE and TRIM(... FROM ...) value positions', () => {
  it('binds tokens after WHEN as positional parameters', () => {
    const res = parameterizeRawSqlInterpolations(
      "SELECT * FROM events WHERE (CASE WHEN {{ dateRange }} = 'today' THEN start_time < CURRENT_DATE WHEN {{ dateRange }} = '7d' THEN start_time < NOW() ELSE TRUE END)",
      [{ name: 'dateRange', value: ref('get-range', 'value') }]
    )
    expect(res.residuals).toEqual([])
    expect(res.query).toContain('CASE WHEN $1 =')
    expect(res.query).toContain('WHEN $2 =')
    expect(res.params).toHaveLength(2)
  })

  it('binds the operand of TRIM(BOTH FROM {{ token }})', () => {
    const value = ref('get-status', 'value')
    const res = parameterizeRawSqlInterpolations(
      "SELECT * FROM t WHERE TRIM(BOTH FROM {{ status }}) IN ('', 'All')",
      [{ name: 'status', value }]
    )
    expect(res.query).toBe("SELECT * FROM t WHERE TRIM(BOTH FROM $1) IN ('', 'All')")
    expect(res.params).toEqual([value])
    expect(res.residuals).toEqual([])
  })

  it('binds TRIM(LEADING/TRAILING ... FROM {{ token }}) variants', () => {
    const value = ref('n', 'v')
    for (const sql of [
      "SELECT TRIM(LEADING '0' FROM {{ v }})",
      'SELECT TRIM(TRAILING FROM {{ v }})',
      'SELECT TRIM(FROM {{ v }})',
    ]) {
      const res = parameterizeRawSqlInterpolations(sql, [{ name: 'v', value }])
      expect(res.residuals).toEqual([])
      expect(res.params).toEqual([value])
    }
  })

  it('still refuses a plain FROM {{ table }} identifier position', () => {
    const res = parameterizeRawSqlInterpolations('SELECT * FROM {{ table }}', [
      { name: 'table', value: ref('n', 't') },
    ])
    expect(res.residuals).toEqual(['{{ table }}'])
  })

  it('parameterizes the full alerts-filter fixture query with zero residuals', () => {
    // Verbatim from examples/uidl-samples/project.json node `query-alerts` — the
    // query this guard refused (8 residuals) before CASE/WHEN and TRIM(... FROM ...)
    // were recognised as value positions.
    const query =
      "SELECT a.id, a.vehicle_id, a.driver_id, a.type_field, a.severity, a.occurred_at, a.resolved FROM alerts a WHERE (TRIM(BOTH FROM {{statusFilterSegment}}) IN ('', 'All') OR (CASE WHEN {{statusFilterSegment}} = 'Active' THEN a.resolved = false WHEN {{statusFilterSegment}} = 'Resolved' THEN a.resolved = true WHEN {{statusFilterSegment}} = 'Acknowledged' THEN EXISTS (SELECT 1 FROM alert_actions aa WHERE aa.alert_id = a.id AND aa.action_field = 'Acknowledged') ELSE false END)) AND ({{severityFilterSelect}} = 'All' OR a.severity = {{severityFilterSelect}}) AND (TRIM(BOTH FROM {{searchAlertsInput}}) = '' OR a.type_field ILIKE '%' || {{searchAlertsInput}} || '%') AND ({{timeRangeSelect}} = 'All Time' OR a.occurred_at >= CASE WHEN {{timeRangeSelect}} = 'Last 24h' THEN NOW() - INTERVAL '24 hours' WHEN {{timeRangeSelect}} = 'Last 7d' THEN NOW() - INTERVAL '7 days' WHEN {{timeRangeSelect}} = 'Last 30d' THEN NOW() - INTERVAL '30 days' ELSE a.occurred_at END) ORDER BY a.occurred_at DESC"
    const status = ref('get-status', 'value')
    const severity = ref('get-severity', 'value')
    const search = ref('get-search', 'value')
    const time = ref('get-time', 'value')
    const res = parameterizeRawSqlInterpolations(query, [
      { name: 'statusFilterSegment', value: status },
      { name: 'severityFilterSelect', value: severity },
      { name: 'searchAlertsInput', value: search },
      { name: 'timeRangeSelect', value: time },
    ])
    expect(res.residuals).toEqual([])
    expect(res.query).not.toContain('{{')
    expect(res.params).toEqual([
      status,
      status,
      status,
      status,
      severity,
      severity,
      search,
      search,
      time,
      time,
      time,
      time,
    ])
    expect(res.query).toContain('TRIM(BOTH FROM $1)')
    expect(res.query).toContain('CASE WHEN $2 =')
    expect(res.query).toContain("ILIKE '%' || $8 || '%'")
    expect(res.query).toContain('$12')
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
