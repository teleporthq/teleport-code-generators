// Emits the external-PDF-service HTTP client section of
// `utils/invoices/pdf-generator.js`. The generated Next.js project used
// to launch Chromium via `puppeteer-core` + `@sparticuz/chromium` on
// every Stripe-webhook invoice — ~48 MB of serverless bundle per project,
// with the memory footprint that implies. This emitter replaces that
// with a single outbound HTTP call to a shared, self-hosted microservice
// (spec: PDF_SERVICE_SPEC.md at the workspace root) so the generated
// bundle ships zero browser code.
//
// The emitted `callPdfService(html, invoiceData)` keeps the same contract
// the old `renderHtmlToPdf` did: HTML in → Node Buffer out → thrown Error
// on failure. `generateInvoicePdf` upstream is unchanged from the
// caller's perspective.

export const generatePdfServiceClientCode = (): string => {
  return `// ---------------------------------------------------------------------------
// External PDF service client
// ---------------------------------------------------------------------------
//
// Posts the already-built HTML to a self-hosted microservice that runs
// Puppeteer on our behalf. The service owns the Chromium process, the
// queue, and the retry budget (up to 3 attempts); this client does NOT
// retry on top. A caller-side retry would break invoice number
// sequencing — the API route reserves \`INV-N\` via
// \`getNextInvoiceNumber\` *before* invoking the renderer, so every
// retry would burn a new number.
//
// Contract:
//   - Config via \`process.env.PDF_SERVICE_URL\` and
//     \`process.env.PDF_SERVICE_API_KEY\` (read at call time, not module
//     load, so dev misconfiguration fails loud at render rather than
//     at \`require()\`).
//   - Auth header: \`X-Pdf-Service-Key: <key>\` (shared static key).
//   - 60 s client-side abort. The service's default per-attempt timeout
//     is 45 s; operators who tune the service down to ~15 s/attempt can
//     fit 3 full retries inside this window.
//   - Response must be \`application/pdf\` — an HTML error page that
//     slipped past status code checks would otherwise be stored in the
//     DB as a "PDF" and silently rot.

function buildPdfServiceEndpoint(baseUrl) {
  return String(baseUrl).replace(/\\/+$/, '') + '/generate';
}

function sanitizePdfFilename(raw) {
  var name = String(raw || 'invoice').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (name.slice(-4).toLowerCase() !== '.pdf') name += '.pdf';
  return name;
}

async function callPdfService(html, invoiceData) {
  var pdfServiceUrl = process.env.PDF_SERVICE_URL;
  var pdfServiceKey = process.env.PDF_SERVICE_API_KEY;

  if (!pdfServiceUrl) {
    throw new Error('PDF_SERVICE_URL is not configured. Set it in the project env vars (the Vercel controller injects it at deploy time from the services-worker env).');
  }
  if (!pdfServiceKey) {
    throw new Error('PDF_SERVICE_API_KEY is not configured. Set it in the project env vars (the Vercel controller injects it at deploy time from the services-worker env).');
  }

  var endpoint = buildPdfServiceEndpoint(pdfServiceUrl);
  var filename = sanitizePdfFilename(invoiceData && invoiceData.invoiceNumber);

  var requestBody = {
    html: html,
    filename: filename,
    format: 'A4',
    printBackground: true,
    margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    preferCSSPageSize: true,
    metadata: {
      invoiceId: (invoiceData && invoiceData.id) || '',
      invoiceNumber: (invoiceData && invoiceData.invoiceNumber) || '',
      orderId: (invoiceData && invoiceData.orderId) || '',
    },
  };

  var timeoutMs = Number(process.env.PDF_SERVICE_TIMEOUT_MS) || 60000;
  var abortCtrl = new AbortController();
  var timer = setTimeout(function () { abortCtrl.abort(); }, timeoutMs);

  var response;
  try {
    console.info('[invoice-pdf] POST ' + endpoint + ' htmlBytes=' + (html ? html.length : 0) + ' filename=' + filename + ' timeoutMs=' + timeoutMs);
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pdf-Service-Key': pdfServiceKey,
      },
      body: JSON.stringify(requestBody),
      signal: abortCtrl.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timer);
    if (fetchErr && fetchErr.name === 'AbortError') {
      throw new Error('PDF service request aborted after ' + timeoutMs + 'ms (' + endpoint + ')');
    }
    throw new Error('PDF service request failed: ' + ((fetchErr && fetchErr.message) || fetchErr));
  }
  clearTimeout(timer);

  if (!response.ok) {
    var errSnippet = '';
    try {
      var raw = await response.text();
      errSnippet = typeof raw === 'string' ? raw.slice(0, 500) : '';
    } catch (_readErr) { errSnippet = ''; }
    var attemptsHeader = response.headers.get('x-attempts');
    console.error('[invoice-pdf] PDF service returned ' + response.status + ' — attempts=' + (attemptsHeader || '?') + ' body=' + errSnippet);
    throw new Error('PDF service returned ' + response.status + ' (attempts=' + (attemptsHeader || '?') + '): ' + errSnippet);
  }

  var contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().indexOf('application/pdf') === -1) {
    // Response was 2xx but not a PDF — usually a proxy that swallowed
    // the upstream error. Refuse so we don't persist an HTML blob in
    // the \`pdf_data\` column.
    var unexpected = '';
    try {
      var rawBody = await response.text();
      unexpected = typeof rawBody === 'string' ? rawBody.slice(0, 500) : '';
    } catch (_e2) { unexpected = ''; }
    throw new Error('PDF service returned unexpected content-type "' + contentType + '": ' + unexpected);
  }

  var arrayBuffer = await response.arrayBuffer();
  var pdfBuffer = Buffer.from(arrayBuffer);
  var attempts = response.headers.get('x-attempts') || '1';
  var renderMs = response.headers.get('x-render-ms') || '?';
  console.info('[invoice-pdf] PDF service OK — pdfBytes=' + pdfBuffer.length + ' attempts=' + attempts + ' renderMs=' + renderMs);
  return pdfBuffer;
}
`
}
