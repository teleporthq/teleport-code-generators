/* tslint:disable:function-constructor */
import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'
import {
  generateLowStockAlertApiRoute,
  generateOrderNotificationApiRoute,
} from '../src/ecommerce/ecommerce-api-routes-generator'
import { generateEmailSenderModule } from '../src/ecommerce/email-sender-generator'

/**
 * `/api/ecommerce/order-notification` and `/api/ecommerce/low-stock-alert`
 * email the merchant what their request body says. They were open: anyone
 * could send the merchant mail of their choosing from the store's address.
 * They now serve only the store's own server code — the app secret (the
 * data API's low-stock auto-fire, the legacy payment webhooks) or the
 * internal-call token of the server runtime (the order INSERT's auto-fire) —
 * and nothing at all when the app has no secret. EXECUTED.
 */

const APP_SECRET = 'app-secret'

const SETTINGS = {
  orderNotifications: true,
  orderNotificationConfig: { provider: 'postmark', notificationEmails: ['owner@shop.test'] },
  stockManagement: true,
  stockManagementConfig: {
    lowStockAlerts: true,
    lowStockAlertConfig: { provider: 'postmark', notificationEmails: ['owner@shop.test'] },
  },
} as unknown as UIDLEcommerceSettings

interface Options {
  secret?: string | null
  runtimeVouches?: boolean
}

// The real emitted sender (templates, escaping), with delivery recorded.
const loadSender = () => {
  const moduleObj: { exports: any } = { exports: {} }
  new Function('require', 'module', 'exports', generateEmailSenderModule(SETTINGS))(
    (name: string) =>
      name === 'resend' ? { Resend: class {} } : { settleSentEmailLog: async () => undefined },
    moduleObj,
    moduleObj.exports
  )
  return moduleObj.exports
}

const boot = (source: string, options: Options = {}) => {
  const sent: string[] = []
  const sender = {
    ...loadSender(),
    sendNotificationEmail: async (to: string[]) => {
      sent.push(to.join(','))
      return { sent: true }
    },
    settleSentEmailLog: async (): Promise<void> => undefined,
  }
  const fakeRequire = (name: string): any => {
    if (name === 'crypto') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('crypto')
    }
    if (name.endsWith('/utils/ecommerce/email-sender')) {
      return sender
    }
    if (name.endsWith('/utils/ecommerce/asset-urls')) {
      return { loadAssetUrlMapFromDb: async () => ({}), resolveMediaUrl: (v: string) => v || '' }
    }
    if (name === '../../../utils/workflows/server-runtime') {
      if (options.runtimeVouches === undefined) {
        throw new Error("Cannot find module '" + name + "'")
      }
      return {
        isInternalCall: (req: any) =>
          options.runtimeVouches === true && req.headers['x-teleport-internal'] === 'token',
      }
    }
    throw new Error('unexpected require: ' + name)
  }
  const env = options.secret === null ? {} : { NEXTAUTH_SECRET: options.secret || APP_SECRET }
  const handler = new Function(
    'require',
    'process',
    `${source.replace(
      'export default async function handler',
      'async function handler'
    )}\nreturn handler`
  )(fakeRequire, { env })
  return async (headers: Record<string, string>, body: Record<string, unknown>) => {
    let status = 0
    const res = {
      status(code: number) {
        status = code
        return res
      },
      json() {
        return res
      },
    }
    await handler({ method: 'POST', headers, body }, res)
    return { status, sent: sent.slice() }
  }
}

const ROUTES: Array<[string, string, Record<string, unknown>]> = [
  [
    'order-notification',
    generateOrderNotificationApiRoute(SETTINGS),
    { orderId: 'ORD-1', customerEmail: 'buyer@shop.test', items: [{ name: 'Mug', quantity: 1 }] },
  ],
  [
    'low-stock-alert',
    generateLowStockAlertApiRoute(SETTINGS),
    { products: [{ id: 'p1', name: 'Mug', stock: 1 }] },
  ],
]

describe('merchant notification routes serve the store only', () => {
  it.each(ROUTES)(
    '%s: refuses a caller without the app secret, and sends nothing',
    async (_n, source, body) => {
      const post = boot(source)
      for (const headers of [
        {},
        { 'x-internal-data-secret': '' },
        { 'x-internal-data-secret': 'guess' },
        { 'x-internal-data-secret': APP_SECRET + 'x' },
      ]) {
        const result = await post(headers, body)
        expect(result.status).toBe(401)
        expect(result.sent).toEqual([])
      }
    }
  )

  it.each(ROUTES)('%s: serves the app secret', async (_n, source, body) => {
    const result = await boot(source)({ 'x-internal-data-secret': APP_SECRET }, body)
    expect(result.status).toBe(200)
    expect(result.sent).toEqual(['owner@shop.test'])
  })

  it.each(ROUTES)(
    "%s: serves the server runtime's internal-call token",
    async (_n, source, body) => {
      const post = boot(source, { runtimeVouches: true })
      expect((await post({ 'x-teleport-internal': 'token' }, body)).status).toBe(200)
      expect((await post({ 'x-teleport-internal': 'forged' }, body)).status).toBe(401)
    }
  )

  it.each(ROUTES)('%s: serves nobody in an app with no secret', async (_n, source, body) => {
    const post = boot(source, { secret: null, runtimeVouches: true })
    for (const headers of [
      {},
      { 'x-internal-data-secret': '' },
      { 'x-teleport-internal': 'token' },
    ]) {
      const result = await post(headers, body)
      expect(result.status).toBe(401)
      expect(result.sent).toEqual([])
    }
  })
})
