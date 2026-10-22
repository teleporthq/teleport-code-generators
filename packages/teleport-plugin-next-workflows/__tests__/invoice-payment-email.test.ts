import {
  BUYER,
  ORDER_ID,
  Row,
  Store,
  historyLines,
  invoiceOf,
  ledgerRows,
  openStore,
  payWhilePdfServiceIsDown,
  runsAsTheStore,
  seedPaidOrder,
} from './_helpers/invoice-store'

/**
 * The invoice email a payment sends is on its order's history.
 *
 * With Invoice Email Delivery on, the payment's `/api/invoices/generate`
 * emails the buyer the invoice it just issued. The admin panel's Regenerate
 * writes an "email sent" line on the order's history when it emails one; the
 * payment wrote none, so the order never showed that its buyer got the
 * invoice.
 *
 * Everything here is the code the store runs, as emitted (see
 * `_helpers/invoice-store.ts`); only its database, the PDF service and the
 * email provider are faked.
 */
describe("the payment's invoice email is on its order's history", () => {
  runsAsTheStore()

  it('the email the payment sends writes one "email sent" line, by the store', async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID)

    const paid = await store.pay(ORDER_ID)

    expect(paid.status).toBe(200)
    const invoice = invoiceOf(store, ORDER_ID)
    expect(store.emails.map((email) => email.To)).toEqual([BUYER])
    expect(ledgerRows(store)).toEqual([
      expect.objectContaining({ status: 'sent', source_ref: 'api/invoices/generate' }),
    ])
    // The line the regeneration writes, keyed on the same invoice: an
    // invoice's email is on its order's history once, whoever sent it.
    expect(historyLines(store)).toEqual([
      expect.objectContaining({
        event_type: 'order-email-sent',
        dedupe_key: 'order-email-sent:' + String(invoice.id) + ':invoice-email',
        order_id: ORDER_ID,
        payload: JSON.stringify({ purpose: 'invoice-email', to: BUYER }),
        actor: '',
        actor_type: 'system',
        status: 'recorded',
      }),
    ])
  })

  it('a payment reported again sends nothing and writes no second line', async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID)
    expect((await store.pay(ORDER_ID)).status).toBe(200)

    const again = await store.pay(ORDER_ID)

    expect(again.body).toMatchObject({ success: true, alreadyIssued: true })
    expect(store.emails).toHaveLength(1)
    expect(historyLines(store)).toHaveLength(1)
  })

  it('an invoice an admin issues by hand is on the history under their name', async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID)

    expect((await store.issueAsAdmin(ORDER_ID)).status).toBe(200)

    expect(store.emails).toHaveLength(1)
    expect(historyLines(store)).toEqual([
      expect.objectContaining({ actor: 'Store admin', actor_type: 'merchant' }),
    ])
  })

  it('a refused email writes no line, and the log says it failed', async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID)
    store.provider.refuses = true

    const paid = await store.pay(ORDER_ID)

    expect(paid.status).toBe(200)
    expect(store.emails).toHaveLength(1)
    expect(ledgerRows(store)).toEqual([expect.objectContaining({ status: 'failed' })])
    expect(historyLines(store)).toEqual([])
    expect(store.errors).toContainEqual(expect.stringContaining('Email delivery FAILED'))
  })

  it('a history that cannot be written costs nothing else: the email goes and the payment is answered', async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID)
    store.db.failNext(/^INSERT INTO teleport_events /, 'relation "teleport_events" does not exist')

    const paid = await store.pay(ORDER_ID)

    expect(paid.status).toBe(200)
    expect(paid.body).toMatchObject({ success: true, invoiceNumber: 'INV-0001' })
    expect(store.emails).toHaveLength(1)
    expect(historyLines(store)).toEqual([])
    expect(store.errors).toContainEqual(
      expect.stringContaining('INV-0001 was emailed, but the order history could not record it')
    )
  })

  it('Invoice Email Delivery off: no email and no line', async () => {
    const store = openStore({ emailDelivery: false })
    seedPaidOrder(store.db, ORDER_ID)

    expect((await store.pay(ORDER_ID)).status).toBe(200)

    expect(store.emails).toEqual([])
    expect(historyLines(store)).toEqual([])
  })
})

/**
 * A retried payment and the merchant's Regenerate finishing the same invoice.
 *
 * The PDF service was down at payment, so the invoice is reserved without a
 * PDF. A quarter of an hour later the provider retries the payment, which
 * claims the stale reservation and renders it — and the merchant clicks
 * Regenerate meanwhile. Each route emails the buyer when it gives the invoice
 * its first PDF, so the database must give that to exactly one of them.
 */
describe('a retried payment and a regeneration finishing the same invoice', () => {
  runsAsTheStore()

  const PAYMENT_PDF = /^UPDATE teleport_invoices SET "?pdf_data"? = \$1/
  const REGENERATION_PDF = /^UPDATE teleport_invoices SET "invoice_number" = \$1/

  /** The order paid while the PDF service was down, its reservation older than any request lives. */
  async function staleInvoice(store: Store): Promise<Row> {
    seedPaidOrder(store.db, ORDER_ID)
    const invoice = await payWhilePdfServiceIsDown(store, ORDER_ID)
    invoice.updated_at = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    return invoice
  }

  it("the regeneration's PDF lands first: it emails the buyer, and the payment answers with its invoice", async () => {
    const store = openStore()
    const invoice = await staleInvoice(store)
    const paymentsPdf = store.db.pauseNext(PAYMENT_PDF)

    const payment = store.pay(ORDER_ID)
    await paymentsPdf.reached
    const regenerated = await store.regenerate(String(invoice.id))
    paymentsPdf.release()
    const paid = await payment

    expect(store.emails.map((email) => email.To)).toEqual([BUYER])
    expect(ledgerRows(store).map((row) => row.source_ref)).toEqual(['api/invoices/[id]/regenerate'])
    expect(historyLines(store)).toEqual([expect.objectContaining({ actor_type: 'merchant' })])
    expect(regenerated.status).toBe(200)
    expect(paid.status).toBe(200)
    expect(paid.body).toMatchObject({
      success: true,
      alreadyIssued: true,
      invoiceId: invoice.id,
      invoiceNumber: 'INV-0001',
      pdfUrl: '/api/invoices/' + String(invoice.id) + '/pdf',
    })
    expect(store.db.row('teleport_orders', ORDER_ID)).toMatchObject({ invoice_id: invoice.id })
  })

  it("the payment's PDF lands first: it emails the buyer, and the regeneration does not", async () => {
    const store = openStore()
    const invoice = await staleInvoice(store)
    const regenerationsPdf = store.db.pauseNext(REGENERATION_PDF)

    const regeneration = store.regenerate(String(invoice.id))
    await regenerationsPdf.reached
    const paid = await store.pay(ORDER_ID)
    regenerationsPdf.release()
    const regenerated = await regeneration

    expect(store.emails.map((email) => email.To)).toEqual([BUYER])
    expect(ledgerRows(store).map((row) => row.source_ref)).toEqual(['api/invoices/generate'])
    expect(historyLines(store)).toEqual([expect.objectContaining({ actor_type: 'system' })])
    expect(paid.status).toBe(200)
    expect(paid.body).toMatchObject({ success: true, invoiceId: invoice.id })
    expect(paid.body).not.toHaveProperty('alreadyIssued')
    expect(regenerated.status).toBe(200)
  })
})
