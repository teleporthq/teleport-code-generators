import { generateCommonJsSessionTokenResolverCode } from './session-cookie-resolver'
import { ROLE_OF_TOKEN_CODE } from './workflow-auth-generator'

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

/**
 * Who may upload what through `/api/runtime-storage/upload`.
 *
 * The route stores files in the merchant's runtime storage, on the merchant's
 * quota, at a public URL. It used to forward whatever arrived — any type, any
 * size, any `private` flag — and the storage worker checked the file against
 * `allowedMimeTypes` / `maxFileSize` fields the same request supplied, so the
 * caller set its own limits.
 *
 * - The store's own server code (the invoice PDF upload presents the app
 *   secret) and a signed-in admin (the admin panel's image, asset and
 *   digital-product uploaders) upload as before: any type, private included.
 * - Everyone else — a shopper's review photos, profile photo, a product
 *   option's print file, the upload widget on a public page — gets the limits
 *   of THIS route: the image and PDF types those uploaders accept, each file
 *   proven by its first bytes (never SVG: it runs script where it is served),
 *   at most VISITOR_MAX_FILE_BYTES per file and VISITOR_MAX_FILES per request,
 *   and never a private file. The fields the request sends can only narrow that.
 *
 * A signed-out visitor is NOT refused: a product option's file is chosen before
 * the shopper decides whether to sign in (its custom node is declared
 * guest-scoped), and the upload widget may sit on a public page. Refusing
 * guests here would break both; the per-file proof and caps are what bound them.
 */
export const TRUSTED_UPLOAD_ROLES: ReadonlyArray<string> = ['admin']
export const VISITOR_UPLOAD_MIME_TYPES: ReadonlyArray<string> = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]
export const VISITOR_MAX_FILE_BYTES = 5 * 1024 * 1024
export const VISITOR_MAX_FILES = 10

export const generateRuntimeStorageUploadRoute = (): string => {
  return `var RUNTIME_STORAGE_URL = process.env.RUNTIME_STORAGE_URL;
var RUNTIME_STORAGE_API_KEY = process.env.RUNTIME_STORAGE_API_KEY;
var RUNTIME_STORAGE_PROJECT_ID = process.env.RUNTIME_STORAGE_PROJECT_ID;

// See UPLOAD_PROXY_TIMEOUT_MS in the generator: an upstream that never answers
// must become a 504, never a request the browser waits on forever.
var UPLOAD_TIMEOUT_MS = ${UPLOAD_PROXY_TIMEOUT_MS};

${generateCommonJsSessionTokenResolverCode()}
${ROLE_OF_TOKEN_CODE}

// What a visitor may upload — see TRUSTED_UPLOAD_ROLES in the generator.
var TRUSTED_UPLOAD_ROLES = ${JSON.stringify(TRUSTED_UPLOAD_ROLES)};
var VISITOR_UPLOAD_MIME_TYPES = ${JSON.stringify(VISITOR_UPLOAD_MIME_TYPES)};
var VISITOR_MAX_FILE_BYTES = ${VISITOR_MAX_FILE_BYTES};
var VISITOR_MAX_FILES = ${VISITOR_MAX_FILES};
// The files plus room for the form's own fields and part headers.
var VISITOR_MAX_REQUEST_BYTES = VISITOR_MAX_FILES * VISITOR_MAX_FILE_BYTES + 256 * 1024;

var CRLF = Buffer.from([13, 10]);
var BLANK_LINE = Buffer.from([13, 10, 13, 10]);

// Only server code can read NEXTAUTH_SECRET, so a browser cannot present it.
function presentsAppSecret(req) {
  var given = req && req.headers ? req.headers['x-internal-data-secret'] : '';
  var expected = process.env.NEXTAUTH_SECRET;
  if (typeof given !== 'string' || !given || !expected) return false;
  var a = Buffer.from(given);
  var b = Buffer.from(String(expected));
  return a.length === b.length && require('crypto').timingSafeEqual(a, b);
}

async function isTrustedUploader(req) {
  if (presentsAppSecret(req)) return true;
  var token = null;
  try {
    token = await __tqSessionToken(req);
  } catch (e) {
    token = null;
  }
  var role = roleOf(token);
  return !!role && TRUSTED_UPLOAD_ROLES.indexOf(role) !== -1;
}

function refuse(res, status, code, message) {
  res.status(status).json({ error: code, message: message });
}

// The whole request body, or an error with code UPLOAD_TOO_LARGE past limit.
function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    var settled = false;
    req.on('data', function (chunk) {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        var err = new Error('Upload too large');
        err.code = 'UPLOAD_TOO_LARGE';
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', function (err) {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function multipartBoundary(contentType) {
  var match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(contentType || ''));
  return match ? (match[1] || match[2] || '').trim() : '';
}

function readPart(headerText, data) {
  var part = { name: '', filename: null, type: '', data: data };
  var lines = headerText.split(String.fromCharCode(13, 10));
  for (var i = 0; i < lines.length; i++) {
    var colon = lines[i].indexOf(':');
    if (colon <= 0) continue;
    var key = lines[i].slice(0, colon).trim().toLowerCase();
    var value = lines[i].slice(colon + 1).trim();
    if (key === 'content-disposition') {
      var name = /[; ]name="([^"]*)"/i.exec(value);
      var filename = /filename="([^"]*)"/i.exec(value);
      part.name = name ? name[1] : '';
      part.filename = filename ? filename[1] : null;
    } else if (key === 'content-type') {
      part.type = value.split(';')[0].trim().toLowerCase();
    }
  }
  return part;
}

// The form's parts, or null when the body is not well-formed multipart.
function parseMultipart(body, boundary) {
  var delimiter = Buffer.from('--' + boundary);
  var separator = Buffer.concat([CRLF, delimiter]);
  var start = body.indexOf(delimiter);
  if (start === -1) return null;
  var parts = [];
  var cursor = start + delimiter.length;
  while (cursor + 1 < body.length) {
    // '--' closes the form; CRLF opens the next part.
    if (body[cursor] === 45 && body[cursor + 1] === 45) return parts;
    if (body[cursor] !== 13 || body[cursor + 1] !== 10) return null;
    var headerEnd = body.indexOf(BLANK_LINE, cursor + 2);
    if (headerEnd === -1) return null;
    var next = body.indexOf(separator, headerEnd + 4);
    if (next === -1) return null;
    parts.push(readPart(body.slice(cursor + 2, headerEnd).toString('utf8'), body.slice(headerEnd + 4, next)));
    cursor = next + separator.length;
  }
  return null;
}

// What a file IS, by its first bytes — never what the request says it is.
function sniffMimeType(data) {
  var head = data.slice(0, 12).toString('latin1');
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (head.slice(0, 8) === String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png';
  if (head.slice(0, 6) === 'GIF87a' || head.slice(0, 6) === 'GIF89a') return 'image/gif';
  if (head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP') return 'image/webp';
  if (head.slice(0, 5) === '%PDF-') return 'application/pdf';
  return '';
}

var DECLARED_TYPE_ALIASES = { 'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg' };

// null when a visitor may upload this form, else the refusal.
function visitorUploadRefusal(parts) {
  var files = 0;
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (part.filename === null) {
      if (part.name === 'private' && String(part.data.toString('utf8')).trim() === 'true') {
        return { status: 403, code: 'UPLOAD_PRIVATE_FORBIDDEN', message: 'Only the store can upload private files.' };
      }
      continue;
    }
    files += 1;
    if (files > VISITOR_MAX_FILES) {
      return { status: 413, code: 'TOO_MANY_FILES', message: 'At most ' + VISITOR_MAX_FILES + ' files can be uploaded at once.' };
    }
    if (part.data.length > VISITOR_MAX_FILE_BYTES) {
      return { status: 413, code: 'FILE_TOO_LARGE', message: 'Each file can be at most ' + Math.floor(VISITOR_MAX_FILE_BYTES / 1048576) + ' MB.' };
    }
    var actual = sniffMimeType(part.data);
    var declared = DECLARED_TYPE_ALIASES[part.type] || part.type;
    var declaredMatches = !declared || declared === 'application/octet-stream' || declared === actual;
    if (!actual || VISITOR_UPLOAD_MIME_TYPES.indexOf(actual) === -1 || !declaredMatches) {
      return { status: 415, code: 'FILE_TYPE_NOT_ALLOWED', message: 'Only JPG, PNG, WEBP, GIF and PDF files can be uploaded.' };
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!RUNTIME_STORAGE_URL || !RUNTIME_STORAGE_API_KEY || !RUNTIME_STORAGE_PROJECT_ID) {
    res.status(500).json({ error: 'Runtime storage is not configured' });
    return;
  }

  var trusted = await isTrustedUploader(req);
  var body = req;
  var contentLength = req.headers['content-length'];

  if (!trusted) {
    var declaredLength = parseInt(contentLength, 10);
    if (!isNaN(declaredLength) && declaredLength > VISITOR_MAX_REQUEST_BYTES) {
      refuse(res, 413, 'UPLOAD_TOO_LARGE', 'The upload is too large.');
      return;
    }
    var boundary = multipartBoundary(req.headers['content-type']);
    if (!boundary) {
      refuse(res, 400, 'UPLOAD_INVALID', 'The upload is not a file form.');
      return;
    }
    try {
      body = await readBody(req, VISITOR_MAX_REQUEST_BYTES);
    } catch (readErr) {
      if (readErr && readErr.code === 'UPLOAD_TOO_LARGE') {
        refuse(res, 413, 'UPLOAD_TOO_LARGE', 'The upload is too large.');
      } else {
        refuse(res, 400, 'UPLOAD_INVALID', 'The upload could not be read.');
      }
      return;
    }
    var parts = parseMultipart(body, boundary);
    if (!parts) {
      refuse(res, 400, 'UPLOAD_INVALID', 'The upload is not a file form.');
      return;
    }
    var refusal = visitorUploadRefusal(parts);
    if (refusal) {
      refuse(res, refusal.status, refusal.code, refusal.message);
      return;
    }
    contentLength = String(body.length);
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
    if (contentLength) {
      headers['content-length'] = contentLength;
    }

    var storageRes = await fetch(targetUrl, {
      method: 'POST',
      headers: headers,
      // A trusted caller's form is streamed through untouched; a visitor's was
      // read in full to be checked, and is forwarded byte for byte.
      body: body,
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
      message: 'The upload could not be completed. Please try again.',
    });
  } finally {
    clearTimeout(timer);
  }
};

module.exports.config = { api: { bodyParser: false } };
`
}
