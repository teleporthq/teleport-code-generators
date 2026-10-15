/**
 * State bindings of the static HTML export: the attributes a downloaded page
 * carries so that clicks open menus, switch tabs and restyle elements, and the
 * small expression language they are written in. The HTML generator writes
 * them (teleport-plugin-html-base-component), the one runtime file a download
 * ships (`tq-state.js`, teleport-project-generator-html) reads them back.
 *
 *   data-tq-scope="Navigation"            a page root or a component instance:
 *   data-tq-state="menuOpen = false"      its own store, with its starting values
 *   data-tq-if="menuOpen"                 shown while true; `hidden` when it starts false
 *   data-tq-class="active: tab === 0"     the class is on while true
 *   data-tq-on-click="menuOpen = !menuOpen"
 *   data-tq-slot                          content a parent put into a component:
 *                                         it reads the parent's store
 *
 * The language has literals (numbers, 'quoted strings', true, false, null),
 * state names, `!`, `+ -`, the six comparisons and `&& ||`, with JavaScript's
 * meaning. Nothing is ever evaluated as JavaScript, so a page keeps working
 * under a strict Content-Security-Policy.
 */

export const SCOPE_ATTR = 'data-tq-scope'
export const STATE_ATTR = 'data-tq-state'
export const SLOT_ATTR = 'data-tq-slot'
export const IF_ATTR = 'data-tq-if'
export const CLASS_ATTR = 'data-tq-class'
export const CLICK_ATTR = 'data-tq-on-click'

export const RUNTIME_FILE_NAME = 'tq-state'

export type StateValue = string | number | boolean | null

export type ComparisonOperator = '===' | '!==' | '<' | '<=' | '>' | '>='
export type BinaryOperator = '||' | '&&' | ComparisonOperator | '+' | '-'

export type StateExpression =
  | { kind: 'literal'; value: StateValue }
  | { kind: 'state'; name: string }
  | { kind: 'not'; operand: StateExpression }
  | { kind: 'binary'; operator: BinaryOperator; left: StateExpression; right: StateExpression }

export interface StateAssignment {
  name: string
  value: StateExpression
}

export interface ClassBinding {
  className: string
  condition: StateExpression
}

const RESERVED_WORDS = ['true', 'false', 'null']

export const isStateName = (name: string): boolean =>
  /^[A-Za-z_$][\w$]*$/.test(name) && !RESERVED_WORDS.includes(name)

export const isBindableClassName = (name: string): boolean => /^[^\s:;'"\\]+$/.test(name)

export const isStateValue = (value: unknown): value is StateValue =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value))

export const literal = (value: StateValue): StateExpression => ({ kind: 'literal', value })
export const state = (name: string): StateExpression => ({ kind: 'state', name })
export const not = (operand: StateExpression): StateExpression => ({ kind: 'not', operand })
export const binary = (
  operator: BinaryOperator,
  left: StateExpression,
  right: StateExpression
): StateExpression => ({ kind: 'binary', operator, left, right })

export const stateNamesOf = (expression: StateExpression, names = new Set<string>()) => {
  switch (expression.kind) {
    case 'state':
      names.add(expression.name)
      break
    case 'not':
      stateNamesOf(expression.operand, names)
      break
    case 'binary':
      stateNamesOf(expression.left, names)
      stateNamesOf(expression.right, names)
      break
    default:
      break
  }
  return names
}

const PRECEDENCE: Record<BinaryOperator, number> = {
  '||': 1,
  '&&': 2,
  '===': 3,
  '!==': 3,
  '<': 3,
  '<=': 3,
  '>': 3,
  '>=': 3,
  '+': 4,
  '-': 4,
}
const UNARY_PRECEDENCE = 5
const PRIMARY_PRECEDENCE = 6

const precedenceOf = (expression: StateExpression): number => {
  if (expression.kind === 'binary') {
    return PRECEDENCE[expression.operator]
  }
  return expression.kind === 'not' ? UNARY_PRECEDENCE : PRIMARY_PRECEDENCE
}

const printOperand = (expression: StateExpression, lowestUnwrapped: number): string =>
  precedenceOf(expression) < lowestUnwrapped
    ? `(${printExpression(expression)})`
    : printExpression(expression)

export const printValue = (value: StateValue): string => {
  if (typeof value === 'string') {
    return `'${value.replace(/[\\']/g, '\\$&')}'`
  }
  return String(value)
}

export const printExpression = (expression: StateExpression): string => {
  switch (expression.kind) {
    case 'literal':
      return printValue(expression.value)
    case 'state':
      return expression.name
    case 'not':
      return `!${printOperand(expression.operand, UNARY_PRECEDENCE)}`
    case 'binary': {
      const level = PRECEDENCE[expression.operator]
      const chains = expression.operator === '||' || expression.operator === '&&'
      const left = printOperand(expression.left, level === 3 ? level + 1 : level)
      const right = printOperand(expression.right, chains ? level : level + 1)
      return `${left} ${expression.operator} ${right}`
    }
    default:
      throw new Error(`Unknown state expression ${JSON.stringify(expression)}`)
  }
}

export const printAssignments = (assignments: StateAssignment[]): string =>
  assignments.map(({ name, value }) => `${name} = ${printExpression(value)}`).join('; ')

export const printClassBindings = (bindings: ClassBinding[]): string =>
  bindings
    .map(({ className, condition }) => `${className}: ${printExpression(condition)}`)
    .join('; ')

/** The same meaning the runtime gives an expression, for the page's first paint. */
export const evaluateExpression = (
  expression: StateExpression,
  values: Record<string, StateValue>
): unknown => {
  switch (expression.kind) {
    case 'literal':
      return expression.value
    case 'state':
      return Object.prototype.hasOwnProperty.call(values, expression.name)
        ? values[expression.name]
        : undefined
    case 'not':
      return !evaluateExpression(expression.operand, values)
    case 'binary': {
      const left = evaluateExpression(expression.left, values) as any
      const right = evaluateExpression(expression.right, values) as any
      switch (expression.operator) {
        case '||':
          return left || right
        case '&&':
          return left && right
        case '===':
          return left === right
        case '!==':
          return left !== right
        case '<':
          return left < right
        case '<=':
          return left <= right
        case '>':
          return left > right
        case '>=':
          return left >= right
        case '+':
          return left + right
        case '-':
          return left - right
        default:
          throw new Error(`Unknown state operator ${expression.operator}`)
      }
    }
    default:
      throw new Error(`Unknown state expression ${JSON.stringify(expression)}`)
  }
}

/**
 * An attribute value as the HTML printer must receive it: it writes values
 * between double quotes and escapes nothing. `&&` and `<` stay readable; an
 * ampersand that could start a character reference does not.
 */
export const escapeAttributeValue = (value: string): string =>
  value.replace(/&(?=[A-Za-z#])/g, '&amp;').replace(/"/g, '&quot;')
