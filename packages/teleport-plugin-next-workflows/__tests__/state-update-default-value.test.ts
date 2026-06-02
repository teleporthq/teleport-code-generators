// Regression guard for "state-update node wired without a value writes
// `undefined` into state". A node may legitimately be configured without an
// explicit value (e.g. the admin "Close Detail Panel" workflow clearing an id).
// The client runtime must then fall back to the state type's empty default —
// string -> '', array -> [], object -> {}, anything else -> null — so a setter
// never receives `undefined` (which flips a controlled input to uncontrolled).
//
// `__stateUpdateHandler` / `__defaultValueForType` / the `state-batch-update`
// handler all live inside the page-level `__createWorkflowHandlers` factory
// emitted by the workflow component plugin (and only the trigger surface is
// returned, not the handler map). We can't import them directly, so we pull the
// individual function sources out of the generated module-level code and
// reconstitute them in a sandbox with the closure variables they rely on (same
// approach as state-setter-value-key-unwrap.test.ts).

import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'

// Brace-match a `function NAME(...) { ... }` declaration out of generated code.
const extractFunctionSource = (haystack: string, funcDecl: string): string => {
  const startIdx = haystack.indexOf(funcDecl)
  if (startIdx === -1) {
    throw new Error('Helper not found: ' + funcDecl)
  }
  return braceMatchFrom(haystack, startIdx)
}

// Brace-match the `function(...) { ... }` expression assigned to a given LHS,
// e.g. `__handlers['state-batch-update'] = function(config, context) { ... }`.
const extractAssignedFunction = (haystack: string, lhs: string): string => {
  const lhsIdx = haystack.indexOf(lhs)
  if (lhsIdx === -1) {
    throw new Error('Assignment not found: ' + lhs)
  }
  const fnIdx = haystack.indexOf('function', lhsIdx)
  if (fnIdx === -1) {
    throw new Error('No function expression after ' + lhs)
  }
  return braceMatchFrom(haystack, fnIdx)
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
        config: { property: 'myStr', value: 'x' },
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

type HandlerFn = (config: any, context: any) => Promise<any>

interface Runtime {
  update: HandlerFn
  batch: HandlerFn
  defaultForType: (type: string | undefined) => unknown
  writes: Record<string, unknown>
  hasWrite: (prop: string) => boolean
}

let cachedModuleCode: string | null = null

const getModuleCode = async (): Promise<string> => {
  if (cachedModuleCode) {
    return cachedModuleCode
  }
  const plugin = createNextWorkflowPlugin({ isPage: true })
  const structure = buildStructure()
  await plugin(structure as any)
  const moduleChunk = (structure.chunks as any[]).find((c: any) => c.name === 'workflow-module')
  if (!moduleChunk) {
    throw new Error('workflow-module chunk not emitted by plugin')
  }
  cachedModuleCode = String(moduleChunk.content)
  return cachedModuleCode
}

// Reconstitute the state-update runtime (handler + helpers) in a sandbox,
// wiring spying setters so we can assert what value each update writes.
const buildRuntime = async (stateTypes: Record<string, string>): Promise<Runtime> => {
  const moduleCode = await getModuleCode()
  const coerceSrc = extractFunctionSource(moduleCode, 'function __coerceValue')
  const defaultSrc = extractFunctionSource(moduleCode, 'function __defaultValueForType')
  const updateSrc = extractFunctionSource(moduleCode, 'function __stateUpdateHandler')
  const batchSrc = extractAssignedFunction(moduleCode, "__handlers['state-batch-update']")

  const writes: Record<string, unknown> = {}
  const written = new Set<string>()
  const stateSetters: Record<string, (v: unknown) => void> = {}
  for (const key of Object.keys(stateTypes)) {
    stateSetters[key] = (v: unknown) => {
      writes[key] = v
      written.add(key)
    }
  }
  const stateValuesRef = { current: {} as Record<string, unknown> }

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    'stateSetters',
    'stateTypes',
    'stateValuesRef',
    'refreshGlobalState',
    `
    var __stateNameMap = {};
    var __setterKeys = Object.keys(stateSetters);
    for (var __i = 0; __i < __setterKeys.length; __i++) {
      __stateNameMap[__setterKeys[__i]] = __setterKeys[__i];
      var __snake = __setterKeys[__i].replace(/[A-Z]/g, function(l) { return '_' + l.toLowerCase(); });
      if (__snake !== __setterKeys[__i]) __stateNameMap[__snake] = __setterKeys[__i];
    }
    function __resolveName(name) { return __stateNameMap[name] || name; }
    ${coerceSrc}
    ${defaultSrc}
    ${updateSrc}
    var __batch = ${batchSrc};
    return { update: __stateUpdateHandler, batch: __batch, defaultForType: __defaultValueForType };
    `
  )
  const rt = factory(stateSetters, stateTypes, stateValuesRef, undefined)
  return {
    update: rt.update,
    batch: rt.batch,
    defaultForType: rt.defaultForType,
    writes,
    hasWrite: (prop: string) => written.has(prop),
  }
}

const STATE_TYPES = {
  myStr: 'string',
  myArr: 'array',
  myObj: 'object',
  myNum: 'number',
  myBool: 'boolean',
}

describe('__defaultValueForType mapping', () => {
  it('maps each state type to its empty default', async () => {
    const rt = await buildRuntime(STATE_TYPES)
    expect(rt.defaultForType('string')).toBe('')
    expect(rt.defaultForType('array')).toEqual([])
    expect(rt.defaultForType('object')).toEqual({})
    expect(rt.defaultForType('number')).toBeNull()
    expect(rt.defaultForType('boolean')).toBeNull()
    expect(rt.defaultForType(undefined)).toBeNull()
  })
})

describe('state-update without a value defaults by state type', () => {
  it("defaults a string state to ''", async () => {
    const rt = await buildRuntime(STATE_TYPES)
    await rt.update({ property: 'myStr' }, { __stateValues: {} })
    expect(rt.writes.myStr).toBe('')
  })

  it('defaults an array state to []', async () => {
    const rt = await buildRuntime(STATE_TYPES)
    await rt.update({ property: 'myArr' }, { __stateValues: {} })
    expect(rt.writes.myArr).toEqual([])
  })

  it('defaults an object state to {}', async () => {
    const rt = await buildRuntime(STATE_TYPES)
    await rt.update({ property: 'myObj' }, { __stateValues: {} })
    expect(rt.writes.myObj).toEqual({})
  })

  it('defaults number and boolean states to null', async () => {
    const rt = await buildRuntime(STATE_TYPES)
    await rt.update({ property: 'myNum' }, { __stateValues: {} })
    await rt.update({ property: 'myBool' }, { __stateValues: {} })
    expect(rt.writes.myNum).toBeNull()
    expect(rt.writes.myBool).toBeNull()
  })

  it('preserves an explicit null (a real value — only a missing value defaults)', async () => {
    // A dynamic binding can resolve to null at runtime; defaulting it (e.g.
    // object -> {}) would flip downstream truthiness checks. Only a statically
    // absent value (config.value === undefined) is treated as "not set".
    const rt = await buildRuntime(STATE_TYPES)
    await rt.update({ property: 'myStr', value: null }, { __stateValues: {} })
    expect(rt.writes.myStr).toBeNull()
  })

  it('preserves an explicit value (no defaulting)', async () => {
    const rt = await buildRuntime(STATE_TYPES)
    await rt.update({ property: 'myStr', value: 'hello' }, { __stateValues: {} })
    expect(rt.writes.myStr).toBe('hello')
  })

  it('defaults unset entries in a batch update too', async () => {
    const rt = await buildRuntime(STATE_TYPES)
    await rt.batch(
      {
        updates: [{ key: 'myStr' }, { key: 'myArr', value: undefined }, { key: 'myNum', value: 7 }],
      },
      { __stateValues: {} }
    )
    expect(rt.writes.myStr).toBe('')
    expect(rt.writes.myArr).toEqual([])
    expect(rt.writes.myNum).toBe(7)
  })

  it('does NOT default a property-mode update (sub-property stays undefined)', async () => {
    // Object property-mode updates set a single key; an unset value there means
    // "clear this property", not "replace the object with its type default".
    const rt = await buildRuntime(STATE_TYPES)
    await rt.update(
      { property: 'myObj', objectUpdateMode: 'property', objectPropertyPath: 'a' },
      { __stateValues: { myObj: { a: 1 } } }
    )
    expect(rt.writes.myObj).toEqual({ a: undefined })
  })
})
