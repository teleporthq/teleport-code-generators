import { loadHandler } from './_helpers/load-handler'
import {
  assertWorkflowsAreSecure,
  CodegenSecurityError,
  INTEGRATION_ENV_NAME_PATTERN,
} from '../src/security-scanner'

// The integrations keep another member's sign-in in the project's secrets under
// `__` names (`__gsc_access`, `__google_merchant_refresh`,
// `__social_oauth_<platform>_*`), and every publish before 2026-10-26 put them
// in the site's environment. Custom JS may not read them: the codegen gate
// refuses the obvious reads, the runtime shadow hides them from the rest.

const withCode = (code: string) => ({
  workflows: { w: { nodes: [{ id: 'a', type: 'general-custom-js', config: { code } }] } },
})

describe('the codegen gate and integration secrets', () => {
  it('names every __ env name as protected', () => {
    expect(INTEGRATION_ENV_NAME_PATTERN.test('__gsc_access')).toBe(true)
    expect(INTEGRATION_ENV_NAME_PATTERN.test('__social_oauth_instagram_story_refresh')).toBe(true)
    expect(INTEGRATION_ENV_NAME_PATTERN.test('MY__KEY')).toBe(false)
    expect(INTEGRATION_ENV_NAME_PATTERN.test('_single')).toBe(false)
  })

  it.each([
    'return process.env.__gsc_access',
    "return process.env['__google_merchant_refresh']",
    'return process.env["__social_oauth_linkedin_access"]',
    'var env = process.env; return env . __gsc_refresh',
  ])('refuses %s', (body) => {
    expect(() =>
      assertWorkflowsAreSecure(withCode(`function customHandler(){ ${body} }`))
    ).toThrowError(CodegenSecurityError)
  })

  it('still passes code that mentions a __ name anywhere but an env read', () => {
    const code =
      'function customHandler(p){ var o = {}; var proto = o.__proto__; ' +
      'return { proto: !!proto, dir: typeof __dirname, label: "__gsc_access" } }'
    expect(() => assertWorkflowsAreSecure(withCode(code))).not.toThrow()
  })
})

describe('the runtime shadow and integration secrets', () => {
  const handler = loadHandler('general-custom-js')
  const ORIGINAL = process.env

  beforeAll(() => {
    process.env.__gsc_access = 'ya29.leaked'
    process.env.__social_oauth_x_refresh = 'x-leaked'
    process.env.PUBLIC_FEATURE_FLAG = 'allowed'
  })
  afterAll(() => {
    process.env = { ...ORIGINAL }
  })

  it('hides them from a read, a computed read and a key listing', async () => {
    const code = `function customHandler(){
      var name = '__social' + '_oauth_x_refresh';
      return {
        direct: process.env.__gsc_access,
        computed: process.env[name],
        listed: Object.keys(process.env).filter(function (k) { return k.indexOf('__') === 0 }),
        allowed: process.env.PUBLIC_FEATURE_FLAG,
      }
    }`
    const out = (await handler({ code, __nodeId: 'a' }, {})) as Record<string, unknown>
    expect(out.direct).toBeUndefined()
    expect(out.computed).toBeUndefined()
    expect(out.listed).toEqual([])
    expect(out.allowed).toBe('allowed')
  })
})
