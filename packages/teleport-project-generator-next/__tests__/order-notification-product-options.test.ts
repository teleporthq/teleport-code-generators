/* tslint:disable:function-constructor */
import { parse } from '@babel/parser'
import { generateOrderNotificationApiRoute } from '../src/ecommerce/ecommerce-api-routes-generator'
import { generateEmailSenderModule } from '../src/ecommerce/email-sender-generator'
import type { UIDLEcommerceSettings } from '@teleporthq/teleport-types'
import { PHOTO } from './_helpers/product-options-fixtures'
import { dataCreateItem } from '../../teleport-plugin-next-workflows/src/nodes/data/data-create-item'

/**
 * The merchant's order email and product options. A line bought with options
 * shows every answer — what the order is made from — read from the order
 * line's snapshot through the shared parser (the current form and the compact
 * one older checkouts wrote), HTML-escaped wherever it lands. A template with
 * a `{{configuration}}` row token gets the answers there; one written before
 * options existed gets the short label appended to the product name. A line
 * without options renders exactly as before. The whole route is EXECUTED
 * against a fake pool and the real email-sender module.
 */

const settingsWith = (body: string): UIDLEcommerceSettings =>
  ({
    orderNotifications: true,
    orderNotificationConfig: {
      provider: 'resend',
      notificationEmails: ['owner@example.com'],
      subject: 'New order {{orderNumber}}',
      body,
    },
  } as unknown as UIDLEcommerceSettings)

const ROW_WITH_TOKEN =
  '<!--tq:each items--><p>{{product_name}}|{{configuration}}|{{line_total}}</p><!--/tq:each-->'
const ROW_WITHOUT_TOKEN =
  '<!--tq:each items--><p>{{product_name}}|{{line_total}}</p><!--/tq:each-->'
const ITEMS_COUNT_ONLY = '<p>Items: {{itemsCount}}</p>'

const SNAPSHOT = JSON.stringify({
  v: 1,
  basePrice: 10,
  priceDelta: 17,
  entries: [
    { key: 'size', label: 'Size', type: 'choice', value: 'a3', valueLabel: 'A3', priceDelta: 9 },
    {
      key: 'engraving',
      label: 'Engraving',
      type: 'text',
      value: '<script>alert(1)</script>',
      valueLabel: '<script>alert(1)</script>',
      priceDelta: 0,
    },
    {
      key: 'your-photo',
      label: 'Your photo',
      type: 'upload',
      value: [PHOTO.id],
      valueLabel: 'IMG_2231.jpg',
      priceDelta: 0,
      files: [PHOTO],
    },
  ],
})

const PRINT_ROW = {
  product_id: 'print',
  product_name: 'Photo print',
  variant_label: null,
  quantity: 1,
  unit_price: '27.00',
  total_price: '27.00',
  currency: 'USD',
  configuration: SNAPSHOT,
  configuration_label: 'Size: A3 · Engraving: <script>alert(1)</script> · Your photo: IMG_2231.jpg',
  image_url: '',
}

const MUG_ROW = {
  product_id: 'mug',
  product_name: 'Mug',
  variant_label: null,
  quantity: 2,
  unit_price: '12.00',
  total_price: '24.00',
  currency: 'USD',
  configuration: null,
  configuration_label: null,
  image_url: '',
}

const loadSender = (settings: UIDLEcommerceSettings) => {
  const moduleObj: { exports: any } = { exports: {} }
  new Function('require', 'module', 'exports', generateEmailSenderModule(settings))(
    (name: string) => {
      if (name === 'resend') {
        return { Resend: class {} }
      }
      return { settleSentEmailLog: async () => undefined }
    },
    moduleObj,
    moduleObj.exports
  )
  return moduleObj.exports
}

async function sendOrderEmail(options: {
  body: string
  rows?: Array<Record<string, unknown>>
  items?: Array<Record<string, unknown>>
  postgres?: boolean
}) {
  const settings = settingsWith(options.body)
  const postgres = options.postgres !== false
  const source = generateOrderNotificationApiRoute(
    settings,
    postgres ? 'teleport' : null,
    postgres ? { connectionString: 'postgres://x' } : null
  )
  const queries: string[] = []
  class FakePool {
    public async query(sql: string) {
      queries.push(sql)
      return { rows: options.rows || [] }
    }
  }
  const sent: string[] = []
  const realSender = loadSender(settings)
  const sender = {
    ...realSender,
    sendNotificationEmail: async (_to: string[], _subject: string, html: string) => {
      sent.push(html)
      return { sent: true }
    },
    settleSentEmailLog: async () => undefined,
  }
  const fakeRequire = (name: string): any => {
    if (name === '../../../utils/ecommerce/email-sender') {
      return sender
    }
    if (name === '../../../utils/ecommerce/asset-urls') {
      return {
        loadAssetUrlMapFromDb: async () => ({}),
        resolveMediaUrl: (value: string) => value || '',
      }
    }
    if (name === 'pg') {
      return { Pool: FakePool }
    }
    if (name === 'crypto') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('crypto')
    }
    throw new Error('unexpected require: ' + name)
  }
  const handler = new Function(
    'require',
    'process',
    `'use strict'\n${source.replace(
      'export default async function handler',
      'async function handler'
    )}\nreturn handler`
    // The route serves only the store's server code, which presents the app secret.
  )(fakeRequire, { env: { NEXTAUTH_SECRET: 'app-secret' } })
  let status = 0
  const res = {
    status(code: number) {
      status = code
      return this
    },
    json() {
      return this
    },
  }
  await handler(
    {
      method: 'POST',
      headers: { 'x-internal-data-secret': 'app-secret' },
      body: { orderId: 'order-1', orderNumber: 'ORD-1', items: options.items },
    },
    res
  )
  expect(status).toBe(200)
  return { html: sent[0], queries }
}

describe('order notification — product options', () => {
  it('reads the snapshot and the label with the order lines, whatever columns the store has', async () => {
    const { queries } = await sendOrderEmail({ body: ROW_WITH_TOKEN, rows: [MUG_ROW] })
    expect(queries[0]).toContain(
      "to_jsonb(oi) ->> 'configuration' AS configuration, to_jsonb(oi) ->> 'configuration_label' AS configuration_label"
    )
  })

  it('fills the row token with every answer, escaped, and leaves the product name alone', async () => {
    const { html } = await sendOrderEmail({ body: ROW_WITH_TOKEN, rows: [PRINT_ROW, MUG_ROW] })
    expect(html).toBe(
      '<p>Photo print|Size: A3\nEngraving: &lt;script&gt;alert(1)&lt;/script&gt;\nYour photo: IMG_2231.jpg|27.00</p>' +
        '<p>Mug||24.00</p>'
    )
  })

  it('appends the short label to the product name when the template has no row token', async () => {
    const { html } = await sendOrderEmail({ body: ROW_WITHOUT_TOKEN, rows: [PRINT_ROW, MUG_ROW] })
    expect(html).toBe(
      '<p>Photo print — Size: A3 · Engraving: &lt;script&gt;alert(1)&lt;/script&gt; · Your photo: IMG_2231.jpg|27.00</p>' +
        '<p>Mug|24.00</p>'
    )
  })

  it('lists the answers under the line in the injected item list, one per line', async () => {
    const { html } = await sendOrderEmail({ body: ITEMS_COUNT_ONLY, rows: [PRINT_ROW, MUG_ROW] })
    expect(html).toContain(
      '<strong>27.00</strong><div style="color:#666;font-size:13px;margin:2px 0 0;">Size: A3<br>' +
        'Engraving: &lt;script&gt;alert(1)&lt;/script&gt;<br>Your photo: IMG_2231.jpg</div></li>'
    )
    expect(html).not.toContain('<script>')
    // The plain line is the line it always was.
    expect(html).toContain(
      '<li style="margin:0 0 8px;"><strong>Mug</strong> — 2 × 12.00 = <strong>24.00</strong></li>'
    )
  })

  it('reads the compact form an older checkout wrote, preferring the label it stored', async () => {
    const compact = '[{"key":"size","value":"a3"},{"key":"gift-wrap","value":true}]'
    const labelled = {
      ...PRINT_ROW,
      configuration: compact,
      configuration_label: 'Size: A3 · Gift wrap: Yes',
    }
    expect((await sendOrderEmail({ body: ROW_WITH_TOKEN, rows: [labelled] })).html).toBe(
      '<p>Photo print|Size: A3 · Gift wrap: Yes|27.00</p>'
    )
    const unlabelled = { ...PRINT_ROW, configuration: compact, configuration_label: null }
    expect((await sendOrderEmail({ body: ROW_WITH_TOKEN, rows: [unlabelled] })).html).toBe(
      '<p>Photo print|size: a3\ngift-wrap: Yes|27.00</p>'
    )
  })

  it('shows the short label a caller’s own lines carry', async () => {
    const items = [
      {
        name: 'Photo print',
        product_name: 'Photo print',
        quantity: 1,
        unitPrice: 27,
        totalPrice: 27,
        unit_price: '27.00',
        line_total: '27.00',
        configurationLabel: 'Size: A3 · Paper: Glossy',
        configuration: '[{"key":"size","value":"a3"}]',
      },
      {
        name: 'Mug',
        product_name: 'Mug',
        quantity: 1,
        unitPrice: 12,
        unit_price: '12.00',
        line_total: '12.00',
      },
    ]
    for (const postgres of [true, false]) {
      const { html } = await sendOrderEmail({ body: ROW_WITH_TOKEN, items, postgres })
      expect(html).toBe('<p>Photo print|Size: A3 · Paper: Glossy|27.00</p><p>Mug||12.00</p>')
    }
  })

  it('shows the options of the lines the order INSERT forwards when the workflow sends no email itself', async () => {
    // A store whose place-order workflow has no "Send Order-Notification
    // Email" node: the order INSERT (data-create-item) posts the cart lines
    // it found in the workflow context. Run that node for real and hand what
    // it posted to the route.
    const posted: Array<{ url: string; body: any }> = []
    const fetchMock = async (url: string, init: { body: string }) => {
      posted.push({ url, body: JSON.parse(init.body) })
      return {
        ok: true,
        json: async () => ({ item: { id: 'order-1', order_number: 'ORD-1', currency: 'USD' } }),
      }
    }
    const createItem = new Function(
      'fetch',
      `${dataCreateItem.generateHandler()}\nreturn data_create_item`
    )(fetchMock)
    const cartLines = [
      {
        productId: 'print',
        name: 'Photo print',
        price: 27,
        quantity: 1,
        configuration: SNAPSHOT,
        configurationKey: 'size=a3',
        configurationLabel: 'Size: A3 · Paper: Glossy',
        configurationPriceDelta: 17,
        basePrice: 10,
      },
      { productId: 'mug', name: 'Mug', price: 12, quantity: 1 },
    ]
    await createItem(
      { dataSourceId: 'ds', tableName: 'teleport_orders', columnMappings: {} },
      { getCart: { items: cartLines } }
    )
    const notification = posted.find((call) => call.url === '/api/ecommerce/order-notification')
    expect(notification).toBeDefined()
    const items = notification!.body.items
    expect(items.map((it: any) => it.configurationLabel)).toEqual(['Size: A3 · Paper: Glossy', ''])

    expect((await sendOrderEmail({ body: ROW_WITH_TOKEN, items })).html).toBe(
      '<p>Photo print|Size: A3 · Paper: Glossy|27.00</p><p>Mug||12.00</p>'
    )
    expect((await sendOrderEmail({ body: ROW_WITHOUT_TOKEN, items })).html).toBe(
      '<p>Photo print — Size: A3 · Paper: Glossy|27.00</p><p>Mug|12.00</p>'
    )
  })

  it('emits a parseable route in both datasource shapes', () => {
    for (const postgres of [true, false]) {
      const source = generateOrderNotificationApiRoute(
        settingsWith(ROW_WITH_TOKEN),
        postgres ? 'teleport' : null,
        postgres ? { connectionString: 'postgres://x' } : null
      )
      expect(() => parse(source, { sourceType: 'module' })).not.toThrow()
      expect(source.indexOf('/* tq:po-helpers:start v1 */') !== -1).toBe(postgres)
    }
  })
})
