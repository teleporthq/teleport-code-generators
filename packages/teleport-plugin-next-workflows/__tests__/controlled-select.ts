import { parse } from '@babel/parser'
import * as types from '@babel/types'
import { UIDLWorkflow } from '@teleporthq/teleport-types'
import {
  collectWrittenStateProperties,
  readBoundStateName,
  restoreControlledSelectValue,
} from '../src/controlled-select'

/**
 * A `<select>` whose only change handler comes from a workflow was shipping as
 * UNCONTROLLED (`defaultValue`), because the pass that demotes handler-less form
 * controls runs while the JSX is generated and workflow triggers are attached
 * afterwards. `defaultValue` is read once at mount, so state established after
 * hydration never reached the DOM: `/products?sortBy=price-asc` sorted the
 * products correctly under a dropdown still reading "Name (A-Z)".
 *
 * The restore is deliberately narrow, and most of what follows pins what it
 * refuses to touch — a control made controlled without its handler writing the
 * bound state is FROZEN, which is a worse defect than the stale label.
 */

const openingElementOf = (source: string): types.JSXOpeningElement => {
  const file = parse(`const x = ${source}`, { sourceType: 'module', plugins: ['jsx'] })
  let found: types.JSXOpeningElement | null = null
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if ((node as types.Node).type === 'JSXOpeningElement' && !found) {
      found = node as types.JSXOpeningElement
      return
    }
    for (const value of Object.values(node as Record<string, unknown>)) {
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') walk(value)
    }
  }
  walk(file.program)
  if (!found) throw new Error('no JSX opening element in: ' + source)
  return found
}

const attrNames = (element: types.JSXOpeningElement): string[] =>
  element.attributes
    .filter((attr): attr is types.JSXAttribute => types.isJSXAttribute(attr))
    .map((attr) => (types.isJSXIdentifier(attr.name) ? attr.name.name : ''))

const workflowWriting = (...properties: string[]): UIDLWorkflow =>
  ({
    id: 'wf',
    name: 'Sort changed',
    trigger: { type: 'event-element-event', config: {} },
    nodes: properties.map((property, index) => ({
      id: `n${index}`,
      type: 'state-update-local-state',
      config: { property },
    })),
    edges: [],
    usedInNodes: {},
  } as unknown as UIDLWorkflow)

const SORT_SELECT = `<select defaultValue={sortBy} onChange={__wfRef.current.elementTriggers['a']['onChange']} />`

describe('collectWrittenStateProperties', () => {
  it('reads a local and a global state write', () => {
    const workflow = {
      nodes: [
        { id: '1', type: 'state-update-local-state', config: { property: 'sortBy' } },
        { id: '2', type: 'state-update-global-state', config: { property: 'cartCount' } },
      ],
    } as unknown as UIDLWorkflow
    expect(collectWrittenStateProperties(workflow)).toEqual(new Set(['sortBy', 'cartCount']))
  })

  it('reads a batch update, whose targets live under `updates[].key`', () => {
    const workflow = {
      nodes: [
        {
          id: '1',
          type: 'state-batch-update',
          config: { updates: [{ key: 'sortBy' }, { key: 'page' }] },
        },
      ],
    } as unknown as UIDLWorkflow
    expect(collectWrittenStateProperties(workflow)).toEqual(new Set(['sortBy', 'page']))
  })

  it('ignores nodes that do not write state, and survives a malformed graph', () => {
    expect(
      collectWrittenStateProperties({
        nodes: [
          { id: '1', type: 'general-if-statement', config: { property: 'sortBy' } },
          { id: '2', type: 'state-update-local-state', config: {} },
          null,
        ],
      } as unknown as UIDLWorkflow)
    ).toEqual(new Set())
    expect(collectWrittenStateProperties({} as UIDLWorkflow)).toEqual(new Set())
  })
})

describe('readBoundStateName', () => {
  it('reads a bare identifier', () => {
    const element = openingElementOf('<select defaultValue={sortBy} />')
    expect(readBoundStateName(element.attributes[0] as types.JSXAttribute)).toBe('sortBy')
  })

  it('refuses a member expression — an entity field has no state behind it', () => {
    const element = openingElementOf('<select defaultValue={props.item?.category} />')
    expect(readBoundStateName(element.attributes[0] as types.JSXAttribute)).toBeNull()
  })

  it('refuses a string literal', () => {
    const element = openingElementOf('<select defaultValue="name-asc" />')
    expect(readBoundStateName(element.attributes[0] as types.JSXAttribute)).toBeNull()
  })
})

describe('restoreControlledSelectValue', () => {
  it('controls a select whose workflow writes the state it is bound to', () => {
    const element = openingElementOf(SORT_SELECT)
    restoreControlledSelectValue(element, [workflowWriting('sortBy')])
    expect(attrNames(element)).toEqual(['value', 'onChange'])
  })

  it('keeps the binding expression untouched when it renames the prop', () => {
    const element = openingElementOf(SORT_SELECT)
    restoreControlledSelectValue(element, [workflowWriting('sortBy')])
    const value = element.attributes[0] as types.JSXAttribute
    expect(types.isJSXExpressionContainer(value.value)).toBe(true)
    expect(readBoundStateName(value)).toBe('sortBy')
  })

  it('is idempotent', () => {
    const element = openingElementOf(SORT_SELECT)
    restoreControlledSelectValue(element, [workflowWriting('sortBy')])
    restoreControlledSelectValue(element, [workflowWriting('sortBy')])
    expect(attrNames(element)).toEqual(['value', 'onChange'])
  })

  it('matches across several workflows on the same onChange', () => {
    const element = openingElementOf(SORT_SELECT)
    restoreControlledSelectValue(element, [workflowWriting('unrelated'), workflowWriting('sortBy')])
    expect(attrNames(element)).toContain('value')
  })
})

describe('restoreControlledSelectValue — what it refuses to touch', () => {
  it('leaves a text input uncontrolled even when its workflow writes the state', () => {
    // An input accumulates one keystroke at a time and needs a SYNCHRONOUS
    // write-back per keystroke; a workflow is async, and a controlled input
    // whose state lags drops characters and jumps the caret.
    const element = openingElementOf(
      `<input type="text" defaultValue={chatInputValue} onChange={h} />`
    )
    restoreControlledSelectValue(element, [workflowWriting('chatInputValue')])
    expect(attrNames(element)).toContain('defaultValue')
    expect(attrNames(element)).not.toContain('value')
  })

  it('leaves a textarea uncontrolled', () => {
    const element = openingElementOf(`<textarea defaultValue={draft} onChange={h} />`)
    restoreControlledSelectValue(element, [workflowWriting('draft')])
    expect(attrNames(element)).toContain('defaultValue')
  })

  it('leaves a checkbox alone — a toggle that bounces back reads as broken', () => {
    const element = openingElementOf(
      `<input type="checkbox" defaultChecked={agreed} onChange={h} />`
    )
    restoreControlledSelectValue(element, [workflowWriting('agreed')])
    expect(attrNames(element)).toEqual(['type', 'defaultChecked', 'onChange'])
  })

  it('leaves a select whose workflow writes some OTHER state uncontrolled', () => {
    // Controlling it would freeze the dropdown: nothing would ever move the
    // bound state, so every selection would snap back.
    const element = openingElementOf(SORT_SELECT)
    restoreControlledSelectValue(element, [workflowWriting('somethingElse')])
    expect(attrNames(element)).toEqual(['defaultValue', 'onChange'])
  })

  it('leaves a select bound to an entity field uncontrolled', () => {
    const element = openingElementOf(`<select defaultValue={props.item?.category} onChange={h} />`)
    restoreControlledSelectValue(element, [workflowWriting('category')])
    expect(attrNames(element)).toEqual(['defaultValue', 'onChange'])
  })

  it('leaves a select with no change handler uncontrolled', () => {
    // This is the case the demotion exists for: React freezes a controlled
    // control that has no way to change.
    const element = openingElementOf(`<select defaultValue={sortBy} />`)
    restoreControlledSelectValue(element, [workflowWriting('sortBy')])
    expect(attrNames(element)).toEqual(['defaultValue'])
  })

  it('leaves a select with no workflows on its onChange uncontrolled', () => {
    const element = openingElementOf(SORT_SELECT)
    restoreControlledSelectValue(element, [])
    expect(attrNames(element)).toEqual(['defaultValue', 'onChange'])
  })

  it('leaves a capitalised <Select> component alone', () => {
    const element = openingElementOf(`<Select defaultValue={sortBy} onChange={h} />`)
    restoreControlledSelectValue(element, [workflowWriting('sortBy')])
    expect(attrNames(element)).toEqual(['defaultValue', 'onChange'])
  })

  it('drops a stale defaultValue rather than shipping both props', () => {
    // React warns about a control carrying `value` and `defaultValue` together
    // and resolves it unpredictably.
    const element = openingElementOf(`<select value={sortBy} defaultValue={sortBy} onChange={h} />`)
    restoreControlledSelectValue(element, [workflowWriting('sortBy')])
    expect(attrNames(element)).toEqual(['value', 'onChange'])
  })
})
