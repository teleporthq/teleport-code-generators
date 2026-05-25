import { generateClientRuntimeCode } from '../src/executor-generator'

// Regression guard for the server-side relative-URL fetch bug. The
// generated client runtime is also loaded from Node in server-only
// paths (e.g. Stripe / PayPal webhooks that trigger custom workflow
// nodes with a server segment): undici's `fetch` rejects relative
// URLs with "Failed to parse URL from /api/workflows/...".
//
// `absolutizeSegmentUrl` closes that gap using `context.__baseUrl`
// (the live request origin recorded by the api-route generator).
// This file locks the behaviour in with a battery of inputs so a
// future refactor of the runtime can't silently reintroduce the
// relative-URL fetch that used to crash payment webhooks.

type Absolutize = (segmentUrl: unknown, context: unknown) => unknown

function extractAbsolutizer(): Absolutize {
  const src = generateClientRuntimeCode()
  // Match from `function absolutizeSegmentUrl` up to the matching
  // closing brace on its own line, then `eval` it to expose the
  // function. The runtime is generated as a single string, so eval
  // here is the cleanest way to exercise its internals without
  // booting Next.js.
  const match = src.match(/function absolutizeSegmentUrl[\s\S]*?\n\}/)
  if (!match) {
    throw new Error('absolutizeSegmentUrl not found in generated runtime')
  }
  // Node gives us access to `window` in test env via globalThis only
  // when we set it — keep it undefined here so the function behaves
  // as it would in a Node workflow segment.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(match[0] + '\nreturn absolutizeSegmentUrl;')() as Absolutize
}

describe('absolutizeSegmentUrl — server-side workflow fetch bridge', () => {
  const abs = extractAbsolutizer()

  it('absolutizes a relative /api URL using context.__baseUrl', () => {
    expect(
      abs('/api/workflows/process-payment-webhook-seg-server-1', {
        __baseUrl: 'http://localhost:3000',
      })
    ).toBe('http://localhost:3000/api/workflows/process-payment-webhook-seg-server-1')
  })

  it('strips any trailing slashes from __baseUrl before concatenating', () => {
    // Whether req.headers.host is "localhost:3000" or "example.com/"
    // depends on deployment; both must produce the same URL.
    expect(abs('/api/workflows/seg', { __baseUrl: 'http://localhost:3000/' })).toBe(
      'http://localhost:3000/api/workflows/seg'
    )
    expect(abs('/api/workflows/seg', { __baseUrl: 'http://example.com///' })).toBe(
      'http://example.com/api/workflows/seg'
    )
  })

  it('leaves an already-absolute http(s) URL untouched', () => {
    expect(abs('http://other.example/api', { __baseUrl: 'http://localhost:3000' })).toBe(
      'http://other.example/api'
    )
    expect(abs('https://other.example/api', { __baseUrl: 'http://localhost:3000' })).toBe(
      'https://other.example/api'
    )
  })

  it('falls back to the original URL when __baseUrl is missing', () => {
    // Server-side without __baseUrl means the api-route generator
    // didn't run before this point — the fetch will still fail, but
    // that's a generator bug, not this function's job. Keep the URL
    // unchanged so the error message continues to point at the real
    // cause.
    expect(abs('/api/workflows/seg', {})).toBe('/api/workflows/seg')
    expect(abs('/api/workflows/seg', null)).toBe('/api/workflows/seg')
    expect(abs('/api/workflows/seg', undefined)).toBe('/api/workflows/seg')
  })

  it('prefixes a missing leading slash before concatenating', () => {
    // Defensive: if a future codegen emits 'api/workflows/seg' without
    // the leading '/', the concat must still produce a valid URL.
    expect(abs('api/workflows/seg', { __baseUrl: 'http://localhost:3000' })).toBe(
      'http://localhost:3000/api/workflows/seg'
    )
  })

  it('passes through empty / null / non-string inputs untouched', () => {
    expect(abs('', { __baseUrl: 'http://localhost:3000' })).toBe('')
    expect(abs(null, { __baseUrl: 'http://localhost:3000' })).toBe(null)
    expect(abs(undefined, { __baseUrl: 'http://localhost:3000' })).toBe(undefined)
  })
})
