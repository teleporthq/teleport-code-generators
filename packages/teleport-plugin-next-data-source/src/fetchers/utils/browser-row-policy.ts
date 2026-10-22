import { ContentTables, TableAccess } from '@teleporthq/teleport-shared'

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
 * column, and may neither filter nor sort by a hidden column: a filter is an
 * oracle for a column it never returns. A hidden SEARCH column is dropped from
 * the search instead (`__brpVisibleColumns`), because the storefront's own list
 * bindings name every text column of the table — the blog list asks to search
 * `author_email` — and refusing them emptied the blog for every visitor.
 */

export type BrowserRowPolicy = ContentTables.VisitorRowPolicy

/**
 * One map for both route families: the content presets' posts tables (ONLY
 * `published` rows, never the author's email — see
 * `CONTENT_POSTS_VISITOR_ROW_POLICY`) and the catalogue's products.
 */
export const BROWSER_ROW_POLICIES: Readonly<Record<string, BrowserRowPolicy>> =
  ContentTables.VISITOR_ROW_POLICIES

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

// What a page's own data carries of a member, read for a visitor: the public
// profile (TableAccess.PUBLIC_PROFILE_COLUMNS) — an allow-list, so a column the
// account row gains later stays out too. A browser reads the table not at all.
var __BRP_PUBLIC_PROFILE = ${JSON.stringify({
    predicate: 'TRUE',
    hiddenColumns: [],
    visibleColumns: TableAccess.PUBLIC_PROFILE_COLUMNS,
  })};

// Who is asking: the store's own server code and its administrators read every
// row; anyone else is a visitor — a page's own data included (\`__taIsVisitorView\`).
async function __brpReader(req) {
  if (__taIsVisitorView(req)) return { trusted: false };
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

// A visitor's browser may not send a statement that names a narrowed table: it
// is refused whole. A page's own statement, read for a visitor, is run over the
// rows a visitor is served instead (\`narrowRaw\`, see \`__brpNarrowRawQuery\`).
// The session is only decoded when the read touches one of these tables.
async function __brpAccess(req, tableName, rawQuery) {
  var raw = typeof rawQuery === 'string' && rawQuery.length > 0 ? rawQuery : null;
  if (!raw && __taIsVisitorView(req) && __taIsCredentialTable(tableName)) {
    return { denied: null, policy: __BRP_PUBLIC_PROFILE };
  }
  var bare = __taNormalizeTable(tableName);
  var rawNarrowed = !!raw && __brpMentionsAny(raw, Object.keys(__BRP_POLICIES));
  var policy = raw ? null : (Object.prototype.hasOwnProperty.call(__BRP_POLICIES, bare) ? __BRP_POLICIES[bare] : null);
  if (!rawNarrowed && !policy) return { denied: null, policy: null };
  var reader = await __brpReader(req);
  if (reader.trusted) return { denied: null, policy: null };
  if (rawNarrowed) {
    if (__taIsVisitorView(req)) return { denied: null, policy: null, narrowRaw: true };
    return { denied: { status: 403, message: 'Forbidden: raw queries over this table are only available to server-side calls' }, policy: null };
  }
  return { denied: null, policy: policy };
}

function __brpRefuseRaw(what) {
  var err = new Error('Forbidden: ' + what + ' cannot be read for a visitor');
  err.status = 403;
  return err;
}

// A page's own statement over the rows a visitor is served: every narrowed
// table it reads becomes a WITH entry of the same name, ahead of the
// statement, which its own references — and its own WITH entries — resolve to:
//
//   WITH "teleport_products" AS (SELECT * FROM "teleport_products" AS __brp_rows WHERE (<predicate>)) <statement>
//
// Inside its own definition the entry names the table itself (a WITH that is
// not RECURSIVE does not see itself). A hidden column reads NULL however the
// statement spells it — an alias, a whole-row value. A statement this cannot
// vouch for is refused: unreadable or opaque, RECURSIVE (its entries would see
// themselves), or naming a narrowed table through a schema, which reaches the
// table past the entry.
function __brpNarrowRawQuery(sql) {
  var cleaned = __taCleanSql(sql);
  if (!cleaned.ok || __TA_OPAQUE_SQL_RE.test(cleaned.text)) throw __brpRefuseRaw('this statement');
  var tables = Object.keys(__BRP_POLICIES).filter(function(table) {
    return new RegExp('(?:^|[^A-Za-z0-9_])"?' + table + '"?(?![A-Za-z0-9_])', 'i').test(cleaned.text);
  });
  if (tables.length === 0) return sql;
  var leading = /^\\s*with\\b(\\s+recursive\\b)?/i.exec(cleaned.text);
  if (leading && leading[1]) throw __brpRefuseRaw('a recursive statement');
  tables.forEach(function(table) {
    if (new RegExp('\\\\.\\\\s*"?' + table + '"?(?![A-Za-z0-9_])', 'i').test(cleaned.text)) throw __brpRefuseRaw(table);
  });
  var entries = tables.map(function(table) {
    var policy = __BRP_POLICIES[table];
    var hidden = {};
    policy.hiddenColumns.forEach(function(column) { hidden[column] = null; });
    var columns = policy.hiddenColumns.length > 0
      ? '(jsonb_populate_record(__brp_rows, ' + "'" + JSON.stringify(hidden) + "'" + '::jsonb)).*'
      : '*';
    return '"' + table + '" AS (SELECT ' + columns + ' FROM "' + table + '" AS __brp_rows WHERE (' + policy.predicate + '))';
  });
  var statement = String(sql).trim().replace(/;\\s*$/, '');
  if (!leading) return 'WITH ' + entries.join(', ') + ' ' + statement;
  // The statement's own WITH list follows ours, so its entries read ours too.
  var own = /^with\\b/i.exec(statement);
  if (!own) throw __brpRefuseRaw('this statement');
  return 'WITH ' + entries.join(', ') + ', ' + statement.slice(own[0].length);
}

// The rows of a statement narrowed for a visitor, without the hidden columns
// of the tables it read.
function __brpStripHiddenOfRaw(sql, rows) {
  var cleaned = __taCleanSql(sql);
  return Object.keys(__BRP_POLICIES).reduce(function(current, table) {
    return cleaned.ok && __taSqlMentionsTable(sql, table) ? __brpStripHidden(__BRP_POLICIES[table], current) : current;
  }, rows);
}

function __brpColumnName(field) {
  var parts = String(field == null ? '' : field).replace(/"/g, '').trim().split('.');
  return parts[parts.length - 1];
}

// A column the policy keeps from the reader: one it hides, or — for a policy
// that names the only columns it serves (\`visibleColumns\`) — any other.
function __brpIsHidden(policy, field) {
  var name = __brpColumnName(field).toLowerCase();
  if (policy.visibleColumns) return policy.visibleColumns.indexOf(name) === -1;
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

// Search columns are not checked here: the read drops the hidden ones from the
// search (\`__brpVisibleColumns\`), and the storefront's own list bindings name them.
function __brpAssertVisibleFields(policy, query) {
  var q = query || {};
  var fields = [];
  __brpRequestFields(__brpParse(q.filters), fields);
  __brpRequestFields(__brpParse(q.sorts), fields);
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
