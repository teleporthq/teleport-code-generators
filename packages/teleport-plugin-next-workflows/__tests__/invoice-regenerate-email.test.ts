import {
  BUYER,
  ORDER_ID,
  SECOND_BUYER,
  SECOND_ORDER_ID,
  PostmarkMessage,
  historyLines,
  invoiceOf,
  ledgerRows,
  openStore,
  payWhilePdfServiceIsDown,
  runsAsTheStore,
  seedPaidOrder,
} from './_helpers/invoice-store'

/**
 * Regenerate emails the buyer the invoice their payment could not.
 *
 * When the PDF service is down at payment, the order is still paid and its
 * invoice row stays reserved without a PDF, so the payment's invoice email
 * never goes out. The merchant then gets the PDF with the admin panel's
 * Regenerate — and that regeneration, the FIRST to give the invoice a PDF,
 * emails the buyer, once, when the store emails invoices.
 *
 * Everything here is the code the store runs, as emitted: the payment's
 * `/api/invoices/generate`, the admin panel's `/api/invoices/[id]/regenerate`,
 * the data access, the assembly, the PDF client, the invoice sender, the
 * sent-email ledger and the locale module. Only what lies outside the store is
 * faked: its Postgres database, the PDF service and the email provider.
 */

describe('Regenerate emails the buyer the invoice their payment could not', () => {
  runsAsTheStore()

  it('no PDF before: the regeneration that gives the invoice its PDF emails the buyer once', async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID)
    const invoice = await payWhilePdfServiceIsDown(store, ORDER_ID)
    expect(store.emails).toHaveLength(0)

    const regenerated = await store.regenerate(String(invoice.id))

    expect(regenerated.status).toBe(200)
    expect(Number(invoice.pdf_size_bytes)).toBeGreaterThan(0)
    expect(store.emails).toHaveLength(1)
    const [email] = store.emails
    expect(email.To).toBe(BUYER)
    expect(email.From).toBe('Lumen Pottery <shop@lumen.test>')
    expect(email.Attachments).toEqual([
      {
        Name: 'INV-0001.pdf',
        Content: Buffer.from('%PDF-1.4 INV-0001').toString('base64'),
        ContentType: 'application/pdf',
      },
    ])

    // The sent-email ledger: the row the payment's email writes, naming the
    // route that sent it.
    expect(ledgerRows(store)).toEqual([
      expect.objectContaining({
        email_type: 'invoice-email',
        audience: 'customer',
        recipient_email: BUYER,
        from_email: 'shop@lumen.test',
        from_name: 'Lumen Pottery',
        status: 'sent',
        provider: 'postmark',
        source: 'invoice',
        source_ref: 'api/invoices/[id]/regenerate',
        order_id: ORDER_ID,
        reference_type: 'invoice',
        reference_id: invoice.id,
      }),
    ])
    // The order's history: one "email sent" line, by the store admin.
    expect(historyLines(store)).toEqual([
      expect.objectContaining({
        event_type: 'order-email-sent',
        dedupe_key: 'order-email-sent:' + String(invoice.id) + ':invoice-email',
        order_id: ORDER_ID,
        payload: JSON.stringify({ purpose: 'invoice-email', to: BUYER }),
        actor: 'Store admin',
        actor_type: 'merchant',
        status: 'recorded',
      }),
    ])
  })

  it.each([
    [
      'served from the database',
      false,
      (invoiceId: string) => '/api/invoices/' + invoiceId + '/pdf',
    ],
    ['in runtime storage', true, () => 'https://cdn.test/INV-0001.pdf'],
  ])(
    'sends exactly the email the payment would have sent — sender, template, attachment, language, and the link of a PDF %s',
    async (_, storageConfigured, expectedLink) => {
      // A payment the PDF service served: the invoice email it sends.
      const paidOk = openStore()
      paidOk.storage.configured = storageConfigured
      seedPaidOrder(paidOk.db, ORDER_ID)
      expect((await paidOk.pay(ORDER_ID)).status).toBe(200)
      expect(paidOk.emails).toHaveLength(1)
      const atPayment = paidOk.emails[0]
      const paidInvoiceId = String(invoiceOf(paidOk, ORDER_ID).id)

      // The same order, paid while the PDF service was down, then regenerated.
      const paidDown = openStore()
      paidDown.storage.configured = storageConfigured
      seedPaidOrder(paidDown.db, ORDER_ID)
      const invoice = await payWhilePdfServiceIsDown(paidDown, ORDER_ID)
      expect((await paidDown.regenerate(String(invoice.id))).status).toBe(200)
      expect(paidDown.emails).toHaveLength(1)
      const atRegeneration = paidDown.emails[0]

      // Nothing differs but the invoice's own id, inside a database link.
      const sameLink = (message: PostmarkMessage, id: string): PostmarkMessage => ({
        ...message,
        HtmlBody: message.HtmlBody.split(id).join('<invoice id>'),
      })
      expect(sameLink(atRegeneration, String(invoice.id))).toEqual(
        sameLink(atPayment, paidInvoiceId)
      )
      // The buyer's language (the order is Spanish), not the merchant's German admin.
      expect(atRegeneration.Subject).toBe('Factura INV-0001')
      expect(atRegeneration.HtmlBody).toBe(
        '<p>Hola Ana Pop, factura INV-0001 por €100.00: ' +
          expectedLink(String(invoice.id)) +
          '</p>'
      )
    }
  )

  it("an order with no language of its own gets the store's main language, never the merchant's", async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID, { locale: null })
    const invoice = await payWhilePdfServiceIsDown(store, ORDER_ID)

    await store.regenerate(String(invoice.id))

    expect(store.emails.map((email) => email.Subject)).toEqual(['Invoice INV-0001'])
  })

  it('had a PDF: only the invoice that never had one is emailed', async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID)
    seedPaidOrder(store.db, SECOND_ORDER_ID, {}, SECOND_BUYER)
    // The first order's invoice was issued and emailed at payment.
    expect((await store.pay(ORDER_ID)).status).toBe(200)
    const issued = invoiceOf(store, ORDER_ID)
    expect(store.emails.map((email) => email.To)).toEqual([BUYER])
    // The second order's was not: the PDF service was down.
    const unfinished = await payWhilePdfServiceIsDown(store, SECOND_ORDER_ID)

    expect((await store.regenerate(String(issued.id))).status).toBe(200)
    expect((await store.regenerate(String(unfinished.id))).status).toBe(200)

    // The payment's email, then the unfinished invoice's — nothing for the
    // invoice that already had its PDF.
    expect(store.emails.map((email) => email.To)).toEqual([BUYER, SECOND_BUYER])
    // Each email is on its own order's history once: the payment's, by the
    // store, and the regeneration's, by the admin.
    expect(historyLines(store).map((line) => [line.order_id, line.actor_type])).toEqual([
      [ORDER_ID, 'system'],
      [SECOND_ORDER_ID, 'merchant'],
    ])
  })

  it('a second regeneration never emails again', async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID)
    const invoice = await payWhilePdfServiceIsDown(store, ORDER_ID)

    expect((await store.regenerate(String(invoice.id))).status).toBe(200)
    expect(store.emails).toHaveLength(1)
    expect((await store.regenerate(String(invoice.id))).status).toBe(200)
    expect((await store.regenerate(String(invoice.id))).status).toBe(200)

    expect(store.emails).toHaveLength(1)
    expect(ledgerRows(store)).toHaveLength(1)
    expect(historyLines(store)).toHaveLength(1)
  })

  it('two overlapping regenerations (a double click) email once', async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID)
    const invoice = await payWhilePdfServiceIsDown(store, ORDER_ID)

    // Both requests read the invoice without a PDF and render before either
    // writes: the PDF service answers neither until it has both.
    let releaseRenders: () => void = () => undefined
    store.pdfService.hold = new Promise((resolve) => {
      releaseRenders = resolve
    })
    const first = store.regenerate(String(invoice.id))
    const second = store.regenerate(String(invoice.id))
    while (store.pdfService.renders < 2) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    releaseRenders()
    const answers = await Promise.all([first, second])

    expect(answers.map((answer) => answer.status)).toEqual([200, 200])
    expect(store.emails).toHaveLength(1)
    expect(ledgerRows(store)).toHaveLength(1)
    expect(historyLines(store)).toHaveLength(1)
  })

  it('Invoice Email Delivery off: the same regeneration emails nobody', async () => {
    const delivering = openStore()
    seedPaidOrder(delivering.db, ORDER_ID)
    const deliveredInvoice = await payWhilePdfServiceIsDown(delivering, ORDER_ID)
    await delivering.regenerate(String(deliveredInvoice.id))
    expect(delivering.emails).toHaveLength(1)

    const silent = openStore({ emailDelivery: false })
    seedPaidOrder(silent.db, ORDER_ID)
    const invoice = await payWhilePdfServiceIsDown(silent, ORDER_ID)
    const regenerated = await silent.regenerate(String(invoice.id))

    expect(regenerated.status).toBe(200)
    expect(Number(invoice.pdf_size_bytes)).toBeGreaterThan(0)
    expect(silent.emails).toHaveLength(0)
    expect(ledgerRows(silent)).toHaveLength(0)
    expect(historyLines(silent)).toHaveLength(0)
    // The route does not even load the sender.
    expect(silent.routeCode).not.toContain('email-sender')
  })

  it('a refused email still regenerates the invoice, is logged, and is never sent again', async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID)
    const invoice = await payWhilePdfServiceIsDown(store, ORDER_ID)
    store.provider.refuses = true

    const regenerated = await store.regenerate(String(invoice.id))

    // The merchant has the PDF, and the order links to it.
    expect(regenerated.status).toBe(200)
    expect(regenerated.body).toMatchObject({ success: true, invoiceNumber: 'INV-0001' })
    expect(Number(invoice.pdf_size_bytes)).toBeGreaterThan(0)
    expect(store.db.row('teleport_orders', ORDER_ID)).toMatchObject({
      invoice_id: invoice.id,
      invoice_number: 'INV-0001',
      invoice_pdf_url: '/api/invoices/' + String(invoice.id) + '/pdf',
    })
    // The provider was asked once and refused: the ledger says so, the
    // order's history does not claim an email went out, the log names it.
    expect(store.emails).toHaveLength(1)
    expect(ledgerRows(store)).toEqual([
      expect.objectContaining({
        status: 'failed',
        error_message: '422 The From address is not a confirmed sender signature',
      }),
    ])
    expect(historyLines(store)).toHaveLength(0)
    expect(store.errors).toContainEqual(
      expect.stringContaining('invoice INV-0001 could not be emailed to its customer')
    )

    store.provider.refuses = false
    expect((await store.regenerate(String(invoice.id))).status).toBe(200)
    expect(store.emails).toHaveLength(1)
  })

  it('an order that cannot be updated still gets its invoice emailed, once', async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID)
    const invoice = await payWhilePdfServiceIsDown(store, ORDER_ID)
    store.db.failNext(/^UPDATE teleport_orders SET invoice_id = \$1/, 'Connection terminated')

    const failed = await store.regenerate(String(invoice.id))

    // The invoice has its PDF, so its buyer is emailed it, with the link the
    // database serves it from.
    expect(failed.status).toBe(500)
    expect(store.emails).toHaveLength(1)
    expect(store.emails[0].HtmlBody).toContain('/api/invoices/' + String(invoice.id) + '/pdf')
    expect(ledgerRows(store)).toHaveLength(1)

    // Regenerating again links the order, and emails nobody.
    expect((await store.regenerate(String(invoice.id))).status).toBe(200)
    expect(store.db.row('teleport_orders', ORDER_ID)).toMatchObject({ invoice_id: invoice.id })
    expect(store.emails).toHaveLength(1)
    expect(historyLines(store)).toHaveLength(1)
  })
})
