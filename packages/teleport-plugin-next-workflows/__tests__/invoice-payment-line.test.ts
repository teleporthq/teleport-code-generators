import type { UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import { generatePdfGeneratorCode } from '../src/invoice/pdf-generator-code'
import { evaluateEmittedModule } from './_helpers/load-invoice-route'

/**
 * The invoice's payment line says how the order was paid in words, with the
 * provider that took the money ("Card (Stripe)", "Cash on delivery", "Paid
 * online" for a booking), and the provider's payment id as "Ref. pi_…". It
 * used to print the stored ids ("card", "cash_on_delivery", "pi_…") as they
 * are. Run on the EMITTED renderer.
 */

const SETTINGS = {
  invoicePrefix: 'INV-',
  defaultTaxRate: 0,
  companyDetails: {},
  template: { document: null as unknown },
  tables: { invoicesTable: 'teleport_invoices', invoiceItemsTable: 'teleport_invoice_items' },
  emailDelivery: { enabled: false },
} as unknown as UIDLInvoiceSettings

interface PdfGeneratorModule {
  buildInvoiceDataScope: (invoiceData: Record<string, unknown>) => {
    invoiceData: { Payment: Record<string, string> }
  }
}

const renderer = evaluateEmittedModule<PdfGeneratorModule>(
  generatePdfGeneratorCode(SETTINGS, null, null),
  require
)

const paymentOf = (invoice: Record<string, unknown>) =>
  renderer.buildInvoiceDataScope({ items: [], ...invoice }).invoiceData.Payment

describe('the invoice payment line', () => {
  it.each([
    ['card', 'stripe', 'Card (Stripe)'],
    ['card', '', 'Card'],
    ['online', '', 'Paid online'],
    ['online', 'mollie', 'Paid online (Mollie)'],
    ['cash_on_delivery', '', 'Cash on delivery'],
    ['cash_on_delivery', 'cash_on_delivery', 'Cash on delivery'],
    ['cod', '', 'Cash on delivery'],
    ['cash', '', 'Cash'],
    ['store_pickup', '', 'Paid at pickup'],
    ['gift_card', '', 'Gift card'],
    ['bank_transfer', '', 'Bank transfer'],
    ['paypal', '', 'Paid online (PayPal)'],
    ['stripe', '', 'Paid online (Stripe)'],
    ['', 'coingate', 'Paid online (CoinGate)'],
    ['apple_pay', '', 'Apple pay'],
    ['', '', ''],
  ])('prints method %j with provider %j as %j', (method, provider, label) => {
    expect(paymentOf({ paymentMethod: method, paymentProvider: provider }).method).toBe(label)
  })

  it('names the provider in words', () => {
    expect(paymentOf({ paymentProvider: 'paypal' }).provider).toBe('PayPal')
    expect(paymentOf({ paymentProvider: '' }).provider).toBe('')
  })

  it('prints the payment id as a reference, and nothing without one', () => {
    expect(paymentOf({ paymentIntentId: 'pi_3Nabc' }).intentId).toBe('Ref. pi_3Nabc')
    expect(paymentOf({ paymentIntentId: '' }).intentId).toBe('')
    expect(paymentOf({}).intentId).toBe('')
  })
})
