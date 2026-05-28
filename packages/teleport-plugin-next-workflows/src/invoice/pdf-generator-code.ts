import { UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import { generateInvoiceHtmlCode } from './invoice-html-code'
import { generatePdfServiceClientCode } from './pdf-service-client-code'

// Emits `utils/invoices/pdf-generator.js` — the module consumed by
// `pages/api/invoices/generate.js` (see `api-routes-code.ts`). The file
// is stitched together from three concerns, each owned by its own
// source module:
//
//   1. HTML builder — walks the user-authored `invoice-template` UIDL
//      component, merges real DB data with editor defaults, and emits a
//      fully self-contained HTML document (reset CSS + global CSS inline,
//      no external stylesheet dependencies). Lives in `invoice-html-code.ts`.
//
//   2. PDF service client — posts that HTML to the shared external
//      microservice, receives a PDF buffer, handles status codes and
//      content-type validation. Lives in `pdf-service-client-code.ts`.
//      The service owns the retry budget (3 attempts); this client does
//      not retry.
//
//   3. Public surface — `generateInvoicePdf(invoiceData)` composes (1)+(2),
//      plus `module.exports` exposing the legacy shims email templates
//      and admin UIs may still require. That lives in this file.
//
// The emitted module keeps the exact same name, path, and export shape
// as before, so `api-routes-code.ts` and any downstream consumer do not
// need to change.

export const generatePdfGeneratorCode = (
  settings: UIDLInvoiceSettings,
  invoiceTemplateUidl: unknown,
  allComponents: Record<string, unknown> | null | undefined
): string => {
  const htmlBuilder = generateInvoiceHtmlCode(settings, invoiceTemplateUidl, allComponents)
  const serviceClient = generatePdfServiceClientCode()

  return `/**
 * Invoice PDF Generator
 * Walks the user-authored \`invoice-template\` UIDL component → HTML,
 * then delegates rendering to a shared external PDF microservice over
 * HTTP (configured via \`PDF_SERVICE_URL\` + \`PDF_SERVICE_API_KEY\`).
 * Used to launch Puppeteer locally; that renderer was moved out of
 * every deployed project to trim the serverless bundle by ~48 MB.
 */

${htmlBuilder}
${serviceClient}

// ---------------------------------------------------------------------------
// Public API — the one the \`/api/invoices/generate\` route calls.
// Signature matches the previous Puppeteer-backed implementation so the
// route code is identical to before the service migration.
// ---------------------------------------------------------------------------

async function generateInvoicePdf(invoiceData) {
  console.info('[invoice-pdf] Building HTML from invoice-template UIDL — itemCount=' +
    (Array.isArray(invoiceData.items) ? invoiceData.items.length : 0));
  var html = buildInvoiceHtml(invoiceData);
  console.info('[invoice-pdf] Rendering via external PDF service — ' + html.length + ' bytes of HTML');
  return callPdfService(html, invoiceData);
}

module.exports = {
  generateInvoicePdf,
  resolveDynamicProperty,
  formatValue,
  resolveTextSpans,
  replacePlaceholders,
  evaluateCondition,
  buildDataContext,
  buildInvoiceHtml,
  buildInvoiceDataScope,
  COMPANY_DETAILS,
};
`
}
