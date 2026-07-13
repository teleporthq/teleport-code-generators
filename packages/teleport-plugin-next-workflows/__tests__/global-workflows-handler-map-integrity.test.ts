import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'

/**
 * Regression: `generateGlobalWorkflowsHook` must never emit a `clientNodeHandlers`
 * map entry that references a handler function it did not also define.
 *
 * Bug: `handlers` (the function definitions) was gated on `if (nodeRegistry[t])`,
 * while `handlerEntries` (the map) mapped over EVERY collected client node type.
 * A client-segment node whose type has no registry generator — e.g. a
 * `general-comment`, or an `event-*` trigger node that got collected into the
 * type set — therefore produced a map value `'general-comment': general_comment`
 * with no `general_comment` defined anywhere in the file. That is a bare
 * reference to an undefined identifier; it throws `ReferenceError: general_comment
 * is not defined` when the module/hook is evaluated in production, crashing the
 * Vercel build (global-workflows.js is pulled into the global client bundle for
 * every page via `useGlobalWorkflows()`). The two lists must stay paired.
 */

// A GLOBAL workflow (custom-triggered) whose client segment mixes a REGISTERED
// handler node (`state-update-local-state`) with an UNREGISTERED node type
// (`general-comment`, which has no entry in `nodeRegistry`). `general-comment`
// resolves to a client segment by default, so it lands in the handler type set.
const globalWorkflowWithUnregisteredNode = {
  id: 'global-wf-unregistered',
  trigger: { type: 'event-custom-triggered', config: { eventName: 'store-locations-loaded' } },
  nodes: [
    {
      id: 'node-registered',
      type: 'state-update-local-state',
      config: { property: 'selectedPickupStore', value: '' },
      stepNumber: 1,
    },
    {
      id: 'node-unregistered',
      type: 'general-comment',
      config: { text: 'a designer note that must not become a handler' },
      stepNumber: 2,
    },
  ],
  edges: [{ id: 'edge-1', source: 'node-registered', target: 'node-unregistered' }],
}

function generateHook(): string {
  const plugin = new NextWorkflowProjectPlugin()
  // generateGlobalWorkflowsHook is private; call it directly for a unit test.
  return (plugin as any).generateGlobalWorkflowsHook([globalWorkflowWithUnregisteredNode])
}

describe('generateGlobalWorkflowsHook — clientNodeHandlers map integrity', () => {
  const code = generateHook()

  it('defines a function for every identifier referenced in the handler map', () => {
    // Match handler-map entries of the shape `'node-type': node_type` (the value
    // identifier is the key with hyphens turned to underscores).
    const entry = /['"]([a-z0-9]+(?:-[a-z0-9]+)+)['"]\s*:\s*([a-z0-9]+(?:_[a-z0-9]+)+)\b/g
    const dangling: string[] = []
    let m: RegExpExecArray | null = entry.exec(code)
    while (m !== null) {
      const [, key, ident] = m
      if (key.replace(/-/g, '_') !== ident) {
        m = entry.exec(code)
        continue // not a handler-map entry
      }
      const isDefined = new RegExp(
        `(?:async\\s+function|function|const|let|var)\\s+${ident}\\b`
      ).test(code)
      if (!isDefined) {
        dangling.push(ident)
      }
      m = entry.exec(code)
    }
    expect(dangling).toEqual([])
  })

  it('keeps the registered handler in the map, isolated in its own IIFE', () => {
    // Each map entry is an IIFE that declares AND returns its own handler,
    // rather than a bare reference to a handler declared elsewhere in the
    // shared useGlobalWorkflows() body. Two DIFFERENT node types are
    // minified independently by a consumer's own build (e.g. teleport-gui's
    // browser packer worker), so their real declared names can
    // coincidentally collide post-minification even though they never do
    // pre-minification — declared as bare siblings in one shared scope, the
    // second declaration would silently shadow the first, so two unrelated
    // node types could end up executing the SAME (wrong-for-one-of-them)
    // handler. An IIFE per entry gives every handler its own scope, so a
    // same-named collision between two unrelated handlers can never shadow
    // each other.
    expect(code).toContain("'state-update-local-state': (function () {")
    expect(code).toMatch(/(?:async\s+)?function state_update_local_state\s*\(/)
    expect(code).toMatch(/return state_update_local_state;\s*\}\)\(\)/)
  })

  it('omits an unregistered node type (general-comment) entirely — no dangling reference', () => {
    // Neither a definition nor a map entry for the unregistered type may appear.
    expect(code).not.toContain('general_comment')
    expect(code).not.toContain("'general-comment'")
  })
})
