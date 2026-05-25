import { NodeHandlerGenerator, handlerToString } from '../types'

async function ecommerce_generate_invoice(config: any, context: any) {
  const baseUrl = (context && context.__baseUrl) || ''
  const orderId = config.orderId

  if (!orderId) {
    console.warn('[invoice-node] Refusing to call /api/invoices/generate: orderId is empty')
    return {
      invoiceId: '',
      invoiceNumber: '',
      pdfUrl: '',
      total: 0,
      status: 'failed',
      error: 'orderId is required',
    }
  }

  try {
    const payload: any = { orderId }
    if (config.sendEmail !== undefined) {
      payload.sendEmail = !!config.sendEmail
    }
    if (config.overrideCurrency) {
      payload.overrideCurrency = config.overrideCurrency
    }
    if (config.overrideTaxRate !== undefined && config.overrideTaxRate !== null) {
      payload.overrideTaxRate = Number(config.overrideTaxRate)
    }

    const targetUrl = baseUrl + '/api/invoices/generate'
    console.info('[invoice-node] POST ' + targetUrl + ' payload=' + JSON.stringify(payload))

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      let errBody: any
      try {
        errBody = await response.json()
      } catch (_e) {
        errBody = {}
      }
      console.warn(
        '[invoice-node] /api/invoices/generate FAILED status=' +
          response.status +
          ' body=' +
          JSON.stringify(errBody)
      )
      return {
        invoiceId: '',
        invoiceNumber: '',
        pdfUrl: '',
        storageUrl: '',
        total: 0,
        status: 'failed',
        error: errBody.error || 'Invoice generation failed',
      }
    }

    const data = await response.json()
    console.info(
      '[invoice-node] /api/invoices/generate OK invoiceId=' +
        (data.invoiceId || '(missing)') +
        ' number=' +
        (data.invoiceNumber || '(missing)') +
        ' pdfUrl=' +
        (data.pdfUrl || '(missing)') +
        ' storageUrl=' +
        (data.storageUrl || '(empty)')
    )
    return {
      invoiceId: data.invoiceId || data.id || '',
      invoiceNumber: data.invoiceNumber || '',
      pdfUrl: data.pdfUrl || '',
      // Persistent runtime-storage URL — empty when the storage worker is not
      // configured for the project. Downstream nodes (e.g. the payment
      // webhook) should gate on a non-empty value before writing it onto the
      // order record.
      storageUrl: data.storageUrl || '',
      total: data.total || 0,
      status: data.status || 'generated',
    }
  } catch (err: unknown) {
    console.warn('[invoice-node] /api/invoices/generate threw: ' + ((err as Error).message || err))
    return {
      invoiceId: '',
      invoiceNumber: '',
      pdfUrl: '',
      storageUrl: '',
      total: 0,
      status: 'failed',
      error: (err as Error).message,
    }
  }
}

export const ecommerceGenerateInvoice: NodeHandlerGenerator = {
  nodeType: 'ecommerce-generate-invoice',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(ecommerce_generate_invoice)
  },
}
