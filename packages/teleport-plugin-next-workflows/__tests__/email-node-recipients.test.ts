import { loadHandler } from './_helpers/load-handler'

/**
 * A workflow email node given several recipients sends one provider call per
 * address: a refused address (a sender that only delivers to the account
 * owner's address, an account still pending approval) no longer blocks the
 * others, and the result says who got the email. One recipient behaves as it
 * always did. Executed against fake provider SDKs that refuse an address the
 * way each real provider does.
 */

const REASON = 'You can only send testing emails to your own email address'
const BUYER = 'buyer@lumen.test'
const ANA = 'ana@lumen.test'
const BLOCKED = 'blocked@lumen.test'
const BLOCKED_TOO = 'blocked-too@lumen.test'

const addressesOf = (to: unknown): string[] => {
  const list = Array.isArray(to) ? to : String(to).split(',')
  return list.map((entry: any) => (typeof entry === 'object' ? entry.email : String(entry).trim()))
}

const refuses = (to: unknown): boolean =>
  addressesOf(to).some((address) => address.toLowerCase().startsWith('blocked'))

interface ProviderCall {
  to: string[]
  cc: string[]
}

/** Fake provider SDKs that record every call's recipients and refuse the blocked ones. */
const fakeSdks = (calls: ProviderCall[]): Record<string, unknown> => {
  const record = (to: unknown, cc: unknown) => {
    calls.push({ to: addressesOf(to), cc: cc ? addressesOf(cc) : [] })
    return calls.length
  }
  const sendgrid = {
    setApiKey: (): void => undefined,
    send: async (msg: { to: unknown; cc?: unknown }) => {
      const n = record(msg.to, msg.cc)
      if (refuses(msg.to)) {
        const err: any = new Error('Bad Request')
        err.response = { body: { errors: [{ message: REASON }] } }
        throw err
      }
      return [{ statusCode: 202, headers: { 'x-message-id': 'sg-' + n } }]
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
          sendEmail: async (payload: { To: unknown; Cc?: unknown }) => {
            const n = record(payload.To, payload.Cc)
            if (refuses(payload.To)) {
              throw new Error(REASON)
            }
            return { MessageID: 'pm-' + n }
          },
        }
      },
    },
    resend: {
      Resend: function Resend() {
        return {
          emails: {
            send: async (payload: {
              to: unknown
              cc?: unknown
            }): Promise<{
              data: { id: string } | null
              error: { name: string; message: string } | null
            }> => {
              const n = record(payload.to, payload.cc)
              if (refuses(payload.to)) {
                return { data: null, error: { name: 'validation_error', message: REASON } }
              }
              return { data: { id: 're-' + n }, error: null }
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
            create: async (_domain: string, payload: { to: unknown; cc?: unknown }) => {
              const n = record(payload.to, payload.cc)
              if (refuses(payload.to)) {
                throw new Error(REASON)
              }
              return { id: 'mg-' + n }
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
            send: async (params: { to: unknown; cc?: unknown }) => {
              const n = record(params.to, params.cc)
              if (refuses(params.to)) {
                return { statusCode: 422, body: { message: REASON } }
              }
              return { statusCode: 202, headers: { 'x-message-id': 'ms-' + n } }
            },
          },
        }
      },
      Sender: function Sender(email: string, name: string) {
        return { email, name }
      },
      Recipient: function Recipient(email: string, name: string) {
        return { email, name }
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

type IdKey = 'id' | 'messageId'

const NODES: Array<[string, string, IdKey]> = [
  ['email-postmark', 'pm', 'messageId'],
  ['email-resend', 're', 'id'],
  ['email-sendgrid', 'sg', 'messageId'],
  ['email-mailgun', 'mg', 'messageId'],
  ['email-mailersend', 'ms', 'messageId'],
]

const baseConfig = {
  apiKey: 'key',
  serverToken: 'token',
  domain: 'mg.lumen.test',
  from: 'shop@lumen.test',
  fromName: 'Lumen Pottery',
  subject: 'Your order',
  body: '<p>Thanks</p>',
}

const sendThrough = async (nodeType: string, to: unknown, extra: Record<string, unknown> = {}) => {
  const calls: ProviderCall[] = []
  const handler = loadHandler(nodeType)
  const result = (await withSdks(fakeSdks(calls), () =>
    handler({ ...baseConfig, to, ...extra }, {})
  )) as Record<string, unknown>
  return { calls, result }
}

describe('workflow email nodes send to each recipient separately', () => {
  for (const [nodeType, prefix, idKey] of NODES) {
    const idOf = (n: number) => ({ [idKey]: prefix + '-' + n })

    describe(nodeType, () => {
      it('one recipient: one provider call and the result as before', async () => {
        const asString = await sendThrough(nodeType, BUYER)
        expect(asString.calls).toEqual([{ to: [BUYER], cc: [] }])
        expect(asString.result).toEqual({ ...idOf(1), success: true })

        const asList = await sendThrough(nodeType, [BUYER])
        expect(asList.calls).toEqual([{ to: [BUYER], cc: [] }])
        expect(asList.result).toEqual({ ...idOf(1), success: true })
      })

      it('one refused recipient: the failure as before', async () => {
        const { calls, result } = await sendThrough(nodeType, BLOCKED)
        expect(calls).toEqual([{ to: [BLOCKED], cc: [] }])
        expect(result).toEqual({ [idKey]: '', success: false, error: REASON })
      })

      it('several recipients, one refused: one call per address, the others delivered', async () => {
        const { calls, result } = await sendThrough(nodeType, [BUYER, BLOCKED, ANA], {
          cc: 'ops@lumen.test',
        })
        expect(calls).toEqual([
          { to: [BUYER], cc: ['ops@lumen.test'] },
          { to: [BLOCKED], cc: ['ops@lumen.test'] },
          { to: [ANA], cc: ['ops@lumen.test'] },
        ])
        expect(result).toEqual({
          ...idOf(1),
          success: true,
          error: 'refused for ' + BLOCKED + ' (' + REASON + ')',
          deliveries: [
            { to: BUYER, success: true, ...idOf(1) },
            { to: BLOCKED, success: false, error: REASON },
            { to: ANA, success: true, ...idOf(3) },
          ],
        })
      })

      it('every recipient refused: a failed result naming each', async () => {
        const { calls, result } = await sendThrough(nodeType, [BLOCKED, BLOCKED_TOO])
        expect(calls).toHaveLength(2)
        expect(result).toEqual({
          [idKey]: '',
          success: false,
          error:
            'refused for ' + BLOCKED + ' (' + REASON + '); ' + BLOCKED_TOO + ' (' + REASON + ')',
          deliveries: [
            { to: BLOCKED, success: false, error: REASON },
            { to: BLOCKED_TOO, success: false, error: REASON },
          ],
        })
      })

      it('drops empty entries and sends to an address once, whatever its case', async () => {
        const { calls, result } = await sendThrough(nodeType, [
          BUYER,
          '',
          'Buyer@Lumen.test',
          null,
          ANA,
        ])
        expect(calls).toEqual([
          { to: [BUYER], cc: [] },
          { to: [ANA], cc: [] },
        ])
        expect((result.deliveries as unknown[]).map((d: any) => d.to)).toEqual([BUYER, ANA])
      })

      it('refuses to send without a recipient', async () => {
        for (const to of ['', [], undefined, [null, '']]) {
          const { calls, result } = await sendThrough(nodeType, to)
          expect(calls).toEqual([])
          expect(result).toEqual({ [idKey]: '', success: false, error: 'No recipient' })
        }
      })
    })
  }

  it('mailersend keeps a named recipient and matches named entries by address', async () => {
    const { calls, result } = await sendThrough('email-mailersend', [
      { email: BUYER, name: 'Ana' },
      { email: 'Buyer@lumen.test', name: 'Ana again' },
      { email: ANA },
    ])
    expect(calls).toEqual([
      { to: [BUYER], cc: [] },
      { to: [ANA], cc: [] },
    ])
    expect((result.deliveries as unknown[]).map((d: any) => d.to)).toEqual([BUYER, ANA])
  })
})
