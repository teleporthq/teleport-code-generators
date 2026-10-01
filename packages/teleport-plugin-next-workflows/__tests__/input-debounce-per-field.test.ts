import { parse } from '@babel/parser'
import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'

// A debounced `event-input-updated` handler is generated once per element id
// and shared by every row a repeater renders with that id. It used to keep ONE
// timer: typing in the next row within the debounce window cleared the pending
// run of the row before, so that row's value never reached its workflow. Each
// field now debounces on its own; a field typed into twice still runs once.

const ELEMENT_ID = 'option-input'
const WORKFLOW_ID = 'wf-option-input'
const DEBOUNCE = 250

const inputWorkflow = {
  id: WORKFLOW_ID,
  name: 'Enter Product Option',
  trigger: {
    type: 'event-input-updated',
    nodeId: 'trigger-input',
    scope: 'element',
    config: { elementHtmlId: ELEMENT_ID, debounce: DEBOUNCE },
  },
  nodes: [
    {
      id: 'update-1',
      type: 'state-update-local-state',
      config: { property: 'typedOption', value: 'x' },
      stepNumber: 1,
    },
  ],
  edges: [{ id: 'e1', source: 'trigger-input', target: 'update-1' }],
}

const generateHandlerSource = async (): Promise<string> => {
  const ast = parse(
    `const OptionsPage = (props) => {
      return (
        <div>
          <input id="${ELEMENT_ID}" type="text" />
        </div>
      )
    }`,
    { plugins: ['jsx'] }
  )
  const structure: any = {
    uidl: {
      name: 'OptionsPage',
      outputOptions: { pageId: 'page-options', fileName: 'options-page' },
      stateDefinitions: {},
      node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
    },
    chunks: [{ type: 'chunk-type-ast', name: 'jsx-component', content: ast.program.body[0] }],
    options: {
      workflows: { workflows: { [WORKFLOW_ID]: inputWorkflow }, customNodes: {} },
    },
    dependencies: {},
  }
  await createNextWorkflowPlugin({ isPage: true })(structure)
  const moduleChunk = structure.chunks.find((chunk: any) => chunk.name === 'workflow-module')
  const match = String(moduleChunk?.content ?? '').match(
    new RegExp(`elementTriggers\\['${ELEMENT_ID}'\\] = \\{\\n {4}\\w+: ([\\s\\S]*?)\\n {2}\\};`)
  )
  if (!match) {
    throw new Error('no element trigger emitted for the input')
  }
  return match[1]
}

interface Run {
  value: unknown
  triggerElement: unknown
}

const loadHandler = async (runs: Run[]): Promise<(event: unknown) => void> => {
  const source = await generateHandlerSource()
  const safeId = WORKFLOW_ID.replace(/[^a-zA-Z0-9]/g, '_')
  // tslint:disable-next-line:function-constructor
  const factory = new Function(
    '__execWf',
    `__wfConfig_${safeId}`,
    `__wfServerUrls_${safeId}`,
    'CustomEvent',
    `return ${source}`
  )
  const execWf = (_config: unknown, triggerContext: Run) => {
    runs.push({ value: triggerContext.value, triggerElement: triggerContext.triggerElement })
  }
  return factory(
    execWf,
    {},
    {},
    class {
      constructor(public type: string, public init: unknown) {}
    }
  )
}

const field = (value: string) => ({ value, dispatchEvent: jest.fn() })

describe('debounced input trigger', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('runs the workflow for every field typed into within the window', async () => {
    const runs: Run[] = []
    const handler = await loadHandler(runs)
    const line1 = field('John')
    const line2 = field('Doe')

    handler({ target: line1 })
    jest.advanceTimersByTime(DEBOUNCE - 20)
    handler({ target: line2 })
    jest.advanceTimersByTime(DEBOUNCE)

    expect(runs).toEqual([
      { value: 'John', triggerElement: line1 },
      { value: 'Doe', triggerElement: line2 },
    ])
  })

  it('still runs once, with the last value, for a field typed into twice', async () => {
    const runs: Run[] = []
    const handler = await loadHandler(runs)
    const line1 = field('Jo')

    handler({ target: line1 })
    jest.advanceTimersByTime(DEBOUNCE - 20)
    line1.value = 'John'
    handler({ target: line1 })
    jest.advanceTimersByTime(DEBOUNCE - 1)
    expect(runs).toEqual([])
    jest.advanceTimersByTime(1)

    expect(runs).toEqual([{ value: 'John', triggerElement: line1 }])
    expect(line1.dispatchEvent).toHaveBeenCalledTimes(2)
  })
})
