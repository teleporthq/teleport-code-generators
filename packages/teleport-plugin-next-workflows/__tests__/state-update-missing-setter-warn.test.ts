// `__stateUpdateHandler` observability guard: writing to a state property the
// current page/component does NOT own must console.warn (and still resolve)
// instead of silently no-oping. The silent no-op masked the original
// "Auto-open Navigation Sidebar Group" bug for weeks: the workflow ran on
// every page, found no `sidebarGroupOpen` setter, and did nothing without a
// trace. Harness mirrors state-update-default-value.test.ts.

import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'

const extractFunctionSource = (haystack: string, funcDecl: string): string => {
  const startIdx = haystack.indexOf(funcDecl)
  if (startIdx === -1) {
    throw new Error('Helper not found: ' + funcDecl)
  }
  return braceMatchFrom(haystack, startIdx)
}

const braceMatchFrom = (haystack: string, startIdx: number): string => {
  let depth = 0
  let i = haystack.indexOf('{', startIdx)
  if (i === -1) {
    throw new Error('No opening brace from index ' + startIdx)
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
  throw new Error('Unbalanced braces from index ' + startIdx)
}

const buildStructure = (): any => ({
  uidl: {
    name: 'Page',
    outputOptions: { pageId: 'page-1', fileName: 'page-1' },
    node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
    stateDefinitions: { known: { type: 'string', defaultValue: '' } },
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
    workflows: {
      workflows: {
        'wf-1': {
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
              config: { property: 'known', value: 'x' },
              stepNumber: 1,
              label: 'X',
            },
          ],
          edges: [{ id: 'e', source: 'trigger-1', target: 'update-1' }],
        },
      },
      customNodes: {},
    },
  },
  dependencies: {},
})

type HandlerFn = (config: any, context: any) => Promise<any>

const buildUpdateHandler = async (
  stateTypes: Record<string, string>
): Promise<{ update: HandlerFn; writes: Record<string, unknown> }> => {
  const plugin = createNextWorkflowPlugin({ isPage: true })
  const structure = buildStructure()
  await plugin(structure as any)
  const moduleChunk = (structure.chunks as any[]).find((c: any) => c.name === 'workflow-module')
  if (!moduleChunk) {
    throw new Error('workflow-module chunk not emitted by plugin')
  }
  const moduleCode = String(moduleChunk.content)

  const coerceSrc = extractFunctionSource(moduleCode, 'function __coerceValue')
  const defaultSrc = extractFunctionSource(moduleCode, 'function __defaultValueForType')
  const updateSrc = extractFunctionSource(moduleCode, 'function __stateUpdateHandler')

  const writes: Record<string, unknown> = {}
  const stateSetters: Record<string, (v: unknown) => void> = {}
  for (const key of Object.keys(stateTypes)) {
    stateSetters[key] = (v: unknown) => {
      writes[key] = v
    }
  }
  const stateValuesRef = { current: {} as Record<string, unknown> }

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    'stateSetters',
    'stateTypes',
    'stateValuesRef',
    `
    var __stateNameMap = {};
    Object.keys(stateSetters).forEach(function(k) { __stateNameMap[k] = k; });
    function __resolveName(name) { return __stateNameMap[name] || name; }
    ${coerceSrc}
    ${defaultSrc}
    ${updateSrc}
    return __stateUpdateHandler;
    `
  )
  const update = factory(stateSetters, stateTypes, stateValuesRef) as HandlerFn
  return { update, writes }
}

describe('state-update with a missing setter', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('warns and still resolves for a plain-value update', async () => {
    const { update, writes } = await buildUpdateHandler({ known: 'string' })
    const result = await update({ property: 'unknownProp', value: 'x' }, { __stateValues: {} })
    expect(result.success).toBe(true)
    expect(writes.unknownProp).toBeUndefined()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0][0])).toContain('unknownProp')
    expect(String(warnSpy.mock.calls[0][0])).toContain('known')
  })

  it('warns and still resolves for an object property-mode update', async () => {
    const { update } = await buildUpdateHandler({ known: 'string' })
    const result = await update(
      { property: 'unknownObj', objectUpdateMode: 'property', objectPropertyPath: 'a', value: 1 },
      { __stateValues: {} }
    )
    expect(result.success).toBe(true)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0][0])).toContain('unknownObj')
  })

  it('does NOT warn when the setter exists', async () => {
    const { update, writes } = await buildUpdateHandler({ known: 'string' })
    await update({ property: 'known', value: 'hello' }, { __stateValues: {} })
    expect(writes.known).toBe('hello')
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
