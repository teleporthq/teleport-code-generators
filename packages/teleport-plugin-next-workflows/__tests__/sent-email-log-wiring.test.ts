// Every path that sends mail from a generated app must go through the
// sent-email ledger. These tests pin the wiring of each path, and the last
// one is the guard: any emitted file that talks to a mail provider must also
// record — a sixth transport cannot appear unlogged.
import {
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
  generateCronAPIRoute,
  generateWebhookWorkflowAPIRoute,
} from '../src/api-route-generator'
import { generateSharedRuntimeUtilsCode } from '../src/executor-generator'
import { generateEmailSenderCode } from '../src/invoice/email-sender-code'
import { generateInvoiceGenerateRouteCode } from '../src/invoice/api-routes-code'
import { generateSignupRouteFile } from '../src/auth-generator'
import { generateAccountDeleteRoute } from '../src/account-delete-route-generator'
import { generateProviderSendFunction } from '../src/transactional-email-code'
import { ensureSentEmailLogModule } from '../src/sent-email-log'
import { nodeRegistry } from '../src/nodes'
import { isEmailSendingNodeType } from '../src/sent-email-log/sent-email-log-scope'
import { WorkflowSegment } from '../src/types'

const emailNode = (id: string, type = 'email-resend'): any => ({
  id,
  type,
  config: { to: 'a@b.c', subject: 's', body: '<p>b</p>', apiKey: 'k' },
  executionEnv: 'server',
  stepNumber: 1,
  label: 'Send',
})

const segmentWith = (nodes: any[]): WorkflowSegment => ({
  id: 'seg-1',
  env: 'server',
  nodeIds: nodes.map((n) => n.id),
  nodes,
  edges: [],
})

const PREAMBLE = "require('../../../utils/email/sent-email-log')"

describe('sent-email ledger — workflow routes', () => {
  it('wraps every mail-sending node handler and requires the module only when one is present', () => {
    const withEmail = generateServerSegmentAPIRoute(segmentWith([emailNode('e1')]), 'wf')
    expect(withEmail).toContain(PREAMBLE)
    expect(withEmail).toContain("'email-resend': __wrapEmailHandler('email-resend', (function () {")

    const withoutEmail = generateServerSegmentAPIRoute(
      segmentWith([{ ...emailNode('d1', 'data-select'), config: {} }]),
      'wf'
    )
    expect(withoutEmail).not.toContain('sent-email-log')
    expect(withoutEmail).not.toContain('__wrapEmailHandler')
  })

  it('degrades to the bare handler where the module cannot be loaded', () => {
    const route = generateServerSegmentAPIRoute(segmentWith([emailNode('e1')]), 'wf')
    const module = { exports: null as any }
    const requireShim = (id: string) => {
      if (id.endsWith('server-runtime')) {
        const utils = { exports: {} as any }
        // eslint-disable-next-line no-new-func
        new Function('module', 'exports', generateSharedRuntimeUtilsCode())(utils, utils.exports)
        return utils.exports
      }
      throw new Error('missing ' + id)
    }
    // eslint-disable-next-line no-new-func
    expect(() =>
      new Function('module', 'exports', 'require', route)(module, {}, requireShim)
    ).not.toThrow()
    expect(typeof module.exports).toBe('function')
  })

  it('is wired into the streaming, cron and webhook routes too', () => {
    const streaming = generateStreamingServerSegmentAPIRoute(segmentWith([emailNode('e1')]), 'wf')
    expect(streaming).toContain(PREAMBLE)
    expect(streaming).toContain('__wrapEmailHandler(')

    const baseWorkflow = {
      id: 'wf-1',
      name: 'WF',
      nodes: [emailNode('e1', 'email-postmark')],
      edges: [],
    }
    const cron = generateCronAPIRoute({
      ...baseWorkflow,
      trigger: {
        type: 'event-cron-triggered',
        nodeId: 't',
        scope: 'global',
        config: { schedule: '0 * * * *', urlPath: 'cron_x' },
      },
    } as any)
    expect(cron).toContain(PREAMBLE)
    expect(cron).toContain("__wrapEmailHandler('email-postmark'")
    // A failed run still lands the rows the emails it DID send produced.
    expect(cron).toContain(
      "console.error('Cron workflow error:', error);\n    if (__wfContext) { await utils.settlePendingNodePromises(__wfContext); }"
    )

    const webhook = generateWebhookWorkflowAPIRoute({
      ...baseWorkflow,
      trigger: { type: 'event-webhook-triggered', nodeId: 't', scope: 'global', config: {} },
      webhookConfig: { urlPath: 'hooks/x', httpMethod: 'POST', signatureSecret: '' },
    } as any)
    expect(webhook).toContain("/utils/email/sent-email-log')")
    expect(webhook).toContain("__wrapEmailHandler('email-postmark'")
    expect(webhook).toContain(
      "if (typeof context !== 'undefined' && context) { await utils.settlePendingNodePromises(context); }"
    )
  })

  it('the shared drain settles in place so a still-running parallel branch keeps the same queue', async () => {
    const utils = { exports: {} as any }
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', generateSharedRuntimeUtilsCode())(utils, utils.exports)
    const context: any = { __pendingNodePromises: [Promise.resolve()] }
    const branchView = context.__pendingNodePromises
    await utils.exports.settlePendingNodePromises(context)
    expect(context.__pendingNodePromises).toBe(branchView)
    let landed = false
    branchView.push(
      Promise.resolve().then(() => {
        landed = true
      })
    )
    await utils.exports.settlePendingNodePromises(context)
    expect(landed).toBe(true)
  })
})

describe('sent-email ledger — invoice, welcome, farewell', () => {
  const delivery: any = {
    enabled: true,
    provider: 'resend',
    fromEmail: 'billing@acme.com',
    fromName: 'Acme',
    subject: 'Invoice {{invoiceNumber}}',
    body: '<p>Attached</p>',
    secretKeys: { apiKey: 'INVOICE_RESEND_APIKEY' },
  }

  it('the invoice sender builds the message once and records it with the PDF as attachment metadata', () => {
    const code = generateEmailSenderCode(delivery)
    expect(code).toContain("require('../email/sent-email-log')")
    expect(code).toContain(
      'async function sendInvoiceEmailWithProvider(emailData, invoiceData, pdfBuffer)'
    )
    expect(code).toContain("emailType: 'invoice-email'")
    expect(code).toContain("contentType: 'application/pdf'")
    expect(code).toContain('url: invoiceData.pdfUrl || null')
    expect(code).not.toContain("content: pdfBuffer.toString('base64'),\n      url")
    // The provider body no longer rebuilds the message, so the row is what went out.
    expect(code.split('= buildEmailData(invoiceData)')).toHaveLength(2)
    expect(code).toContain('module.exports = { sendInvoiceEmail }')
  })

  it('the invoice route settles the ledger before every reply', () => {
    const route = generateInvoiceGenerateRouteCode({
      enabled: true,
      emailDelivery: delivery,
    } as any)
    expect(route).toContain("var sentEmailLog = require('../../../utils/email/sent-email-log')")
    expect(route.split('await sentEmailLog.settleSentEmailLog()')).toHaveLength(3)
    const noEmail = generateInvoiceGenerateRouteCode({ enabled: true } as any)
    expect(noEmail).not.toContain('sent-email-log')
  })

  it('a transactional send records success and failure and rethrows', () => {
    const code = generateProviderSendFunction('sendgrid', {
      emailType: 'welcome',
      source: 'signup',
      sourceRef: 'api/auth/signup',
      relativePrefix: '../../..',
    })
    expect(code).toContain('async function __sendProviderEmailRaw(msg)')
    expect(code).toContain('async function __sendProviderEmail(msg)')
    expect(code).toContain('emailType: "welcome"')
    expect(code).toContain('if (failure) { throw failure; }')
    // No provider ⇒ the no-op, no ledger.
    expect(
      generateProviderSendFunction(null, {
        emailType: 'x',
        source: 'y',
        sourceRef: 'z',
        relativePrefix: '.',
      })
    ).not.toContain('sent-email-log')
  })

  it('signup and account-delete routes pass the token values + user id and settle before replying', () => {
    const signup = generateSignupRouteFile({ enabled: true, dataSourceType: 'teleport' } as any, {
      emailProvider: 'resend',
      fromEmail: 'hi@acme.com',
      emailSecretEnvName: 'RESEND_KEY',
      emailBodyHtml: '<p>Welcome {{userName}}</p>',
    })
    expect(signup).toContain('emailType: "welcome"')
    expect(signup).toContain('tokenValues: tokenValues, userId: userId')
    expect(signup).toContain('}, newUser && newUser.id, __emailLocale.resolveRequestLocale(req));')
    expect(signup).toContain(
      "if (typeof __sentEmailLog !== 'undefined') { await __sentEmailLog.settleSentEmailLog(); }"
    )

    const del = generateAccountDeleteRoute({
      authUsersTableName: 'users',
      emailProvider: 'postmark',
      fromEmail: 'hi@acme.com',
      emailSecretEnvName: 'PM',
      emailBodyHtml: '<p>Bye</p>',
    })
    expect(del).toContain('emailType: "account-deleted"')
    expect(del).toContain('}, userId, __emailLocale.resolveRequestLocale(req));')
    expect(del).toContain('await __sentEmailLog.settleSentEmailLog()')

    const silent = generateAccountDeleteRoute({ authUsersTableName: 'users' })
    expect(silent).not.toContain('sent-email-log')
  })
})

describe('sent-email ledger — module emission', () => {
  const structureFor = (dataSourceType: string | null): any => ({
    uidl: {
      name: 'p',
      dataSources: dataSourceType ? { ds1: { type: dataSourceType, config: {} } } : undefined,
      globals: { env: {} },
    },
    files: new Map(),
    dependencies: {},
  })

  it('emits the module once, under utils/email, and adds pg only for a Postgres data source', () => {
    const pg = structureFor('teleport')
    ensureSentEmailLogModule(pg)
    ensureSentEmailLogModule(pg)
    expect(pg.files.get('sent-email-log').path).toEqual(['utils', 'email'])
    expect(pg.files.get('sent-email-log').files[0].content).toContain(
      "var TABLE_NAME = 'teleport_sent_emails'"
    )
    expect(pg.dependencies.pg).toBeDefined()

    const mysql = structureFor('mysql')
    ensureSentEmailLogModule(mysql)
    expect(mysql.files.get('sent-email-log').files[0].content).toContain('disabled')
    expect(mysql.dependencies.pg).toBeUndefined()
  })
})

describe('sent-email ledger — coverage guard', () => {
  it('every registered node that talks to a mail provider is classified as mail-sending', () => {
    // One pattern per mail transport a handler could embed: the Resend /
    // SendGrid / Postmark / Mailgun / MailerSend SDK calls, nodemailer, and the
    // Gmail / Graph REST send endpoints.
    const providerCall =
      /resend\.emails\.send\(|sgMail\.send\(|ServerClient\(|mg\.messages\.create\(|mailerSend\.email\.send\(|\.sendMail\(|'messages\/send'|'sendMail'/
    const missing: string[] = []
    for (const [nodeType, generator] of Object.entries(nodeRegistry)) {
      const source = generator.generateServerHandler
        ? generator.generateServerHandler()
        : generator.generateHandler()
      if (providerCall.test(source) && !isEmailSendingNodeType(nodeType)) {
        missing.push(nodeType)
      }
    }
    expect(missing).toEqual([])
  })
})
