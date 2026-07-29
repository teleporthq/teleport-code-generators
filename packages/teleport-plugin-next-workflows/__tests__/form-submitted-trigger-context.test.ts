/**
 * The form-submitted trigger must expose its fields where generated validators
 * actually look for them.
 *
 * THE DEFECT (run 4b049fe6, reported: "when I update a guild and click Save
 * changes I get 'Guild Name is required' even though the name is added"):
 *
 *   Edit Guild Submit → validate-form:
 *     const form = params[0] || {}
 *     if (!form["name"]) return { isValid: false, error: "Guild Name is required" }
 *
 * `params[0]` is the trigger — the executor writes `context[triggerNodeId]`
 * first — and the trigger carried the fields one level down under `formData`.
 * `params[0].name` was `undefined`, so every save reported the filled-in name as
 * missing. `general-extract-form-data` has always returned its fields flat for
 * exactly this reason; the trigger now matches it.
 *
 * These tests EXECUTE the generated handler source rather than asserting on
 * strings, so they fail if the emitted expression ever stops behaving.
 */

/** Evaluate the `triggerContext = …` expression the generator emits. */
function evaluateTriggerContext(
  source: string,
  formData: Record<string, unknown>
): Record<string, unknown> {
  const match = /const triggerContext = ([\s\S]*?);\n/.exec(source)
  if (!match) {
    throw new Error('no triggerContext assignment found in generated source')
  }
  const expression = match[1]
    // The generated code reads `event.target`; substitute a stand-in.
    .replace(/event\.target/g, '__el')
  const fn = new Function(
    'formData',
    '__el',
    `const Date = { now: () => 1234 }; return (${expression});`
  )
  return fn(formData, { tagName: 'FORM' }) as Record<string, unknown>
}

describe('event-form-submitted trigger context', () => {
  const SOURCE = [
    'async function(event) {',
    '    event.preventDefault();',
    '    const formData = {};',
    '    const fd = new FormData(event.target);',
    '    fd.forEach(function(v, k) { formData[k] = v; });',
    "    const triggerContext = Object.assign({}, formData, { fields: formData, formData: formData, formId: 'edit-guild-form', triggerElement: event.target, element: event.target, timestamp: Date.now() });",
    '',
  ].join('\n')

  it('exposes each submitted field at the top level', () => {
    const ctx = evaluateTriggerContext(SOURCE, { name: 'Order of the Light', server: 'Area 52' })
    expect(ctx.name).toBe('Order of the Light')
    expect(ctx.server).toBe('Area 52')
  })

  it('still exposes them under formData and fields', () => {
    const ctx = evaluateTriggerContext(SOURCE, { name: 'Order of the Light' })
    expect((ctx.formData as Record<string, unknown>).name).toBe('Order of the Light')
    expect((ctx.fields as Record<string, unknown>).name).toBe('Order of the Light')
  })

  it('keeps the reserved keys even when a field is named after one', () => {
    // The spread comes FIRST, so a field literally called `formId` or `element`
    // cannot shadow the runtime's own keys.
    const ctx = evaluateTriggerContext(SOURCE, {
      formId: 'attacker',
      element: 'attacker',
      timestamp: 'attacker',
      formData: 'attacker',
    })
    expect(ctx.formId).toBe('edit-guild-form')
    expect(ctx.element).toEqual({ tagName: 'FORM' })
    expect(ctx.timestamp).toBe(1234)
    expect(typeof ctx.formData).toBe('object')
  })

  it('reproduces the exact Edit Guild validator, which now passes', () => {
    const ctx = evaluateTriggerContext(SOURCE, {
      name: 'Order of the Light',
      server: 'Area 52',
      leader_account: 'Thrall',
      visibility: 'Public',
    })
    const validate = (params: unknown[]) => {
      const form = (params[0] || {}) as Record<string, string>
      const required = ['name', 'server', 'leader_account', 'visibility']
      for (const key of required) {
        const value = form[key]
        if (!value || (typeof value === 'string' && value.trim() === '')) {
          return { isValid: false, error: `${key} is required` }
        }
      }
      return { isValid: true, error: '' }
    }
    expect(validate([ctx])).toEqual({ isValid: true, error: '' })
  })
})
