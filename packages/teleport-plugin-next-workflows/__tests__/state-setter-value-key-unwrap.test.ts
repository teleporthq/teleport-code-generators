// Regression guard for "Objects are not valid as a React child
// (found: object with keys {value, key})" — surfaced on
// `pages/gift-basket-builder.js` when a `state-batch-update` (or
// any state-setter handler) received the raw output of a
// `state-get-local-state` node instead of its `.value` field.
// The runtime forwarded that wrapper object verbatim to setState
// and React then tried to render the object as a child.
//
// `__coerceValue` lives inside the page-level
// `__createWorkflowHandlers` factory emitted by the workflow
// component plugin. We can't import it directly, but the helper
// is a pure stringify of an inline function — pull the source out
// of the generated module-level code by name and reconstitute it
// in a sandbox. That way, when the AI-wiring problem reappears
// after a regeneration, this test catches the regression before
// the user does.

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

// Build a minimal page UIDL that triggers the workflow plugin and
// emits the page-level workflow scaffolding (so __coerceValue
// appears in the chunk content).
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

// Build the emitted module code via the plugin and grab the
// __coerceValue source from it. Then run our assertions against
// the live function so changes to the implementation are caught.
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
  // The function closes over `stateTypes`; bind a fake one in the
  // sandbox that mirrors the test's expected types.
  const stateTypes = { myStr: 'string', myObj: 'object' }
  const factory = new Function('stateTypes', fnSource + '\nreturn __coerceValue;')
  return factory(stateTypes)
}

describe('__coerceValue: state-get-local-state output unwrap', () => {
  it('unwraps a {value, key} wrapper for non-object state types', async () => {
    // The canonical bug: setState('myStr', { value: 'hello', key: 'myStr' })
    // — without the unwrap, React would render the wrapper object.
    const coerce = await buildCoerceFn()
    expect(coerce({ value: 'hello', key: 'myStr' }, 'myStr')).toBe('hello')
  })

  it('preserves the wrapper when the target state is declared as object', async () => {
    // A state genuinely typed as `object` may legitimately carry
    // a {value, key} payload (e.g. a generic key/value record
    // editor). Don't unwrap in that case — that would silently
    // lose the user's data.
    const coerce = await buildCoerceFn()
    const payload = { value: 'hello', key: 'myObj' }
    expect(coerce(payload, 'myObj')).toEqual(payload)
  })

  it('leaves primitives untouched', async () => {
    const coerce = await buildCoerceFn()
    expect(coerce('plain string', 'myStr')).toBe('plain string')
    expect(coerce(42, 'myStr')).toBe(42)
    expect(coerce(null, 'myStr')).toBe(null)
    expect(coerce(undefined, 'myStr')).toBe(undefined)
  })

  it('leaves objects that do not match the {value, key} shape alone', async () => {
    // Extra keys disqualify the unwrap — a real domain object
    // that happens to have `value` and `key` plus more must not
    // be silently truncated to `.value`.
    const coerce = await buildCoerceFn()
    const richObj = { value: 'v', key: 'k', extra: 'do not drop me' }
    expect(coerce(richObj, 'myStr')).toEqual(richObj)
  })

  it('leaves arrays alone', async () => {
    // Arrays in JS have `typeof === "object"` but they are
    // legitimately renderable by React; the unwrap branch is
    // gated on !Array.isArray to keep array setState calls
    // working as-is.
    const coerce = await buildCoerceFn()
    const arr = [1, 2, 3]
    expect(coerce(arr, 'myStr')).toBe(arr)
  })
})
