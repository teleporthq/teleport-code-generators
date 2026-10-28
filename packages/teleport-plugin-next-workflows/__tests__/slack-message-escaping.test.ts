import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { escapeSlackMessageBindings } from '../src/slack-message-values'
import { loadHandler } from './_helpers/load-handler'
import { withFetch } from './_helpers/fake-fetch'

/**
 * A Slack message is mrkdwn: `<…>` there is a link, a mention or
 * `<!channel>`. A message bound whole to a value is written as a context chip
 * for every workflow (not only automations), so the runtime escapes the value
 * the way it escapes an embedded one; and a quote an escaped value carries is
 * put back in the text and in Block Kit blocks alike.
 */

const ref = (nodeId: string, path: string[]) => ({ type: 'workflowContext', nodeId, path })

const slack = (text: unknown, blocks?: unknown) => ({
  id: 'post',
  type: 'integration-slack',
  label: 'Post to Slack',
  config: {
    action: 'send-message',
    token: 'xoxb',
    channel: 'C1',
    text,
    ...(blocks ? { blocks } : {}),
  },
  executionEnv: 'server',
  stepNumber: 2,
})

const pageWorkflow = (text: unknown) => ({
  id: 'wf-notify',
  name: 'Notify Team',
  trigger: { type: 'event-page-loaded', nodeId: 't', scope: 'page', config: { allPages: true } },
  nodes: [
    {
      id: 'read',
      type: 'data-select',
      label: 'Read',
      config: { dataSourceId: 'ds-1', tableName: 'messages', limit: 1 },
      executionEnv: 'server',
      stepNumber: 1,
    },
    slack(text),
  ],
  edges: [
    { id: 'e1', source: 't', target: 'read' },
    { id: 'e2', source: 'read', target: 'post' },
  ],
})

const generate = async (workflow: unknown): Promise<string[]> => {
  const structure = {
    uidl: {
      name: 'Site',
      globals: { settings: { title: 'Site', language: 'en' }, env: { NEXTAUTH_SECRET: 'k' } },
      root: {
        name: 'Root',
        stateDefinitions: {
          route: { type: 'string', defaultValue: 'Home', values: [{ value: 'Home' }] },
        },
        node: { type: 'element', content: { elementType: 'container', children: [] as unknown[] } },
      },
      components: {},
      dataSources: { 'ds-1': { id: 'ds-1', type: 'teleport', name: 'Site', config: {} } },
      workflows: { workflows: { 'wf-notify': workflow } },
    },
    strategy: { pages: { options: {} } },
    files: new Map<string, { path: string[]; files: Array<{ name: string; content: unknown }> }>(),
    dependencies: {} as Record<string, string>,
    devDependencies: {},
  }
  await new NextWorkflowProjectPlugin().runAfter(structure as never)
  const routes: string[] = []
  for (const entry of structure.files.values()) {
    if (entry.path.join('/') === 'pages/api/workflows') {
      entry.files.forEach((file) => routes.push(String(file.content)))
    }
  }
  return routes
}

describe('Slack messages bound to a value', () => {
  it('writes a page workflow’s whole-message binding as a chip, so its value is escaped', async () => {
    const routes = await generate(pageWorkflow(ref('read', ['rows', '0', 'body'])))
    const route = routes.find((content) => content.includes('integration-slack')) as string
    expect(route).toContain('context-value-inline')
    expect(route).toContain('data-ctx-node-id=\\"read\\"')
    expect(route).not.toContain('"text": {')
  })

  it('leaves a message that is already the author’s own text untouched', () => {
    const nodes = [slack('Hello team') as never]
    expect(escapeSlackMessageBindings(nodes)).toBe(nodes)
  })

  it('puts quotes back in the text and in Block Kit blocks, and keeps Slack’s own escapes', async () => {
    const handler = loadHandler('integration-slack')
    const sent = await withFetch(
      () => ({ status: 200, body: { ok: true, ts: '1' } }),
      async (calls) => {
        await handler(
          {
            action: 'send-message',
            token: 'xoxb',
            channel: 'C1',
            text: 'O&#39;Brien said &quot;hi&quot; &lt;!channel&gt;',
            blocks: [
              {
                type: 'section',
                text: { type: 'mrkdwn', text: 'O&#39;Brien &amp; &lt;!here&gt;' },
              },
            ],
          },
          {}
        )
        return calls
      }
    )
    expect(sent[0].json.text).toBe('O\'Brien said "hi" &lt;!channel&gt;')
    expect(sent[0].json.blocks[0].text.text).toBe("O'Brien &amp; &lt;!here&gt;")
  })
})
