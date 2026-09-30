/* tslint:disable:function-constructor */
import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'
import {
  generateLowStockAlertApiRoute,
  generateOrderNotificationApiRoute,
} from '../src/ecommerce/ecommerce-api-routes-generator'

/**
 * A failure inside the order-notification and low-stock-alert routes is
 * logged in full and answered with a fixed message: the error can come from
 * the database, and its text (relation, column and constraint names) is not
 * the caller's to read. Executed with a store module whose every helper fails
 * the way a missing table does.
 */

const DB_ERROR = 'relation "teleport_sent_emails" does not exist'

const SETTINGS = {
  orderNotifications: true,
  orderNotificationConfig: { provider: 'postmark', notificationEmails: ['owner@shop.test'] },
  stockManagement: true,
  stockManagementConfig: {
    lowStockAlerts: true,
    lowStockAlertConfig: { provider: 'postmark', notificationEmails: ['owner@shop.test'] },
  },
} as unknown as UIDLEcommerceSettings

const failingModule = () =>
  new Proxy(
    {},
    {
      get: (_target, name) =>
        name === 'settleSentEmailLog'
          ? async (): Promise<void> => undefined
          : () => {
              throw new Error(DB_ERROR)
            },
    }
  )

// The routes serve only the store's server code, which presents the app secret.
const APP_SECRET = 'app-secret'

const execute = async (source: string, body: Record<string, unknown>) => {
  const code = source.replace('export default async function handler', 'async function handler')
  const handler = new Function('require', 'process', `${code}\nreturn handler;`)(
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (name: string) => (name === 'crypto' ? require('crypto') : failingModule()),
    { env: { NEXTAUTH_SECRET: APP_SECRET } }
  )
  const reply = { status: 0, body: null as any }
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
  const logged: string[] = []
  const spy = jest.spyOn(console, 'error').mockImplementation((line: string) => {
    logged.push(String(line))
  })
  try {
    await handler({ method: 'POST', headers: { 'x-internal-data-secret': APP_SECRET }, body }, res)
  } finally {
    spy.mockRestore()
  }
  return { reply, logged }
}

describe('notification routes answer a failure without its database error', () => {
  it('order-notification', async () => {
    const { reply, logged } = await execute(generateOrderNotificationApiRoute(SETTINGS), {
      orderId: 'ORD-1',
      customerEmail: 'buyer@shop.test',
      items: [{ name: 'Mug', quantity: 1, unitPrice: 5 }],
    })
    expect(reply.status).toBe(500)
    expect(reply.body).toEqual({ sent: false, error: 'Failed to send notification' })
    expect(logged.join('\n')).toContain(DB_ERROR)
  })

  it('low-stock-alert', async () => {
    const { reply, logged } = await execute(generateLowStockAlertApiRoute(SETTINGS), {
      products: [{ id: 'p1', name: 'Mug', stock: 1 }],
    })
    expect(reply.status).toBe(500)
    expect(reply.body).toEqual({ sent: false, error: 'Failed to send low-stock alert' })
    expect(logged.join('\n')).toContain(DB_ERROR)
  })
})
