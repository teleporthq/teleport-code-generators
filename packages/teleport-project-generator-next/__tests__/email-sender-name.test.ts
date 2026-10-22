import { generateEmailSenderModule } from '../src/ecommerce/email-sender-generator'
import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'

/**
 * The store's order-notification and low-stock emails name the sender the
 * merchant saved (`fromName`) on every provider: quoted when the name holds a
 * comma or a quote, never wrapped twice when the address already names its
 * sender. Executed against fake providers: what matters is the From each one
 * is handed.
 */

interface SenderCase {
  label: string
  fromEmail: string
  fromName: string
  header: string
  email: string
  name: string
}

const CASES: SenderCase[] = [
  {
    label: 'name set',
    fromEmail: 'shop@lumen.test',
    fromName: 'Lumen Pottery',
    header: 'Lumen Pottery <shop@lumen.test>',
    email: 'shop@lumen.test',
    name: 'Lumen Pottery',
  },
  {
    label: 'no name',
    fromEmail: 'shop@lumen.test',
    fromName: '',
    header: 'shop@lumen.test',
    email: 'shop@lumen.test',
    name: '',
  },
  {
    label: 'a name with a comma and a quote',
    fromEmail: 'shop@lumen.test',
    fromName: 'Smith, Jones & "Co"',
    header: '"Smith, Jones & \\"Co\\"" <shop@lumen.test>',
    email: 'shop@lumen.test',
    name: 'Smith, Jones & "Co"',
  },
  {
    label: 'from already formatted',
    fromEmail: 'Lumen Pottery <shop@lumen.test>',
    fromName: 'Lumen Pottery',
    header: 'Lumen Pottery <shop@lumen.test>',
    email: 'shop@lumen.test',
    name: 'Lumen Pottery',
  },
]

// `mailgun` has no dispatcher of its own here: it goes through the SMTP one.
const PROVIDERS = ['postmark', 'resend', 'sendgrid', 'mailgun'] as const
type Provider = (typeof PROVIDERS)[number]

const expectedFrom = (provider: Provider, c: SenderCase): unknown =>
  provider === 'sendgrid' ? (c.name ? { email: c.email, name: c.name } : c.email) : c.header

const settingsFor = (provider: Provider, c: SenderCase): UIDLEcommerceSettings =>
  ({
    orderNotifications: true,
    orderNotificationConfig: {
      provider,
      fromEmail: c.fromEmail,
      fromName: c.fromName,
      notificationEmails: ['owner@lumen.test'],
    },
    stockManagement: false,
    paymentProviders: [],
  } as unknown as UIDLEcommerceSettings)

const loadSender = (provider: Provider, c: SenderCase, sent: unknown[], ledger: unknown[]) => {
  const code = generateEmailSenderModule(settingsFor(provider, c), { logTag: 'test' })
  const fetchStub = (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body).From)
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ MessageID: 'pm-1' }) })
  }
  const requireStub = (id: string): unknown => {
    switch (id) {
      // Loaded where the runtime has no global fetch, as this test runtime.
      case 'node-fetch':
        return fetchStub
      case '../email/sent-email-log':
        return {
          recordSentEmail: (entry: unknown) => ledger.push(entry),
          settleSentEmailLog: () => Promise.resolve(),
        }
      case '@sendgrid/mail':
        return {
          setApiKey: () => undefined,
          send: async (msg: { from: unknown }) => {
            sent.push(msg.from)
            return [{ statusCode: 202 }]
          },
        }
      case 'resend':
        return {
          Resend: function Resend() {
            return {
              emails: {
                send: async (payload: { from: unknown }) => {
                  sent.push(payload.from)
                  return { data: { id: 're-1' } }
                },
              },
            }
          },
        }
      case 'nodemailer':
        return {
          createTransport: () => ({
            sendMail: async (msg: { from: unknown }) => {
              sent.push(msg.from)
              return { messageId: 'smtp-1' }
            },
          }),
        }
      default:
        throw new Error('unexpected require: ' + id)
    }
  }
  const moduleShim = { exports: {} as Record<string, (...args: unknown[]) => Promise<any>> }
  // The postmark dispatcher calls the free identifier `fetch`; naming it as a
  // parameter shadows Node's global with the stub for this module.
  // eslint-disable-next-line no-new-func
  new Function('module', 'require', 'process', 'fetch', code)(
    moduleShim,
    requireStub,
    { env: { POSTMARK_SERVER_TOKEN: 'token' } },
    fetchStub
  )
  return moduleShim.exports.sendNotificationEmail
}

// Sends one notification and hands back what the provider and the ledger got.
const sendOnce = async (provider: Provider, senderCase: SenderCase) => {
  const sent: unknown[] = []
  const ledger: unknown[] = []
  const silence = (['log', 'warn', 'error'] as const).map((method) =>
    jest.spyOn(console, method).mockImplementation(() => undefined)
  )
  const globalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  try {
    const send = loadSender(provider, senderCase, sent, ledger)
    const result = await send(['owner@lumen.test'], 'New order', '<p>Order</p>')
    return { result, sent, ledger }
  } finally {
    silence.forEach((spy) => spy.mockRestore())
    if (globalFetch) {
      Object.defineProperty(globalThis, 'fetch', globalFetch)
    } else {
      delete (globalThis as { fetch?: unknown }).fetch
    }
  }
}

describe('the store notification sender sends the sender name', () => {
  for (const provider of PROVIDERS) {
    describe(provider, () => {
      for (const senderCase of CASES) {
        it(senderCase.label, async () => {
          const { result, sent } = await sendOnce(provider, senderCase)
          expect(result).toMatchObject({ sent: true, delivered: ['owner@lumen.test'] })
          expect(sent).toEqual([expectedFrom(provider, senderCase)])
        })
      }
    })
  }

  it('the ledger records the name the email went out with', async () => {
    const quotedName = CASES[2]
    const { ledger } = await sendOnce('postmark', quotedName)
    expect(ledger).toEqual([
      expect.objectContaining({ from: quotedName.header, fromName: quotedName.name }),
    ])
  })
})
