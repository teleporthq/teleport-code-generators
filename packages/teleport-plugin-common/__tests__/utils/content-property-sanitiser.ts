import { sanitizeContentValue, getContentOfStyleObject } from '../../src/utils/style-utils'
import { UIDLStyleDefinitions } from '@teleporthq/teleport-types'

// Regression guard for "broken CSS shipped to next dev as
// `content: ';;`". The AI occasionally emits the raw fragment
// `';` as the value of the `content` property — without
// sanitisation the JSS pipeline forwards it verbatim and the
// emitted rule becomes:
//
//   .bundle-price-tag::before {
//     content: ';;     ← starts a quoted string that never closes
//   }
//
// Next.js's CSS loader then bails on the entire stylesheet,
// which manifests in dev as a Webpack overlay and in prod as
// silently-missing rules from that point onward. The sanitiser
// keeps the surrounding rule parseable by either accepting a
// well-formed value as-is, normalising one of the canonical
// keyword/function shapes, or — when the input can't be repaired
// — substituting the empty-string literal `''`.

describe('sanitizeContentValue', () => {
  it('keeps a properly single-quoted string as-is', () => {
    expect(sanitizeContentValue("'★'")).toBe("'★'")
    expect(sanitizeContentValue("'NEW'")).toBe("'NEW'")
  })

  it('keeps a properly double-quoted string as-is', () => {
    expect(sanitizeContentValue('"foo"')).toBe('"foo"')
  })

  it('keeps the empty-string literal', () => {
    expect(sanitizeContentValue("''")).toBe("''")
    expect(sanitizeContentValue('""')).toBe('""')
  })

  it('keeps the canonical keywords', () => {
    for (const kw of [
      'none',
      'normal',
      'open-quote',
      'close-quote',
      'no-open-quote',
      'no-close-quote',
      'inherit',
      'initial',
      'unset',
      'revert',
    ]) {
      expect(sanitizeContentValue(kw)).toBe(kw)
    }
  })

  it('keeps recognised function calls (attr / counter / var / url)', () => {
    expect(sanitizeContentValue('attr(data-label)')).toBe('attr(data-label)')
    expect(sanitizeContentValue('counter(section)')).toBe('counter(section)')
    expect(sanitizeContentValue('var(--badge)')).toBe('var(--badge)')
    expect(sanitizeContentValue('url(/icon.svg)')).toBe('url(/icon.svg)')
  })

  it("repairs the canonical broken AI emission `';` to an empty string literal", () => {
    // This is the specific shape that started this regression.
    // The repair path strips the stray quote + semicolon and
    // wraps the (empty) remainder, yielding a valid declaration.
    expect(sanitizeContentValue("';")).toBe("''")
  })

  it('repairs other unquoted garbage to an empty string literal', () => {
    expect(sanitizeContentValue(';')).toBe("''")
    expect(sanitizeContentValue("'")).toBe("''")
    expect(sanitizeContentValue('"')).toBe("''")
    expect(sanitizeContentValue('   ')).toBe("''")
  })

  it('rejects strings whose quotes do not match or balance', () => {
    // `'foo"` — opens with single, closes with double — is NOT a
    // properly quoted string. We repair: strip stray quote
    // characters, wrap the remaining bareword in single quotes.
    expect(sanitizeContentValue('\'foo"')).toBe("'foo'")
  })

  it('rejects a string with an unescaped interior matching quote', () => {
    // `'a'b'` — the closing quote in position 2 closes the
    // string early, leaving `b'` as raw CSS. The sanitiser must
    // refuse to treat this as a quoted string; instead it
    // strips quotes and re-wraps.
    expect(sanitizeContentValue("'a'b'")).toBe("'ab'")
  })

  it('preserves an escaped interior quote in a single-quoted string', () => {
    // The walker honours `\` as an escape, so a backslash-escaped
    // single quote inside a single-quoted string is part of the
    // content, not a terminator.
    expect(sanitizeContentValue("'don\\'t'")).toBe("'don\\'t'")
  })

  it('preserves a value that contains a colon inside a quoted string', () => {
    // The generic `isValidCSSValue` would otherwise drop a colon
    // outside parentheses, but content values are passed straight
    // through to the sanitiser instead — a colon in a quoted
    // string is legitimate text.
    expect(sanitizeContentValue('"section:1"')).toBe('"section:1"')
  })

  it('does not silently mangle a long quoted string', () => {
    // A real-world bundle-price decoration like `'$ '` must
    // round-trip unchanged.
    expect(sanitizeContentValue("'$ '")).toBe("'$ '")
  })
})

describe('getContentOfStyleObject: integration with content sanitiser', () => {
  it('applies the sanitiser only to the `content` key', () => {
    const styleValue: UIDLStyleDefinitions = {
      content: { type: 'static', content: "';" },
      color: { type: 'static', content: 'red' },
      'font-family': { type: 'static', content: "'Arial', sans-serif" },
    }
    const result = getContentOfStyleObject(styleValue)
    // `content` is repaired; `color` and `font-family` are
    // unaffected (the latter accidentally matches the "quoted"
    // pattern but is on a different key, so it never reaches the
    // sanitiser).
    expect(result.content).toBe("''")
    expect(result.color).toBe('red')
    expect(result['font-family']).toBe("'Arial', sans-serif")
  })

  it('repairs the documented bundle-price-tag::before regression', () => {
    // Mirrors the exact shape that produced
    // `.bundle-price-tag::before { content: ';; }` in the
    // generated stylesheet — verify end-to-end that the value
    // that reaches downstream serializers is now `''`.
    const styleValue: UIDLStyleDefinitions = {
      content: { type: 'static', content: "';" },
    }
    expect(getContentOfStyleObject(styleValue)).toEqual({ content: "''" })
  })

  it('keeps a legitimate content value intact', () => {
    const styleValue: UIDLStyleDefinitions = {
      content: { type: 'static', content: "'★'" },
    }
    expect(getContentOfStyleObject(styleValue)).toEqual({ content: "'★'" })
  })

  it('keeps the existing colon-in-CSS-value guard for non-content properties', () => {
    // Verifies the original `isValidCSSValue` check still rejects
    // a corrupted background / etc. — the new key-aware branch
    // only bypasses the colon check for `content`.
    const styleValue: UIDLStyleDefinitions = {
      background: { type: 'static', content: 'redcolor: blue' },
    }
    expect(getContentOfStyleObject(styleValue)).toEqual({})
  })
})
