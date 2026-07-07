import { NodeHandlerGenerator, handlerToString } from '../types'

async function general_extract_form_data(config: any, context: Record<string, unknown>) {
  const formNodeId = config.formNodeId
  const includeEmpty = config.includeEmpty !== false
  const validate = config.validate || false

  try {
    let formEl = document.getElementById(formNodeId) as HTMLFormElement | null
    if (!formEl && config.elementHtmlId) {
      formEl = document.getElementById(config.elementHtmlId) as HTMLFormElement | null
    }
    if (!formEl) {
      formEl = document.querySelector(
        'form[data-form-id="' + formNodeId + '"]'
      ) as HTMLFormElement | null
    }
    if (!formEl && (context as any).triggerElement) {
      const triggerEl = (context as any).triggerElement as HTMLElement
      formEl = triggerEl.closest('form') as HTMLFormElement | null
    }
    if (!formEl) {
      const allForms = document.querySelectorAll('form')
      if (allForms.length === 1) {
        formEl = allForms[0] as HTMLFormElement
      }
    }
    if (!formEl) {
      return {
        fields: {},
        isValid: false,
        errors: [{ message: 'Form element not found: ' + formNodeId }],
      }
    }

    const formData = new FormData(formEl as HTMLFormElement)
    const fields: Record<string, any> = {}
    const entries = (formData as any).entries()
    let entry = entries.next()
    while (!entry.done) {
      const key = entry.value[0]
      const value = entry.value[1]
      if (includeEmpty || (value !== '' && value !== null && value !== undefined)) {
        if (fields[key] !== undefined) {
          if (!Array.isArray(fields[key])) {
            fields[key] = [fields[key]]
          }
          fields[key].push(value)
        } else {
          fields[key] = value
        }
      }
      entry = entries.next()
    }

    // Also collect named inputs that are outside the form element but on the
    // same page (e.g., the terms checkbox in the checkout right column). Never
    // overwrite a value already captured from the target form — unrelated forms
    // on the page (newsletter signup in the footer, etc.) can share field names
    // like "email" and would otherwise clobber the real submission. We also
    // skip inputs that live inside ANOTHER <form> element: those belong to
    // their own submission flow, and pulling them in pollutes our payload
    // with sibling-form values (e.g. an empty email from the footer
    // newsletter that flips the checkout validation to "fill in all required
    // fields" even when the buyer's actual checkout form has no email field
    // — pickup flow with no billing section).
    const allInputs = document.querySelectorAll('input[name], select[name], textarea[name]')
    for (let ai = 0; ai < allInputs.length; ai++) {
      const inp = allInputs[ai] as HTMLInputElement
      if (formEl.contains(inp)) {
        continue
      } // Already captured via FormData
      if (!inp.name) {
        continue
      }
      if (fields[inp.name] !== undefined) {
        continue
      }
      const ownerForm = inp.closest('form')
      if (ownerForm && ownerForm !== formEl) {
        continue
      }
      if (inp.type === 'checkbox') {
        if (includeEmpty || inp.checked) {
          fields[inp.name] = inp.checked ? 'on' : ''
        }
      } else if (inp.type === 'radio') {
        if (inp.checked) {
          fields[inp.name] = inp.value
        }
      } else {
        const val = inp.value
        if (includeEmpty || (val !== '' && val !== null && val !== undefined)) {
          fields[inp.name] = val
        }
      }
    }

    const fieldKeys = Object.keys(fields)
    const result: Record<string, any> = { fields, formData: fields }
    for (let fi = 0; fi < fieldKeys.length; fi++) {
      result[fieldKeys[fi]] = fields[fieldKeys[fi]]
    }

    // Workflows generated/imported from HTML often refer to a form control by
    // its DOM id (`class-session-select`) while FormData exposes submitted
    // values by name (`class_session_id`). Preserve the canonical name keys
    // above, and add non-overwriting aliases for id/data-form-field-id so both
    // conventions resolve to the same submitted value.
    try {
      const addAlias = (alias: string | null | undefined, name: string | undefined) => {
        if (!alias || !name) return
        if (fields[name] === undefined) return
        if (result[alias] === undefined) {
          result[alias] = fields[name]
        }
      }
      const controls = (formEl as HTMLFormElement).querySelectorAll(
        'input[name], select[name], textarea[name], button[name]'
      )
      for (let ci = 0; ci < controls.length; ci++) {
        const control = controls[ci] as HTMLInputElement
        addAlias(control.id, control.name)
        addAlias(control.getAttribute('data-form-field-id'), control.name)
      }
      const outsideControls = document.querySelectorAll(
        'input[name], select[name], textarea[name], button[name]'
      )
      for (let oi = 0; oi < outsideControls.length; oi++) {
        const control = outsideControls[oi] as HTMLInputElement
        if (formEl.contains(control)) continue
        const ownerForm = control.closest('form')
        if (ownerForm && ownerForm !== formEl) continue
        addAlias(control.id, control.name)
        addAlias(control.getAttribute('data-form-field-id'), control.name)
      }
    } catch (_aliasErr) {
      /* aliases are best-effort; canonical name-based fields remain intact */
    }

    // Diagnostic: surface any required inputs whose value is empty at extraction
    // time so downstream custom-JS validators have something concrete to report
    // instead of a generic "please fill in all required fields" message.
    try {
      const emptyRequired: string[] = []
      const elements = (formEl as HTMLFormElement).elements
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i] as HTMLInputElement & {
          required?: boolean
          name?: string
          type?: string
          value?: string
          checked?: boolean
        }
        if (!el.required || !el.name) {
          continue
        }
        if (el.type === 'checkbox' || el.type === 'radio') {
          if (!el.checked) {
            emptyRequired.push(el.name)
          }
        } else {
          const v = el.value
          if (v === undefined || v === null || String(v).trim() === '') {
            emptyRequired.push(el.name)
          }
        }
      }
      result.__emptyRequired = emptyRequired
      if (emptyRequired.length > 0 && typeof console !== 'undefined' && console.warn) {
        console.warn(
          '[extract-form-data] empty required fields on form ' +
            (formEl.id || '(unknown id)') +
            ':',
          emptyRequired,
          'captured fields:',
          fields
        )
      }
    } catch (_diagErr) {
      /* diagnostics must not break extraction */
    }

    if (validate) {
      let isValid = true
      const errors: Array<{ field: string; message: string }> = []
      const elements = (formEl as HTMLFormElement).elements
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i] as HTMLInputElement & {
          name?: string
          validity?: { valid: boolean }
          validationMessage?: string
        }
        if (el.name && el.validity && !el.validity.valid) {
          isValid = false
          errors.push({ field: el.name, message: el.validationMessage || 'Invalid value' })
        }
      }
      result.isValid = isValid
      result.errors = errors
    }

    return result
  } catch (err: unknown) {
    return { fields: {}, isValid: false, errors: [{ message: (err as Error).message }] }
  }
}
export const generalExtractFormData: NodeHandlerGenerator = {
  nodeType: 'general-extract-form-data',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(general_extract_form_data)
  },
}
