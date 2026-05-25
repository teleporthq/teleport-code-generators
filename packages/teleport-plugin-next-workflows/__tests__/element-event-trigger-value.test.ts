import { formControlPropertyReads } from '../src/trigger-generator'

// Regression guard for the "SELECT onChange fires but the workflow's
// `Trigger.value` resolver returns undefined" bug.
//
// The `event-element-event` trigger (used by every JSX onChange/onInput/
// onBlur etc. that the GUI lets the user wire to a workflow) builds a
// `triggerContext` object literal. The workflow executor's
// `resolveContextRef` resolves `Trigger.value` by reading
// `triggerContext.value` — without an entry for `value` (and `checked` for
// checkboxes/radios, `files` for file inputs), every `state-update-local-
// state` node wired to "Trigger.value" silently sets state to `undefined`
// and the dropdown/checkbox/file picker becomes a no-op.
//
// This file pins the contract: the generator must emit `value`, `checked`,
// `files` reads keyed to the right element-reference variable.
describe('formControlPropertyReads', () => {
  it('emits value/checked/files reads keyed off the given element reference', () => {
    // `__te` is the convention inside the JSX-on-* matched-element
    // handlers (event.currentTarget || event.target).
    const snippet = formControlPropertyReads('__te')

    expect(snippet).toContain('value: __te.value')
    expect(snippet).toContain('checked: __te.checked')
    expect(snippet).toContain('files: __te.files')
  })

  it('supports `event.target` for the document-listener fallback path', () => {
    // The fallback handler attached via `addEventListener('change', ...)`
    // uses `event.target` directly rather than the `__te` alias.
    const snippet = formControlPropertyReads('event.target')

    expect(snippet).toContain('value: event.target.value')
    expect(snippet).toContain('checked: event.target.checked')
    expect(snippet).toContain('files: event.target.files')
  })

  it('produces a snippet that drops cleanly into an object literal', () => {
    const snippet = formControlPropertyReads('__te')
    // Compose it into a literal the same way the trigger generators do —
    // the trailing/leading commas and whitespace must allow inlining
    // without producing invalid JS.
    const literal = `{ elementId: 'x', ${snippet} }`

    // Round-trip via Function to make sure the literal parses. We
    // stub `__te` with a fake element so the reads don't throw.
    const fn = new Function('__te', `return ${literal}`)
    const result = fn({ value: 'rings', checked: false, files: null })

    expect(result.value).toBe('rings')
    expect(result.checked).toBe(false)
    expect(result.files).toBe(null)
  })
})
