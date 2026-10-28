// The native-listener form of an element trigger (`generateTriggerCode`), as the
// editor exports it for a navigation element the Instant search plugin adopted:
// a click on a linked control, and the submit of a search form, both with
// `preventDefault` + `stopPropagation`.
//
// `generateTriggerCode` has NO production caller: what a published site runs are
// the React props `workflow-component-plugin.ts` puts on the element, proven in
// `adopted-navigation-element-end2end.test.ts` (and, for a form whose submissions
// the platform stores, `adopted-search-form-submission-end2end.test.ts`) in the
// Next project generator. This file only pins the same contract on the exported
// function, for whoever wires it again: the listener is attached to the element
// found by its published html id (never the editor's internal node id), cancels
// the default action and the bubbling BEFORE the workflow runs, and does so only
// when the trigger asked.

import type { UIDLWorkflow } from '@teleporthq/teleport-types'
import { generateTriggerCode } from '../src/trigger-generator'

const HTML_ID = 'nav-search-link'
const INTERNAL_NODE_ID = 'TQ_internal_node_id'

const workflowWith = (
  type: 'event-element-clicked' | 'event-element-event',
  config: Record<string, unknown>
): UIDLWorkflow =>
  ({
    id: 'open-search',
    name: 'Open the search',
    trigger: {
      nodeId: 'open-search-trigger',
      type,
      scope: 'element',
      config: { nodeId: INTERNAL_NODE_ID, elementHtmlId: HTML_ID, ...config },
    },
    nodes: [],
    edges: [],
  } as unknown as UIDLWorkflow)

/**
 * Runs the generated statements against a fake document. Returns what the
 * browser would have seen: which ids were looked up, which events got a
 * listener, and the order of everything a dispatched event then did.
 */
const run = (workflow: UIDLWorkflow) => {
  const listeners: Record<string, (event: unknown) => void> = {}
  const lookups: string[] = []
  const calls: string[] = []

  const element = {
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners[type] = handler
    },
    removeEventListener: (): void => undefined,
  }
  const fakeDocument = {
    getElementById: (id: string) => {
      lookups.push(id)
      return id === HTML_ID ? element : null
    },
  }
  const runWorkflow = () => {
    calls.push('workflow')
  }

  const code = generateTriggerCode(workflow, 'runWorkflow')
  // The statements end in a `return` of the cleanup, as they do inside the
  // effect they are placed in.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const attach = new Function('document', 'window', 'runWorkflow', code)
  const cleanup = attach(fakeDocument, {}, runWorkflow)

  const dispatch = (type: string) => {
    const event = {
      preventDefault: () => calls.push('preventDefault'),
      stopPropagation: () => calls.push('stopPropagation'),
      target: {},
    }
    listeners[type](event)
  }
  return { code, listeners, lookups, calls, dispatch, cleanup }
}

describe('generateTriggerCode for an adopted navigation element', () => {
  it('looks the control up by its published html id, never the editor node id', () => {
    const { lookups, code } = run(
      workflowWith('event-element-clicked', { preventDefault: true, stopPropagation: true })
    )
    expect(lookups).toEqual([HTML_ID])
    expect(code).toContain(`document.getElementById('${HTML_ID}')`)
    expect(code).not.toContain(INTERNAL_NODE_ID)
  })

  it('cancels the link, stops the bubbling, then runs the workflow on a click', () => {
    const { listeners, calls, dispatch, cleanup } = run(
      workflowWith('event-element-clicked', { preventDefault: true, stopPropagation: true })
    )
    expect(Object.keys(listeners)).toEqual(['click'])

    dispatch('click')
    expect(calls).toEqual(['preventDefault', 'stopPropagation', 'workflow'])
    // And it unregisters with the effect.
    expect(typeof cleanup).toBe('function')
  })

  it('cancels the form submit, stops the bubbling, then runs the workflow on a submit', () => {
    const { listeners, calls, dispatch } = run(
      workflowWith('event-element-event', {
        eventType: 'submit',
        preventDefault: true,
        stopPropagation: true,
      })
    )
    expect(Object.keys(listeners)).toEqual(['submit'])

    dispatch('submit')
    expect(calls).toEqual(['preventDefault', 'stopPropagation', 'workflow'])
  })

  it('leaves the default action and the bubbling alone when the trigger did not ask', () => {
    const click = run(workflowWith('event-element-clicked', {}))
    click.dispatch('click')
    expect(click.calls).toEqual(['workflow'])

    const submit = run(workflowWith('event-element-event', { eventType: 'submit' }))
    submit.dispatch('submit')
    expect(submit.calls).toEqual(['workflow'])
  })
})
