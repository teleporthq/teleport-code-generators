import * as types from '@babel/types'
import { UIDLElement, UIDLFormDefinition } from '@teleporthq/teleport-types'
import { UIDLUtils } from '@teleporthq/teleport-shared'

export const FIELD_ERROR_MESSAGE_ATTR = 'data-error-message'

/** Whether the form's own captcha check is on; absent means on. */
export const isCaptchaEnabled = (formDefinition: UIDLFormDefinition | undefined): boolean =>
  formDefinition?.security?.captchaEnabled?.content !== false

/** Whether any field inside the form carries its own validation message. */
export const formHasFieldErrorMessages = (formElement: UIDLElement): boolean => {
  let found = false
  for (const child of formElement.children ?? []) {
    UIDLUtils.traverseElements(child, (element) => {
      if (element.attrs?.[FIELD_ERROR_MESSAGE_ATTR]) {
        found = true
      }
    })
  }
  return found
}

const id = (name: string) => types.identifier(name)

const member = (object: types.Expression | string, property: string) =>
  types.memberExpression(typeof object === 'string' ? id(object) : object, id(property))

const call = (callee: types.Expression, args: types.Expression[]) =>
  types.callExpression(callee, args)

const constant = (name: string, value: types.Expression) =>
  types.variableDeclaration('const', [types.variableDeclarator(id(name), value)])

const returnWhenMissing = (name: string) =>
  types.ifStatement(
    types.unaryExpression('!', id(name)),
    types.blockStatement([types.returnStatement()])
  )

/** `field.closest ? field.closest(formSelector) : null` — the form this event belongs to. */
const closestForm = () =>
  types.conditionalExpression(
    member('field', 'closest'),
    call(member('field', 'closest'), [id('formSelector')]),
    types.nullLiteral()
  )

const documentListener = (
  method: 'addEventListener' | 'removeEventListener',
  event: string,
  handler: string
) =>
  types.expressionStatement(
    call(member('document', method), [
      types.stringLiteral(event),
      id(handler),
      types.booleanLiteral(true),
    ])
  )

const LISTENERS: Array<[string, string]> = [
  ['invalid', 'showFieldErrorMessage'],
  ['input', 'clearFieldErrorMessage'],
  ['change', 'clearFieldErrorMessage'],
]

const attrOf = (element: string, attr: string) =>
  call(member(element, 'getAttribute'), [types.stringLiteral(attr)])

/** `element.getAttribute('name') === name`, false when the field has no name. */
const sharesName = (element: string) =>
  types.logicalExpression(
    '&&',
    id('name'),
    types.binaryExpression('===', attrOf(element, 'name'), id('name'))
  )

/** The event's field, its form (or an early return) and its name; built anew for each handler. */
const fieldPreamble = () => [
  constant('field', member('event', 'target')),
  constant('form', closestForm()),
  returnWhenMissing('form'),
  constant('name', attrOf('field', 'name')),
]

/** `Array.from(form.querySelectorAll(selector))` */
const formElements = (selector: string) =>
  call(member('Array', 'from'), [
    call(member('form', 'querySelectorAll'), [types.stringLiteral(selector)]),
  ])

/**
 * `useEffect` that shows a field's `data-error-message` instead of the
 * browser's own wording when the field fails validation, and clears it as soon
 * as the value changes so the next check starts fresh.
 *
 * Listeners sit on `document` in the capture phase (`invalid` does not
 * bubble), scoped to this form by its selector, so a form that renders later —
 * inside a popup, behind a condition — and every copy on the page are covered.
 * A radio group carries its message on one button, but the browser may report
 * any button of the group, so the message is looked up across the group; a
 * change clears it on every button of the group. Only messages this effect set
 * are cleared (`applied`), never another script's custom validity.
 *
 *   const applied = new WeakSet()
 *   const showFieldErrorMessage = (event) => {
 *     const field = event.target
 *     const form = field.closest ? field.closest(formSelector) : null
 *     if (!form) return
 *     const name = field.getAttribute('name')
 *     const carrier = field.hasAttribute('data-error-message')
 *       ? field
 *       : Array.from(form.querySelectorAll('[data-error-message]')).find(
 *           (element) => name && element.getAttribute('name') === name)
 *     const message = carrier ? carrier.getAttribute('data-error-message') : null
 *     if (message) { field.setCustomValidity(message); applied.add(field) }
 *   }
 *   const clearFieldErrorMessage = (event) => {
 *     const field = event.target
 *     const form = field.closest ? field.closest(formSelector) : null
 *     if (!form) return
 *     const name = field.getAttribute('name')
 *     Array.from(form.querySelectorAll('[name]')).concat(field).forEach((element) => {
 *       if ((element === field || (name && element.getAttribute('name') === name)) &&
 *           applied.has(element)) {
 *         element.setCustomValidity('')
 *         applied.delete(element)
 *       }
 *     })
 *   }
 */
export const buildFieldErrorMessagesEffect = (formId: string): types.ExpressionStatement => {
  const showHandler = types.arrowFunctionExpression(
    [id('event')],
    types.blockStatement([
      ...fieldPreamble(),
      constant(
        'carrier',
        types.conditionalExpression(
          call(member('field', 'hasAttribute'), [types.stringLiteral(FIELD_ERROR_MESSAGE_ATTR)]),
          id('field'),
          call(member(formElements(`[${FIELD_ERROR_MESSAGE_ATTR}]`), 'find'), [
            types.arrowFunctionExpression([id('element')], sharesName('element')),
          ])
        )
      ),
      constant(
        'message',
        types.conditionalExpression(
          id('carrier'),
          attrOf('carrier', FIELD_ERROR_MESSAGE_ATTR),
          types.nullLiteral()
        )
      ),
      types.ifStatement(
        id('message'),
        types.blockStatement([
          types.expressionStatement(call(member('field', 'setCustomValidity'), [id('message')])),
          types.expressionStatement(call(member('applied', 'add'), [id('field')])),
        ])
      ),
    ])
  )

  const clearElement = types.arrowFunctionExpression(
    [id('element')],
    types.blockStatement([
      types.ifStatement(
        types.logicalExpression(
          '&&',
          types.logicalExpression(
            '||',
            types.binaryExpression('===', id('element'), id('field')),
            sharesName('element')
          ),
          call(member('applied', 'has'), [id('element')])
        ),
        types.blockStatement([
          types.expressionStatement(
            call(member('element', 'setCustomValidity'), [types.stringLiteral('')])
          ),
          types.expressionStatement(call(member('applied', 'delete'), [id('element')])),
        ])
      ),
    ])
  )

  const clearHandler = types.arrowFunctionExpression(
    [id('event')],
    types.blockStatement([
      ...fieldPreamble(),
      types.expressionStatement(
        call(member(call(member(formElements('[name]'), 'concat'), [id('field')]), 'forEach'), [
          clearElement,
        ])
      ),
    ])
  )

  return types.expressionStatement(
    call(id('useEffect'), [
      types.arrowFunctionExpression(
        [],
        types.blockStatement([
          constant('formSelector', types.stringLiteral(`form[data-form-id="${formId}"]`)),
          constant('applied', types.newExpression(id('WeakSet'), [])),
          constant('showFieldErrorMessage', showHandler),
          constant('clearFieldErrorMessage', clearHandler),
          ...LISTENERS.map(([event, handler]) =>
            documentListener('addEventListener', event, handler)
          ),
          types.returnStatement(
            types.arrowFunctionExpression(
              [],
              types.blockStatement(
                LISTENERS.map(([event, handler]) =>
                  documentListener('removeEventListener', event, handler)
                )
              )
            )
          ),
        ])
      ),
      types.arrayExpression([]),
    ])
  )
}
