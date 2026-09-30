/* tslint:disable:function-constructor */
import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'
import {
  generateLowStockAlertApiRoute,
  generateOrderNotificationApiRoute,
} from '../src/ecommerce/ecommerce-api-routes-generator'

/**
 * `/api/ecommerce/order-notification` and `/api/ecommerce/low-stock-alert` email
 * the MERCHANT what their body says, so they serve only the store's own server
 * code: the app secret (compared in constant time) or the internal-call token
 * of `utils/workflows/server-runtime` (the order INSERT's auto-fire). Anything
 * else — and everything, when the app has no secret — is a 401 before a single
 * email is built. Executed against the emitted routes.
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

interface Reply {
  status: number
  body: any
  sent: number
}

// A store whose email sender works, counting the emails it is asked to send.
const boot = (source: string, runtime: { isInternalCall: (req: any) => boolean } | null = null) => {
  let sent = 0
  const sender = {
    renderTemplate: (template: string) => template,
    expandListBlocks: (template: string) => template,
    hasOwnItemList: () => false,
    sendNotificationEmail: async () => {
      sent += 1
      return { sent: true }
    },
    settleSentEmailLog: async (): Promise<void> => undefined,
  }
  const requireShim = (id: string): unknown => {
    if (id === 'crypto') {
      // tslint:disable-next-line:no-var-requires
      return require('crypto')
    }
    if (id.endsWith('/utils/workflows/server-runtime')) {
      if (!runtime) {
        throw new Error("Cannot find module '" + id + "'")
      }
      return runtime
    }
    return sender
  }
  const code = source.replace('export default async function handler', 'async function handler')
  const handler = new Function('require', `${code}\nreturn handler;`)(requireShim)
  return async (
    headers: Record<string, string>,
    body: Record<string, unknown>,
    secret: string | null = APP_SECRET
  ): Promise<Reply> => {
    const reply: Reply = { status: 0, body: null, sent: 0 }
    const res = {
      status(statusCode: number) {
        reply.status = statusCode
        return res
      },
      json(payload: unknown) {
        reply.body = payload
        return res
      },
    }
    const saved = process.env.NEXTAUTH_SECRET
    if (secret === null) {
      delete process.env.NEXTAUTH_SECRET
    } else {
      process.env.NEXTAUTH_SECRET = secret
    }
    const before = sent
    try {
      await handler({ method: 'POST', headers, body }, res)
    } finally {
      if (saved === undefined) {
        delete process.env.NEXTAUTH_SECRET
      } else {
        process.env.NEXTAUTH_SECRET = saved
      }
    }
    reply.sent = sent - before
    return reply
  }
}

const ROUTES: Array<[string, string, Record<string, unknown>]> = [
  [
    'order-notification',
    generateOrderNotificationApiRoute(SETTINGS),
    { orderId: 'ORD-1', customerEmail: 'buyer@shop.test', items: [], totalAmount: 5 },
  ],
  [
    'low-stock-alert',
    generateLowStockAlertApiRoute(SETTINGS),
    { products: [{ id: 'p1', name: 'Mug', stock: 1 }] },
  ],
]

describe('merchant notification routes: the store server only', () => {
  it.each(ROUTES)(
    '%s: refuses an anonymous, wrong or empty secret with 401',
    async (_n, source, body) => {
      const post = boot(source)
      for (const headers of [
        {},
        { 'x-internal-data-secret': 'nope' },
        { 'x-internal-data-secret': '' },
        { 'x-internal-data-secret': APP_SECRET + 'x' },
      ]) {
        const reply = await post(headers, body)
        expect(reply.status).toBe(401)
        expect(reply.sent).toBe(0)
      }
    }
  )

  it.each(ROUTES)('%s: sends for the app secret', async (_n, source, body) => {
    const reply = await boot(source)({ 'x-internal-data-secret': APP_SECRET }, body)
    expect(reply.status).toBe(200)
    expect(reply.sent).toBe(1)
  })

  it.each(ROUTES)(
    "%s: sends for the server runtime's internal-call token (the order INSERT's auto-fire)",
    async (_n, source, body) => {
      const runtime = { isInternalCall: (req: any) => req.headers['x-teleport-internal'] === 'mac' }
      const post = boot(source, runtime)
      expect((await post({ 'x-teleport-internal': 'mac' }, body)).status).toBe(200)
      expect((await post({ 'x-teleport-internal': 'forged' }, body)).status).toBe(401)
    }
  )

  it.each(ROUTES)('%s: fails closed in an app with no secret', async (_n, source, body) => {
    const runtime = { isInternalCall: () => true }
    const reply = await boot(source, runtime)({ 'x-internal-data-secret': '' }, body, null)
    expect(reply.status).toBe(401)
    expect(reply.sent).toBe(0)
  })

  it('leaves the inert (unconfigured) routes as they were', async () => {
    const inert = generateOrderNotificationApiRoute({} as UIDLEcommerceSettings)
    expect(inert).not.toContain('__isStoreServerCall')
    expect(generateLowStockAlertApiRoute({} as UIDLEcommerceSettings)).not.toContain(
      '__isStoreServerCall'
    )
  })
})
