import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { generateProviderSendFunction } from '../src/transactional-email-code'
import { generateEmailSenderCode } from '../src/invoice/email-sender-code'
import { loadHandler } from './_helpers/load-handler'

/**
 * A store's emails name the sender the editor stores beside the address
 * (`fromName`): every workflow email node, the welcome and farewell emails and
 * the invoice email, on every provider. A name holding a comma or a quote is
 * quoted, and a `from` that already names its sender is never wrapped twice.
 * Executed against fake provider SDKs: what matters is the From each provider
 * is handed.
 */

interface SenderCase {
  label: string
  from: string
  fromName: string
  // The From a provider taking one mailbox string is handed.
  header: string
  // The two parts SendGrid and MailerSend are handed.
  email: string
  name: string
}

const CASES: SenderCase[] = [
  {
    label: 'name set',
    from: 'shop@lumen.test',
    fromName: 'Lumen Pottery',
    header: 'Lumen Pottery <shop@lumen.test>',
    email: 'shop@lumen.test',
    name: 'Lumen Pottery',
  },
  {
    label: 'no name',
    from: 'shop@lumen.test',
    fromName: '',
    header: 'shop@lumen.test',
    email: 'shop@lumen.test',
    name: '',
  },
  {
    label: 'a name with a comma and a quote',
    from: 'shop@lumen.test',
    fromName: 'Smith, Jones & "Co"',
    header: '"Smith, Jones & \\"Co\\"" <shop@lumen.test>',
    email: 'shop@lumen.test',
    name: 'Smith, Jones & "Co"',
  },
  {
    label: 'from already formatted',
    from: 'Lumen Pottery <shop@lumen.test>',
    fromName: 'Lumen Pottery',
    header: 'Lumen Pottery <shop@lumen.test>',
    email: 'shop@lumen.test',
    name: 'Lumen Pottery',
  },
]

const QUOTED_NAME = CASES[2]

type Provider = 'postmark' | 'resend' | 'sendgrid' | 'mailgun' | 'mailersend'

const expectedFrom = (provider: Provider, c: SenderCase): unknown => {
  if (provider === 'sendgrid') {
    // SendGrid reads a string's display name verbatim, quotes included.
    return c.name ? { email: c.email, name: c.name } : c.email
  }
  if (provider === 'mailersend') {
    return { email: c.email, name: c.name || c.email }
  }
  return c.header
}

/** Fake provider SDKs that record the From of every email they are handed. */
const fakeSdks = (sent: unknown[]): Record<string, unknown> => {
  const sendgrid = {
    setApiKey: () => undefined,
    send: async (msg: { from: unknown }) => {
      sent.push(msg.from)
      return [{ statusCode: 202, headers: { 'x-message-id': 'sg-1' } }]
    },
  }
  const chainable = () => {
    const params: Record<string, unknown> = {}
    for (const key of ['From', 'To', 'Subject', 'Html', 'ReplyTo', 'Cc', 'Bcc', 'Attachments']) {
      params['set' + key] = (value: unknown) => {
        params[key.toLowerCase()] = value
        return params
      }
    }
    return params
  }
  return {
    postmark: {
      ServerClient: function ServerClient() {
        return {
          sendEmail: async (payload: { From: unknown }) => {
            sent.push(payload.From)
            return { MessageID: 'pm-1' }
          },
        }
      },
    },
    resend: {
      Resend: function Resend() {
        return {
          emails: {
            send: async (payload: { from: unknown }) => {
              sent.push(payload.from)
              return { data: { id: 're-1' }, error: null }
            },
          },
        }
      },
    },
    '@sendgrid/mail': {
      ...sendgrid,
      MailService: function MailService() {
        return sendgrid
      },
    },
    'mailgun.js': function Mailgun() {
      return {
        client: () => ({
          messages: {
            create: async (_domain: string, payload: { from: unknown }) => {
              sent.push(payload.from)
              return { id: 'mg-1' }
            },
          },
        }),
      }
    },
    'form-data': function FormData() {
      return {}
    },
    mailersend: {
      MailerSend: function MailerSend() {
        return {
          email: {
            send: async (params: { from: unknown }) => {
              sent.push(params.from)
              return { statusCode: 202, headers: { 'x-message-id': 'ms-1' } }
            },
          },
        }
      },
      Sender: function Sender(email: string, name: string) {
        return { email, name }
      },
      Recipient: function Recipient(email: string) {
        return { email }
      },
      Attachment: function Attachment() {
        return {}
      },
      EmailParams: function EmailParams() {
        return chainable()
      },
    },
  }
}

const quietConsole = () => {
  const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
    jest.spyOn(console, method).mockImplementation(() => undefined)
  )
  return () => spies.forEach((spy) => spy.mockRestore())
}

describe('workflow email nodes send the sender name', () => {
  // The handler loads its SDK through `__non_webpack_require__` whenever that
  // exists, so the fakes take the SDKs' place through the same global.
  const withSdks = async <T>(sdks: Record<string, unknown>, run: () => Promise<T>): Promise<T> => {
    const scope = globalThis as { __non_webpack_require__?: unknown }
    scope.__non_webpack_require__ = (id: string) => {
      if (!(id in sdks)) {
        throw new Error('unexpected require: ' + id)
      }
      return sdks[id]
    }
    try {
      return await run()
    } finally {
      delete scope.__non_webpack_require__
    }
  }

  const NODES: Array<[Provider, string]> = [
    ['postmark', 'email-postmark'],
    ['resend', 'email-resend'],
    ['sendgrid', 'email-sendgrid'],
    ['mailgun', 'email-mailgun'],
  ]

  for (const [provider, nodeType] of NODES) {
    describe(nodeType, () => {
      for (const senderCase of CASES) {
        it(senderCase.label, async () => {
          const sent: unknown[] = []
          const handler = loadHandler(nodeType)
          const config = {
            apiKey: 'key',
            serverToken: 'token',
            domain: 'mg.lumen.test',
            from: senderCase.from,
            fromName: senderCase.fromName,
            to: 'buyer@lumen.test',
            subject: 'Your order',
            body: '<p>Thanks</p>',
          }
          const result = await withSdks(fakeSdks(sent), () => handler(config, {}))
          expect(result).toMatchObject({ success: true })
          expect(sent).toEqual([expectedFrom(provider, senderCase)])
        })
      }
    })
  }
})

describe('welcome and farewell emails send the sender name', () => {
  const LEDGER_MODULE = '../../../utils/email/sent-email-log'

  const loadSend = (provider: Provider, sent: unknown[], ledger: unknown[]) => {
    const sdks = fakeSdks(sent)
    const requireStub = (id: string) => {
      if (id === LEDGER_MODULE) {
        return { recordSentEmail: (entry: unknown) => ledger.push(entry) }
      }
      if (!(id in sdks)) {
        throw new Error('unexpected require: ' + id)
      }
      return sdks[id]
    }
    const source = generateProviderSendFunction(provider, {
      emailType: 'welcome',
      source: 'signup',
      sourceRef: 'api/auth/signup',
      relativePrefix: '../../..',
    })
    // eslint-disable-next-line no-new-func
    return new Function('require', 'process', `${source}\nreturn __sendProviderEmail;`)(
      requireStub,
      { env: { MAILGUN_DOMAIN: 'mg.lumen.test' } }
    ) as (msg: Record<string, unknown>) => Promise<void>
  }

  const PROVIDERS: Provider[] = ['postmark', 'resend', 'sendgrid', 'mailgun', 'mailersend']

  for (const provider of PROVIDERS) {
    describe(provider, () => {
      for (const senderCase of CASES) {
        it(senderCase.label, async () => {
          const sent: unknown[] = []
          const ledger: unknown[] = []
          const send = loadSend(provider, sent, ledger)
          await send({
            from: senderCase.from,
            fromName: senderCase.fromName,
            to: 'buyer@lumen.test',
            subject: 'Welcome',
            html: '<p>Hi</p>',
            apiKey: 'key',
          })
          expect(sent).toEqual([expectedFrom(provider, senderCase)])
        })
      }
    })
  }

  it('the ledger records the name the email went out with', async () => {
    const ledger: unknown[] = []
    const send = loadSend('postmark', [], ledger)
    await send({
      from: QUOTED_NAME.from,
      fromName: QUOTED_NAME.fromName,
      to: 'buyer@lumen.test',
      subject: 'Welcome',
      html: '<p>Hi</p>',
      apiKey: 'key',
    })
    expect(ledger).toEqual([
      expect.objectContaining({ from: QUOTED_NAME.email, fromName: QUOTED_NAME.name }),
    ])
  })

  // The account nodes carry the sender the editor stored on them; the plugin
  // bakes it into the routes they call.
  describe('the routes baked from the account nodes', () => {
    const accountNodeConfig = {
      emailProvider: 'email-resend',
      from: 'shop@lumen.test',
      fromName: QUOTED_NAME.fromName,
      apiKey: 'RESEND_API_KEY',
      body: '<p>Hello {{userName}}</p>',
    }

    const generateRoutes = async () => {
      const uidl: any = {
        name: 'Lumen',
        globals: { settings: { title: 'Lumen', language: 'en' }, env: {} },
        root: {
          name: 'Root',
          stateDefinitions: {},
          node: { type: 'element', content: { elementType: 'container', children: [] } },
        },
        components: {},
        authentication: {
          enabled: true,
          passwordAuthEnabled: true,
          dataSourceId: 'ds1',
          dataSourceType: 'postgresql',
          providers: [],
          roles: [],
          tables: {},
          pageProtection: {},
          folderProtection: {},
          authPages: {},
          callbackBaseUrl: '',
          envKeys: {},
          customUserProperties: [],
        },
        dataSources: { ds1: { type: 'postgresql', config: {} } },
        workflows: {
          workflows: {
            account: {
              id: 'account',
              name: 'Account',
              trigger: { type: 'event-custom-triggered', nodeId: 't', config: { eventName: 'x' } },
              nodes: [
                { id: 'signup', type: 'account-signup', config: accountNodeConfig, stepNumber: 1 },
                {
                  id: 'delete',
                  type: 'account-delete-current',
                  config: accountNodeConfig,
                  stepNumber: 2,
                },
              ],
              edges: [],
            },
          },
          customNodes: {},
        },
      }
      const structure: any = {
        uidl,
        strategy: { pages: { options: {} } },
        files: new Map(),
        dependencies: {},
        devDependencies: {},
      }
      await new NextWorkflowProjectPlugin().runAfter(structure)
      const content = (key: string): string => String(structure.files.get(key).files[0].content)
      return {
        signup: content('auth-signup-route'),
        farewell: content('account-delete-current-route'),
      }
    }

    // Evaluates a whole route module and hands back one of its functions.
    const loadRouteFunction = (
      source: string,
      fnName: string,
      sent: unknown[],
      ledger: unknown[]
    ) => {
      const sdks = fakeSdks(sent)
      const requireStub = (id: string): unknown => {
        if (id.endsWith('/utils/email/sent-email-log')) {
          return {
            recordSentEmail: (entry: unknown) => ledger.push(entry),
            settleSentEmailLog: async () => undefined,
          }
        }
        if (id.endsWith('/utils/email/email-locale')) {
          return {
            pickLocalizedTemplate: (base: { subject: string; body: string }) => ({
              ...base,
              locale: 'en',
            }),
          }
        }
        return id in sdks ? sdks[id] : {}
      }
      const moduleShim = { exports: {} }
      // eslint-disable-next-line no-new-func
      return new Function(
        'module',
        'exports',
        'require',
        'process',
        `${source}\nreturn ${fnName};`
      )(moduleShim, moduleShim.exports, requireStub, { env: { RESEND_API_KEY: 'key' } }) as (
        ...args: unknown[]
      ) => Promise<void>
    }

    it('the welcome email names the sender stored on the signup node', async () => {
      const { signup } = await generateRoutes()
      const sent: unknown[] = []
      const ledger: unknown[] = []
      const restore = quietConsole()
      try {
        const sendWelcomeEmail = loadRouteFunction(signup, 'sendWelcomeEmail', sent, ledger)
        await sendWelcomeEmail('buyer@lumen.test', { userName: 'Ana' }, 'user-1', 'en')
      } finally {
        restore()
      }
      expect(sent).toEqual([QUOTED_NAME.header])
    })

    it('the farewell email names the sender stored on the delete-account node', async () => {
      const { farewell } = await generateRoutes()
      const sent: unknown[] = []
      const ledger: unknown[] = []
      const restore = quietConsole()
      try {
        const sendFarewellEmail = loadRouteFunction(farewell, 'sendFarewellEmail', sent, ledger)
        await sendFarewellEmail('buyer@lumen.test', { userName: 'Ana' }, 'user-1', 'en')
      } finally {
        restore()
      }
      expect(sent).toEqual([QUOTED_NAME.header])
    })
  })
})

describe('the invoice email sends the sender name', () => {
  const loadInvoiceSender = (
    provider: Provider,
    senderCase: SenderCase,
    sent: unknown[],
    ledger: unknown[]
  ) => {
    const code = generateEmailSenderCode({
      enabled: true,
      provider,
      fromEmail: senderCase.from,
      fromName: senderCase.fromName,
      subject: 'Invoice {{invoiceNumber}}',
      body: '<p>Attached</p>',
      secretKeys: {},
    } as any)
    const sdks = fakeSdks(sent)
    const requireStub = (id: string): unknown => {
      if (id === './pdf-generator') {
        return { replacePlaceholders: (text: string) => text, buildDataContext: () => ({}) }
      }
      if (id === '../email/sent-email-log') {
        return { recordSentEmail: (entry: unknown) => ledger.push(entry) }
      }
      if (id === '../email/email-locale') {
        return { pickLocalizedTemplate: (base: unknown) => base }
      }
      if (!(id in sdks)) {
        throw new Error('unexpected require: ' + id)
      }
      return sdks[id]
    }
    const moduleShim = { exports: {} as Record<string, (...args: unknown[]) => Promise<any>> }
    // resolveSecretKey falls back to an env var named like the key.
    // eslint-disable-next-line no-new-func
    new Function('module', 'require', 'process', code)(moduleShim, requireStub, {
      env: { apiKey: 'key', serverToken: 'token', domain: 'mg.lumen.test' },
    })
    return moduleShim.exports.sendInvoiceEmail
  }

  const PROVIDERS: Provider[] = ['postmark', 'resend', 'sendgrid', 'mailgun', 'mailersend']

  for (const provider of PROVIDERS) {
    describe(provider, () => {
      for (const senderCase of CASES) {
        it(senderCase.label, async () => {
          const sent: unknown[] = []
          const ledger: unknown[] = []
          const restore = quietConsole()
          let result: { success?: boolean } = {}
          try {
            const sendInvoiceEmail = loadInvoiceSender(provider, senderCase, sent, ledger)
            result = await sendInvoiceEmail(
              { id: 'inv-1', invoiceNumber: 'INV-1', customerEmail: 'buyer@lumen.test' },
              Buffer.from('%PDF')
            )
          } finally {
            restore()
          }
          expect(result).toMatchObject({ success: true })
          expect(sent).toEqual([expectedFrom(provider, senderCase)])
        })
      }
    })
  }

  it('the ledger records the name the email went out with', async () => {
    const ledger: unknown[] = []
    const restore = quietConsole()
    try {
      const sendInvoiceEmail = loadInvoiceSender('postmark', QUOTED_NAME, [], ledger)
      await sendInvoiceEmail(
        { id: 'inv-1', invoiceNumber: 'INV-1', customerEmail: 'buyer@lumen.test' },
        Buffer.from('%PDF')
      )
    } finally {
      restore()
    }
    expect(ledger).toEqual([
      expect.objectContaining({ from: QUOTED_NAME.header, fromName: QUOTED_NAME.name }),
    ])
  })
})
