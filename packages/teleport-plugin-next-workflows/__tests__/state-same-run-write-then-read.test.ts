// A workflow that WRITES a state key and then READS it back in the same run
// used to get the value from before the write.
//
// `state-update-local-state` calls the React setter, which only schedules a
// render, and `state-get-local-state` deliberately reads `stateValuesRef`
// (the "latest committed" values) rather than the trigger-time snapshot. The
// ref is rebuilt from state on render, so between the write and the next
// render it still held the old value.
//
// The chat's option chips are exactly this sequence — write the chip's text
// into the input state, then invoke the node that reads it back — so clicking
// a chip re-sent the previous message, and the assistant answered the question
// before the one the visitor had just chosen.

import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'

const extractFunctionSource = (haystack: string, funcDecl: string): string => {
  const startIdx = haystack.indexOf(funcDecl)
  if (startIdx === -1) {
    throw new Error('Helper not found: ' + funcDecl)
  }
  let depth = 0
  let i = haystack.indexOf('{', startIdx)
  if (i === -1) {
    throw new Error('No opening brace after ' + funcDecl)
  }
  for (; i < haystack.length; i++) {
    const ch = haystack.charAt(i)
    if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        return haystack.slice(startIdx, i + 1)
      }
    }
  }
  throw new Error('Unbalanced braces for ' + funcDecl)
}

const buildStructure = (): any => {
  const workflow = {
    id: 'wf-1',
    name: 'Test WF',
    trigger: {
      type: 'event-page-loaded',
      nodeId: 'trigger-1',
      scope: 'page',
      config: { pageId: 'page-1' },
    },
    nodes: [
      {
        id: 'update-1',
        type: 'state-update-local-state',
        config: { property: 'chatInputValue', value: 'x' },
        stepNumber: 1,
        label: 'X',
      },
    ],
    edges: [{ id: 'e', source: 'trigger-1', target: 'update-1' }],
  }
  return {
    uidl: {
      name: 'Page',
      outputOptions: { pageId: 'page-1', fileName: 'page-1' },
      node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
      stateDefinitions: {
        chatInputValue: { type: 'string', defaultValue: '' },
        draft: { type: 'object', defaultValue: {} },
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
    options: { workflows: { workflows: { 'wf-1': workflow }, customNodes: {} } },
    dependencies: {},
  }
}

interface Harness {
  update: (config: Record<string, unknown>, context: unknown) => Promise<unknown>
  batchUpdate: (config: Record<string, unknown>, context: unknown) => Promise<unknown>
  read: (config: Record<string, unknown>, context: unknown) => Promise<{ value: unknown }>
  /** What React has actually committed — only advances on "render". */
  committed: Record<string, unknown>
  render: () => void
}

/**
 * Instantiates the emitted `__createWorkflowHandlers` against a fake React:
 * setters record into `pending`, and the ref is only rebuilt from `pending`
 * when `render()` is called — the timing that made the bug possible.
 */
const buildHarness = async (): Promise<Harness> => {
  const plugin = createNextWorkflowPlugin({ isPage: true })
  const structure = buildStructure()
  await plugin(structure as any)
  const moduleChunk = (structure.chunks as any[]).find((c: any) => c.name === 'workflow-module')
  if (!moduleChunk) {
    throw new Error('workflow-module chunk not emitted by plugin')
  }
  const moduleCode = String(moduleChunk.content)

  // The factory returns only its trigger wiring, so capture the handler map
  // itself at the point it is built.
  const HANDLERS_DECL = 'const __handlers = Object.assign({}, workflowClientHandlers);'
  const factorySource = extractFunctionSource(moduleCode, 'function __createWorkflowHandlers')
  if (!factorySource.includes(HANDLERS_DECL)) {
    throw new Error('handler map declaration moved; update this test')
  }

  const source = [
    extractFunctionSource(moduleCode, 'function __resolveName'),
    extractFunctionSource(moduleCode, 'function __defaultValueForType'),
    extractFunctionSource(moduleCode, 'function __coerceValue'),
    factorySource.replace(HANDLERS_DECL, HANDLERS_DECL + '\n  __captureHandlers(__handlers);'),
    'return __createWorkflowHandlers;',
  ].join('\n')

  const stateTypes = { chatInputValue: 'string', draft: 'object' }
  const committed: Record<string, unknown> = { chatInputValue: '', draft: {} }
  const pending: Record<string, unknown> = { ...committed }
  const stateSetters: Record<string, (v: unknown) => void> = {
    chatInputValue: (v) => {
      pending.chatInputValue = v
    },
    draft: (v) => {
      pending.draft = v
    },
  }
  // Rebuilt from committed state on every render, exactly like the emitted
  // `__wfStateRef.current = { ... }` assignment.
  const stateValuesRef = { current: { ...committed } }

  let handlers: Record<string, (config: any, context: any) => Promise<any>> = {}
  // `__handlers` starts as a copy of the shared client handlers; the state
  // handlers under test are assigned over it, so an empty map is enough.
  const factory = new Function('stateTypes', 'workflowClientHandlers', '__captureHandlers', source)(
    stateTypes,
    {},
    (map: Record<string, any>) => {
      handlers = map
    }
  )
  factory(stateSetters, stateTypes, stateValuesRef)

  return {
    update: handlers['state-update-local-state'],
    batchUpdate: handlers['state-batch-update'],
    read: handlers['state-get-local-state'],
    committed,
    render: () => {
      Object.assign(committed, pending)
      stateValuesRef.current = { ...committed }
    },
  }
}

describe('state written and read back inside one workflow run', () => {
  it('reads the value the run just wrote, before React has re-rendered', async () => {
    const h = await buildHarness()
    const context = { __stateValues: { chatInputValue: 'the previous message' } }

    await h.update({ property: 'chatInputValue', value: 'the message just chosen' }, context)
    const result = await h.read({ property: 'chatInputValue' }, context)

    expect(result.value).toBe('the message just chosen')
  })

  it('still reads the written value after the render lands', async () => {
    const h = await buildHarness()
    const context = { __stateValues: { chatInputValue: '' } }

    await h.update({ property: 'chatInputValue', value: 'chosen' }, context)
    h.render()
    const result = await h.read({ property: 'chatInputValue' }, context)

    expect(result.value).toBe('chosen')
    // The setter really ran; the ref write is an early mirror of it, not a
    // substitute that would leave React holding something else.
    expect(h.committed.chatInputValue).toBe('chosen')
  })

  it('applies to a batch write too', async () => {
    const h = await buildHarness()
    const context = { __stateValues: {} }

    await h.batchUpdate({ updates: [{ key: 'chatInputValue', value: 'batched' }] }, context)
    const result = await h.read({ property: 'chatInputValue' }, context)

    expect(result.value).toBe('batched')
  })

  it('leaves a key the page does not own to the warning path', async () => {
    const h = await buildHarness()
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const context = { __stateValues: {} }

    await h.update({ property: 'notOnThisPage', value: 'nope' }, context)
    const result = await h.read({ property: 'notOnThisPage' }, context)

    // No setter means no state write, so the ref must not claim otherwise.
    expect(result.value).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
