/**
 * Scope analysis for the JavaScript carried by a UIDL `expr` node.
 *
 * The resolver needs to know which identifiers an expression READS from the
 * scope that surrounds it, because those are the only ones that can throw
 * `ReferenceError` at render time. Member access can never throw on its own:
 * `props.a.b.c` only fails if `props` itself is undeclared, so we look at the
 * ROOT of every reference — `cat` in `cat.name`, `item` in `` `/e/${item?.id}` ``,
 * `params` in `params['id']`. Property names, string-literal contents and
 * language keywords are not roots.
 *
 * Identifiers the expression BINDS itself are subtracted from that set, so an
 * inline callback such as `(event) => event.target.value` is understood to be
 * self-contained rather than a reference to an undeclared `event`.
 *
 * Some constructs introduce bindings a lexer cannot place reliably — a
 * block-scoped declaration (`var` / `let` / `const`) or a `class` body, both of
 * which can only appear inside an IIFE here. When one of those shows up the
 * analysis reports `resolvable: false` and the caller must leave the expression
 * alone: this resolver only ever removes PROVABLY broken expressions.
 */

import {
  IDENTIFIER_START,
  RESERVED_WORDS,
  isWhitespace,
  readIdentifier,
  skipStringLiteral,
  skipTemplateLiteral,
} from './expression-lexer'

export interface ExpressionScopeAnalysis {
  /** Root identifiers the expression reads from the enclosing scope. */
  freeIdentifiers: Set<string>
  /**
   * `false` when the expression contains a construct whose bindings this lexer
   * cannot resolve. `freeIdentifiers` is then not trustworthy and callers must
   * treat the expression as bound.
   */
  resolvable: boolean
}

/**
 * Keywords that declare a name outside of a parameter list. They can only reach
 * a UIDL expression inside a function body (the generator emits `expr` nodes as
 * a single expression statement), and tracking their bindings would require a
 * real parser — so they switch the analysis off instead.
 */
const OPAQUE_SCOPE_KEYWORDS = new Set(['var', 'let', 'const', 'class'])

/** Marker stored in `previousSignificant` for "the last token was an identifier". */
const IDENTIFIER_TOKEN = 'a'

interface ScanState {
  roots: Set<string>
  declared: Set<string>
  resolvable: boolean
}

interface ParenGroup {
  start: number
  end: number
}

/**
 * True when the next non-whitespace character starting at `from` is a single
 * `:` (an object-literal key separator, not the `::` of a type/label). Used to
 * tell `{ active: item.x }` (key) apart from `cond ? item : other` (reference).
 */
const nextNonWhitespaceIsColon = (code: string, from: number): boolean => {
  let index = from
  while (index < code.length && isWhitespace(code[index])) {
    index += 1
  }
  return code[index] === ':' && code[index + 1] !== ':'
}

/**
 * Registers every identifier inside a parameter list as a binding.
 *
 * Parameter lists can hold defaults that reference outer values
 * (`(a = outer) => …`), and those get collected as bindings too. That
 * over-collection is deliberate: declaring too much only makes the caller more
 * conservative (it keeps an expression it might have been able to neutralise),
 * whereas declaring too little would blank a perfectly valid expression.
 */
const declareIdentifiersIn = (fragment: string, state: ScanState): void => {
  let index = 0
  while (index < fragment.length) {
    const char = fragment[index]
    if (char === "'" || char === '"') {
      index = skipStringLiteral(fragment, index)
      continue
    }
    if (char === '`') {
      index = skipTemplateLiteral(fragment, index)
      continue
    }
    if (IDENTIFIER_START.test(char)) {
      const identifier = readIdentifier(fragment, index)
      if (!RESERVED_WORDS.has(identifier)) {
        state.declared.add(identifier)
      }
      index += identifier.length
      continue
    }
    index += 1
  }
}

const scanExpression = (code: string, state: ScanState): void => {
  // Open-paren indices, so a `)` can be paired back to its group. `=>` needs
  // that group: an arrow's parameters sit BEFORE the token that identifies it
  // as a function.
  const openParens: number[] = []
  let lastParenGroup: ParenGroup | undefined
  // Paren nesting level at which a `function` keyword was seen, so the very
  // next group closing at that level is recognised as its parameter list.
  let functionParenDepth = -1
  // Last non-whitespace character seen — `.` marks a member access, `)` an
  // arrow's parameter list, `IDENTIFIER_TOKEN` a bare identifier.
  let previousSignificant = ''
  let previousIdentifier = ''
  let index = 0

  while (index < code.length) {
    const char = code[index]

    if (isWhitespace(char)) {
      index += 1
      continue
    }

    if (char === "'" || char === '"') {
      index = skipStringLiteral(code, index)
      previousSignificant = '"'
      continue
    }

    if (char === '`') {
      index = skipTemplateLiteral(code, index, (fragment) => scanExpression(fragment, state))
      previousSignificant = '`'
      continue
    }

    // `=>` — everything the parameter list binds belongs to the arrow's own scope.
    if (char === '=' && code[index + 1] === '>') {
      if (previousSignificant === ')' && lastParenGroup) {
        declareIdentifiersIn(code.slice(lastParenGroup.start + 1, lastParenGroup.end), state)
      } else if (previousSignificant === IDENTIFIER_TOKEN && previousIdentifier) {
        // Single parameter without parentheses: `item => item.id`.
        state.declared.add(previousIdentifier)
      }
      index += 2
      previousSignificant = '>'
      continue
    }

    if (IDENTIFIER_START.test(char)) {
      const identifier = readIdentifier(code, index)
      const end = index + identifier.length
      // A property name is never a keyword occurrence nor a variable read —
      // `props.const` and `props.function` are plain member accesses.
      const isMemberAccess = previousSignificant === '.'

      if (!isMemberAccess && OPAQUE_SCOPE_KEYWORDS.has(identifier)) {
        state.resolvable = false
      }

      if (!isMemberAccess && identifier === 'function') {
        functionParenDepth = openParens.length
      } else if (previousIdentifier === 'function' && previousSignificant === IDENTIFIER_TOKEN) {
        // A named function expression binds its own name: `function fn(a) { … }`.
        state.declared.add(identifier)
      } else if (!isMemberAccess && !RESERVED_WORDS.has(identifier)) {
        // An unquoted object-literal key (`{ key: ... }` / `, key: ...`) is a
        // property name, not a variable read.
        const isObjectKey =
          (previousSignificant === '{' || previousSignificant === ',') &&
          nextNonWhitespaceIsColon(code, end)
        if (!isObjectKey) {
          state.roots.add(identifier)
        }
      }

      index = end
      previousSignificant = IDENTIFIER_TOKEN
      previousIdentifier = identifier
      continue
    }

    if (char === '(') {
      openParens.push(index)
    } else if (char === ')') {
      const start = openParens.pop()
      if (start !== undefined) {
        lastParenGroup = { start, end: index }
        if (functionParenDepth >= 0 && openParens.length === functionParenDepth) {
          declareIdentifiersIn(code.slice(start + 1, index), state)
          functionParenDepth = -1
        }
      }
    }

    previousSignificant = char
    index += 1
  }
}

/**
 * Returns the identifiers an expression reads from the surrounding scope,
 * together with whether the analysis could account for every binding it saw.
 */
export const analyzeExpressionScope = (expression: string): ExpressionScopeAnalysis => {
  const state: ScanState = {
    roots: new Set<string>(),
    declared: new Set<string>(),
    resolvable: true,
  }

  if (typeof expression === 'string' && expression.length > 0) {
    scanExpression(expression, state)
  }

  const freeIdentifiers = new Set<string>()
  state.roots.forEach((root) => {
    if (!state.declared.has(root)) {
      freeIdentifiers.add(root)
    }
  })

  return { freeIdentifiers, resolvable: state.resolvable }
}
