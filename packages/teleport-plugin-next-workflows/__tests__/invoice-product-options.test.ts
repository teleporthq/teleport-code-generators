/* tslint:disable:function-constructor */
import { generatePdfGeneratorCode } from '../src/invoice/pdf-generator-code'
import { generateInvoiceAssemblyCode } from '../src/invoice/invoice-assembly-code'
import type { UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import { evaluateEmittedModule } from './_helpers/load-invoice-route'

/**
 * A line bought with product options on the invoice: its short label joins the
 * variant after the product name the template binds (clamped, so a long
 * engraving cannot swamp the row), and the no-template fallback prints the
 * line's description — every answer, one per line — under the name, escaped.
 * A line without options keeps exactly the name it always had. Executed through
 * the emitted `utils/invoices/pdf-generator.js`.
 */

const SETTINGS = {
  invoicePrefix: 'INV-',
  defaultTaxRate: 0,
  showDiscount: false,
  taxIncludedInPrice: false,
  companyDetails: {},
  template: { document: null as unknown },
  tables: { invoicesTable: 'teleport_invoices', invoiceItemsTable: 'teleport_invoice_items' },
  emailDelivery: { enabled: false },
} as unknown as UIDLInvoiceSettings

interface PdfGeneratorModule {
  buildInvoiceDataScope: (invoiceData: Record<string, unknown>) => {
    invoiceData: { Products: Array<Record<string, string>> }
  }
  buildInvoiceHtml: (invoiceData: Record<string, unknown>) => string
}

function loadPdfGenerator(): PdfGeneratorModule {
  const moduleObject = { exports: {} as Record<string, unknown> }
  return new Function(
    'require',
    'module',
    'exports',
    `${generatePdfGeneratorCode(SETTINGS, null, null)}; return module.exports;`
  )(require, moduleObject, moduleObject.exports)
}

const invoiceWith = (items: Array<Record<string, unknown>>) => ({
  invoiceNumber: 'INV-0001',
  currencySymbol: '$',
  subtotal: 51,
  total: 51,
  items,
})

const PRINT = {
  name: 'Photo print',
  variantLabel: 'Framed',
  quantity: 1,
  unitPrice: 27,
  totalPrice: 27,
  configurationLabel: 'Size: A3 · Paper: Glossy · Engraving: <b>Ana</b>',
  description: 'Size: A3\nPaper: Glossy\nEngraving: <b>Ana</b>',
}
const MUG = { name: 'Mug', variantLabel: 'Blue', quantity: 2, unitPrice: 12, totalPrice: 24 }

describe('invoice — lines bought with product options', () => {
  const pdf = loadPdfGenerator()

  it('names the line with its variant and options, and keeps a plain line’s name', () => {
    const [print, mug, flat] = pdf.buildInvoiceDataScope(
      invoiceWith([PRINT, MUG, { name: 'Tote', quantity: 1, unitPrice: 8 }])
    ).invoiceData.Products
    expect(print.name).toBe(
      'Photo print — Framed · Size: A3 · Paper: Glossy · Engraving: <b>Ana</b>'
    )
    expect(print.description).toBe(PRINT.description)
    expect(mug.name).toBe('Mug — Blue')
    expect(flat.name).toBe('Tote')
  })

  it('clamps a long options label without splitting a character', () => {
    const [line] = pdf.buildInvoiceDataScope(
      invoiceWith([
        { name: 'Pen', quantity: 1, unitPrice: 5, configuration_label: '😀'.repeat(200) },
      ])
    ).invoiceData.Products
    expect(line.name).toBe('Pen — ' + '😀'.repeat(159) + '…')
  })

  it('prints every answer under the name in the fallback layout, escaped', () => {
    const html = pdf.buildInvoiceHtml(invoiceWith([PRINT, MUG]))
    expect(html).toContain(
      'Photo print — Framed · Size: A3 · Paper: Glossy · Engraving: &lt;b&gt;Ana&lt;/b&gt;' +
        '<div style="color:#666;font-size:11px;">Size: A3<br>Paper: Glossy<br>Engraving: &lt;b&gt;Ana&lt;/b&gt;</div></td>'
    )
    expect(html).toContain('>Mug — Blue</td>')
    expect(html).not.toContain('<b>Ana</b>')
  })
})

/**
 * The invoice issued from an order id reads each line's options off the stored
 * order line: the short label beside the name, and every answer as the line's
 * description. Executed through the emitted `utils/invoices/invoice-assembly.js`.
 */
describe('invoice assembly — options read off the stored order lines', () => {
  type Row = Record<string, unknown>
  const assembly = evaluateEmittedModule<{
    assembleInvoiceData: (body: Row, order: Row, items: Row[]) => { items: Row[] } | null
  }>(generateInvoiceAssemblyCode(SETTINGS), ((id: string) => {
    if (id.indexOf('pdf-generator') !== -1) {
      return { COMPANY_DETAILS: {} }
    }
    return id.indexOf('data-access') !== -1 ? {} : require(id)
  }) as unknown as NodeRequire)
  const ORDER = { id: 'o1', currency: 'USD' }
  const SNAPSHOT = JSON.stringify({
    v: 1,
    basePrice: 10,
    priceDelta: 17,
    entries: [
      { key: 'size', label: 'Size', type: 'choice', value: 'a3', valueLabel: 'A3', priceDelta: 9 },
      {
        key: 'paper',
        label: 'Paper',
        type: 'choice',
        value: 'glossy',
        valueLabel: 'Glossy',
        priceDelta: 8,
      },
    ],
  })
  const itemsOf = (rows: Row[]) =>
    assembly.assembleInvoiceData({ orderId: 'o1' }, ORDER, rows)!.items

  it("bills every line in the order's currency, whatever the line's own column holds", () => {
    const result = assembly.assembleInvoiceData({ orderId: 'o1' }, { id: 'o1', currency: 'ron' }, [
      { product_name: 'Mug', quantity: 1, unit_price: 12, total_price: 12, currency: 'USD' },
      { product_name: 'Tea', quantity: 2, unit_price: 5, total_price: 10 },
    ]) as { currency: string; items: Row[] }
    expect(result.currency).toBe('RON')
    expect(result.items.map((line) => line.currency)).toEqual(['RON', 'RON'])
  })

  it('labels a current snapshot and lists every answer as the description', () => {
    const [line] = itemsOf([
      {
        product_name: 'Photo print',
        quantity: 1,
        unit_price: 27,
        total_price: 27,
        configuration: SNAPSHOT,
      },
    ])
    expect(line.configurationLabel).toBe('Size: A3 · Paper: Glossy')
    expect(line.description).toBe('Size: A3\nPaper: Glossy')
  })

  it('keeps the stored label of a compact snapshot an older checkout wrote', () => {
    const [line] = itemsOf([
      {
        product_name: 'Photo print',
        quantity: 1,
        unit_price: 27,
        total_price: 27,
        configuration: JSON.stringify([{ key: 'size', value: 'a3' }]),
        configuration_label: 'Size: A3',
      },
    ])
    expect(line.configurationLabel).toBe('Size: A3')
    expect(line.description).toBe('Size: A3')
  })

  it('leaves a line without options with empty option fields', () => {
    const [line] = itemsOf([{ product_name: 'Tote', quantity: 1, unit_price: 8, total_price: 8 }])
    expect(line.configurationLabel).toBe('')
    expect(line.description).toBe('')
    expect(line.name).toBe('Tote')
  })
})
