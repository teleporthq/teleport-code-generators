import { generateCommonJsSessionTokenResolverCode } from './session-cookie-resolver'
import { ROLE_OF_TOKEN_CODE } from './workflow-auth-generator'
import { securityRuntimeSpecifier } from './security-runtime'

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

/**
 * How much one visitor (by address, IPv6 by its /64) and the whole site may
 * upload, through the shared security runtime:
 * - VISITOR_UPLOAD_LIMITS: requests, `[limit, windowSeconds]`, checked before
 *   the body is read;
 * - VISITOR_UPLOAD_MB_PER_DAY: bytes, counted per file in whole MB (a file
 *   counts at least 1), after the form passed its checks;
 * - SITE_VISITOR_FILES_PER_DAY: files from all visitors together, counted only
 *   for forms that passed, so junk requests cannot pause everyone's uploads.
 * The storage worker also holds all guests together to their share of the
 * project's quota. Without these a guest could fill the merchant's quota with
 * allowed files until the admin's own uploads fail.
 */
export const VISITOR_UPLOAD_LIMITS: ReadonlyArray<[number, number]> = [
  [20, 3600],
  [60, 86400],
]
export const VISITOR_UPLOAD_MB_PER_DAY = 25
export const SITE_VISITOR_FILES_PER_DAY = 500

/** The true values of the `private` flag, read the way the storage worker reads them. */
export const PRIVATE_FLAG_VALUES: ReadonlyArray<string> = ['true', '1', 'yes']

/** The extensions a proven type keeps; any other is replaced by the first. */
export const PROVEN_TYPE_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'application/pdf': ['.pdf'],
}

/**
 * Tells the storage worker which policy a forwarded upload gets. Only this
 * route sends it (the request carries the project key): `visitor` uploads
 * meet the worker's own allow-list as well as this route's, `trusted` ones
 * (the store's server code, an admin) upload any type as before. A site
 * exported before this header existed sends none, and the worker refuses
 * active content (HTML, SVG, XML, scripts) from it.
 */
export const UPLOAD_ACCESS_HEADER = 'x-teleport-upload-access'

export const generateRuntimeStorageUploadRoute = (
  options: { withSessionRevocation?: boolean } = {}
): string => {
  return `var RUNTIME_STORAGE_URL = process.env.RUNTIME_STORAGE_URL;
var RUNTIME_STORAGE_API_KEY = process.env.RUNTIME_STORAGE_API_KEY;
var RUNTIME_STORAGE_PROJECT_ID = process.env.RUNTIME_STORAGE_PROJECT_ID;

// See UPLOAD_PROXY_TIMEOUT_MS in the generator: an upstream that never answers
// must become a 504, never a request the browser waits on forever.
var UPLOAD_TIMEOUT_MS = ${UPLOAD_PROXY_TIMEOUT_MS};

${generateCommonJsSessionTokenResolverCode('../../..', {
  withRevocation: options.withSessionRevocation !== false,
})}
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

var __security = require('${securityRuntimeSpecifier('../../..')}');
var VISITOR_UPLOAD_LIMITS = ${JSON.stringify(VISITOR_UPLOAD_LIMITS)};
var VISITOR_UPLOAD_MB_PER_DAY = ${VISITOR_UPLOAD_MB_PER_DAY};
var SITE_VISITOR_FILES_PER_DAY = ${SITE_VISITOR_FILES_PER_DAY};
var PRIVATE_FLAG_VALUES = ${JSON.stringify(PRIVATE_FLAG_VALUES)};
var PROVEN_TYPE_EXTENSIONS = ${JSON.stringify(PROVEN_TYPE_EXTENSIONS)};
var UPLOAD_ACCESS_HEADER = '${UPLOAD_ACCESS_HEADER}';

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

// RFC 7230 token characters: what busboy accepts as a disposition type or a
// parameter name.
var TOKEN_CHAR = /[!#$%&'*+.^_\\x60|~0-9A-Za-z-]/;

// A Content-Disposition value read the way busboy (the storage worker's
// parser) reads it: the type, then ';'-separated parameters whose value is a
// token, a quoted string (backslash escapes) or, for a name ending in '*', an
// RFC 5987 extended value (charset'language'percent-encoded). null when it is
// malformed. Deciding "is this a file" on any other reading lets a part the
// worker stores as a file pass this route as a plain field.
function parseDisposition(value) {
  var i = 0;
  while (i < value.length && TOKEN_CHAR.test(value[i])) i++;
  var type = value.slice(0, i).toLowerCase();
  if (!type) return null;
  var params = {};
  while (i < value.length) {
    while (value[i] === ' ' || value[i] === '\\t') i++;
    if (i >= value.length) break;
    if (value[i] !== ';') return null;
    i++;
    while (value[i] === ' ' || value[i] === '\\t') i++;
    var nameStart = i;
    while (i < value.length && TOKEN_CHAR.test(value[i])) i++;
    if (i === nameStart || value[i] !== '=') return null;
    var name = value.slice(nameStart, i).toLowerCase();
    i++;
    var paramValue = '';
    if (name.charAt(name.length - 1) === '*') {
      var ext = /^([^']*)'[^']*'([^;\\s]*)/.exec(value.slice(i));
      if (!ext) return null;
      i += ext[0].length;
      try {
        paramValue = /^utf-?8$/i.test(ext[1])
          ? decodeURIComponent(ext[2])
          : unescape(ext[2]);
      } catch (e) {
        return null;
      }
    } else if (value[i] === '"') {
      i++;
      var closed = false;
      while (i < value.length) {
        var ch = value[i];
        if (ch === '\\\\' && i + 1 < value.length) {
          paramValue += value[i + 1];
          i += 2;
          continue;
        }
        if (ch === '"') {
          closed = true;
          i++;
          break;
        }
        paramValue += ch;
        i++;
      }
      if (!closed) return null;
    } else {
      var valueStart = i;
      while (i < value.length && TOKEN_CHAR.test(value[i])) i++;
      if (i === valueStart) return null;
      paramValue = value.slice(valueStart, i);
    }
    if (!Object.prototype.hasOwnProperty.call(params, name)) params[name] = paramValue;
  }
  return { type: type, params: params };
}

// One part's name, filename and declared type. A file is what the storage
// worker stores as one: a part whose 'filename*' or 'filename' is not empty
// ('filename*' first), quoted, unquoted or extended alike. The ambiguous flag marks a
// part two parsers could read differently (a second disposition, a folded
// header line, a disposition that is not well-formed form-data); a visitor's
// form with one is refused.
function readPart(headerText, data) {
  var part = { name: '', filename: null, type: '', data: data, ambiguous: false };
  var sawDisposition = false;
  var lines = headerText.split(String.fromCharCode(13, 10));
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].charAt(0) === ' ' || lines[i].charAt(0) === '\\t') {
      part.ambiguous = true;
      continue;
    }
    var colon = lines[i].indexOf(':');
    if (colon <= 0) continue;
    var key = lines[i].slice(0, colon).trim().toLowerCase();
    var value = lines[i].slice(colon + 1).trim();
    if (key === 'content-disposition') {
      if (sawDisposition) {
        part.ambiguous = true;
        continue;
      }
      sawDisposition = true;
      var disposition = parseDisposition(value);
      if (!disposition || disposition.type !== 'form-data') {
        part.ambiguous = true;
        continue;
      }
      part.name = disposition.params.name || '';
      var filename = disposition.params['filename*'] || disposition.params.filename || '';
      part.filename = filename ? filename : null;
    } else if (key === 'content-type') {
      part.type = value.split(';')[0].trim().toLowerCase();
    }
  }
  if (!sawDisposition) part.ambiguous = true;
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
    if (part.ambiguous) {
      return { status: 400, code: 'UPLOAD_INVALID', message: 'The upload is not a file form.' };
    }
    if (part.filename === null) {
      // Every value the storage worker takes as private (true, 1, yes; any case).
      if (part.name === 'private' && PRIVATE_FLAG_VALUES.indexOf(part.data.toString('utf8').trim().toLowerCase()) !== -1) {
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

// The file's base name with the extension its proven type has: x.html holding
// PNG bytes is stored as x.png, never under a name that says it is a page.
function provenFileName(filename, type) {
  var base = String(filename).split(/[\\\\/]/).pop() || 'file';
  var allowed = PROVEN_TYPE_EXTENSIONS[type] || [];
  var dot = base.lastIndexOf('.');
  var ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
  if (allowed.indexOf(ext) !== -1) return base;
  var stem = dot > 0 ? base.slice(0, dot) : base;
  var stemDot = stem.lastIndexOf('.');
  if (stemDot > 0 && allowed.indexOf(stem.slice(stemDot).toLowerCase()) !== -1) return stem;
  return (stem || 'file') + (allowed[0] || '');
}

// Header-safe: no quote, backslash or control character survives.
function headerSafe(text) {
  return String(text).replace(/["\\\\\\u0000-\\u001f\\u007f]/g, '_');
}

// The checked form, written afresh: one quoted disposition per part, each
// file with the type its bytes proved and its base name, under a boundary of
// our own. The storage worker parses this and nothing else, so what it stores
// is exactly what visitorUploadRefusal passed — not a second reading of the
// visitor's bytes. null when the boundary cannot be made unique.
function serializeVisitorForm(parts) {
  for (var attempt = 0; attempt < 3; attempt++) {
    var boundary = '----tqupload' + require('crypto').randomBytes(16).toString('hex');
    var marker = Buffer.from('--' + boundary);
    var clash = false;
    var chunks = [];
    for (var i = 0; i < parts.length && !clash; i++) {
      var part = parts[i];
      if (part.data.indexOf(marker) !== -1) {
        clash = true;
        break;
      }
      var head = '--' + boundary + '\\r\\nContent-Disposition: form-data; name="' + headerSafe(part.name) + '"';
      if (part.filename !== null) {
        var type = sniffMimeType(part.data);
        head += '; filename="' + headerSafe(provenFileName(part.filename, type)) + '"\\r\\nContent-Type: ' + type;
      }
      chunks.push(Buffer.from(head + '\\r\\n\\r\\n', 'utf8'), part.data, CRLF);
    }
    if (clash) continue;
    chunks.push(Buffer.from('--' + boundary + '--\\r\\n'));
    return { boundary: boundary, body: Buffer.concat(chunks) };
  }
  return null;
}

// A visitor's request allowance, before the body is read.
// false = the 429 is already sent.
async function visitorMayUpload(req, res) {
  for (var i = 0; i < VISITOR_UPLOAD_LIMITS.length; i++) {
    var ok = await __security.rateLimitRequest(req, res, {
      scope: 'runtime-storage-upload',
      limit: VISITOR_UPLOAD_LIMITS[i][0],
      windowSeconds: VISITOR_UPLOAD_LIMITS[i][1],
    });
    if (!ok) return false;
  }
  return true;
}

// A checked form's cost, per file: its size in whole MB out of the visitor's
// daily byte budget, then one file out of the site's daily visitor files.
// false = the 429 is already sent.
async function visitorMayStore(req, res, parts) {
  var files = 0;
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].filename === null) continue;
    files += 1;
    var units = Math.max(1, Math.ceil(parts[i].data.length / 1048576));
    for (var u = 0; u < units; u++) {
      var ok = await __security.rateLimitRequest(req, res, {
        scope: 'runtime-storage-upload-mb',
        limit: VISITOR_UPLOAD_MB_PER_DAY,
        windowSeconds: 86400,
      });
      if (!ok) return false;
    }
  }
  for (var f = 0; f < files; f++) {
    var site = await __security.rateLimit({
      key: 'site:visitor-uploads',
      limit: SITE_VISITOR_FILES_PER_DAY,
      windowSeconds: 86400,
    });
    if (!site.allowed) {
      res.setHeader('Retry-After', String(site.retryAfter));
      refuse(res, 429, 'UPLOAD_LIMIT_REACHED', 'Uploads are paused for now. Please try again later.');
      return false;
    }
  }
  return true;
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
  var contentType = req.headers['content-type'];

  if (!trusted) {
    if (!(await visitorMayUpload(req, res))) return;
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
    if (!(await visitorMayStore(req, res, parts))) return;
    var checked = serializeVisitorForm(parts);
    if (!checked) {
      refuse(res, 400, 'UPLOAD_INVALID', 'The upload could not be read.');
      return;
    }
    body = checked.body;
    contentType = 'multipart/form-data; boundary=' + checked.boundary;
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
    // Which of the storage worker's policies this upload gets (only this
    // server can send it: the request carries the project key).
    headers[UPLOAD_ACCESS_HEADER] = trusted ? 'trusted' : 'visitor';

    if (contentType) {
      headers['content-type'] = contentType;
    }
    if (contentLength) {
      headers['content-length'] = contentLength;
    }

    var storageRes = await fetch(targetUrl, {
      method: 'POST',
      headers: headers,
      // A trusted caller's form is streamed through untouched; a visitor's was
      // read in full, checked, and is forwarded as the form it was checked as.
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
