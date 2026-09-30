/**
 * What a per-table read route (`/api/teleport-<table>-<source>` and its count
 * twin) serves a BROWSER of the tables whose unpublished rows sit beside the
 * public ones. (The tables it serves a browser not at all — the AI assistant's
 * among them — are `TableAccess.PROTECTED_TABLES`, guarded by `__taGuardRead`.)
 *
 * The route answers whoever asks, with the whole table. For the blog that was
 * every draft, scheduled and archived post — and each author's email address;
 * for the catalogue, every draft and inactive product. The storefront's own
 * bindings ask for the public rows, but the route is a URL anyone can call
 * without them. So a caller that is not the store itself (its server code, or a
 * signed-in administrator — the generated admin edits drafts through these
 * routes) is served only the rows the storefront publishes, never a hidden
 * column, and may neither filter, sort nor search by a hidden column: a filter
 * is an oracle for a column it never returns.
 */

export interface BrowserRowPolicy {
  /** SQL every browser read of the table is narrowed with. */
  predicate: string
  /** Keys never served to a browser, wherever they sit in a row (raw and transformed names). */
  hiddenColumns: ReadonlyArray<string>
}

export const BROWSER_ROW_POLICIES: Readonly<Record<string, BrowserRowPolicy>> = {
  // ONLY `published` is public — the blog's own rule (see the GUI's
  // `blog-post-status.ts`): drafts, scheduled and archived posts are not.
  teleport_blog_posts: {
    predicate: "status = 'published'",
    hiddenColumns: ['author_email', 'authorEmail'],
  },
  // The storefront sells `active` products; a draft or inactive one is the
  // merchant's, spelled in any case the admin form stored it in.
  teleport_products: {
    predicate: "LOWER(TRIM(status)) = 'active'",
    hiddenColumns: [],
  },
}

/**
 * ES5 source inlined after the table-access preamble (it uses `__ta*` and
 * `__tqSessionToken`). Declares `__brpAccess(req, tableName, rawQuery)`, which
 * resolves to `{ denied, policy }`: `denied` a `{ status, message }` refusal or
 * null, `policy` the narrowing to apply to this read or null (the caller reads
 * the table whole). Plus the helpers that apply a policy to a request and to
 * its rows.
 */
export const generateBrowserRowPolicyCode =
  (): string => `// GENERATED — see browser-row-policy.ts in teleport-plugin-next-data-source.
var __BRP_POLICIES = ${JSON.stringify(BROWSER_ROW_POLICIES)};

// Who is asking: the store's own server code and its administrators read every
// row; anyone else is a visitor.
async function __brpReader(req) {
  if (__taIsInternalRequest(req)) return { trusted: true };
  var token = null;
  try {
    token = await __tqSessionToken(req);
  } catch (e) {
    token = null;
  }
  var role = token ? __taRoleOf(token) : null;
  return { trusted: !!role && __TA_TRUSTED_READER_ROLES.indexOf(role) !== -1 };
}

function __brpMentionsAny(rawQuery, tables) {
  for (var i = 0; i < tables.length; i++) {
    if (__taSqlMentionsTable(rawQuery, tables[i])) return true;
  }
  return false;
}

// A raw statement cannot be narrowed, so a visitor's statement that names a
// narrowed table is refused whole. The session is only decoded when the read
// touches one of these tables.
async function __brpAccess(req, tableName, rawQuery) {
  var raw = typeof rawQuery === 'string' && rawQuery.length > 0 ? rawQuery : null;
  var bare = __taNormalizeTable(tableName);
  var rawNarrowed = !!raw && __brpMentionsAny(raw, Object.keys(__BRP_POLICIES));
  var policy = raw ? null : (Object.prototype.hasOwnProperty.call(__BRP_POLICIES, bare) ? __BRP_POLICIES[bare] : null);
  if (!rawNarrowed && !policy) return { denied: null, policy: null };
  var reader = await __brpReader(req);
  if (reader.trusted) return { denied: null, policy: null };
  if (rawNarrowed) {
    return { denied: { status: 403, message: 'Forbidden: raw queries over this table are only available to server-side calls' }, policy: null };
  }
  return { denied: null, policy: policy };
}

function __brpColumnName(field) {
  var parts = String(field == null ? '' : field).replace(/"/g, '').trim().split('.');
  return parts[parts.length - 1];
}

function __brpIsHidden(policy, field) {
  var name = __brpColumnName(field).toLowerCase();
  for (var i = 0; i < policy.hiddenColumns.length; i++) {
    if (policy.hiddenColumns[i].toLowerCase() === name) return true;
  }
  return false;
}

// Every field a request filters, sorts or searches by, however deep a filter
// group nests it. A condition's value is data, not a field.
function __brpRequestFields(value, out) {
  if (Array.isArray(value)) {
    for (var i = 0; i < value.length; i++) __brpRequestFields(value[i], out);
  } else if (value && typeof value === 'object') {
    if (typeof value.source === 'string') out.push(value.source);
    if (typeof value.field === 'string') out.push(value.field);
    var keys = Object.keys(value);
    for (var k = 0; k < keys.length; k++) {
      if (keys[k] === 'destination' || keys[k] === 'value') continue;
      if (value[keys[k]] && typeof value[keys[k]] === 'object') __brpRequestFields(value[keys[k]], out);
    }
  } else if (typeof value === 'string' && value) {
    out.push(value);
  }
  return out;
}

function __brpParse(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    return value;
  }
}

function __brpAssertVisibleFields(policy, query) {
  var q = query || {};
  var fields = [];
  __brpRequestFields(__brpParse(q.filters), fields);
  __brpRequestFields(__brpParse(q.sorts), fields);
  __brpRequestFields(__brpParse(q.queryColumns), fields);
  if (typeof q.sortBy === 'string') fields.push(q.sortBy);
  for (var i = 0; i < fields.length; i++) {
    if (__brpIsHidden(policy, fields[i])) {
      var err = new Error('Forbidden: ' + __brpColumnName(fields[i]) + ' is not readable');
      err.status = 403;
      throw err;
    }
  }
}

function __brpVisibleColumns(policy, columns) {
  return columns.filter(function(column) { return !__brpIsHidden(policy, column); });
}

// The rows without a hidden key, at any depth: a transformed row nests related
// rows (a post's related and adjacent posts) built the same way.
function __brpStripHidden(policy, value) {
  if (Array.isArray(value)) {
    return value.map(function(entry) { return __brpStripHidden(policy, entry); });
  }
  if (!value || typeof value !== 'object') return value;
  var copy = {};
  Object.keys(value).forEach(function(key) {
    if (!__brpIsHidden(policy, key)) copy[key] = __brpStripHidden(policy, value[key]);
  });
  return copy;
}

// Whether this request is answered exactly as an anonymous visitor's would be,
// so a response cached for one may serve the other. A read whose answer depends
// on who asks (\`viewDependent\`: a narrowed, protected or admin-only table) or
// that runs a raw statement differs for the store's own server code and its
// administrators, and must never share a cache entry with a visitor.
async function __brpSharesPublicView(req, viewDependent) {
  var raw = !!(req && req.query && typeof req.query.rawQuery === 'string' && req.query.rawQuery.length > 0);
  if (!viewDependent && !raw) return true;
  return !(await __brpReader(req)).trusted;
}
`

/**
 * Whether a per-table read route's answer depends on who asks — the rows it
 * narrows, the tables it guards — so its response cache must be split by view.
 */
export const isViewDependentTable = (
  tableName: string,
  protectedTables: ReadonlyArray<string>
): boolean => {
  const parts = String(tableName || '')
    .trim()
    .toLowerCase()
    .split('.')
  const bare = parts[parts.length - 1].replace(/"/g, '')
  return (
    Object.prototype.hasOwnProperty.call(BROWSER_ROW_POLICIES, bare) ||
    protectedTables.indexOf(bare) !== -1
  )
}

/**
 * The early return right after the table-access guard, plus the policy
 * (`__rowPolicy`, null or a policy) the handler narrows the rest of its read by.
 */
export const generateBrowserRowAccessCall = (
  tableName: string,
  rawQueryExpr: string | null
): string => {
  return `  const __rowAccess = await __brpAccess(req, ${JSON.stringify(tableName)}, ${
    rawQueryExpr || 'null'
  })
  if (__rowAccess.denied) {
    return res.status(__rowAccess.denied.status).json({ success: false, error: __rowAccess.denied.message, timestamp: Date.now() })
  }
  const __rowPolicy = __rowAccess.policy
`
}
