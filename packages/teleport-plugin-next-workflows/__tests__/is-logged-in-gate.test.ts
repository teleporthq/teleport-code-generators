import { isIsLoggedInTrueGateConfig, neutraliseIsLoggedInGates } from '../src/is-logged-in-gate'

// Regression guard for "guest checkout buyer redirected away from
// /order-details by the page-load workflow's isLoggedIn gate".
// The AI's `evaluate-auth` custom-js emits string "true"/"false";
// the IF compares it against boolean `true`. After the
// `coerceForComparison` runtime helper coerces them, the
// comparison resolves to false for any anonymous visitor — and
// the IF's FALSE-branch edge sends them to home / sign-in BEFORE
// the SQL ownership query gets a chance to match their
// anonymousUserId. These tests pin the contract for the codegen
// transform that neutralises that gate on row-owned pages.

const refToIsLoggedIn = (nodeId: string) => ({
  type: 'workflowContext' as const,
  nodeId,
  path: [nodeId, 'isLoggedIn'],
})

describe('isIsLoggedInTrueGateConfig', () => {
  it('matches the canonical `=== true` shape the AI emits', () => {
    expect(
      isIsLoggedInTrueGateConfig({
        conditionType: 'simple-comparison',
        leftValue: refToIsLoggedIn('evaluate-auth'),
        operator: '===',
        rightValue: true,
      })
    ).toBe(true)
  })

  it('matches the string-"true" variant some emitters use', () => {
    // evaluate-auth returns isLoggedIn as a string; some workflows
    // round-trip the boolean through the AI as the literal "true",
    // and `coerceForComparison` collapses both forms.
    expect(
      isIsLoggedInTrueGateConfig({
        conditionType: 'simple-comparison',
        leftValue: refToIsLoggedIn('evaluate-auth'),
        operator: '===',
        rightValue: 'true',
      })
    ).toBe(true)
  })

  it('matches loose-equality variants (`==`, `equals`)', () => {
    for (const op of ['==', 'equals']) {
      expect(
        isIsLoggedInTrueGateConfig({
          conditionType: 'simple-comparison',
          leftValue: refToIsLoggedIn('x'),
          operator: op,
          rightValue: true,
        })
      ).toBe(true)
    }
  })

  it('infers `simple-comparison` when conditionType is omitted', () => {
    // The AI sometimes drops the explicit conditionType when there
    // is only one comparison; we treat the absence as the default.
    expect(
      isIsLoggedInTrueGateConfig({
        leftValue: refToIsLoggedIn('x'),
        operator: '===',
        rightValue: true,
      })
    ).toBe(true)
  })

  it('rejects unrelated IF nodes', () => {
    // Different leftValue path → not our gate. A `found === true`
    // post-SQL check must NOT be touched; that IF is the legitimate
    // "no rows returned, redirect home" guard and the row-owned
    // bypass relies on it staying intact.
    expect(
      isIsLoggedInTrueGateConfig({
        conditionType: 'simple-comparison',
        leftValue: {
          type: 'workflowContext',
          nodeId: 'parse-rows',
          path: ['parse-rows', 'found'],
        },
        operator: '===',
        rightValue: true,
      })
    ).toBe(false)
  })

  it('rejects non-workflowContext left operands', () => {
    expect(
      isIsLoggedInTrueGateConfig({
        leftValue: 'isLoggedIn',
        operator: '===',
        rightValue: true,
      })
    ).toBe(false)
  })

  it('rejects when rightValue is false', () => {
    // `isLoggedIn === false` is the inverted form — its FALSE
    // branch fires for logged-in users, which is the opposite of
    // the guest-blocking pattern we're neutralising.
    expect(
      isIsLoggedInTrueGateConfig({
        leftValue: refToIsLoggedIn('x'),
        operator: '===',
        rightValue: false,
      })
    ).toBe(false)
  })

  it('rejects non-equality operators', () => {
    // `is-truthy` and `>=` etc are out of scope: only equality
    // gates are the AI's documented pattern, and broadening the
    // matcher risks rewiring legitimate decision points.
    for (const op of ['is-truthy', 'is-empty', '>=', 'contains']) {
      expect(
        isIsLoggedInTrueGateConfig({
          leftValue: refToIsLoggedIn('x'),
          operator: op,
          rightValue: true,
        })
      ).toBe(false)
    }
  })

  it('rejects multiple-conditions IFs as out of scope', () => {
    // Conditional groups (AND/OR) are rare here; if a future
    // emitter ever wraps the isLoggedIn check in a group we want
    // a separate review rather than silently neutralising.
    expect(
      isIsLoggedInTrueGateConfig({
        conditionType: 'multiple-conditions',
        leftValue: refToIsLoggedIn('x'),
        operator: '===',
        rightValue: true,
      })
    ).toBe(false)
  })
})

describe('neutraliseIsLoggedInGates', () => {
  const buildWorkflow = () =>
    ({
      id: 'page-load-test',
      name: 'Order Details · Page Load',
      nodes: [
        { id: 'extract', type: 'general-custom-js', config: {} },
        { id: 'resolve-user', type: 'general-custom-node', config: {} },
        { id: 'evaluate-auth', type: 'general-custom-js', config: {} },
        {
          id: 'is-logged-in',
          type: 'general-if-statement',
          config: {
            conditionType: 'simple-comparison',
            leftValue: refToIsLoggedIn('evaluate-auth'),
            operator: '===',
            rightValue: true,
          },
        },
        { id: 'go-home', type: 'navigation-go-to-page', config: { pageId: '/' } },
        { id: 'sql-fetch', type: 'data-raw-query', config: {} },
        { id: 'parse-rows', type: 'general-custom-js', config: {} },
        {
          id: 'found-check',
          type: 'general-if-statement',
          config: {
            conditionType: 'simple-comparison',
            leftValue: {
              type: 'workflowContext',
              nodeId: 'parse-rows',
              path: ['parse-rows', 'found'],
            },
            operator: '===',
            rightValue: true,
          },
        },
        { id: 'render-ok', type: 'state-update-local-state', config: {} },
        { id: 'go-home-2', type: 'navigation-go-to-page', config: { pageId: '/' } },
      ],
      edges: [
        { id: 'e1', source: 'extract', target: 'resolve-user' },
        { id: 'e2', source: 'resolve-user', target: 'evaluate-auth' },
        { id: 'e3', source: 'evaluate-auth', target: 'is-logged-in' },
        { id: 'e4', source: 'is-logged-in', target: 'sql-fetch', sourceHandle: 'true' },
        { id: 'e5', source: 'is-logged-in', target: 'go-home', sourceHandle: 'false' },
        { id: 'e6', source: 'sql-fetch', target: 'parse-rows' },
        { id: 'e7', source: 'parse-rows', target: 'found-check' },
        { id: 'e8', source: 'found-check', target: 'render-ok', sourceHandle: 'true' },
        { id: 'e9', source: 'found-check', target: 'go-home-2', sourceHandle: 'false' },
      ],
      trigger: { type: 'event-page-loaded', nodeId: 'trigger', config: {} },
    } as any)

  // Helper that replays the runtime's evaluation. The real
  // `evaluateSingleComparison` accepts the same operator strings
  // and a non-empty `isLoggedIn` will satisfy `is-not-empty` for
  // both `"true"` and `"false"` outputs from `evaluate-auth`.
  const evaluateIf = (config: any, isLoggedInValue: string): boolean => {
    if (config.operator === 'is-not-empty') {
      return isLoggedInValue !== '' && isLoggedInValue !== null && isLoggedInValue !== undefined
    }
    // Mirror the runtime's boolean<>string coercion for ===.
    if (config.operator === '===') {
      let a: any = isLoggedInValue
      const b: any = config.rightValue
      if (typeof b === 'boolean' && typeof a === 'string') {
        if (a === 'true') {
          a = true
        } else if (a === 'false') {
          a = false
        }
      }
      return a === b
    }
    return false
  }

  it('rewrites the gate config so the IF always evaluates to true', () => {
    const wf = buildWorkflow()
    const neutralised = neutraliseIsLoggedInGates(wf, [])
    expect(neutralised).toBe(1)

    const ifNode = wf.nodes.find((n: any) => n.id === 'is-logged-in')
    expect(ifNode.config.operator).toBe('is-not-empty')
    // rightValue must be cleared so a future runtime cannot
    // misinterpret the operator as a binary comparison.
    expect(ifNode.config.rightValue).toBeUndefined()
    expect(ifNode.config.leftValue.path).toEqual(['evaluate-auth', 'isLoggedIn'])

    // The IF result is now true for BOTH guests and authenticated
    // users — that's the whole point.
    expect(evaluateIf(ifNode.config, 'true')).toBe(true)
    expect(evaluateIf(ifNode.config, 'false')).toBe(true)
  })

  it('leaves outgoing edges in place — runtime skips the FALSE branch on its own', () => {
    // Edge data is left as-is on purpose: the client runtime
    // already knows to skip the not-taken branch based on the IF
    // result, so we don't need to mutate the data graph.
    const wf = buildWorkflow()
    neutraliseIsLoggedInGates(wf, [])
    const falseEdge = wf.edges.find(
      (e: any) => e.source === 'is-logged-in' && e.sourceHandle === 'false'
    )
    const trueEdge = wf.edges.find(
      (e: any) => e.source === 'is-logged-in' && e.sourceHandle === 'true'
    )
    expect(falseEdge.target).toBe('go-home')
    expect(trueEdge.target).toBe('sql-fetch')
  })

  it('leaves the post-SQL `found === true` IF untouched', () => {
    // The found-check IF protects the "no rows returned, redirect
    // home" flow. After the SQL runs with the
    // user_id OR anonymousUserId clause, a genuine "no rows"
    // outcome still needs to redirect — otherwise stale
    // /order-details/<random> URLs would render empty pages
    // forever.
    const wf = buildWorkflow()
    neutraliseIsLoggedInGates(wf, [])
    const foundIf = wf.nodes.find((n: any) => n.id === 'found-check')
    expect(foundIf.config.operator).toBe('===')
    expect(foundIf.config.rightValue).toBe(true)
  })

  it('is a no-op for workflows that do not contain an isLoggedIn gate', () => {
    const wf = {
      id: 'no-gate',
      name: 'No Gate',
      nodes: [
        { id: 'a', type: 'general-custom-js', config: {} },
        { id: 'b', type: 'state-update-local-state', config: {} },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b' }],
      trigger: { type: 'event-page-loaded', nodeId: 't', config: {} },
    } as any
    expect(neutraliseIsLoggedInGates(wf, [])).toBe(0)
  })

  it('is idempotent — running twice keeps the operator as is-not-empty', () => {
    // The component plugin can in principle be invoked twice for
    // the same UIDL (page + project pass); the second pass must
    // not regress the already-neutralised gate.
    const wf = buildWorkflow()
    expect(neutraliseIsLoggedInGates(wf, [])).toBe(1)
    // Second pass: pattern no longer matches `=== true`, so it
    // returns 0 and the config stays as-is.
    expect(neutraliseIsLoggedInGates(wf, [])).toBe(0)
    const ifNode = wf.nodes.find((n: any) => n.id === 'is-logged-in')
    expect(ifNode.config.operator).toBe('is-not-empty')
  })

  it('does not throw if the workflow has no edges array', () => {
    // Defensive: a workflow built from a malformed UIDL should not
    // hard-crash the generator.
    const wf = {
      id: 'no-edges',
      nodes: [
        {
          id: 'g',
          type: 'general-if-statement',
          config: {
            leftValue: refToIsLoggedIn('x'),
            operator: '===',
            rightValue: true,
          },
        },
      ],
      edges: [],
      trigger: { type: 'event-page-loaded', nodeId: 't', config: {} },
    } as any
    expect(() => neutraliseIsLoggedInGates(wf, [])).not.toThrow()
  })
})
