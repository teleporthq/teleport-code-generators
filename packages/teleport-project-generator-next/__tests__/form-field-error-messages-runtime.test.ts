import generate from '@babel/generator'
import { buildFieldErrorMessagesEffect } from '../src/forms/field-error-messages'

type Cleanup = () => void
type Listener = (event: { target: FakeField }) => void

/** The parts of the DOM the emitted effect touches (jsdom does not load in this repo). */
class FakeForm {
  fields: FakeField[] = []
  constructor(readonly formId: string) {}
  querySelectorAll(selector: string) {
    const attr = selector.slice(1, -1)
    return this.fields.filter((field) => field.attrs[attr] !== undefined)
  }
}

class FakeField {
  validationMessage = ''
  constructor(readonly form: FakeForm, readonly attrs: Record<string, string>) {
    form.fields.push(this)
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null
  }
  hasAttribute(name: string) {
    return this.attrs[name] !== undefined
  }
  closest(selector: string) {
    return selector === `form[data-form-id="${this.form.formId}"]` ? this.form : null
  }
  setCustomValidity(message: string) {
    this.validationMessage = message
  }
}

class FakeDocument {
  listeners: Array<{ type: string; listener: Listener; capture: boolean }> = []
  addEventListener(type: string, listener: Listener, capture: boolean) {
    this.listeners.push({ type, listener, capture })
  }
  removeEventListener(type: string, listener: Listener, capture: boolean) {
    this.listeners = this.listeners.filter(
      (entry) => !(entry.type === type && entry.listener === listener && entry.capture === capture)
    )
  }
  fire(type: string, target: FakeField) {
    this.listeners
      .filter((entry) => entry.type === type)
      .forEach(({ listener }) => listener({ target }))
  }
}

/** Runs the emitted `useEffect` the way React would, returning its cleanup. */
const runEffect = (formId: string, document: FakeDocument): Cleanup => {
  const { code } = generate(buildFieldErrorMessagesEffect(formId))
  let cleanup: Cleanup = () => undefined
  const useEffect = (effect: () => Cleanup) => {
    cleanup = effect()
  }
  new Function('useEffect', 'document', code)(useEffect, document)
  return cleanup
}

describe('field error messages, as they run in the page', () => {
  it('listens on the document in the capture phase, so a form rendered later is covered', () => {
    const document = new FakeDocument()
    runEffect('contact', document)
    expect(document.listeners.map(({ type, capture }) => [type, capture])).toEqual([
      ['invalid', true],
      ['input', true],
      ['change', true],
    ])

    // Both copies exist only after the effect ran.
    const copies = [new FakeForm('contact'), new FakeForm('contact')].map(
      (form) => new FakeField(form, { name: 'email', 'data-error-message': 'Use your work email' })
    )
    copies.forEach((field) => document.fire('invalid', field))
    expect(copies.map((field) => field.validationMessage)).toEqual([
      'Use your work email',
      'Use your work email',
    ])
  })

  it('clears the message on every radio button of a group when another one is picked', () => {
    const document = new FakeDocument()
    runEffect('survey', document)
    const form = new FakeForm('survey')
    const optionA = new FakeField(form, { name: 'plan', 'data-error-message': 'Pick a plan' })
    const optionB = new FakeField(form, { name: 'plan' })

    document.fire('invalid', optionA)
    expect(optionA.validationMessage).toBe('Pick a plan')

    document.fire('change', optionB)
    expect(optionA.validationMessage).toBe('')
  })

  it('shows the message of a radio group whichever button the browser reports', () => {
    const document = new FakeDocument()
    runEffect('survey', document)
    const form = new FakeForm('survey')
    const optionA = new FakeField(form, { name: 'plan', 'data-error-message': 'Pick a plan' })
    const optionB = new FakeField(form, { name: 'plan' })

    document.fire('invalid', optionB)
    expect(optionB.validationMessage).toBe('Pick a plan')

    document.fire('change', optionA)
    expect(optionB.validationMessage).toBe('')
  })

  it('never clears a custom validity another script set', () => {
    const document = new FakeDocument()
    runEffect('checkout', document)
    const form = new FakeForm('checkout')
    const postal = new FakeField(form, { name: 'postal' })
    postal.setCustomValidity('Postal code does not match the country')

    document.fire('input', postal)

    expect(postal.validationMessage).toBe('Postal code does not match the country')
  })

  it("leaves other forms' fields alone and stops listening on cleanup", () => {
    const document = new FakeDocument()
    const cleanup = runEffect('contact', document)
    const other = new FakeField(new FakeForm('newsletter'), {
      name: 'email',
      'data-error-message': 'Other form',
    })
    document.fire('invalid', other)
    expect(other.validationMessage).toBe('')

    cleanup()
    expect(document.listeners).toEqual([])
  })
})
