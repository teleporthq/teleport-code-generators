// A workflow reads a global state through the state values its file hands the
// workflow runtime, and a global state is among them only when the file takes
// it from `useGlobalState()`. A file whose workflows only READ a global state
// used to get none of that, so the read was undefined: a timer in a component,
// gated on a global on/off switch that a page flips, never ticked.

import generate from '@babel/generator'
import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'
import { buildStateGetHandlerSource } from '../src/nodes/state/_state-get'

const GLOBAL_STATES = {
  TQ_switch: { id: 'TQ_switch', name: 'tickerTimerEnabled', type: 'boolean', defaultValue: true },
}

const COMPONENT = { componentId: 'TQ_ticker', componentName: 'Ticker' }

const node = (id: string, type: string, config: Record<string, unknown>) => ({
  id,
  type,
  config,
  stepNumber: 1,
  label: id,
})

const UPDATE_COUNT = node('bump', 'state-update-local-state', { property: 'count', value: 1 })

const timerWorkflow = (
  nodes: Array<ReturnType<typeof node>>,
  trigger: Record<string, unknown> = { scope: 'component', config: COMPONENT }
) => ({
  id: 'wf-ticker',
  name: 'Ticker Count Update',
  trigger: {
    type: 'event-interval',
    nodeId: 'tick',
    scope: trigger.scope,
    config: { intervalMs: 1000, autoStart: true, ...(trigger.config as object) },
  },
  nodes,
  edges: nodes.map((target, index) => ({
    id: `e${index}`,
    source: index === 0 ? 'tick' : nodes[index - 1].id,
    target: target.id,
  })),
})

const jsxComponentChunk = () => ({
  type: 'chunk-type-ast',
  name: 'jsx-component',
  content: {
    type: 'VariableDeclaration',
    kind: 'const',
    declarations: [
      {
        type: 'VariableDeclarator',
        id: { type: 'Identifier', name: 'Ticker' },
        init: {
          type: 'ArrowFunctionExpression',
          params: [] as unknown[],
          body: {
            type: 'BlockStatement',
            body: [{ type: 'ReturnStatement', argument: null as unknown }],
            directives: [] as unknown[],
          },
        },
      },
    ],
  },
})

interface Generated {
  component: string
  module: string
  dependencies: Record<string, { path?: string }>
}

const generateFile = async (params: {
  workflow: any
  isPage: boolean
  globalStateDefinitions?: Record<string, unknown>
  customNodes?: Record<string, unknown>
}): Promise<Generated> => {
  const { workflow, isPage, globalStateDefinitions = GLOBAL_STATES, customNodes = {} } = params
  const plugin = createNextWorkflowPlugin({ isPage })
  const structure: any = {
    uidl: {
      name: isPage ? 'Home' : 'Ticker',
      node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
      stateDefinitions: { count: { type: 'number', defaultValue: 0 } },
      ...(isPage ? { outputOptions: { pageId: 'page-1', fileName: 'index' } } : {}),
    },
    chunks: [jsxComponentChunk()],
    options: {
      workflows: { workflows: { [workflow.id]: workflow }, customNodes },
      globalStateDefinitions,
    },
    dependencies: {},
  }
  await plugin(structure)
  const componentChunk = structure.chunks.find((c: any) => c.name === 'jsx-component')
  const moduleChunk = structure.chunks.find((c: any) => c.name === 'workflow-module')
  return {
    component: generate(componentChunk.content).code,
    module: moduleChunk ? String(moduleChunk.content) : '',
    dependencies: structure.dependencies,
  }
}

const HOOK =
  /const \{\s*tickerTimerEnabled,\s*setTickerTimerEnabled,\s*refreshGlobalState\s*\} = useGlobalState\(\)/
const VALUE_IN_REF =
  /__wfStateRef\.current = \{\s*count: count,\s*tickerTimerEnabled: tickerTimerEnabled\s*\}/

const expectGlobalStateWired = (file: Generated) => {
  expect(file.dependencies.useGlobalState).toEqual({
    type: 'local',
    path: '@/global-state-context',
    meta: { namedImport: true },
  })
  expect(file.component).toMatch(HOOK)
  // Assigned on every render, after the hook: a change of the global value
  // re-renders the file, and the next run reads the new value.
  expect(file.component).toMatch(VALUE_IN_REF)
  expect(file.component.indexOf('useGlobalState()')).toBeLessThan(
    file.component.indexOf('__wfStateRef.current =')
  )
  // The runtime is told the state's type, and each run starts from the ref.
  expect(file.component).toMatch(/tickerTimerEnabled: "boolean"/)
  expect(file.module).toContain(
    'triggerContext.__stateValues = Object.assign({}, stateValuesRef.current);'
  )
}

const expectNoGlobalStateWiring = (file: Generated) => {
  expect(file.dependencies.useGlobalState).toBeUndefined()
  expect(file.component).not.toContain('useGlobalState')
  expect(file.component).not.toContain('tickerTimerEnabled')
  expect(file.component).toMatch(/__wfStateRef\.current = \{\s*count: count\s*\}/)
}

const READ_SWITCH = node('read-switch', 'state-get-global-state', {
  property: 'tickerTimerEnabled',
})

describe('a file whose workflows only read a global state', () => {
  it('a component gets the import, the hook, and the value in its state ref', async () => {
    const file = await generateFile({
      workflow: timerWorkflow([READ_SWITCH, UPDATE_COUNT]),
      isPage: false,
    })

    expectGlobalStateWired(file)
  })

  it('a page gets the same', async () => {
    const file = await generateFile({
      workflow: timerWorkflow([READ_SWITCH, UPDATE_COUNT], {
        scope: 'page',
        config: { pageId: 'page-1' },
      }),
      isPage: true,
    })

    expectGlobalStateWired(file)
  })

  it('counts a read made inside a custom node the workflow calls', async () => {
    const file = await generateFile({
      workflow: timerWorkflow([
        node('call', 'general-custom-node', { customNodeId: 'shared-check' }),
        UPDATE_COUNT,
      ]),
      isPage: false,
      customNodes: { 'shared-check': { id: 'shared-check', nodes: [READ_SWITCH], edges: [] } },
    })

    expectGlobalStateWired(file)
  })

  it.each([
    ['a {{state.<name>}} token', { value: '{{state.tickerTimerEnabled}}' }],
    [
      'a context reference into the state values',
      {
        value: {
          type: 'workflowContext',
          nodeId: 'tick',
          path: ['tick', '__stateValues', 'tickerTimerEnabled'],
        },
      },
    ],
    [
      'an expression over the state values',
      { expression: 'context.__stateValues.tickerTimerEnabled === true' },
    ],
  ])('counts a read written as %s', async (_form, config) => {
    const file = await generateFile({
      workflow: timerWorkflow([node('gate', 'general-if-statement', config), UPDATE_COUNT]),
      isPage: false,
    })

    expectGlobalStateWired(file)
  })
})

describe('a file that uses no global state is generated as before', () => {
  it('a workflow on local state only gets no hook, in a project that has global states', async () => {
    const file = await generateFile({ workflow: timerWorkflow([UPDATE_COUNT]), isPage: false })

    expectNoGlobalStateWiring(file)
  })

  it.each([
    ['a token naming a local state', { value: '{{state.count}}' }],
    ['an expression over the state values naming none', { expression: '__stateValues.count > 3' }],
    [
      'a name that merely contains a global state name',
      { expression: '__stateValues.tickerTimerEnabledLabel' },
    ],
  ])('%s gets no hook', async (_form, config) => {
    const file = await generateFile({
      workflow: timerWorkflow([node('gate', 'general-if-statement', config), UPDATE_COUNT]),
      isPage: false,
    })

    expectNoGlobalStateWiring(file)
  })

  it('a read node in a project that declares no global state adds nothing', async () => {
    const file = await generateFile({
      workflow: timerWorkflow([READ_SWITCH, UPDATE_COUNT]),
      isPage: false,
      globalStateDefinitions: {},
    })

    expect(file.dependencies.useGlobalState).toBeUndefined()
    expect(file.component).not.toContain('useGlobalState')
  })
})

describe('the read node itself', () => {
  it('returns the value the state ref held when the run started', async () => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const handler = new Function(`return ${buildStateGetHandlerSource('state_get_global_state')}`)()
    const stateValuesRef = { current: { tickerTimerEnabled: true } }
    const context = { __stateValues: { ...stateValuesRef.current } }

    await expect(handler({ property: 'tickerTimerEnabled' }, context)).resolves.toEqual({
      value: true,
      key: 'tickerTimerEnabled',
    })
    await expect(handler({ property: 'tickerTimerEnabled' }, {})).resolves.toEqual({
      value: undefined,
      key: 'tickerTimerEnabled',
    })
  })
})
