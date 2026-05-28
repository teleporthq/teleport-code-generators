import { loadHandler } from './_helpers/load-handler'
import {
  assertWorkflowsAreSecure,
  CodegenSecurityError,
  PROTECTED_ENV_NAMES,
} from '../src/security-scanner'

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

  it('PROTECTED_ENV_NAMES contains exactly the 8 documented secrets', () => {
    expect([...PROTECTED_ENV_NAMES].sort()).toEqual(
      [
        'PDF_SERVICE_API_KEY',
        'PDF_SERVICE_URL',
        'REALTIME_SERVER_API_KEY',
        'REALTIME_SERVER_URL',
        'RUNTIME_STORAGE_API_KEY',
        'RUNTIME_STORAGE_PROJECT_ID',
        'TELEPORT_DB_CONNECTION_STRING',
        'TELEPORT_PROJECT_TOKEN',
      ].sort()
    )
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

  it('does not break access to non-process bindings', async () => {
    const code = `function customHandler(){
      return 1 + 2;
    }`
    const out = await handler({ code, __nodeId: 'a' }, {})
    expect(out).toBe(3)
  })
})
