import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { collectWorkflowPublishRefusals } from '../src/publish-refusals'
import { CodegenSecurityError } from '../src/security-scanner'

/**
 * `collectWorkflowPublishRefusals` answers what a publish of these workflows
 * would refuse, without generating them: the editor's AI tools ask it before
 * a write lands, the editor's publish before it goes out. It runs the gates
 * the plugin itself runs (`assertWorkflowPublishGates`,
 * `assertSegmentRouteGates`), so a refusal it reports is the one a publish
 * throws, in the same words — pinned below by generating the same workflows.
 */

const ref = (nodeId: string, path: string[]) => ({ type: 'workflowContext', nodeId, path })

const node = (
  id: string,
  type: string,
  config: Record<string, unknown>,
  executionEnv = 'server',
  label = id
) => ({ id, type, label, config, executionEnv, stepNumber: 1 })

const formWorkflow = (id: string, steps: Array<ReturnType<typeof node>>) => ({
  id,
  name: id,
  trigger: { type: 'event-form-submitted', nodeId: 't', scope: 'page', config: {} },
  nodes: steps,
  edges: steps.map((step, index) => ({
    id: `e${index}`,
    source: index === 0 ? 't' : steps[index - 1].id,
    target: step.id,
  })),
  usedInNodes: {},
})

const cronWorkflow = (id: string, steps: Array<ReturnType<typeof node>>) => ({
  ...formWorkflow(id, steps),
  trigger: { type: 'event-cron-triggered', nodeId: 't', scope: 'global', config: {} },
})

const visitorEmail = node('reply', 'email-resend', {
  to: ref('t', ['formData', 'email']),
  subject: 'Your message',
  body: ref('t', ['formData', 'message']),
})

const ownerEmail = node('notify', 'email-resend', {
  to: 'owner@example.com',
  subject: 'New message',
  body: '<p>A visitor wrote: {{message}}</p>',
  templateParams: [{ key: 'message', value: ref('t', ['formData', 'message']) }],
})

const push = node('push', 'push-send-notification', { title: 'Sale', body: 'Now on' })

const WRITER_ID = 'cn-writer'
const writer = {
  id: WRITER_ID,
  name: 'Record Order Event',
  parameters: [],
  protection: {
    requiresAuth: false,
    allowedRoles: [],
    serverOnly: true,
    derivedFrom: 'server-callers',
  },
  nodes: [
    node('w-insert', 'data-create-item', {
      dataSourceId: 'ds-1',
      tableName: 'teleport_events',
      columnMappings: [{ column: 'event_type', value: 'x' }],
    }),
  ],
  edges: [] as unknown[],
}

const recordEvent = (value: unknown) =>
  node('record', 'general-custom-node', {
    customNodeId: WRITER_ID,
    parameters: [
      { key: 'eventType', value: 'order-placed' },
      { key: 'entityId', value },
    ],
  })

/** A custom node that reads a field in the browser, then records an event with it. */
const customNodeSteps = {
  id: 'cn-steps',
  name: 'Signup steps',
  parameters: [],
  nodes: [
    node('read-input', 'element-get-input-value', { elementId: 'email' }, 'client'),
    {
      ...node('record-in-cn', 'general-custom-node', {
        customNodeId: WRITER_ID,
        parameters: [{ key: 'entityId', value: ref('read-input', ['value']) }],
      }),
    },
  ],
  edges: [{ id: 'cn-e1', source: 'read-input', target: 'record-in-cn' }],
}

const createRow = node('create-row', 'data-create-item', {
  dataSourceId: 'ds-1',
  tableName: 'leads',
  columnMappings: [{ column: 'email', value: ref('t', ['formData', 'email']) }],
})

const staleNewsletterUnsubscribeWorkflow = {
  id: 'newsletter-off',
  name: 'Newsletter · Switch Off From The Account',
  trigger: { type: 'event-element-clicked', nodeId: 'switch', scope: 'element', config: {} },
  nodes: [
    node('account', 'account-get-current', {}, 'client', 'Fetch The Signed-In Person'),
    node(
      'now',
      'general-custom-js',
      {
        code: [
          'function customHandler(params) {',
          '  var named = params && params.length ? params[params.length - 1] || {} : {};',
          '  var now = new Date();',
          '  var id = named.id == null ? "" : String(named.id);',
          '  return { value: now.toISOString(), dedupe: id + ":" + Math.floor(now.getTime() / 60000) };',
          '}',
        ].join('\n'),
        context: 'server',
        params: { id: ref('account', ['id']), email: ref('account', ['email']) },
      },
      'server',
      'Note The Time'
    ),
    node(
      'update',
      'data-update-item',
      {
        dataSourceId: 'ds-1',
        tableName: 'users',
        filters: [{ field: 'email', operator: '=', value: ref('account', ['email']) }],
        columnMappings: [
          { column: 'newsletter_status', value: 'unsubscribed' },
          { column: 'newsletter_unsubscribed_at', value: ref('now', ['value']) },
        ],
      },
      'server',
      'Unsubscribe The Signed-In Person'
    ),
    node(
      'changed',
      'general-if-statement',
      {
        conditionType: 'simple-comparison',
        leftValue: ref('update', ['updatedCount']),
        operator: '>',
        rightValue: '0',
      },
      'server',
      'Did The Row Change?'
    ),
    node(
      'off',
      'state-update-local-state',
      { property: 'newsletterSwitch', value: 'off' },
      'client',
      'Show The Switch Off'
    ),
    node(
      'record',
      'general-custom-node',
      {
        customNodeId: WRITER_ID,
        parameters: [
          { key: 'eventType', value: 'newsletter-unsubscribed' },
          { key: 'entityType', value: 'subscriber' },
          { key: 'entityId', value: ref('account', ['id']) },
          { key: 'dedupeSubject', value: ref('now', ['dedupe']) },
          { key: 'actorType', value: 'customer' },
          { key: 'actor', value: ref('account', ['email']) },
        ],
      },
      'server',
      'Record The Unsubscribe'
    ),
  ],
  edges: [
    { id: 'e1', source: 'switch', target: 'account' },
    { id: 'e2', source: 'account', target: 'now' },
    { id: 'e3', source: 'now', target: 'update' },
    { id: 'e4', source: 'update', target: 'changed' },
    { id: 'e5', source: 'changed', target: 'off', sourceHandle: 'true' },
    { id: 'e6', source: 'off', target: 'record' },
  ],
  usedInNodes: {},
}

const unboundSql = node('find', 'data-raw-query', {
  dataSourceId: 'ds-1',
  query: 'SELECT * FROM {{ tableName }}',
  queryVariables: [{ name: 'tableName', value: ref('t', ['formData', 'table']) }],
})

const refusalsOf = (
  workflows: Record<string, unknown>,
  customNodes: Record<string, unknown> = {}
) => collectWorkflowPublishRefusals({ workflows, customNodes } as never)

const ofCheck = (refusals: ReturnType<typeof refusalsOf>, check: string) =>
  refusals.filter((refusal) => refusal.check === check)

const projectStructure = (
  workflows: Record<string, unknown>,
  customNodes: Record<string, unknown>
) => ({
  uidl: {
    name: 'Site',
    globals: { settings: { title: 'Site', language: 'en' }, env: {} },
    root: {
      name: 'Root',
      stateDefinitions: {
        route: { type: 'string', defaultValue: 'Home', values: [{ value: 'Home' }] },
      },
      node: {
        type: 'element',
        content: { elementType: 'container', children: [] as unknown[] },
      },
    },
    components: {},
    dataSources: { 'ds-1': { id: 'ds-1', type: 'teleport', name: 'Site', config: {} } },
    workflows: {
      workflows: JSON.parse(JSON.stringify(workflows)),
      customNodes: JSON.parse(JSON.stringify(customNodes)),
    },
  },
  strategy: { pages: { options: {} } },
  files: new Map(),
  dependencies: {},
  devDependencies: {},
})

/** What generating the workflows throws (runBefore, then runAfter), or null. */
const publishError = async (
  workflows: Record<string, unknown>,
  customNodes: Record<string, unknown> = {}
): Promise<Error | null> => {
  const plugin = new NextWorkflowProjectPlugin()
  const structure = projectStructure(workflows, customNodes)
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  try {
    await plugin.runBefore(structure as never)
    await plugin.runAfter(structure as never)
    return null
  } catch (error) {
    return error as Error
  } finally {
    warn.mockRestore()
  }
}

/** The sentence a thrown refusal carries for its first step, as the editor reads it. */
const thrownSentence = (error: Error): string => {
  if (error instanceof CodegenSecurityError) {
    return error.violations[0].message
  }
  const body = /^Publishing refused: (\{.*\})$/.exec(error.message)
  return body ? JSON.parse(body[1]).message : error.message
}

describe('collectWorkflowPublishRefusals', () => {
  it("finds a send of only the visitor's words to the visitor's address, and names the step", () => {
    const sends = ofCheck(
      refusalsOf({ contact: formWorkflow('contact', [visitorEmail]) }),
      'outbound-message'
    )
    expect(sends).toHaveLength(1)
    expect(sends[0]).toMatchObject({
      kind: 'never-sends',
      ownerId: 'contact',
      ownerKind: 'workflow',
      nodeId: 'reply',
    })
    expect(sends[0].message).toContain('the step "reply"')
    expect(sends[0].message).toContain('will never send')
  })

  it('lets an authored message to the owner through', () => {
    expect(refusalsOf({ contact: formWorkflow('contact', [ownerEmail]) })).toEqual([])
  })

  it('finds the same refused send on an unsigned webhook', () => {
    const webhook = {
      ...formWorkflow('hook', [visitorEmail]),
      trigger: { type: 'event-webhook-received', nodeId: 't', scope: 'global', config: {} },
      webhookConfig: { path: 'hook', verifySignature: false },
    }
    const refusals = refusalsOf({ hook: webhook })
    expect(refusals.map((refusal) => [refusal.kind, refusal.nodeId])).toEqual([
      ['never-sends', 'reply'],
    ])
  })

  it('refuses a push on a route any visitor starts, and allows it on a schedule', () => {
    const refused = ofCheck(refusalsOf({ page: formWorkflow('page', [push]) }), 'public-steps')
    expect(refused).toHaveLength(1)
    expect(refused[0]).toMatchObject({ kind: 'refused', nodeId: 'push' })
    expect(refused[0].message).toContain('"push"')
    expect(refusalsOf({ nightly: cronWorkflow('nightly', [push]) })).toEqual([])
  })

  it('refuses a recorded event fed by a value the browser sends, and allows a server result', () => {
    const fromForm = ofCheck(
      refusalsOf(
        { signup: formWorkflow('signup', [recordEvent(ref('t', ['formData', 'email']))]) },
        { [WRITER_ID]: writer }
      ),
      'server-bound-calls'
    )
    expect(fromForm).toHaveLength(1)
    expect(fromForm[0].ownerId).toBe('signup')
    expect(fromForm[0].message).toContain('records an event')

    const fromServer = refusalsOf(
      { signup: formWorkflow('signup', [createRow, recordEvent(ref('create-row', ['id']))]) },
      { [WRITER_ID]: writer }
    )
    expect(fromServer).toEqual([])
  })

  it('repairs stale newsletter account unsubscribe event recording before generating', async () => {
    const staleRefusal = ofCheck(
      refusalsOf({ newsletter: staleNewsletterUnsubscribeWorkflow }, { [WRITER_ID]: writer }),
      'server-bound-calls'
    )
    expect(staleRefusal).toHaveLength(1)
    expect(staleRefusal[0].message).toContain('"Fetch The Signed-In Person"')

    expect(
      await publishError(
        { newsletter: staleNewsletterUnsubscribeWorkflow },
        { [WRITER_ID]: writer }
      )
    ).toBeNull()
  })

  it('refuses custom code that names a protected platform secret', () => {
    const script = node('script', 'general-custom-js', {
      code: 'function customHandler(params) { return process.env.NEXTAUTH_SECRET }',
    })
    const refused = ofCheck(refusalsOf({ page: formWorkflow('page', [script]) }), 'custom-code')
    expect(refused).toHaveLength(1)
    expect(refused[0].message).toContain('NEXTAUTH_SECRET')
  })

  it('refuses raw SQL a value cannot be bound into, naming the step', () => {
    const refused = ofCheck(refusalsOf({ search: formWorkflow('search', [unboundSql]) }), 'raw-sql')
    expect(refused).toHaveLength(1)
    expect(refused[0]).toMatchObject({ kind: 'refused', ownerId: 'search', nodeId: 'find' })
    expect(refused[0].message).toContain('The step "find" in "search"')
    expect(refused[0].message).toContain('cannot be safely parameterized')
  })

  it('leaves the workflows it was given as they were', () => {
    const workflows = { search: formWorkflow('search', [unboundSql]) }
    const before = JSON.stringify(workflows)
    refusalsOf(workflows)
    expect(JSON.stringify(workflows)).toBe(before)
  })

  it('logs nothing: the build-log line stays the publish’s own', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      refusalsOf({ contact: formWorkflow('contact', [visitorEmail]) })
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  describe('reports what publishing these workflows throws, in its words', () => {
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ['raw SQL', { search: formWorkflow('search', [unboundSql]) }, {}],
      [
        'custom code',
        {
          page: formWorkflow('page', [
            node('script', 'general-custom-js', {
              code: 'function customHandler(params) { return process.env.NEXTAUTH_SECRET }',
            }),
          ]),
        },
        {},
      ],
      ['a public push', { page: formWorkflow('page', [push]) }, {}],
      [
        'a recorded event fed by the browser',
        { signup: formWorkflow('signup', [recordEvent(ref('t', ['formData', 'email']))]) },
        { [WRITER_ID]: writer },
      ],
      [
        "a custom node's server route recording an event from a browser read",
        {
          page: formWorkflow('page', [
            node(
              'call',
              'general-custom-node',
              { customNodeId: 'cn-steps', parameters: [] },
              'universal'
            ),
          ]),
        },
        { [WRITER_ID]: writer, 'cn-steps': customNodeSteps },
      ],
    ]
    for (const [name, workflows, customNodes] of cases) {
      it(name, async () => {
        const refused = refusalsOf(workflows, customNodes).filter(
          (refusal) => refusal.kind === 'refused'
        )
        const thrown = await publishError(workflows, customNodes)
        expect(refused).toHaveLength(1)
        expect(thrown).not.toBeNull()
        expect(refused[0].message).toContain(thrownSentence(thrown as Error))
      })
    }

    it('and nothing for the server-side equivalents', async () => {
      const workflows = {
        nightly: cronWorkflow('nightly', [push]),
        contact: formWorkflow('contact', [ownerEmail]),
        signup: formWorkflow('signup', [createRow, recordEvent(ref('create-row', ['id']))]),
      }
      expect(refusalsOf(workflows, { [WRITER_ID]: writer })).toEqual([])
      expect(await publishError(workflows, { [WRITER_ID]: writer })).toBeNull()
    })
  })

  describe('reports a refused send in the words the generator logs when it builds the route', () => {
    const loggedSends = async (workflows: Record<string, unknown>): Promise<string[]> => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        await new NextWorkflowProjectPlugin().runAfter(projectStructure(workflows, {}) as never)
        return warn.mock.calls
          .map((call) => String(call[0]))
          .filter((line) => line.startsWith('[teleport-plugin-next-workflows] Workflow'))
      } finally {
        warn.mockRestore()
      }
    }
    const expectedLines = (workflows: Record<string, unknown>) =>
      ofCheck(refusalsOf(workflows), 'outbound-message').map(
        (refusal) => `[teleport-plugin-next-workflows] ${refusal.message}`
      )

    it("on a page's segment route", async () => {
      const workflows = { contact: formWorkflow('contact', [visitorEmail]) }
      expect(expectedLines(workflows)).toHaveLength(1)
      expect(await loggedSends(workflows)).toEqual(expectedLines(workflows))
    })

    it('on an unsigned webhook route', async () => {
      const workflows = {
        hook: {
          ...formWorkflow('hook', [visitorEmail]),
          trigger: { type: 'event-webhook-received', nodeId: 't', scope: 'global', config: {} },
          webhookConfig: { urlPath: 'hook', httpMethod: 'POST', verifySignature: false },
        },
      }
      expect(expectedLines(workflows)).toHaveLength(1)
      expect(await loggedSends(workflows)).toEqual(expectedLines(workflows))
    })

    it('and nowhere for an automation, which runs in the event bus', async () => {
      const workflows = {
        welcome: {
          ...formWorkflow('welcome', [visitorEmail]),
          trigger: {
            type: 'event-business-event',
            nodeId: 't',
            scope: 'global',
            config: { eventType: 'order-paid' },
          },
        },
      }
      expect(refusalsOf(workflows)).toEqual([])
      expect(await loggedSends(workflows)).toEqual([])
      expect(await publishError(workflows)).toBeNull()
    })
  })

  it('reports every browser-fed recorded event of a route, each with its step', () => {
    const refused = ofCheck(
      refusalsOf(
        {
          signup: formWorkflow('signup', [
            recordEvent(ref('t', ['formData', 'email'])),
            { ...recordEvent(ref('t', ['formData', 'name'])), id: 'record-2' },
          ]),
        },
        { [WRITER_ID]: writer }
      ),
      'server-bound-calls'
    )
    expect(refused.map((refusal) => refusal.nodeId)).toEqual(['record', 'record-2'])
  })
})
