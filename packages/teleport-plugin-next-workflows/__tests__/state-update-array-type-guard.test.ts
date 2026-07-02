// Regression guard for the poisoned-array-state family (run 47cf1df1,
// "Failed to add variant row"): a workflow ref resolving to a custom-js
// node's WHOLE return object ({ result: [...] }) was written verbatim
// into an ARRAY state (draftVariants). The mapper rendered zero rows and
// the next add-row workflow crashed spreading a non-iterable object.
//
// `__coerceValue` (inside the page-level `__createWorkflowHandlers`
// factory the workflow component plugin emits) now type-guards array
// states: a non-array write logs console.warn, unwraps an object with a
// single array-valued property, and otherwise falls back to []. Same
// extraction technique as state-setter-value-key-unwrap.test.ts.

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
  const triggerNodeId = 'trigger-1'
  const stateUpdateNodeId = 'update-1'
  const workflow = {
    id: 'wf-1',
    name: 'Test WF',
    trigger: {
      type: 'event-page-loaded',
      nodeId: triggerNodeId,
      scope: 'page',
      config: { pageId: 'page-1' },
    },
    nodes: [
      {
        id: stateUpdateNodeId,
        type: 'state-update-local-state',
        config: { property: 'myArr', value: [] },
        stepNumber: 1,
        label: 'X',
      },
    ],
    edges: [{ id: 'e', source: triggerNodeId, target: stateUpdateNodeId }],
  }
  return {
    uidl: {
      name: 'Page',
      outputOptions: { pageId: 'page-1', fileName: 'page-1' },
      node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
      stateDefinitions: {
        myArr: { type: 'array', defaultValue: [] },
        myStr: { type: 'string', defaultValue: '' },
        myObj: { type: 'object', defaultValue: {} },
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
    options: {
      workflows: { workflows: { 'wf-1': workflow }, customNodes: {} },
    },
    dependencies: {},
  }
}

const buildCoerceFn = async (): Promise<(v: unknown, property: string) => unknown> => {
  const plugin = createNextWorkflowPlugin({ isPage: true })
  const structure = buildStructure()
  await plugin(structure as any)
  const moduleChunk = (structure.chunks as any[]).find((c: any) => c.name === 'workflow-module')
  if (!moduleChunk) {
    throw new Error('workflow-module chunk not emitted by plugin')
  }
  const moduleCode = String(moduleChunk.content)
  const fnSource = extractFunctionSource(moduleCode, 'function __coerceValue')
  const stateTypes = { myArr: 'array', myStr: 'string', myObj: 'object' }
  const factory = new Function('stateTypes', fnSource + '\nreturn __coerceValue;')
  return factory(stateTypes)
}

describe('__coerceValue: array state type-guard', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('unwraps an object with a single array-valued property and warns', async () => {
    // The canonical poison: the whole { result: [...] } custom-js return
    // instead of its .result ref.
    const coerce = await buildCoerceFn()
    expect(coerce({ result: [1, 2, 3] }, 'myArr')).toEqual([1, 2, 3])
    expect(warnSpy).toHaveBeenCalled()
  })

  it('falls back to [] for objects that are not a single-array wrapper', async () => {
    const coerce = await buildCoerceFn()
    expect(coerce({ a: [1], b: [2] }, 'myArr')).toEqual([])
    expect(coerce({ a: 'not-an-array' }, 'myArr')).toEqual([])
  })

  it('falls back to [] for primitives and null', async () => {
    const coerce = await buildCoerceFn()
    expect(coerce('oops', 'myArr')).toEqual([])
    expect(coerce(42, 'myArr')).toEqual([])
    expect(coerce(null, 'myArr')).toEqual([])
    expect(warnSpy).toHaveBeenCalledTimes(3)
  })

  it('passes real arrays through untouched, without warning', async () => {
    const coerce = await buildCoerceFn()
    const arr = [{ sku: 'A' }]
    expect(coerce(arr, 'myArr')).toBe(arr)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('still unwraps a {value, key} state-get wrapper carrying an array', async () => {
    // The pre-existing unwrap runs first; its array payload must then
    // pass the array guard without being coerced away.
    const coerce = await buildCoerceFn()
    const arr = [1, 2]
    expect(coerce({ value: arr, key: 'myArr' }, 'myArr')).toBe(arr)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('does not touch non-array states', async () => {
    const coerce = await buildCoerceFn()
    const richObj = { a: 1, b: 2 }
    expect(coerce(richObj, 'myObj')).toBe(richObj)
    expect(coerce('plain', 'myStr')).toBe('plain')
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
