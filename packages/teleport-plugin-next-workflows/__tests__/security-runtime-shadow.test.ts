import { loadHandler } from './_helpers/load-handler'
import {
  assertWorkflowsAreSecure,
  foldStringConcatenations,
  CodegenSecurityError,
  PROTECTED_ENV_NAMES,
  PROTECTED_ENV_NAME_PATTERN,
  PLATFORM_ENV_NAME_PATTERN,
} from '../src/security-scanner'

const SITE_SECRETS = [
  'NEXTAUTH_SECRET',
  'AUTH_PEPPER_SECRET',
  'VERCEL_AUTOMATION_BYPASS_SECRET',
  'TQ_CACHE_SECRET',
]

// The TeleportHQ database's parts, and one no copy lists by name (any later one).
const DATABASE_SECRETS = [
  'TELEPORT_DB_HOST',
  'TELEPORT_DB_PORT',
  'TELEPORT_DB_USER',
  'TELEPORT_DB_PASSWORD',
  'TELEPORT_DB_NAME',
  'TELEPORT_DB_SSL',
  'TELEPORT_DB_REPLICA_URL',
]

// Verifies the two security layers added on top of the general-custom-js
// handler:
//
//   1. Codegen-time gate (`assertWorkflowsAreSecure`) refuses to even emit
//      code for nodes whose user JS reads protected env vars or uses a
//      sandbox-escape primitive.
//
//   2. Runtime preamble injected into the `new Function(...)` body shadows
//      `process` so that `process.env.<protected>` resolves to `undefined`
//      even when the user code is executed.

describe('assertWorkflowsAreSecure (codegen gate)', () => {
  it('throws CodegenSecurityError when custom-js reads a protected env', () => {
    const uidlWorkflows = {
      workflows: {
        w1: {
          id: 'w1',
          name: 'wf',
          nodes: [
            {
              id: 'n1',
              type: 'general-custom-js',
              config: {
                code: 'function customHandler(){ return process.env.TELEPORT_DB_CONNECTION_STRING; }',
              },
            },
          ],
        },
      },
    }
    expect(() => assertWorkflowsAreSecure(uidlWorkflows)).toThrowError(CodegenSecurityError)
  })

  it('throws for eval', () => {
    const uidlWorkflows = {
      workflows: {
        w: {
          nodes: [{ id: 'a', type: 'general-custom-js', config: { code: "eval('1+1')" } }],
        },
      },
    }
    expect(() => assertWorkflowsAreSecure(uidlWorkflows)).toThrowError(CodegenSecurityError)
  })

  it('throws for require("fs")', () => {
    const uidlWorkflows = {
      workflows: {
        w: {
          nodes: [
            {
              id: 'a',
              type: 'general-custom-js',
              config: { code: "const fs = require('fs');" },
            },
          ],
        },
      },
    }
    expect(() => assertWorkflowsAreSecure(uidlWorkflows)).toThrowError(CodegenSecurityError)
  })

  it('passes a clean workflow', () => {
    const uidlWorkflows = {
      workflows: {
        w: {
          nodes: [
            {
              id: 'a',
              type: 'general-custom-js',
              config: { code: 'function customHandler(p){ return p[0]; }' },
            },
          ],
        },
      },
    }
    expect(() => assertWorkflowsAreSecure(uidlWorkflows)).not.toThrow()
  })

  it('ignores non-custom-js nodes', () => {
    const uidlWorkflows = {
      workflows: {
        w: {
          nodes: [
            {
              id: 'a',
              type: 'general-http-request',
              config: { url: 'https://example.com' },
            },
          ],
        },
      },
    }
    expect(() => assertWorkflowsAreSecure(uidlWorkflows)).not.toThrow()
  })

  it('refuses custom JS that names a payment credential, deployed or stored', () => {
    for (const name of [
      'STRIPE_SECRET_KEY',
      'CONFIGURATION_MOLLIE_API_KEY2',
      'PADDLE_WEBHOOK_SECRET',
    ]) {
      const uidlWorkflows = {
        workflows: {
          w: {
            nodes: [
              {
                id: 'a',
                type: 'general-custom-js',
                config: { code: `return process.env['${name}']` },
              },
            ],
          },
        },
      }
      expect(() => assertWorkflowsAreSecure(uidlWorkflows)).toThrowError(CodegenSecurityError)
    }
  })

  it('refuses custom JS that reads any TELEPORT_DB_ name', () => {
    for (const name of DATABASE_SECRETS) {
      for (const read of [`process.env.${name}`, `process.env['${name}']`]) {
        const uidlWorkflows = {
          workflows: {
            w: {
              nodes: [
                {
                  id: 'a',
                  type: 'general-custom-js',
                  config: { code: `function customHandler(){ return ${read}; }` },
                },
              ],
            },
          },
        }
        expect(() => assertWorkflowsAreSecure(uidlWorkflows)).toThrowError(CodegenSecurityError)
      }
    }
  })

  it('the TELEPORT_DB_ rule covers the whole family and nothing else', () => {
    for (const name of [...DATABASE_SECRETS, 'TELEPORT_DB_CONNECTION_STRING']) {
      expect(PLATFORM_ENV_NAME_PATTERN.test(name)).toBe(true)
    }
    for (const name of [
      'TELEPORT_DB_',
      'MY_TELEPORT_DB_PASSWORD',
      'TELEPORT_DBX',
      'teleport_db_host',
    ]) {
      expect(PLATFORM_ENV_NAME_PATTERN.test(name)).toBe(false)
    }
  })

  it('the payment credential pattern covers every provider and nothing else', () => {
    for (const name of [
      'STRIPE_WEBHOOK_SECRET',
      'PAYPAL_CLIENT_SECRET',
      'CONFIGURATION_RAZORPAY_KEY_SECRET',
      'SQUARE_ACCESS_TOKEN',
      'COINGATE_API_TOKEN',
    ]) {
      expect(PROTECTED_ENV_NAME_PATTERN.test(name)).toBe(true)
    }
    for (const name of [
      'STRIPE',
      'MY_STRIPE_KEY',
      'SQUARESPACE_TOKEN',
      'PUBLIC_FEATURE_FLAG',
      'stripe_secret_key',
    ]) {
      expect(PROTECTED_ENV_NAME_PATTERN.test(name)).toBe(false)
    }
  })

  it('PROTECTED_ENV_NAMES contains exactly the 17 documented secrets', () => {
    expect([...PROTECTED_ENV_NAMES].sort()).toEqual(
      [
        'PDF_SERVICE_API_KEY',
        'PDF_SERVICE_URL',
        'REALTIME_SERVER_API_KEY',
        'REALTIME_SERVER_URL',
        'RUNTIME_STORAGE_API_KEY',
        'RUNTIME_STORAGE_PROJECT_ID',
        'TELEPORT_CRON_SECRET',
        'TELEPORT_CRON_SECRET_PREVIOUS',
        'TELEPORT_DB_CONNECTION_STRING',
        'TELEPORT_PROJECT_TOKEN',
        'NEXTAUTH_SECRET',
        'AUTH_PEPPER_SECRET',
        'VERCEL_AUTOMATION_BYPASS_SECRET',
        'TQ_CACHE_SECRET',
        // The site's newsletter service key and the services worker's address
        // (the admin panel's newsletter route reads them, nothing else).
        'NEWSLETTER_SERVICE_TOKEN',
        'NEWSLETTER_SERVICE_URL',
        'TELEPORT_WALL_SECRET',
      ].sort()
    )
  })

  // The secrets TeleportHQ keeps for the site: the app secret every guard of
  // the site rests on, the password pepper, the deployment-protection bypass
  // and the cache-revalidation key.
  it('refuses custom JS that reads a site secret TeleportHQ keeps', () => {
    for (const name of SITE_SECRETS) {
      for (const read of [`process.env.${name}`, `process.env['${name}']`]) {
        const uidlWorkflows = {
          workflows: {
            w: {
              nodes: [
                {
                  id: 'a',
                  type: 'general-custom-js',
                  config: { code: `function customHandler(){ return ${read}; }` },
                },
              ],
            },
          },
        }
        expect(() => assertWorkflowsAreSecure(uidlWorkflows)).toThrowError(CodegenSecurityError)
      }
    }
  })

  it('refuses custom JS that reads a cron signing key', () => {
    for (const name of ['TELEPORT_CRON_SECRET', 'TELEPORT_CRON_SECRET_PREVIOUS']) {
      const uidlWorkflows = {
        workflows: {
          w: {
            nodes: [
              {
                id: 'a',
                type: 'general-custom-js',
                config: { code: `function customHandler(){ return process.env.${name}; }` },
              },
            ],
          },
        },
      }
      expect(() => assertWorkflowsAreSecure(uidlWorkflows)).toThrowError(CodegenSecurityError)
    }
  })

  // The bypasses the deploy-time scanner let through (A8-18): each reaches the
  // real global scope or process.env past the runtime's process shadow.
  const withCode = (code: string) => ({
    workflows: { w: { nodes: [{ id: 'a', type: 'general-custom-js', config: { code } }] } },
  })

  it('refuses the function-constructor and descriptor escapes', () => {
    const escapes = [
      "return (function(){}).constructor('return proc' + 'ess')().env",
      "return Function.prototype.constructor('return this')().process.env",
      "return (async function(){}).constructor('return 1')",
      "return [].map['constructor']('return this')()",
      "return Object.getOwnPropertyDescriptor(process, 'env').value",
      "return Reflect.get(process, 'env')",
      'return Object.values(globalThis).find(function (v) { return v && v.env && v.pid })',
      'for (var k in globalThis) { if (globalThis[k] && globalThis[k].pid) return globalThis[k] }',
      // The variants of the same class (fix round 1).
      "var C = (function(){}).constructor; return C('return process')().env",
      "return (function(){}).constructor.call(null, 'return process')().env",
      "return (() => {}).constructor.apply(null, ['return process'])().env",
      "const { constructor: F } = () => {}; return F('return process')().env",
      "return (function(){})['const' + 'ructor']('return process')().env",
      "return (function(){ return this })().process.env['TELEPORT_DB_' + 'CONNECTION_STRING']",
    ]
    for (const code of escapes) {
      expect(() =>
        assertWorkflowsAreSecure(withCode(`function customHandler(){ ${code} }`))
      ).toThrowError(CodegenSecurityError)
    }
  })

  it('still passes code that only compares a constructor or reads its name', () => {
    const code =
      'function customHandler(p){ var v = p[0]; var kind = v && v.constructor.name; ' +
      'return v && v.constructor === Object ? Object.keys(v).concat([kind]) : [] }'
    expect(() => assertWorkflowsAreSecure(withCode(code))).not.toThrow()
  })

  it('matches a name split across string literals as the whole name', () => {
    expect(foldStringConcatenations("x['const' + 'ruc' + \"tor\"]")).toBe("x['constructor']")
    expect(foldStringConcatenations("a + 'b' + c")).toBe("a + 'b' + c")
  })
})

describe('general-custom-js handler — runtime process shadow', () => {
  const handler = loadHandler('general-custom-js')

  const PROTECTED = process.env
  beforeAll(() => {
    // Inject sentinel values so we can confirm the shadow really hides them.
    process.env.TELEPORT_DB_CONNECTION_STRING = 'secret-db-url'
    process.env.RUNTIME_STORAGE_API_KEY = 'secret-storage'
    process.env.TELEPORT_PROJECT_TOKEN = 'secret-token'
    process.env.PUBLIC_FEATURE_FLAG = 'allowed'
    process.env.STRIPE_SECRET_KEY = 'sk_live_secret'
    process.env.CONFIGURATION_PAYPAL_CLIENT_SECRET2 = 'paypal-secret'
    process.env.TELEPORT_CRON_SECRET = 'cron-key'
    process.env.TELEPORT_CRON_SECRET_PREVIOUS = 'old-cron-key'
    for (const name of SITE_SECRETS) {
      process.env[name] = 'site-secret-' + name
    }
    for (const name of DATABASE_SECRETS) {
      process.env[name] = 'database-secret-' + name
    }
  })
  afterAll(() => {
    // Restore exactly what was there.
    process.env = { ...PROTECTED }
  })

  it('hides protected env vars from user code', async () => {
    const code = `function customHandler(){
      return {
        db: process.env.TELEPORT_DB_CONNECTION_STRING,
        storage: process.env.RUNTIME_STORAGE_API_KEY,
        token: process.env.TELEPORT_PROJECT_TOKEN,
        allowed: process.env.PUBLIC_FEATURE_FLAG,
      }
    }`
    const out = (await handler({ code, __nodeId: 'a' }, {})) as Record<string, unknown>
    expect(out.db).toBeUndefined()
    expect(out.storage).toBeUndefined()
    expect(out.token).toBeUndefined()
    expect(out.allowed).toBe('allowed')
  })

  it('hides protected vars from Object.keys(process.env)', async () => {
    const code = `function customHandler(){
      return Object.keys(process.env);
    }`
    const out = (await handler({ code, __nodeId: 'a' }, {})) as string[]
    expect(out).not.toContain('TELEPORT_DB_CONNECTION_STRING')
    expect(out).not.toContain('RUNTIME_STORAGE_API_KEY')
    expect(out).not.toContain('TELEPORT_PROJECT_TOKEN')
    expect(out).toContain('PUBLIC_FEATURE_FLAG')
  })

  it('hides protected vars from spread of process.env', async () => {
    const code = `function customHandler(){
      const all = { ...process.env };
      return Object.keys(all);
    }`
    const out = (await handler({ code, __nodeId: 'a' }, {})) as string[]
    expect(out).not.toContain('TELEPORT_DB_CONNECTION_STRING')
    expect(out).toContain('PUBLIC_FEATURE_FLAG')
  })

  it('hides protected vars from globalThis.process', async () => {
    const code = `function customHandler(){
      return globalThis.process.env.TELEPORT_DB_CONNECTION_STRING;
    }`
    const out = await handler({ code, __nodeId: 'a' }, {})
    expect(out).toBeUndefined()
  })

  it('returns undefined for protected vars via "in" check', async () => {
    const code = `function customHandler(){
      return 'TELEPORT_DB_CONNECTION_STRING' in process.env;
    }`
    const out = await handler({ code, __nodeId: 'a' }, {})
    expect(out).toBe(false)
  })

  it('hides the cron signing keys from user code', async () => {
    const code = `function customHandler(){
      return {
        current: process.env.TELEPORT_CRON_SECRET,
        previous: process.env['TELEPORT_CRON_SECRET_PREVIOUS'],
        listed: Object.keys(process.env).filter(function (k) { return /CRON/.test(k) }),
      }
    }`
    const out = (await handler({ code, __nodeId: 'a' }, {})) as Record<string, unknown>
    expect(out).toEqual({ current: undefined, previous: undefined, listed: [] })
  })

  it('hides the site secrets TeleportHQ keeps, by name and from every enumeration', async () => {
    const code = `function customHandler(){
      var names = ${JSON.stringify(SITE_SECRETS)};
      return {
        dotted: [process.env.NEXTAUTH_SECRET, process.env.AUTH_PEPPER_SECRET,
          process.env.VERCEL_AUTOMATION_BYPASS_SECRET, process.env.TQ_CACHE_SECRET],
        bracketed: names.map(function (n) { return process.env[n]; }),
        viaGlobal: names.map(function (n) { return globalThis.process.env[n]; }),
        has: names.filter(function (n) { return n in process.env; }),
        described: names.map(function (n) { return Object.getOwnPropertyDescriptor(process.env, n); }),
        listed: Object.keys(process.env).filter(function (k) { return names.indexOf(k) !== -1; }),
        spread: Object.keys({ ...process.env }).filter(function (k) { return names.indexOf(k) !== -1; }),
        allowed: process.env.PUBLIC_FEATURE_FLAG,
      }
    }`
    const out = (await handler({ code, __nodeId: 'a' }, {})) as Record<string, unknown>
    const none = SITE_SECRETS.map(() => undefined)
    expect(out).toEqual({
      dotted: none,
      bracketed: none,
      viaGlobal: none,
      has: [],
      described: none,
      listed: [],
      spread: [],
      allowed: 'allowed',
    })
    expect(JSON.stringify(out)).not.toContain('site-secret-')
  })

  it('hides every TELEPORT_DB_ name, by name and from every enumeration', async () => {
    const code = `function customHandler(){
      var names = ${JSON.stringify(DATABASE_SECRETS)};
      return {
        dotted: process.env.TELEPORT_DB_PASSWORD,
        bracketed: names.map(function (n) { return process.env[n]; }),
        has: names.filter(function (n) { return n in process.env; }),
        described: names.map(function (n) { return Object.getOwnPropertyDescriptor(process.env, n); }),
        listed: Object.keys(process.env).filter(function (k) { return k.indexOf('TELEPORT_DB_') === 0; }),
        spread: Object.keys({ ...process.env }).filter(function (k) { return k.indexOf('TELEPORT_DB_') === 0; }),
        allowed: process.env.PUBLIC_FEATURE_FLAG,
      }
    }`
    const out = (await handler({ code, __nodeId: 'a' }, {})) as Record<string, unknown>
    const none = DATABASE_SECRETS.map(() => undefined)
    expect(out).toEqual({
      dotted: undefined,
      bracketed: none,
      has: [],
      described: none,
      listed: [],
      spread: [],
      allowed: 'allowed',
    })
    expect(JSON.stringify(out)).not.toContain('database-secret-')
  })

  it('hides the merchant payment credentials from user code', async () => {
    const code = `function customHandler(){
      return {
        stripe: process.env.STRIPE_SECRET_KEY,
        paypal: process.env.CONFIGURATION_PAYPAL_CLIENT_SECRET2,
        listed: Object.keys(process.env).filter(function (k) { return /STRIPE|PAYPAL/.test(k) }),
        has: 'STRIPE_SECRET_KEY' in process.env,
        described: Object.getOwnPropertyDescriptor(process.env, 'STRIPE_SECRET_KEY'),
      }
    }`
    const out = (await handler({ code, __nodeId: 'a' }, {})) as Record<string, unknown>
    expect(out).toEqual({
      stripe: undefined,
      paypal: undefined,
      listed: [],
      has: false,
      described: undefined,
    })
  })

  it('runs server code in strict mode: a plain call gets no global this', async () => {
    const code = `function customHandler(){
      var self = (function(){ return this })();
      return { selfIsUndefined: self === undefined };
    }`
    expect(await handler({ code, __nodeId: 'n' }, {})).toEqual({ selfIsUndefined: true })
    const escape = `function customHandler(){
      return (function(){ return this })().process.env.TELEPORT_DB_CONNECTION_STRING;
    }`
    const result = (await handler({ code: escape, __nodeId: 'n' }, {})) as { error?: string }
    expect(result.error).toMatch(/undefined/)
    expect(JSON.stringify(result)).not.toContain('secret-db-url')
  })

  it('keeps a handler with a default parameter working under strict mode', async () => {
    const code = `function customHandler(params = []) {
      return { count: params.length, strict: (function(){ return this })() === undefined };
    }`
    expect(await handler({ code, __nodeId: 'n' }, { a: 1, b: 2 })).toEqual({
      count: 2,
      strict: true,
    })
    // A destructured signature still compiles and runs under strict mode (its
    // values are not forwarded by name — they never were).
    const destructured = `function customHandler({ items } = {}) {
      return { ran: true };
    }`
    expect(await handler({ code: destructured, __nodeId: 'n' }, { a: 1 })).toEqual({ ran: true })
  })

  it('does not break access to non-process bindings', async () => {
    const code = `function customHandler(){
      return 1 + 2;
    }`
    const out = await handler({ code, __nodeId: 'a' }, {})
    expect(out).toBe(3)
  })
})
