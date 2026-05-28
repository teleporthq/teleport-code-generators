import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_generate_invoice_pdf(config: any, context: Record<string, unknown>) {
  const invoiceNumber = config.invoiceNumber || ''
  const date = config.date || new Date().toISOString().split('T')[0]
  const dueDate = config.dueDate || ''
  const from = config.from || {}
  const to = config.to || {}
  const items = config.items || []
  const currency = config.currency || 'USD'
  const taxRate = config.tax !== undefined ? Number(config.tax) : 0
  const discount = config.discount !== undefined ? Number(config.discount) : 0
  const discountType = config.discountType || 'percentage'
  const notes = config.notes || ''
  const paymentTerms = config.paymentTerms || ''

  try {
    const PDFDocument = require('pdfkit')

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
    })

    const chunks: any[] = []
    doc.on('data', function (chunk: any) {
      chunks.push(chunk)
    })

    const pdfPromise = new Promise<Buffer>(function (resolve) {
      doc.on('end', function () {
        resolve(Buffer.concat(chunks))
      })
    })

    const pageWidth = 595.28
    const leftMargin = 50
    const rightEdge = pageWidth - 50
    const contentWidth = rightEdge - leftMargin

    const currencySymbols: Record<string, string> = {
      USD: '$',
      EUR: '\u20AC',
      GBP: '\u00A3',
      JPY: '\u00A5',
      CAD: 'C$',
      AUD: 'A$',
      CHF: 'CHF ',
      CNY: '\u00A5',
      INR: '\u20B9',
      BRL: 'R$',
      KRW: '\u20A9',
      MXN: 'MX$',
    }
    const sym = currencySymbols[currency] || currency + ' '

    function formatAmount(amount: number): string {
      return sym + amount.toFixed(2)
    }

    doc.fontSize(24).fillColor('#333333').text('INVOICE', leftMargin, 50, { align: 'right' })
    doc.moveDown(0.5)

    if (invoiceNumber) {
      doc
        .fontSize(10)
        .fillColor('#666666')
        .text('Invoice #: ' + invoiceNumber, { align: 'right' })
    }
    doc
      .fontSize(10)
      .fillColor('#666666')
      .text('Date: ' + date, { align: 'right' })
    if (dueDate) {
      doc.text('Due Date: ' + dueDate, { align: 'right' })
    }
    doc.moveDown(2)

    const infoY = doc.y

    doc.fontSize(10).fillColor('#333333').text('From:', leftMargin, infoY)
    doc.fontSize(10).fillColor('#555555')
    if (from.name) {
      doc.text(from.name)
    }
    if (from.company) {
      doc.text(from.company)
    }
    if (from.address) {
      doc.text(from.address)
    }
    if (from.city) {
      doc.text(from.city + (from.state ? ', ' + from.state : '') + (from.zip ? ' ' + from.zip : ''))
    }
    if (from.country) {
      doc.text(from.country)
    }
    if (from.email) {
      doc.text(from.email)
    }
    if (from.phone) {
      doc.text(from.phone)
    }

    doc
      .fontSize(10)
      .fillColor('#333333')
      .text('To:', contentWidth / 2 + leftMargin, infoY)
    doc.fontSize(10).fillColor('#555555')
    doc.text(to.name || '', contentWidth / 2 + leftMargin)
    if (to.company) {
      doc.text(to.company, contentWidth / 2 + leftMargin)
    }
    if (to.address) {
      doc.text(to.address, contentWidth / 2 + leftMargin)
    }
    if (to.city) {
      doc.text(
        to.city + (to.state ? ', ' + to.state : '') + (to.zip ? ' ' + to.zip : ''),
        contentWidth / 2 + leftMargin
      )
    }
    if (to.country) {
      doc.text(to.country, contentWidth / 2 + leftMargin)
    }
    if (to.email) {
      doc.text(to.email, contentWidth / 2 + leftMargin)
    }

    doc.moveDown(2)

    const tableTop = doc.y
    const descCol = leftMargin
    const qtyCol = leftMargin + contentWidth * 0.5
    const priceCol = leftMargin + contentWidth * 0.65
    const totalCol = leftMargin + contentWidth * 0.82

    doc
      .moveTo(leftMargin, tableTop - 5)
      .lineTo(rightEdge, tableTop - 5)
      .strokeColor('#cccccc')
      .stroke()
    doc.fontSize(9).fillColor('#333333')
    doc.text('Description', descCol, tableTop, { width: qtyCol - descCol })
    doc.text('Qty', qtyCol, tableTop, { width: priceCol - qtyCol, align: 'center' })
    doc.text('Price', priceCol, tableTop, { width: totalCol - priceCol, align: 'right' })
    doc.text('Total', totalCol, tableTop, { width: rightEdge - totalCol, align: 'right' })
    doc
      .moveTo(leftMargin, tableTop + 15)
      .lineTo(rightEdge, tableTop + 15)
      .stroke()

    let subtotal = 0
    let rowY = tableTop + 22

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const qty = Number(item.quantity) || 1
      const price = Number(item.price) || 0
      const lineTotal = qty * price
      subtotal += lineTotal

      doc.fontSize(9).fillColor('#444444')
      doc.text(item.description || item.name || 'Item ' + (i + 1), descCol, rowY, {
        width: qtyCol - descCol - 5,
      })
      doc.text(String(qty), qtyCol, rowY, { width: priceCol - qtyCol, align: 'center' })
      doc.text(formatAmount(price), priceCol, rowY, { width: totalCol - priceCol, align: 'right' })
      doc.text(formatAmount(lineTotal), totalCol, rowY, {
        width: rightEdge - totalCol,
        align: 'right',
      })

      rowY += 20

      if (rowY > 700) {
        doc.addPage()
        rowY = 50
      }
    }

    doc.moveTo(leftMargin, rowY).lineTo(rightEdge, rowY).stroke()
    rowY += 15

    const summaryX = totalCol - 80
    doc.fontSize(10).fillColor('#555555')
    doc.text('Subtotal:', summaryX, rowY, { width: 80, align: 'right' })
    doc.text(formatAmount(subtotal), totalCol, rowY, {
      width: rightEdge - totalCol,
      align: 'right',
    })
    rowY += 18

    let discountAmount = 0
    if (discount > 0) {
      if (discountType === 'percentage') {
        discountAmount = subtotal * (discount / 100)
        doc.text('Discount (' + discount + '%):', summaryX, rowY, { width: 80, align: 'right' })
      } else {
        discountAmount = discount
        doc.text('Discount:', summaryX, rowY, { width: 80, align: 'right' })
      }
      doc.text('-' + formatAmount(discountAmount), totalCol, rowY, {
        width: rightEdge - totalCol,
        align: 'right',
      })
      rowY += 18
    }

    const taxableAmount = subtotal - discountAmount
    const taxAmount = taxableAmount * (taxRate / 100)

    if (taxRate > 0) {
      doc.text('Tax (' + taxRate + '%):', summaryX, rowY, { width: 80, align: 'right' })
      doc.text(formatAmount(taxAmount), totalCol, rowY, {
        width: rightEdge - totalCol,
        align: 'right',
      })
      rowY += 18
    }

    const total = taxableAmount + taxAmount
    doc.moveTo(summaryX, rowY).lineTo(rightEdge, rowY).stroke()
    rowY += 8
    doc.fontSize(12).fillColor('#333333')
    doc.text('Total:', summaryX, rowY, { width: 80, align: 'right' })
    doc.text(formatAmount(total), totalCol, rowY, { width: rightEdge - totalCol, align: 'right' })
    rowY += 30

    if (notes || paymentTerms) {
      doc.moveTo(leftMargin, rowY).lineTo(rightEdge, rowY).strokeColor('#eeeeee').stroke()
      rowY += 10
      if (paymentTerms) {
        doc.fontSize(9).fillColor('#333333').text('Payment Terms:', leftMargin, rowY)
        doc.fontSize(9).fillColor('#555555').text(paymentTerms)
        doc.moveDown(0.5)
      }
      if (notes) {
        doc.fontSize(9).fillColor('#333333').text('Notes:', leftMargin)
        doc.fontSize(9).fillColor('#555555').text(notes)
      }
    }

    doc.end()
    const pdfBuffer = await pdfPromise
    const pdfBase64 = 'data:application/pdf;base64,' + pdfBuffer.toString('base64')

    return {
      pdfUrl: null,
      pdfData: pdfBase64,
      invoiceSummary: {
        invoiceNumber,
        date,
        dueDate,
        subtotal,
        discount: discountAmount,
        tax: taxAmount,
        total,
        currency,
        itemCount: items.length,
      },
    }
  } catch (err: unknown) {
    return { pdfUrl: null, pdfData: null, error: (err as Error).message }
  }
}
export const utilityGenerateInvoicePdf: NodeHandlerGenerator = {
  nodeType: 'utility-generate-invoice-pdf',
  executionEnv: 'server',
  dependencies: {
    pdfkit: '^0.14.0',
  },
  generateHandler(): string {
    return handlerToString(utility_generate_invoice_pdf)
  },
}
