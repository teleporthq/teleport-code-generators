/**
 * A UIDL state named `class` (a WoW character sheet really has that column)
 * emitted `const [class, setClass] = useState("")`, prettier threw
 * `SyntaxError: Unexpected token, expected "{"`, and `packProject` aborted —
 * so the WHOLE project failed to generate, not just that page.
 */

import {
  RESERVED_JS_IDENTIFIERS,
  createSafeJSIdentifier,
  createSafeJSIdentifierPath,
  isReservedJSIdentifier,
  isValidJSIdentifierName,
  isValidPropertyKeyName,
} from '../../src/utils/js-identifiers'
import { createStateStoringFunction } from '../../src/utils/string-utils'

describe('isValidJSIdentifierName', () => {
  it('accepts ordinary identifiers', () => {
    for (const name of ['isSubmitting', 'realm', '_private', '$ref', 'a1', 'setClass']) {
      expect(isValidJSIdentifierName(name)).toBe(true)
    }
  })

  it('rejects reserved words even though they are valid identifier SYNTAX', () => {
    for (const name of ['class', 'if', 'return', 'new', 'this', 'delete', 'in', 'typeof']) {
      expect(isValidJSIdentifierName(name)).toBe(false)
      expect(isReservedJSIdentifier(name)).toBe(true)
    }
  })

  it('rejects strict-mode reserved words (generated code is always a module)', () => {
    for (const name of ['let', 'static', 'yield', 'await', 'implements', 'arguments', 'eval']) {
      expect(isValidJSIdentifierName(name)).toBe(false)
    }
  })

  it('rejects names that are not identifier syntax at all', () => {
    for (const name of ['', '2fa', 'my key', 'a-b', 'a.b', 'ünicode']) {
      expect(isValidJSIdentifierName(name)).toBe(false)
    }
  })

  it('rejects non-strings without throwing', () => {
    expect(isValidJSIdentifierName(undefined as unknown as string)).toBe(false)
    expect(isValidJSIdentifierName(null as unknown as string)).toBe(false)
  })
})

describe('isValidPropertyKeyName', () => {
  it('accepts a reserved word — `{ class: x }` and `props.class` are legal', () => {
    expect(isValidPropertyKeyName('class')).toBe(true)
    expect(isValidPropertyKeyName('default')).toBe(true)
  })

  it('rejects anything that would need quoting', () => {
    expect(isValidPropertyKeyName('my key')).toBe(false)
    expect(isValidPropertyKeyName('2fa')).toBe(false)
    expect(isValidPropertyKeyName('')).toBe(false)
  })
})

describe('createSafeJSIdentifier', () => {
  it('is a NO-OP for every name that already compiled', () => {
    for (const name of ['isSubmitting', 'characterName', 'itemLevel', '_x', '$y']) {
      expect(createSafeJSIdentifier(name)).toBe(name)
    }
  })

  it('makes a reserved word bindable with a trailing underscore', () => {
    expect(createSafeJSIdentifier('class')).toBe('class_')
    expect(createSafeJSIdentifier('new')).toBe('new_')
    expect(createSafeJSIdentifier('function')).toBe('function_')
  })

  it('cannot collide, because the shared name normaliser erases underscores', () => {
    // `dashCaseToCamelCase` replaces /[-_]+(.)?/ so a normalised state/prop name
    // never contains `_` — `class_` is therefore unreachable as a sibling name.
    expect(createSafeJSIdentifier('class')).not.toBe(createSafeJSIdentifier('classValue'))
  })

  it('repairs names that are not identifier syntax', () => {
    expect(createSafeJSIdentifier('my key')).toBe('my_key')
    expect(createSafeJSIdentifier('a.b')).toBe('a_b')
    expect(createSafeJSIdentifier('2fa')).toBe('_2fa')
  })

  it('falls back for empty / non-string input instead of emitting nothing', () => {
    expect(createSafeJSIdentifier('')).toBe('_value')
    expect(createSafeJSIdentifier(undefined as unknown as string)).toBe('_value')
    expect(createSafeJSIdentifier('', 'fallbackName')).toBe('fallbackName')
  })

  it('re-checks reservedness AFTER the character pass', () => {
    // "my class" sanitises to "my_class", which is no longer reserved and must
    // NOT pick up a second underscore.
    expect(createSafeJSIdentifier('my class')).toBe('my_class')
  })

  it('every reserved word maps to something bindable', () => {
    for (const word of RESERVED_JS_IDENTIFIERS) {
      const safe = createSafeJSIdentifier(word)
      expect(safe).not.toBe(word)
      expect(isValidJSIdentifierName(safe)).toBe(true)
    }
  })
})

describe('createSafeJSIdentifierPath', () => {
  it('rewrites only the binding head, never the property path', () => {
    expect(createSafeJSIdentifierPath("class?.['spec_role']")).toBe("class_?.['spec_role']")
    expect(createSafeJSIdentifierPath('class')).toBe('class_')
  })

  it('leaves an already-legal reference untouched', () => {
    expect(createSafeJSIdentifierPath("fields?.['name']")).toBe("fields?.['name']")
    expect(createSafeJSIdentifierPath('characterName')).toBe('characterName')
  })

  it('never touches a hand-written EXPRESSION that begins with a keyword', () => {
    // `createConditionIdentifier` returns raw expression strings for `expr`
    // references; rewriting their first word would corrupt the condition.
    expect(createSafeJSIdentifierPath("typeof x === 'string'")).toBe("typeof x === 'string'")
    expect(createSafeJSIdentifierPath('new Date()')).toBe('new Date()')
  })

  it('is total for degenerate input', () => {
    expect(createSafeJSIdentifierPath('')).toBe('')
    expect(createSafeJSIdentifierPath('!isLoading')).toBe('!isLoading')
  })
})

describe('createStateStoringFunction', () => {
  it('is unchanged for ordinary names', () => {
    expect(createStateStoringFunction('isSubmitting')).toBe('setIsSubmitting')
    expect(createStateStoringFunction('item-level')).toBe('setItemLevel')
  })

  it('is safe for a reserved state name — `set` + <Name> can never be reserved', () => {
    expect(createStateStoringFunction('class')).toBe('setClass')
    expect(isValidJSIdentifierName(createStateStoringFunction('class'))).toBe(true)
  })

  it('sanitises characters that survive the camel-casing', () => {
    expect(isValidJSIdentifierName(createStateStoringFunction('a.b'))).toBe(true)
  })
})
