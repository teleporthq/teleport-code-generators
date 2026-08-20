import { utilityCsvParse } from '../src/nodes/utility/utility-csv-parse'
import { utilityEncodeDecode } from '../src/nodes/utility/utility-encode-decode'
import { utilitySimilarityScoring } from '../src/nodes/utility/utility-similarity-scoring'
import { utilityVerifyEmail } from '../src/nodes/utility/utility-verify-email'
import { utilityVerifyPhone } from '../src/nodes/utility/utility-verify-phone'
import { utilityExtractContacts } from '../src/nodes/utility/utility-extract-contacts'
import { utilityFullTextSearch } from '../src/nodes/utility/utility-full-text-search'
import { utilityHashData } from '../src/nodes/utility/utility-hash-data'
import { utilityAnonymizeData } from '../src/nodes/utility/utility-anonymize-data'
import { utilityParseUrl } from '../src/nodes/utility/utility-parse-url'
import { utilityFormatPhoneNumber } from '../src/nodes/utility/utility-format-phone-number'
import { utilitySemanticSearch } from '../src/nodes/utility/utility-semantic-search'
import { utilityHybridSearch } from '../src/nodes/utility/utility-hybrid-search'
import { resolveHandlerEntryName } from '../src/nodes/types'

/* tslint:disable:no-eval */
// Loads a handler the way the generated project does — the source goes inside
// an IIFE that returns the entry point by name (see `api-route-generator`).
//
// ⛔ The previous `eval('(' + source + ')')` assumed a handler emits nothing
// but a bare function expression. That stopped being true the moment a handler
// needed a shared prelude: the AI-provider utils emit `var` helpers ahead of
// the entry, exactly as `ai-custom-prompt` has always done, and the wrapper
// then failed with "Unexpected token 'var'".
//
// `eval` rather than `new Function` on purpose: it keeps module scope, so
// handlers that `require('crypto')` and the ts-jest `__awaiter`/`__generator`
// helpers both still resolve.
function createHandler(generator: { nodeType: string; generateHandler(): string }) {
  const source = generator.generateHandler().trim()
  const entry = resolveHandlerEntryName(source, generator.nodeType)
  return eval(`(function () {\n${source}\nreturn ${entry};\n})()`)
}

describe('utility-csv-parse', () => {
  let handler: any
  beforeAll(() => {
    handler = createHandler(utilityCsvParse)
  })

  it('parses basic CSV with headers', async () => {
    const result = await handler({ data: 'name,age\nAlice,30\nBob,25' }, {})
    expect(result.rows).toEqual([
      { name: 'Alice', age: '30' },
      { name: 'Bob', age: '25' },
    ])
    expect(result.headers).toEqual(['name', 'age'])
    expect(result.rowCount).toBe(2)
  })

  it('handles quoted fields with commas', async () => {
    const result = await handler(
      { data: 'name,address\nAlice,"123 Main St, Apt 4"\nBob,"456 Oak Ave"' },
      {}
    )
    expect(result.rows[0].address).toBe('123 Main St, Apt 4')
  })

  it('handles escaped quotes', async () => {
    const result = await handler({ data: 'value\n"He said ""hello"""' }, {})
    expect(result.rows[0].value).toBe('He said "hello"')
  })

  it('handles CRLF line endings', async () => {
    const result = await handler({ data: 'a,b\r\n1,2\r\n3,4' }, {})
    expect(result.rowCount).toBe(2)
  })

  it('handles custom delimiter', async () => {
    const result = await handler({ data: 'a;b\n1;2', delimiter: ';' }, {})
    expect(result.rows[0]).toEqual({ a: '1', b: '2' })
  })

  it('handles no headers mode', async () => {
    const result = await handler({ data: '1,2\n3,4', hasHeaders: false }, {})
    expect(result.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('returns empty for empty input', async () => {
    const result = await handler({ data: '' }, {})
    expect(result.rows).toEqual([])
    expect(result.rowCount).toBe(0)
  })

  it('handles BOM character', async () => {
    const result = await handler({ data: '\uFEFFname,val\na,1' }, {})
    expect(result.headers).toEqual(['name', 'val'])
  })

  it('skips empty lines', async () => {
    const result = await handler({ data: 'a,b\n1,2\n\n3,4' }, {})
    expect(result.rowCount).toBe(2)
  })
})

describe('utility-encode-decode', () => {
  let handler: any
  beforeAll(() => {
    handler = createHandler(utilityEncodeDecode)
  })

  it('base64 encode/decode', async () => {
    const encoded = await handler({ data: 'hello world', operation: 'base64-encode' }, {})
    expect(encoded.result).toBe('aGVsbG8gd29ybGQ=')
    const decoded = await handler({ data: encoded.result, operation: 'base64-decode' }, {})
    expect(decoded.result).toBe('hello world')
  })

  it('url encode/decode', async () => {
    const encoded = await handler({ data: 'hello world & more', operation: 'url-encode' }, {})
    expect(encoded.result).toBe('hello%20world%20%26%20more')
    const decoded = await handler({ data: encoded.result, operation: 'url-decode' }, {})
    expect(decoded.result).toBe('hello world & more')
  })

  it('html encode/decode', async () => {
    const encoded = await handler(
      { data: '<script>alert("xss")</script>', operation: 'html-encode' },
      {}
    )
    expect(encoded.result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    const decoded = await handler({ data: encoded.result, operation: 'html-decode' }, {})
    expect(decoded.result).toBe('<script>alert("xss")</script>')
  })

  it('hex encode/decode', async () => {
    const encoded = await handler({ data: 'abc', operation: 'hex-encode' }, {})
    expect(encoded.result).toBe('616263')
    const decoded = await handler({ data: '616263', operation: 'hex-decode' }, {})
    expect(decoded.result).toBe('abc')
  })

  it('json encode/decode', async () => {
    const encoded = await handler({ data: { a: 1 }, operation: 'json-encode' }, {})
    expect(encoded.result).toBe('{"a":1}')
    const decoded = await handler({ data: '{"a":1}', operation: 'json-decode' }, {})
    expect(decoded.result).toEqual({ a: 1 })
  })

  it('returns error for unknown operation', async () => {
    const result = await handler({ data: 'test', operation: 'unknown' }, {})
    expect(result.error).toBeTruthy()
  })
})

describe('utility-similarity-scoring', () => {
  let handler: any
  beforeAll(() => {
    handler = createHandler(utilitySimilarityScoring)
  })

  it('levenshtein: identical strings = 1', async () => {
    const result = await handler({ text1: 'hello', text2: 'hello', algorithm: 'levenshtein' }, {})
    expect(result.score).toBe(1)
  })

  it('levenshtein: completely different = low score', async () => {
    const result = await handler({ text1: 'abc', text2: 'xyz', algorithm: 'levenshtein' }, {})
    expect(result.score).toBeLessThan(0.5)
  })

  it('levenshtein: empty strings = 1', async () => {
    const result = await handler({ text1: '', text2: '', algorithm: 'levenshtein' }, {})
    expect(result.score).toBe(1)
  })

  it('jaccard: identical = 1', async () => {
    const result = await handler(
      { text1: 'the cat sat', text2: 'the cat sat', algorithm: 'jaccard' },
      {}
    )
    expect(result.score).toBe(1)
  })

  it('jaccard: partial overlap', async () => {
    const result = await handler({ text1: 'the cat', text2: 'the dog', algorithm: 'jaccard' }, {})
    expect(result.score).toBeGreaterThan(0)
    expect(result.score).toBeLessThan(1)
  })

  it('cosine: identical = 1', async () => {
    const result = await handler(
      { text1: 'hello world', text2: 'hello world', algorithm: 'cosine' },
      {}
    )
    expect(result.score).toBe(1)
  })

  it('dice: identical = 1', async () => {
    const result = await handler(
      { text1: 'hello world', text2: 'hello world', algorithm: 'dice' },
      {}
    )
    expect(result.score).toBe(1)
  })

  it('jaro-winkler: identical = 1', async () => {
    const result = await handler({ text1: 'hello', text2: 'hello', algorithm: 'jaro-winkler' }, {})
    expect(result.score).toBe(1)
  })

  it('jaro-winkler: similar strings = high score', async () => {
    const result = await handler(
      { text1: 'martha', text2: 'marhta', algorithm: 'jaro-winkler' },
      {}
    )
    expect(result.score).toBeGreaterThan(0.9)
  })

  it('hamming: requires equal length', async () => {
    const result = await handler({ text1: 'abc', text2: 'abcd', algorithm: 'hamming' }, {})
    expect(result.error).toBeTruthy()
  })

  it('hamming: identical = 1', async () => {
    const result = await handler({ text1: 'abc', text2: 'abc', algorithm: 'hamming' }, {})
    expect(result.score).toBe(1)
  })

  it('unknown algorithm returns error', async () => {
    const result = await handler({ text1: 'a', text2: 'b', algorithm: 'unknown' }, {})
    expect(result.error).toBeTruthy()
  })
})

describe('utility-verify-email', () => {
  let handler: any
  beforeAll(() => {
    handler = createHandler(utilityVerifyEmail)
  })

  it('validates correct emails', async () => {
    const result = await handler({ email: 'user@example.com' }, {})
    expect(result.isValid).toBe(true)
    expect(result.details.domain).toBe('example.com')
  })

  it('rejects invalid emails', async () => {
    const result = await handler({ email: 'not-an-email' }, {})
    expect(result.isValid).toBe(false)
  })

  it('rejects emails with consecutive dots', async () => {
    const result = await handler({ email: 'user..name@example.com' }, {})
    expect(result.isValid).toBe(false)
    expect(result.details.hasConsecutiveDots).toBe(true)
  })

  it('detects disposable email domains', async () => {
    const result = await handler({ email: 'test@mailinator.com' }, {})
    expect(result.isValid).toBe(false)
    expect(result.details.isDisposable).toBe(true)
  })

  it('handles empty input', async () => {
    const result = await handler({ email: '' }, {})
    expect(result.isValid).toBe(false)
  })

  it('trims and lowercases email', async () => {
    const result = await handler({ email: '  User@EXAMPLE.COM  ' }, {})
    expect(result.details.localPart).toBe('user')
    expect(result.details.domain).toBe('example.com')
  })
})

describe('utility-verify-phone', () => {
  let handler: any
  beforeAll(() => {
    handler = createHandler(utilityVerifyPhone)
  })

  it('validates standard phone numbers', async () => {
    const result = await handler({ phone: '+1 (234) 567-8901' }, {})
    expect(result.isValid).toBe(true)
    expect(result.details.hasCountryCode).toBe(true)
  })

  it('rejects too-short numbers', async () => {
    const result = await handler({ phone: '12345' }, {})
    expect(result.isValid).toBe(false)
  })

  it('provides e164 format', async () => {
    const result = await handler({ phone: '+12345678901' }, {})
    expect(result.details.e164).toBe('+12345678901')
  })

  it('handles empty input', async () => {
    const result = await handler({ phone: '' }, {})
    expect(result.isValid).toBe(false)
  })
})

describe('utility-extract-contacts', () => {
  let handler: any
  beforeAll(() => {
    handler = createHandler(utilityExtractContacts)
  })

  it('extracts emails', async () => {
    const result = await handler({ text: 'Contact us at info@example.com or support@test.org' }, {})
    expect(result.emails).toContain('info@example.com')
    expect(result.emails).toContain('support@test.org')
  })

  it('extracts phone numbers', async () => {
    const result = await handler({ text: 'Call 1234567890 or +1 (555) 123-4567' }, {})
    expect(result.phones.length).toBeGreaterThan(0)
  })

  it('extracts URLs', async () => {
    const result = await handler({ text: 'Visit https://example.com or http://test.org/page' }, {})
    expect(result.urls.length).toBe(2)
  })

  it('deduplicates by default', async () => {
    const result = await handler({ text: 'email: test@test.com and also test@test.com' }, {})
    expect(result.emails.length).toBe(1)
  })

  it('returns empty for empty input', async () => {
    const result = await handler({ text: '' }, {})
    expect(result.contacts).toEqual([])
  })
})

describe('utility-full-text-search', () => {
  let handler: any
  beforeAll(() => {
    handler = createHandler(utilityFullTextSearch)
  })

  const collection = [
    { title: 'JavaScript Guide', body: 'Learn JavaScript programming' },
    { title: 'Python Tutorial', body: 'Python is great for data science' },
    { title: 'TypeScript Handbook', body: 'TypeScript extends JavaScript' },
  ]

  it('finds matching items', async () => {
    const result = await handler({ query: 'JavaScript', collection }, {})
    expect(result.results.length).toBe(2)
    expect(result.results[0].title).toContain('JavaScript')
  })

  it('returns empty for no matches', async () => {
    const result = await handler({ query: 'Rust', collection }, {})
    expect(result.results.length).toBe(0)
  })

  it('supports field filtering', async () => {
    const result = await handler({ query: 'JavaScript', collection, fields: ['title'] }, {})
    expect(result.results.length).toBe(1)
  })

  it('supports pagination', async () => {
    const result = await handler({ query: 'a', collection, limit: 1, offset: 0 }, {})
    expect(result.results.length).toBe(1)
    expect(result.totalCount).toBeGreaterThan(1)
  })

  it('handles empty query', async () => {
    const result = await handler({ query: '', collection }, {})
    expect(result.results).toEqual([])
  })

  it('handles empty collection', async () => {
    const result = await handler({ query: 'test', collection: [] }, {})
    expect(result.results).toEqual([])
  })
})

describe('utility-hash-data', () => {
  let handler: any
  beforeAll(() => {
    handler = createHandler(utilityHashData)
  })

  it('hashes with sha256 by default', async () => {
    const result = await handler({ data: 'hello' }, {})
    expect(result.hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    expect(result.type).toBe('hash')
  })

  it('supports md5', async () => {
    const result = await handler({ data: 'hello', algorithm: 'md5' }, {})
    expect(result.hash).toBe('5d41402abc4b2a76b9719d911017c592')
  })

  it('supports HMAC', async () => {
    const result = await handler({ data: 'hello', hmacKey: 'secret' }, {})
    expect(result.hash).toBeTruthy()
    expect(result.type).toBe('hmac')
  })

  it('supports base64 encoding', async () => {
    const result = await handler({ data: 'hello', encoding: 'base64' }, {})
    expect(result.hash).toBeTruthy()
    expect(result.encoding).toBe('base64')
  })

  it('rejects unsupported algorithm', async () => {
    const result = await handler({ data: 'hello', algorithm: 'invalid' }, {})
    expect(result.error).toBeTruthy()
  })
})

describe('utility-anonymize-data', () => {
  let handler: any
  beforeAll(() => {
    handler = createHandler(utilityAnonymizeData)
  })

  it('masks fields', async () => {
    const result = await handler(
      {
        data: { name: 'John', email: 'john@test.com', age: 30 },
        fields: ['name', 'email'],
        strategy: 'mask',
      },
      {}
    )
    expect(result.result.name).not.toBe('John')
    expect(result.result.name.charAt(0)).toBe('J')
    expect(result.result.email).toContain('@test.com')
    expect(result.result.age).toBe(30)
  })

  it('redacts fields', async () => {
    const result = await handler(
      {
        data: { name: 'John', ssn: '123-45-6789' },
        fields: ['ssn'],
        strategy: 'redact',
      },
      {}
    )
    expect(result.result.ssn).toBe('[REDACTED]')
    expect(result.result.name).toBe('John')
  })

  it('handles nested objects', async () => {
    const result = await handler(
      {
        data: { user: { name: 'Alice', email: 'a@b.com' } },
        fields: ['email'],
        strategy: 'redact',
      },
      {}
    )
    expect(result.result.user.email).toBe('[REDACTED]')
    expect(result.result.user.name).toBe('Alice')
  })

  it('handles arrays', async () => {
    const result = await handler(
      {
        data: [
          { name: 'A', secret: '123' },
          { name: 'B', secret: '456' },
        ],
        fields: ['secret'],
        strategy: 'remove',
      },
      {}
    )
    expect(result.result[0].secret).toBeUndefined()
    expect(result.result[0].name).toBe('A')
  })

  it('supports per-field strategies', async () => {
    const result = await handler(
      {
        data: { name: 'John', email: 'j@test.com' },
        fields: ['name', 'email'],
        strategy: 'mask',
        fieldStrategies: { email: 'redact' },
      },
      {}
    )
    expect(result.result.email).toBe('[REDACTED]')
    expect(result.result.name).not.toBe('[REDACTED]')
  })
})

describe('utility-parse-url', () => {
  let handler: any
  beforeAll(() => {
    handler = createHandler(utilityParseUrl)
  })

  it('parses a full URL', async () => {
    const result = await handler(
      { url: 'https://example.com:8080/path/to/page?q=test&lang=en#section' },
      {}
    )
    expect(result.protocol).toBe('https:')
    expect(result.hostname).toBe('example.com')
    expect(result.port).toBe('8080')
    expect(result.pathname).toBe('/path/to/page')
    expect(result.params.q).toBe('test')
    expect(result.params.lang).toBe('en')
    expect(result.hash).toBe('#section')
    expect(result.isSecure).toBe(true)
    expect(result.pathSegments).toEqual(['path', 'to', 'page'])
  })

  it('handles subdomain detection', async () => {
    const result = await handler({ url: 'https://api.staging.example.com/v1' }, {})
    expect(result.subdomain).toBe('api.staging')
    expect(result.domain).toBe('example.com')
  })

  it('returns error for invalid URL', async () => {
    const result = await handler({ url: 'not a url' }, {})
    expect(result.error).toBeTruthy()
  })

  it('handles empty input', async () => {
    const result = await handler({ url: '' }, {})
    expect(result.error).toBeTruthy()
  })

  it('handles duplicate query params', async () => {
    const result = await handler({ url: 'https://example.com?tag=a&tag=b' }, {})
    expect(Array.isArray(result.params.tag)).toBe(true)
    expect(result.params.tag).toEqual(['a', 'b'])
  })
})

describe('utility-format-phone-number', () => {
  let handler: any
  beforeAll(() => {
    handler = createHandler(utilityFormatPhoneNumber)
  })

  it('formats to international', async () => {
    const result = await handler({ phone: '+12345678901', format: 'international' }, {})
    expect(result.formatted).toBe('+12345678901')
  })

  it('formats to national (US)', async () => {
    const result = await handler({ phone: '2345678901', format: 'national' }, {})
    expect(result.formatted).toBe('(234) 567-8901')
  })

  it('formats to e164', async () => {
    const result = await handler({ phone: '+1 234 567 8901', format: 'e164' }, {})
    expect(result.formatted).toBe('+12345678901')
  })

  it('adds country code', async () => {
    const result = await handler({ phone: '2345678901', format: 'e164', countryCode: '1' }, {})
    expect(result.formatted).toBe('+12345678901')
  })

  it('returns error for empty input', async () => {
    const result = await handler({ phone: '' }, {})
    expect(result.error).toBeTruthy()
  })

  it('returns error for too short number', async () => {
    const result = await handler({ phone: '123' }, {})
    expect(result.error).toBeTruthy()
  })
})

describe('utility-semantic-search', () => {
  let handler: any
  beforeAll(() => {
    handler = createHandler(utilitySemanticSearch)
  })

  it('searches using bag-of-words when no embeddings', async () => {
    const collection = [
      { title: 'JavaScript basics', content: 'Learn JS fundamentals' },
      { title: 'Python guide', content: 'Python for beginners' },
      { title: 'Advanced JavaScript', content: 'Deep dive into JS patterns' },
    ]
    const result = await handler({ query: 'JavaScript', documents: collection }, {})
    expect(result.results.length).toBeGreaterThan(0)
    expect(result.results[0].item.title).toContain('JavaScript')
  })

  it('searches using provided embeddings', async () => {
    const collection = [
      { title: 'A', embedding: [1, 0, 0] },
      { title: 'B', embedding: [0, 1, 0] },
      { title: 'C', embedding: [0.9, 0.1, 0] },
    ]
    const result = await handler({ queryEmbedding: [1, 0, 0], documents: collection }, {})
    expect(result.results.length).toBeGreaterThan(0)
    expect(result.results[0].item.title).toBe('A')
  })

  it('respects topK', async () => {
    const collection = [
      { title: 'A', embedding: [1, 0, 0] },
      { title: 'B', embedding: [0.9, 0.1, 0] },
      { title: 'C', embedding: [0.8, 0.2, 0] },
    ]
    const result = await handler({ queryEmbedding: [1, 0, 0], documents: collection, topK: 2 }, {})
    expect(result.results.length).toBe(2)
  })

  it('returns error for empty inputs', async () => {
    const result = await handler({ query: '', documents: [] }, {})
    expect(result.error).toBeTruthy()
  })
})

describe('utility-hybrid-search', () => {
  let handler: any
  beforeAll(() => {
    handler = createHandler(utilityHybridSearch)
  })

  it('combines text and semantic scores', async () => {
    const collection = [
      { title: 'JavaScript guide', embedding: [1, 0, 0] },
      { title: 'Python tutorial', embedding: [0, 1, 0] },
      { title: 'JS patterns', embedding: [0.8, 0.2, 0] },
    ]
    const result = await handler(
      { query: 'JavaScript', queryEmbedding: [1, 0, 0], documents: collection, fields: ['title'] },
      {}
    )
    expect(result.results.length).toBeGreaterThan(0)
    expect(result.hasSemanticScores).toBe(true)
  })

  it('works with text-only (no embeddings)', async () => {
    const collection = [{ title: 'JavaScript basics' }, { title: 'Python guide' }]
    const result = await handler(
      { query: 'JavaScript', documents: collection, fields: ['title'] },
      {}
    )
    expect(result.results.length).toBe(1)
    expect(result.hasSemanticScores).toBe(false)
  })

  it('returns error for empty query', async () => {
    const result = await handler({ query: '', documents: [] }, {})
    expect(result.error).toBeTruthy()
  })
})
