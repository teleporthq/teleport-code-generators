import { parse } from '@babel/parser'
import generate from '@babel/generator'
import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'

// Regression guard for the "Resolved pill crashes with `func.apply is not a
// function`" bug.
//
// The alerts-inbox fixture carried a stray STATIC attr `onClick: ""` on
// `status-resolved-btn` (junk from the element author — behavior belongs in
// `events` / workflow triggers). The trigger injector saw an existing onClick
// attr, found its value was a string literal rather than an expression, and
// `continue`d — silently dropping the workflow wiring AND shipping
// `onClick=""`, which React invokes as a listener on click and crashes.
// The fix replaces a non-expression event prop with the workflow handler.

const clickWorkflow = (elementHtmlId: string) => ({
  id: 'wf-resolved-pill',
  name: 'Sync Status Filter Segment Copy 3',
  trigger: {
    type: 'event-element-clicked',
    nodeId: 'trigger-click',
    scope: 'element',
    config: { elementHtmlId, eventType: 'click' },
  },
  nodes: [
    {
      id: 'update-1',
      type: 'state-update-local-state',
      config: { property: 'statusFilterSegment', value: 'Resolved' },
      stepNumber: 1,
    },
  ],
  edges: [{ id: 'e1', source: 'trigger-click', target: 'update-1' }],
})

const parseComponentChunk = (source: string) => {
  const ast = parse(source, { plugins: ['jsx'] })
  return {
    type: 'chunk-type-ast',
    name: 'jsx-component',
    content: ast.program.body[0],
  }
}

const runPlugin = async (componentSource: string) => {
  const chunk = parseComponentChunk(componentSource)
  const structure: any = {
    uidl: {
      name: 'AlertsInbox',
      outputOptions: { pageId: 'page-alerts', fileName: 'alerts-inbox' },
      stateDefinitions: {},
      node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
    },
    chunks: [chunk],
    options: {
      workflows: {
        workflows: { 'wf-resolved-pill': clickWorkflow('status-resolved-btn') },
        customNodes: {},
      },
    },
    dependencies: {},
  }
  const plugin = createNextWorkflowPlugin({ isPage: true })
  await plugin(structure)
  return generate(chunk.content as any).code
}

describe('element trigger wiring over a non-expression event prop', () => {
  it('replaces a static onClick="" with the workflow handler call', async () => {
    const code = await runPlugin(`const AlertsInbox = (props) => {
      return (
        <button id="status-resolved-btn" onClick="">Resolved</button>
      )
    }`)
    expect(code).not.toContain('onClick=""')
    expect(code).toContain(`__wfRef.current.elementTriggers["status-resolved-btn"]["onClick"]`)
  })

  it('still combines with an existing expression handler', async () => {
    const code = await runPlugin(`const AlertsInbox = (props) => {
      return (
        <button id="status-resolved-btn" onClick={() => setStatusFilterSegment('Resolved')}>
          Resolved
        </button>
      )
    }`)
    expect(code).toContain(`setStatusFilterSegment('Resolved')`)
    expect(code).toContain(`__wfRef.current.elementTriggers["status-resolved-btn"]["onClick"]`)
  })

  it('adds the handler directly when the element has no event prop', async () => {
    const code = await runPlugin(`const AlertsInbox = (props) => {
      return (
        <button id="status-resolved-btn">Resolved</button>
      )
    }`)
    expect(code).toContain(`__wfRef.current.elementTriggers["status-resolved-btn"]["onClick"]`)
  })
})
