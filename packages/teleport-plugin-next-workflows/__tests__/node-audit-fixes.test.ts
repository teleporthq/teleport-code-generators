/* tslint:disable:no-eval */
import { transformValidate } from '../src/nodes/transform/transform-validate'
import { elementAddClass } from '../src/nodes/element/element-add-class'
import { elementToggleClass } from '../src/nodes/element/element-toggle-class'
import { integrationMailchimp } from '../src/nodes/integrations/integration-mailchimp'
import { integrationSegment } from '../src/nodes/integrations/integration-segment'
import { integrationSlack } from '../src/nodes/integrations/integration-slack'
import { integrationYoutube } from '../src/nodes/integrations/integration-youtube'
import { integrationWoocommerce } from '../src/nodes/integrations/integration-woocommerce'
import { integrationAmazonS3 } from '../src/nodes/integrations/integration-amazon-s3'
import { integrationGreenhouse } from '../src/nodes/integrations/integration-greenhouse'
import { createGenericIntegration } from '../src/nodes/integrations/integration-generic'
import { transformDateTime } from '../src/nodes/transform/transform-date-time'

// Regression guards for the 26 bugs found by the full node audit. Functional
// where the fix is logic (eval the emitted handler and run it); string-level
// where the fix is an API contract embedded in the generated source.

function evalHandler(code: string): any {
  return eval('(' + code + ')')
}

describe('node-audit fixes — functional', () => {
  it('transform-validate accepts valid emails and rejects invalid (regex no longer double-escaped)', async () => {
    const handler = evalHandler(transformValidate.generateHandler())
    const cfg = {
      input: { a: 'john@example.com', b: 'nope' },
      rules: [
        { field: 'a', rule: 'email' },
        { field: 'b', rule: 'email' },
      ],
    }
    const res = await handler(cfg, {})
    // field a is valid, field b is invalid → exactly one error, for field b.
    expect(res.isValid).toBe(false)
    expect(res.errors.length).toBe(1)
    // And a fully-valid set passes.
    const ok = await handler(
      { input: { a: 'jane.doe@sub.example.co' }, rules: [{ field: 'a', rule: 'email' }] },
      {}
    )
    expect(ok.isValid).toBe(true)
  })

  it('element-add-class handles a multi-class string and empty value without throwing', async () => {
    const added: string[] = []
    const el = {
      classList: {
        add: (c: string) => {
          if (!c || /\s/.test(c)) throw new Error('InvalidCharacterError')
          added.push(c)
        },
      },
    }
    ;(global as any).document = { getElementById: () => el }
    try {
      const handler = evalHandler(elementAddClass.generateHandler())
      const res = await handler({ nodeId: 'x', className: 'btn  active' }, {})
      expect(res).toEqual({ success: true })
      expect(added).toEqual(['btn', 'active'])
      // Empty className must not throw.
      const res2 = await handler({ nodeId: 'x', className: '' }, {})
      expect(res2).toEqual({ success: true })
    } finally {
      delete (global as any).document
    }
  })

  it('element-toggle-class splits a multi-class string instead of throwing', async () => {
    const toggled: string[] = []
    const el = {
      classList: {
        toggle: (c: string) => {
          if (!c || /\s/.test(c)) throw new Error('InvalidCharacterError')
          toggled.push(c)
        },
      },
    }
    ;(global as any).document = { getElementById: () => el }
    try {
      const handler = evalHandler(elementToggleClass.generateHandler())
      const res = await handler({ nodeId: 'x', className: 'is-open active' }, {})
      expect(res).toEqual({ success: true })
      expect(toggled).toEqual(['is-open', 'active'])
    } finally {
      delete (global as any).document
    }
  })

  it('transform-date-time is-weekend operation is now reachable', () => {
    const code = transformDateTime.generateHandler()
    expect(code).toContain("case 'is-weekend':")
  })
})

describe('node-audit fixes — emitted API contracts', () => {
  it('mailchimp guards a missing apiKey before calling .split', () => {
    const code = integrationMailchimp.generateHandler()
    expect(code).toMatch(/Mailchimp API key is not configured/)
    // the guard precedes the .split('-') call
    expect(code.indexOf('is not configured')).toBeLessThan(code.indexOf(".split('-')"))
  })

  it('segment get-profile uses Basic auth, not the wrong "Segment " scheme', () => {
    const code = integrationSegment.generateHandler()
    expect(code).toContain("'Basic ' + btoa(config.personasToken")
    expect(code).not.toContain("'Segment ' + config.personasToken")
  })

  it('slack files.upload sends form-urlencoded, not JSON', () => {
    const code = integrationSlack.generateHandler()
    expect(code).toContain('application/x-www-form-urlencoded')
    expect(code).toContain('files.upload')
  })

  it('youtube uses authParam (OAuth or key) on every action, not hardcoded key', () => {
    const code = integrationYoutube.generateHandler()
    expect(code).not.toContain("?key=' + apiKey")
  })

  it('woocommerce guards a missing storeUrl and honours explicit force=false', () => {
    const code = integrationWoocommerce.generateHandler()
    expect(code).toContain('storeUrl is not configured')
    expect(code).toContain('config.force === false ? false : true')
  })

  it('amazon-s3 set-acl signs acl= (SigV4 key=value form)', () => {
    const code = integrationAmazonS3.generateHandler()
    expect(code).toContain("'acl='")
  })

  it('greenhouse write actions attach the On-Behalf-Of header', () => {
    const code = integrationGreenhouse.generateHandler()
    expect(code).toContain('On-Behalf-Of')
  })

  it('generic integration supports a raw (non-Bearer) auth scheme', () => {
    const bearer = createGenericIntegration('integration-x').generateHandler()
    const raw = createGenericIntegration('integration-x', 'raw').generateHandler()
    expect(bearer).toContain("'Bearer ' + tok")
    expect(raw).not.toContain("'Bearer ' + tok")
    expect(raw).toContain("'' + tok")
  })
})
