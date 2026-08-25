const FILE_STORAGE_NODE_TYPES = new Set([
  'file-storage-upload',
  'file-storage-list',
  'file-storage-get-details',
  'file-storage-delete',
])

export const needsRuntimeStorageRoute = (usedNodeTypes: Set<string>): boolean => {
  for (const nt of usedNodeTypes) {
    if (FILE_STORAGE_NODE_TYPES.has(nt)) {
      return true
    }
  }
  return false
}

/**
 * How long the upload proxy waits for the runtime-storage worker.
 *
 * This is not a tuning knob, it is a guarantee. Without it the route awaits a
 * `fetch` that has no deadline of its own, so an upstream that accepts the
 * connection and then never answers — a storage worker whose database
 * connections have gone half-open is the case that produced this — leaves the
 * browser request pending FOREVER. The shopper sees a submit button stuck on
 * "Submitting…" with no error, no toast and no way back, and the workflow that
 * called it never reaches its failure branch because its promise never settles.
 *
 * Generous enough for a real upload (five 5MB photos over a slow connection),
 * and deliberately SHORTER than the client's own timeout in
 * `nodes/file-storage/file-storage-upload.ts`, so a stall surfaces as a real
 * `504` the workflow can report rather than as the client giving up on us.
 * Changing one without the other breaks that ordering — a test pins it.
 */
export const UPLOAD_PROXY_TIMEOUT_MS = 120000

export const generateRuntimeStorageUploadRoute = (): string => {
  return `var RUNTIME_STORAGE_URL = process.env.RUNTIME_STORAGE_URL;
var RUNTIME_STORAGE_API_KEY = process.env.RUNTIME_STORAGE_API_KEY;
var RUNTIME_STORAGE_PROJECT_ID = process.env.RUNTIME_STORAGE_PROJECT_ID;

// See UPLOAD_PROXY_TIMEOUT_MS in the generator: an upstream that never answers
// must become a 504, never a request the browser waits on forever.
var UPLOAD_TIMEOUT_MS = ${UPLOAD_PROXY_TIMEOUT_MS};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!RUNTIME_STORAGE_URL || !RUNTIME_STORAGE_API_KEY || !RUNTIME_STORAGE_PROJECT_ID) {
    res.status(500).json({ error: 'Runtime storage is not configured' });
    return;
  }

  var controller = new AbortController();
  var timedOut = false;
  var timer = setTimeout(function () {
    timedOut = true;
    controller.abort();
  }, UPLOAD_TIMEOUT_MS);

  try {
    var targetUrl = RUNTIME_STORAGE_URL + '/project/' + RUNTIME_STORAGE_PROJECT_ID + '/upload';

    var headers = {
      'Authorization': 'Bearer ' + RUNTIME_STORAGE_API_KEY,
    };

    if (req.headers['content-type']) {
      headers['content-type'] = req.headers['content-type'];
    }
    if (req.headers['content-length']) {
      headers['content-length'] = req.headers['content-length'];
    }

    var storageRes = await fetch(targetUrl, {
      method: 'POST',
      headers: headers,
      body: req,
      duplex: 'half',
      signal: controller.signal,
    });

    // Read as text first: an upstream that answers with an HTML error page (a
    // gateway 502, a platform maintenance page) would otherwise throw inside
    // .json() and be reported as a generic proxy failure, hiding the status
    // that actually explains it.
    var raw = await storageRes.text();
    var data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (parseErr) {
      res.status(storageRes.status >= 400 ? storageRes.status : 502).json({
        error: 'UPLOAD_UPSTREAM_INVALID_RESPONSE',
        message:
          'Runtime storage responded with ' + storageRes.status + ' and a non-JSON body',
        status: storageRes.status,
      });
      return;
    }

    res.status(storageRes.status).json(data);
  } catch (err) {
    if (timedOut) {
      console.error('Runtime storage upload timed out after ' + UPLOAD_TIMEOUT_MS + 'ms');
      res.status(504).json({
        error: 'UPLOAD_TIMEOUT',
        message: 'Runtime storage did not respond in time. Please try again.',
      });
      return;
    }
    console.error('Runtime storage upload proxy error:', err);
    res.status(502).json({
      error: 'UPLOAD_PROXY_FAILED',
      message: (err && err.message) || 'Upload proxy failed',
    });
  } finally {
    clearTimeout(timer);
  }
};

module.exports.config = { api: { bodyParser: false } };
`
}
