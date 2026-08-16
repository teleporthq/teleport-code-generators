export const generateSharedRuntimeUtilsCode = (): string => {
  return `/**
 * Workflow Runtime Utilities
 * 
 * This module provides core utilities for executing workflow nodes:
 * - resolveValue: Resolves values from workflow context
 * - resolveConfig: Resolves node configurations
 * - executeNodes: Executes a sequence of workflow nodes
 * - executeWorkflow: Main workflow execution entry point
 */

function resolveValue(value, context) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(function(item) {
      if (item && typeof item === 'object' && item.type === 'workflowContext') {
        return resolveContextRef(item, context);
      }
      if (item && typeof item === 'object' && item.type === 'ctx') {
        return resolveCtxRef(item, context);
      }
      return item;
    }).join('');
  }
  if (typeof value === 'object' && value.type === 'workflowContext') {
    return resolveContextRef(value, context);
  }
  if (typeof value === 'object' && value.type === 'ctx') {
    return resolveCtxRef(value, context);
  }
  return value;
}

function resolveContextRef(ref, context) {
  const nodeOutput = context[ref.nodeId];
  if (nodeOutput === undefined || nodeOutput === null) return undefined;
  let result = nodeOutput;
  const startIdx = (ref.path.length > 0 && ref.path[0] === ref.nodeId) ? 1 : 0;
  for (let i = startIdx; i < ref.path.length; i++) {
    if (result === undefined || result === null) { result = undefined; break; }
    result = result[ref.path[i]];
  }
  // Fallback for form-submit trigger bindings authored without the formData
  // level: the trigger's runtime output nests submitted fields under formData
  // ({ formData: { field: value }, formId, ... }), but the editor/AI has
  // historically emitted paths that read the field directly off the trigger
  // ([triggerId, 'class']). When the direct walk misses AND the node output
  // carries a formData object that holds the first path segment, resolve
  // through it instead of returning undefined — otherwise data-create-item
  // INSERTs NULL for the column and violates not-null constraints. The
  // hasOwnProperty gate keeps this from inventing values for genuinely
  // missing keys.
  if (result === undefined && startIdx < ref.path.length) {
    const formDataBag = nodeOutput.formData;
    if (
      formDataBag &&
      typeof formDataBag === 'object' &&
      Object.prototype.hasOwnProperty.call(formDataBag, ref.path[startIdx])
    ) {
      let fallback = formDataBag;
      for (let j = startIdx; j < ref.path.length; j++) {
        if (fallback === undefined || fallback === null) return undefined;
        fallback = fallback[ref.path[j]];
      }
      return fallback;
    }
  }
  return result;
}

// Coerce a workflowContext-resolved value into an array suitable for loop
// iteration. Many helper-node schemas wrap a single primary array inside an
// envelope of metadata fields:
//   transform-array     -> { result, operation, originalLength }
//   integration-airtable -> { records, ... }
//   utility-semantic-search -> { matches, ... }
//   general-loop        -> { results, currentItem, ... }
// If the upstream binding targets the parent node (path = [nodeId]) instead
// of the inner field, the caller would otherwise see the envelope and treat
// it as a non-array. When the envelope contains exactly ONE array property,
// we unwrap to it — that's unambiguous and matches the schema convention.
// Multi-array envelopes (utility-extract-links, integration-google-sheets,
// utility-csv-parse) stay non-iterable so the user must drill explicitly.
function unwrapWorkflowCollection(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const arrayKeys = [];
  for (const k in value) {
    if (Object.prototype.hasOwnProperty.call(value, k) && Array.isArray(value[k])) {
      arrayKeys.push(k);
      if (arrayKeys.length > 1) return [];
    }
  }
  return arrayKeys.length === 1 ? value[arrayKeys[0]] : [];
}

function resolveCtxRef(ref, context) {
  var elem = context.triggerElement;
  if (!elem || typeof elem.getAttribute !== 'function') return undefined;
  if (!ref.refPath || ref.refPath.length === 0) return undefined;
  var attrName = 'data-item-' + ref.refPath[0].replace(/([A-Z])/g, function(m) { return '-' + m.toLowerCase(); });
  return elem.getAttribute(attrName);
}

function resolveSecret(value, context) {
  if (typeof value === 'string' && value.startsWith('WORKFLOW_SECRET_')) {
    return typeof process !== 'undefined' && process.env ? process.env[value] : value;
  }
  if (typeof value === 'string' && value.startsWith('teleporthq.secrets.')) {
    const envKey = value.replace('teleporthq.secrets.', '');
    return typeof process !== 'undefined' && process.env ? process.env[envKey] : value;
  }
  // Project-secret reference object emitted by the builder for node-config
  // credentials (SMS/AI/integration/email provider keys, etc.):
  //   { type: 'dynamic', content: { referenceType: 'secret', id: 'SMS_TWILIO_ACCOUNTSID' } }
  // The actual value lives in process.env under content.id (the project secret
  // store key), populated at deploy time. Without this the node handler would
  // receive the reference object instead of the credential string.
  if (
    value && typeof value === 'object' && value.type === 'dynamic' &&
    value.content && value.content.referenceType === 'secret' &&
    typeof value.content.id === 'string'
  ) {
    if (typeof process === 'undefined' || !process.env) {
      return '';
    }
    var secretVal = process.env[value.content.id];
    if (secretVal === undefined || secretVal === null) {
      return '';
    }
    // If the deploy step did not replace the placeholder (secret missing from
    // the store), do not leak the literal 'teleporthq.secrets.<KEY>' as a value.
    if (typeof secretVal === 'string' && secretVal.indexOf('teleporthq.secrets.') === 0) {
      return '';
    }
    return secretVal;
  }
  if (typeof value === 'object' && value && value.type === 'workflowContext') {
    return resolveContextRef(value, context);
  }
  return value;
}

// True when a value is a project-secret reference object (see resolveSecret).
function isSecretRef(value) {
  return !!(
    value && typeof value === 'object' && value.type === 'dynamic' &&
    value.content && value.content.referenceType === 'secret' &&
    typeof value.content.id === 'string'
  );
}

// Resolve the inline workflow-context placeholders the rich-text email-body
// editor embeds for every dynamic value:
//   <span class="context-value-inline" data-ctx-node-id="<id>"
//         data-ctx-path='["<id>","result"]'>Label</span>
// resolveConfig leaves plain strings untouched, so without this the literal
// placeholder label (e.g. "Reset URL") would be delivered in the email instead
// of the resolved value. Handles both the raw single-quoted attribute form and
// the Quill-serialized &quot;-escaped form, plus the nested inner <span> Quill
// wraps the label in.
function resolveRichTextContext(html, context) {
  if (typeof html !== 'string' || html.indexOf('context-value-inline') === -1) {
    return html;
  }
  var out = '';
  var i = 0;
  while (i < html.length) {
    var spanStart = html.indexOf('<span', i);
    if (spanStart === -1) { out += html.slice(i); break; }
    var openEnd = html.indexOf('>', spanStart);
    if (openEnd === -1) { out += html.slice(i); break; }
    var openTag = html.slice(spanStart, openEnd + 1);
    if (openTag.indexOf('context-value-inline') === -1) {
      // Unrelated <span> — copy it through verbatim and keep scanning.
      out += html.slice(i, openEnd + 1);
      i = openEnd + 1;
      continue;
    }
    // Copy everything before the embed, then replace the whole embed span
    // (including any nested inner spans) with the resolved value.
    out += html.slice(i, spanStart);
    var depth = 1;
    var j = openEnd + 1;
    while (j < html.length && depth > 0) {
      var nextOpen = html.indexOf('<span', j);
      var nextClose = html.indexOf('</span>', j);
      if (nextClose === -1) { j = html.length; break; }
      if (nextOpen !== -1 && nextOpen < nextClose) {
        var innerEnd = html.indexOf('>', nextOpen);
        j = innerEnd === -1 ? html.length : innerEnd + 1;
        depth++;
      } else {
        j = nextClose + 7; // '</span>'.length
        depth--;
      }
    }
    out += resolveRichTextContextSpan(openTag, context);
    i = j;
  }
  return out;
}

function resolveRichTextContextSpan(openTag, context) {
  var nodeId = extractHtmlAttr(openTag, 'data-ctx-node-id');
  var pathRaw = extractHtmlAttr(openTag, 'data-ctx-path');
  var path = null;
  if (pathRaw) {
    var decoded = pathRaw.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, '&');
    try { path = JSON.parse(decoded); } catch (e) { path = null; }
  }
  if (!Array.isArray(path) || path.length === 0) {
    path = nodeId ? [nodeId] : [];
  }
  if (!nodeId && path.length > 0) { nodeId = path[0]; }
  if (!nodeId) { return ''; }
  var value = resolveContextRef({ type: 'workflowContext', nodeId: nodeId, path: path }, context);
  if (value === undefined || value === null) { return ''; }
  return escapeHtmlText(String(value));
}

// Read a quoted HTML attribute value (double- or single-quoted) without a regex
// so the surrounding template literal needs no backslash escaping.
function extractHtmlAttr(tag, name) {
  var key = name + '=';
  var at = tag.indexOf(key);
  if (at === -1) { return ''; }
  var quote = tag.charAt(at + key.length);
  if (quote !== '"' && quote !== "'") { return ''; }
  var start = at + key.length + 1;
  var end = tag.indexOf(quote, start);
  if (end === -1) { return ''; }
  return tag.slice(start, end);
}

function escapeHtmlText(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Sentinel for a page-context template token ({{urlDifferentiator}} /
// {{Current Page Entity.id}}) that could not be resolved at execution time
// (no dynamic-route parameter reachable — e.g. the workflow fired on a
// non-details page). finalizeResolvedConfig turns this into a validation
// error on data-node filters and into null everywhere else, so the literal
// token text never reaches SQL.
var UNRESOLVED_ROUTE_PARAM = '__TQ_UNRESOLVED_ROUTE_PARAM__';

// Deployed node configs regularly carry literal {{...}} template tokens that
// only the page runtime can resolve: {{state.X}} (trigger-time state
// snapshot), {{urlDifferentiator}} / {{Current Page Entity.id}} /
// {{page.entityId}} (the details page's dynamic-route parameter) and
// {{Current User.id}} (the GlobalContext-bridged authenticated user). No
// other substitution site exists in the generated app, so without this the
// literal token string reaches SQL. Only whole-string tokens are resolved —
// JS-expression tokens ({{state.a === 'b' ? ...}}) are left untouched.
function resolveTemplateTokenString(value, context) {
  if (typeof value !== 'string') return { matched: false };
  var m = value.match(/^\\{\\{\\s*([^{}]+?)\\s*\\}\\}$/);
  if (!m) return { matched: false };
  var token = m[1];
  if (token.indexOf('state.') === 0) {
    var statePath = token.slice(6).split('.');
    for (var si = 0; si < statePath.length; si++) {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(statePath[si])) return { matched: false };
    }
    var stateCursor = context && context.__stateValues;
    for (var sj = 0; sj < statePath.length && stateCursor !== null && stateCursor !== undefined; sj++) {
      stateCursor = stateCursor[statePath[sj]];
    }
    return { matched: true, value: stateCursor === undefined ? null : stateCursor };
  }
  if (token === 'urlDifferentiator' || token === 'Current Page Entity.id' || token === 'page.entityId') {
    var routeParams = context && context.__routeParams;
    // The page's declared dynamic-route attribute wins; 'id' is the fallback
    // for workflows attached to shared components (e.g. Navigation) rendered
    // on a details page, which have no __dynamicRouteParam of their own.
    var routeParamKey = (context && context.__dynamicRouteParam) || 'id';
    if (routeParams && routeParams[routeParamKey] !== undefined && routeParams[routeParamKey] !== null && routeParams[routeParamKey] !== '') {
      var paramValue = routeParams[routeParamKey];
      return { matched: true, value: Array.isArray(paramValue) ? paramValue[0] : paramValue };
    }
    return { matched: true, value: UNRESOLVED_ROUTE_PARAM };
  }
  if (token === 'Current User.id' || token === 'currentUser.id') {
    var currentUser = context && context.__stateValues && context.__stateValues.currentUser;
    var userId = currentUser && typeof currentUser === 'object' ? currentUser.id : undefined;
    return { matched: true, value: userId === undefined ? null : userId };
  }
  return { matched: false };
}

// Fills flat {{key}} merge tokens in a component-bodied email node's body/subject
// from its (already-resolved) templateParams. Unknown tokens are left verbatim so
// unrelated {{...}} (e.g. a campaign CustomerData {{name}}) is never blanked.
// Values are injected unescaped, matching the e-commerce email fillers.
// Expands each \`<!--tq:each KEY-->…{{field}}…<!--/tq:each-->\` block (emitted by
// the email serializer for a builder array mapper) by repeating the inner body
// once per row of lists[KEY], substituting each row's {{field}} with the
// HTML-escaped item value. Unknown per-row tokens are left verbatim so the flat
// page-level fill can still resolve them (e.g. {{companyName}} inside a row). Runs
// BEFORE the flat token replace. No-op when there is no such block.
// PAIRED EDIT: GUI order-side-effects-helper.ts EXPAND_LIST_BLOCKS_JS + worker
// adapters/email/_bridge.ts. Keep in sync.
function expandListBlocks(text, lists) {
  if (typeof text !== 'string' || text.indexOf('<!--tq:each') === -1) return text;
  function escRow(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  return text.replace(/<!--tq:each\\s+([\\w.-]+)\\s*-->([\\s\\S]*?)<!--\\/tq:each-->/g, function(m, key, body) {
    var rows = lists && lists[key];
    if (!Array.isArray(rows)) return '';
    var out = '';
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r] || {};
      out += body.replace(/\\{\\{\\s*([\\w.-]+)\\s*\\}\\}/g, function(mm, field) {
        return (row && Object.prototype.hasOwnProperty.call(row, field) && row[field] != null) ? escRow(row[field]) : mm;
      });
    }
    return out;
  });
}

function applyTemplateParams(text, params) {
  if (typeof text !== 'string' || !Array.isArray(params)) return text;
  var map = {};
  for (var i = 0; i < params.length; i++) {
    var p = params[i];
    if (p && typeof p.key === 'string') {
      // Keep the raw value type: array values feed expandListBlocks (loop rows);
      // scalars are stringified in the flat replace below.
      map[p.key] = p.value;
    }
  }
  var expanded = expandListBlocks(text, map);
  return expanded.replace(/\\{\\{\\s*([\\w.-]+)\\s*\\}\\}/g, function(m, key) {
    if (!Object.prototype.hasOwnProperty.call(map, key)) return m;
    var v = map[key];
    return (v === null || v === undefined) ? '' : String(v);
  });
}

// Post-resolution pass over a node's resolved config. Data-node filters whose
// value is an unresolved route-param sentinel become a hard validation error
// (surfaced through the workflow error handler) — sending them on would query
// 'WHERE id = <literal token>'. Everywhere else the sentinel degrades to null
// (e.g. a columnMapping loses attribution but the write survives).
function finalizeResolvedConfig(nodeType, config) {
  var isDataNode = typeof nodeType === 'string' && nodeType.indexOf('data-') === 0;
  var error = null;
  function walk(obj, insideFilters) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (var ai = 0; ai < obj.length; ai++) walk(obj[ai], insideFilters);
      return;
    }
    var keys = Object.keys(obj);
    for (var ki = 0; ki < keys.length; ki++) {
      var k = keys[ki];
      var v = obj[k];
      if (v === UNRESOLVED_ROUTE_PARAM) {
        if (isDataNode && insideFilters && !error) {
          var column = obj.column || obj.source || obj.field || k;
          error = 'Filter on "' + column + '" requires the page id ({{urlDifferentiator}}), which is not available in this context';
        }
        obj[k] = null;
      } else if (v && typeof v === 'object') {
        walk(v, insideFilters || k === 'filters');
      }
    }
  }
  walk(config, false);

  // BACKSTOP: a data-node FILTER value that STILL holds a literal {{…}} token
  // after resolution is an unresolvable template — a JS expression, an embedded
  // token, or an unknown root the runtime never substitutes (run d9a24741:
  // "{{state.filterDateEnd || '2099-12-31'}} 23:59:59" and
  // "{{Current Page Entity.guest_id}}"). Left alone it reaches SQL as literal
  // text and breaks the query. For a READ (data-select / data-count) DROP the
  // clause — the optional-filter idiom degrades to "no filter" (more rows, never
  // a crash). For a WRITE the filter scopes the mutation, so an unscoped/partial
  // filter is unsafe → surface a validation error (same posture as the
  // route-param sentinel above).
  if (isDataNode && config && Array.isArray(config.filters)) {
    var isReadNode = nodeType === 'data-select' || nodeType === 'data-count';
    var keptFilters = [];
    for (var fi = 0; fi < config.filters.length; fi++) {
      var filt = config.filters[fi];
      var fval = filt && typeof filt === 'object'
        ? (filt.value !== undefined ? filt.value : filt.destination)
        : undefined;
      if (typeof fval === 'string' && /\\{\\{[\\s\\S]*?\\}\\}/.test(fval)) {
        if (!isReadNode && !error) {
          var fcol = (filt && (filt.column || filt.field || filt.source)) || 'filter';
          error = 'Filter on "' + fcol + '" carries an unresolved template ({{…}}) and cannot safely scope this write';
        }
        continue; // drop the unresolvable clause
      }
      keptFilters.push(filt);
    }
    config.filters = keptFilters;
  }

  // BACKSTOP for WRITES: a columnMapping whose resolved value is STILL a whole
  // {{…}} token would insert the literal token text into the column. Run
  // 02783f65 declared state defaults of '{{url.character_id}}' and
  // '{{url.event_id}}' — a token vocabulary that does not exist — and both fed
  // event_responses.event_id / .character_id (both uuid) through a state-get,
  // so every Accept / Decline / Tentative died on Postgres 22P02.
  //
  // Deliberately stricter than the filters rule above: only a WHOLE-string
  // token counts. An embedded '{{' inside longer prose is text a user may have
  // legitimately typed into a form; a value that is nothing but a moustache is
  // unambiguously an unresolved token.
  //
  // Erroring (rather than nulling) matches the write posture above: the column
  // may be a NOT NULL foreign key, so dropping it trades 22P02 for a constraint
  // violation. The error surfaces through the workflow error handler with the
  // column named, instead of a driver-level failure nobody can attribute.
  if (isDataNode && config && Array.isArray(config.columnMappings)) {
    for (var ci = 0; ci < config.columnMappings.length; ci++) {
      var mapping = config.columnMappings[ci];
      if (!mapping || typeof mapping !== 'object') continue;
      var mval = mapping.value;
      if (typeof mval === 'string' && /^\\s*\\{\\{[\\s\\S]*\\}\\}\\s*$/.test(mval)) {
        if (!error) {
          error =
            'Column "' + (mapping.column || 'unknown') +
            '" would be written the unresolved template ' + mval.trim() +
            ' as literal text. That token resolves nowhere at runtime.';
        }
      }
    }
  }

  return error;
}

// Scalar config values are normally just secret-resolved. Rich-text strings
// (email bodies) additionally need their inline context placeholders resolved,
// and whole-string {{...}} template tokens resolve against the page context.
function resolveScalarValue(value, context) {
  var tokenResolution = resolveTemplateTokenString(value, context);
  if (tokenResolution.matched) {
    return tokenResolution.value;
  }
  if (typeof value === 'string' && value.indexOf('context-value-inline') !== -1) {
    return resolveRichTextContext(value, context);
  }
  return resolveSecret(value, context);
}

function resolveConfig(config, context) {
  if (!config || typeof config !== 'object') return config;
  const resolved = {};
  const keys = Object.keys(config);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const val = config[key];
    if (Array.isArray(val)) {
      let hasCtx = false;
      for (let j = 0; j < val.length; j++) {
        if (val[j] && typeof val[j] === 'object' && (val[j].type === 'workflowContext' || val[j].type === 'ctx')) {
          hasCtx = true;
          break;
        }
      }
      if (hasCtx) {
        resolved[key] = val.map(function(item) {
          if (item && typeof item === 'object' && item.type === 'workflowContext') {
            return resolveContextRef(item, context);
          }
          if (item && typeof item === 'object' && item.type === 'ctx') {
            return resolveCtxRef(item, context);
          }
          if (isSecretRef(item)) {
            return resolveSecret(item, context);
          }
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            return resolveConfig(item, context);
          }
          return resolveScalarValue(item, context);
        });
      } else {
        resolved[key] = val.map(function(item) {
          if (isSecretRef(item)) {
            return resolveSecret(item, context);
          }
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            return resolveConfig(item, context);
          }
          return resolveScalarValue(item, context);
        });
      }
    } else if (val && typeof val === 'object' && val.type === 'workflowContext') {
      resolved[key] = resolveContextRef(val, context);
    } else if (val && typeof val === 'object' && val.type === 'ctx') {
      resolved[key] = resolveCtxRef(val, context);
    } else if (isSecretRef(val)) {
      resolved[key] = resolveSecret(val, context);
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      resolved[key] = resolveConfig(val, context);
    } else {
      resolved[key] = resolveScalarValue(val, context);
    }
  }
  return resolved;
}

function evaluateCondition(config, context) {
  const condType = config.conditionType || 'simple-comparison';
  if (condType === 'expression') {
    const cond = resolveValue(config.condition, context);
    try { return !!new Function('context', 'return (' + cond + ')')(context); }
    catch(e) { return false; }
  }
  if (condType === 'multiple-conditions') {
    const conditions = config.conditions || [];
    const logic = config.logicOperator || 'AND';
    const results = conditions.map(function(c) { return evaluateSingleComparison(c, context); });
    return logic === 'AND' ? results.every(Boolean) : results.some(Boolean);
  }
  return evaluateSingleComparison(config, context);
}

function coerceForComparison(a, b) {
  if (typeof a === 'boolean' && typeof b === 'string') {
    if (b === 'true') return [a, true];
    if (b === 'false') return [a, false];
  }
  if (typeof b === 'boolean' && typeof a === 'string') {
    if (a === 'true') return [true, b];
    if (a === 'false') return [false, b];
  }
  if (typeof a === 'number' && typeof b === 'string') {
    var n = Number(b);
    if (!isNaN(n)) return [a, n];
  }
  if (typeof b === 'number' && typeof a === 'string') {
    var m = Number(a);
    if (!isNaN(m)) return [m, b];
  }
  return [a, b];
}

// Several producers cannot type their output and emit booleans as the strings
// "true"/"false": the evaluate-auth custom-js, text inputs in the inspector,
// form fields. coerceForComparison and is-true/is-false already read those as
// booleans, so truthiness must agree — under a plain double-negation the
// string "false" is TRUTHY, which let an is-truthy gate on isLoggedIn admit
// every visitor (see is-logged-in-gate.ts).
function isStringifiedBoolean(value) {
  return value === 'true' || value === 'false';
}

// The operator vocabulary is written by THREE producers that never agreed on
// a spelling: the worker canonicalizes to snake_case (is_not_empty,
// greater_than), the GUI editor emits camelCase named forms (startsWith,
// notContains), and this runtime historically implemented only the hyphenated
// forms. Unknown spellings used to fall through to the default 'left == right'
// branch, which INVERTS unary semantics (is_not_empty compared the value
// against undefined). Normalizing camelCase and snake_case to the canonical
// hyphenated form here makes every producer's config executable.
function normalizeComparisonOperator(op) {
  if (typeof op !== 'string' || op === '') return 'equals';
  return op
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

function evaluateSingleComparison(config, context) {
  var rawLeft = resolveValue(config.leftValue, context);
  var rawRight = resolveValue(config.rightValue, context);
  const op = normalizeComparisonOperator(config.operator || 'equals');
  var isUnary = op === 'is-empty' || op === 'is-not-empty' || op === 'is-truthy' || op === 'is-falsy' ||
    op === 'is-null' || op === 'is-not-null' || op === 'is-true' || op === 'is-false';
  var pair = isUnary ? [rawLeft, rawRight] : coerceForComparison(rawLeft, rawRight);
  var left = pair[0];
  var right = pair[1];
  switch (op) {
    case '===': return left === right;
    case '!==': return left !== right;
    case '==': case 'equals': return left == right;
    case '!=': case 'not-equals': return left != right;
    case '>': case 'greater-than': return left > right;
    case '<': case 'less-than': return left < right;
    case '>=': case 'greater-than-or-equal': return left >= right;
    case '<=': case 'less-than-or-equal': return left <= right;
    case 'contains': return String(left).includes(String(right));
    case 'not-contains': case 'does-not-contain': return !String(left).includes(String(right));
    case 'starts-with': return String(left).startsWith(String(right));
    case 'ends-with': return String(left).endsWith(String(right));
    case 'is-empty': return left === '' || left === null || left === undefined || (Array.isArray(left) && left.length === 0);
    case 'is-not-empty': return left !== '' && left !== null && left !== undefined && !(Array.isArray(left) && left.length === 0);
    case 'is-null': return left === null || left === undefined;
    case 'is-not-null': return left !== null && left !== undefined;
    case 'is-true': return left === true || left === 'true';
    case 'is-false': return left === false || left === 'false';
    case 'is-truthy': return isStringifiedBoolean(left) ? left === 'true' : !!left;
    case 'is-falsy': return isStringifiedBoolean(left) ? left === 'false' : !left;
    case 'matches-regex': try { return new RegExp(String(right)).test(String(left)); } catch(e) { return false; }
    default:
      console.warn('[workflow] Unknown comparison operator "' + config.operator + '" — falling back to loose equality');
      return left == right;
  }
}

async function executeWorkflow(workflowConfig, triggerContext, nodeHandlers, options) {
  options = options || {};
  const context = {};
  // See buildContext — one shared fire-and-forget queue for the whole run.
  context.__pendingNodePromises = [];
  const executionId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  context[workflowConfig.triggerNodeId] = triggerContext;
  if (triggerContext && triggerContext.__stateValues) {
    context.__stateValues = triggerContext.__stateValues;
  }
  if (triggerContext && triggerContext.__routeParams) {
    context.__routeParams = triggerContext.__routeParams;
  }
  if (triggerContext && triggerContext.__dynamicRouteParam) {
    context.__dynamicRouteParam = triggerContext.__dynamicRouteParam;
  }
  if (triggerContext && triggerContext.triggerElement) {
    context.triggerElement = triggerContext.triggerElement;
  }

  const callServerSegment = options.callServerSegment;

  try {
    await executeNodes(workflowConfig.nodes, workflowConfig.edges, context, nodeHandlers, workflowConfig, callServerSegment, executionId);
  } catch (error) {
    if (error.__skipErrorHandler) {
      return context;
    }
    if (workflowConfig.errorHandlerNodeId && workflowConfig.errorHandlerEdges) {
      const errorContext = {
        error: {
          message: error.message || String(error),
          stack: error.stack || '',
          nodeId: error.nodeId || '',
          nodeType: error.nodeType || '',
          stepNumber: error.stepNumber || 0
        }
      };
      context[workflowConfig.errorHandlerNodeId] = errorContext;
      try {
        await executeNodes(workflowConfig.errorHandlerNodes || [], workflowConfig.errorHandlerEdges, context, nodeHandlers, workflowConfig, callServerSegment, executionId);
      } catch (innerErr) {
        console.error('Workflow error handler failed:', innerErr);
      }
    } else {
      throw error;
    }
  }

  return context;
}

function markAllBranchNodes(branchEdges, nodes, edges, parentId, executed) {
  for (let i = 0; i < branchEdges.length; i++) {
    if (branchEdges[i].sourceHandle) {
      collectBranchNodes(branchEdges[i].target, nodes, edges, parentId)
        .forEach(function(bn) { executed[bn.id] = true; });
    }
  }
}

function topoSortNodes(nodes, edges) {
  var nodeMap = {};
  var inDegree = {};
  for (var i = 0; i < nodes.length; i++) {
    nodeMap[nodes[i].id] = nodes[i];
    inDegree[nodes[i].id] = 0;
  }
  for (var j = 0; j < edges.length; j++) {
    if (nodeMap[edges[j].target] && nodeMap[edges[j].source]) {
      inDegree[edges[j].target] = (inDegree[edges[j].target] || 0) + 1;
    }
  }
  var queue = [];
  for (var k = 0; k < nodes.length; k++) {
    if (inDegree[nodes[k].id] === 0) queue.push(nodes[k]);
  }
  queue.sort(function(a, b) { return (a.stepNumber || 0) - (b.stepNumber || 0); });
  var sorted = [];
  while (queue.length > 0) {
    var node = queue.shift();
    sorted.push(node);
    for (var e = 0; e < edges.length; e++) {
      if (edges[e].source === node.id && nodeMap[edges[e].target]) {
        inDegree[edges[e].target]--;
        if (inDegree[edges[e].target] === 0) {
          queue.push(nodeMap[edges[e].target]);
          queue.sort(function(a, b) { return (a.stepNumber || 0) - (b.stepNumber || 0); });
        }
      }
    }
  }
  if (sorted.length < nodes.length) {
    var remaining = nodes.filter(function(n) { return !sorted.some(function(s) { return s.id === n.id; }); });
    remaining.sort(function(a, b) { return (a.stepNumber || 0) - (b.stepNumber || 0); });
    sorted = sorted.concat(remaining);
  }
  return sorted;
}

// Data-category node types. Mirrors DATA_NODE_TYPES in await-result.ts (and in
// teleport-gui's workflow-schema) — PAIRED EDIT.
var __DATA_NODE_TYPES = {
  'data-select': true,
  'data-count': true,
  'data-raw-query': true,
  'data-create-item': true,
  'data-update-item': true,
  'data-delete-item': true
};

// A data node the author opted out of awaiting. Only an explicit \`false\` opts
// out, so a config written before the option existed keeps awaiting.
function isFireAndForgetNode(node) {
  if (!node || !__DATA_NODE_TYPES[node.type]) return false;
  return !!node.config && node.config.awaitResult === false;
}

// Starts a fire-and-forget node and returns a promise that ALWAYS resolves.
// The workflow has already moved on, so a failure here can neither abort it nor
// reach the error handler — it is reported to the console and swallowed, which
// is exactly what "do not await" means.
function startFireAndForgetNode(node, handler, resolvedConfig, context) {
  var label = (node && (node.label || node.type)) || 'node';
  var started;
  try {
    started = Promise.resolve(handler(resolvedConfig, context));
  } catch (syncErr) {
    started = Promise.reject(syncErr);
  }
  return started.then(function(result) {
    if (isFatalNodeResult(result)) {
      console.error('[workflow] "' + label + '" failed (not awaited): ' + fatalNodeResultMessage(result));
    }
  }).catch(function(err) {
    console.error('[workflow] "' + label + '" threw (not awaited):', err);
  });
}

// Keeps every in-flight fire-and-forget promise on the execution context so a
// server route can settle them BEFORE it responds. A serverless function may be
// frozen the moment its response is sent, which would silently drop an
// in-flight write; the visitor still never waits for it, because the client
// dispatches such a segment without awaiting the round trip.
function registerPendingNodePromise(context, promise) {
  if (!context || !promise) return promise;
  if (!context.__pendingNodePromises) context.__pendingNodePromises = [];
  context.__pendingNodePromises.push(promise);
  return promise;
}

async function settlePendingNodePromises(context) {
  if (!context) return;
  // Bounded drain: a settled promise can only enqueue more work through a
  // nested custom node, so a handful of passes is always enough and a runaway
  // producer can never hang the response.
  for (var pass = 0; pass < 5; pass++) {
    var pending = context.__pendingNodePromises;
    if (!pending || pending.length === 0) return;
    context.__pendingNodePromises = [];
    // Every entry swallows its own rejection (see startFireAndForgetNode), so
    // this can never reject.
    await Promise.all(pending);
  }
}

// A node result signals failure either through the legacy string contract
// ({ error: '...' } / { success: false }) or through the AI-node contract
// ({ error: true, message, code } — provider/auth failures). Both must halt
// the workflow; treating error:true as success used to let the pipeline limp
// into downstream NOT NULL violations.
function isFatalNodeResult(result) {
  if (!result) return false;
  return result.success === false ||
    (typeof result.error === 'string' && result.error) ||
    result.error === true;
}

function fatalNodeResultMessage(result) {
  if (typeof result.error === 'string' && result.error) return result.error;
  if (typeof result.message === 'string' && result.message) return result.message;
  return 'Node execution failed';
}

async function executeNodes(nodes, edges, context, nodeHandlers, workflowConfig, callServerSegment, executionId) {
  const executed = {};
  const sortedNodes = topoSortNodes(nodes, edges);

  for (let i = 0; i < sortedNodes.length; i++) {
    const node = sortedNodes[i];
    if (executed[node.id]) continue;
    // Skip nodes that were marked as belonging to a non-taken branch
    // by the segment executor after a cross-boundary if-statement
    if (context.__skippedNodes && context.__skippedNodes[node.id]) {
      executed[node.id] = true;
      continue;
    }

    const resolvedConfig = resolveConfig(node.config, context);

    try {
      const configError = finalizeResolvedConfig(node.type, resolvedConfig);
      if (configError) {
        throw new Error(configError);
      }

      // Component-bodied send-email node: fill {{token}} merge fields in the
      // serialized template body/subject from the resolved templateParams
      // (resolveConfig already resolved each param value against context).
      if (resolvedConfig && Array.isArray(resolvedConfig.templateParams)) {
        if (typeof resolvedConfig.body === 'string') {
          resolvedConfig.body = applyTemplateParams(resolvedConfig.body, resolvedConfig.templateParams);
        }
        if (typeof resolvedConfig.subject === 'string') {
          resolvedConfig.subject = applyTemplateParams(resolvedConfig.subject, resolvedConfig.templateParams);
        }
      }

      if (node.type === 'general-if-statement') {
        const condResult = evaluateCondition(resolvedConfig, context);
        context[node.id] = { result: condResult };
        executed[node.id] = true;

        const ifEdges = edges.filter(function(e) { return e.source === node.id; });
        const branchHandle = condResult ? 'true' : 'false';
        const branchEdge = ifEdges.find(function(e) { return e.sourceHandle === branchHandle; });
        if (branchEdge) {
          const branchNodes = collectBranchNodes(branchEdge.target, nodes, edges, node.id);
          await executeNodes(branchNodes, edges, context, nodeHandlers, workflowConfig, callServerSegment, executionId);
        }
        markAllBranchNodes(ifEdges, nodes, edges, node.id, executed);
        context.__previousNodeResult = context[node.id];
        continue;
      }

      if (node.type === 'general-switch') {
        const switchVal = resolveValue(resolvedConfig.switchValue, context);
        const cases = resolvedConfig.cases || [];
        let matchedCase = 'default';
        for (let ci = 0; ci < cases.length; ci++) {
          const caseVal = resolveValue(cases[ci].condition, context);
          if (resolvedConfig.comparisonMode === 'expression') {
            try { if (new Function('value', 'context', 'return (' + caseVal + ')')(switchVal, context)) { matchedCase = cases[ci].id; break; } } catch(e) {}
          } else {
            if (switchVal === caseVal) { matchedCase = cases[ci].id; break; }
          }
        }
        context[node.id] = { matchedCase: matchedCase };
        executed[node.id] = true;

        const switchEdges = edges.filter(function(e) { return e.source === node.id; });
        const matchedEdge = switchEdges.find(function(e) {
          return (e.sourceHandle === 'switch' && e.data && e.data.caseId === matchedCase) ||
                 (matchedCase === 'default' && e.sourceHandle === 'default');
        });
        if (matchedEdge) {
          const caseBranchNodes = collectBranchNodes(matchedEdge.target, nodes, edges, node.id);
          await executeNodes(caseBranchNodes, edges, context, nodeHandlers, workflowConfig, callServerSegment, executionId);
        }
        markAllBranchNodes(switchEdges, nodes, edges, node.id, executed);
        context.__previousNodeResult = context[node.id];
        continue;
      }

      if (node.type === 'general-loop') {
        await executeLoop(node, resolvedConfig, nodes, edges, context, nodeHandlers, workflowConfig, callServerSegment, executionId);
        executed[node.id] = true;
        getLoopBodyNodeIds(node.id, edges).forEach(function(bid) { executed[bid] = true; });
        context.__previousNodeResult = context[node.id];
        continue;
      }

      if (node.type === 'general-parallel') {
        await executeParallel(node, resolvedConfig, nodes, edges, context, nodeHandlers, workflowConfig, callServerSegment, executionId);
        executed[node.id] = true;
        context.__previousNodeResult = context[node.id];
        continue;
      }

      if (isStreamingAINode(node, resolvedConfig)) {
        const streamEdges = edges.filter(function(e) { return e.source === node.id; });
        const onStreamEdge = streamEdges.find(function(e) { return e.sourceHandle === 'on-stream'; });
        const onEndEdge = streamEdges.find(function(e) { return e.sourceHandle === 'on-end'; });
        const onStreamNodes = onStreamEdge ? collectBranchNodes(onStreamEdge.target, nodes, edges, node.id) : [];
        const onEndNodes = onEndEdge ? collectBranchNodes(onEndEdge.target, nodes, edges, node.id) : [];

        const streamHandler = nodeHandlers[node.type];
        if (streamHandler) {
          const streamResult = await streamHandler(resolvedConfig, context, async function(chunkData) {
            context[node.id] = chunkData;
            if (onStreamNodes.length > 0) {
              await executeNodes(onStreamNodes, edges, context, nodeHandlers, workflowConfig, callServerSegment, executionId);
            }
          });
          if (isFatalNodeResult(streamResult)) {
            throw new Error(fatalNodeResultMessage(streamResult));
          }
          context[node.id] = streamResult;

          if (onEndNodes.length > 0) {
            await executeNodes(onEndNodes, edges, context, nodeHandlers, workflowConfig, callServerSegment, executionId);
          }
        }

        executed[node.id] = true;
        markAllBranchNodes(streamEdges, nodes, edges, node.id, executed);
        context.__previousNodeResult = context[node.id];
        continue;
      }

      const handler = nodeHandlers[node.type];
      if (!handler) {
        console.warn('No handler for node type: ' + node.type);
        continue;
      }

      if (isFireAndForgetNode(node)) {
        registerPendingNodePromise(
          context,
          startFireAndForgetNode(node, handler, resolvedConfig, context)
        );
        // The workflow never waits for this query, so it has no value to
        // publish: downstream references resolve to null rather than to a
        // half-finished or stale result.
        context[node.id] = null;
        executed[node.id] = true;
        context.__previousNodeResult = null;
        continue;
      }

      let result = await handler(resolvedConfig, context);

      if (result && result.__customNode && result.customNodeId && workflowConfig.customNodes) {
        const customNodeFn = workflowConfig.customNodes[result.customNodeId];
        if (customNodeFn) {
          var savedCustomNodeIds = context.__customNodeIds;
          var savedIsInsideCustomNode = context.__isInsideCustomNode;
          var savedPreviousNodeResult = context.__previousNodeResult;
          result = await customNodeFn(context, result.parameters || {}, nodeHandlers);
          context.__customNodeIds = savedCustomNodeIds;
          context.__isInsideCustomNode = savedIsInsideCustomNode;
          context.__previousNodeResult = savedPreviousNodeResult;
        }
      }

      if (result && result.__earlyResponse) {
        context[node.id] = result;
        var earlyErr = new Error((result.__earlyResponse.body && result.__earlyResponse.body.message) || 'Early response');
        earlyErr.__earlyResponse = result.__earlyResponse;
        earlyErr.__skipErrorHandler = true;
        throw earlyErr;
      }

      if (isFatalNodeResult(result)) {
        throw new Error(fatalNodeResultMessage(result));
      }

      context[node.id] = result;
      executed[node.id] = true;
      context.__previousNodeResult = result;

      if (result && result.__terminal) {
        return;
      }
    } catch (err) {
      if (err.__skipErrorHandler) throw err;
      const wfError = new Error(err.message || String(err));
      wfError.nodeId = node.id;
      wfError.nodeType = node.type;
      wfError.stepNumber = node.stepNumber;
      if (err.__earlyResponse) {
        wfError.__earlyResponse = err.__earlyResponse;
        wfError.__skipErrorHandler = true;
      }
      throw wfError;
    }
  }
}

async function executeLoop(loopNode, config, allNodes, edges, context, nodeHandlers, workflowConfig, callServerSegment, executionId) {
  const loopType = config.loopType || 'forEach';
  const bodyNodeIds = getLoopBodyNodeIds(loopNode.id, edges);
  const bodyNodes = allNodes.filter(function(n) { return bodyNodeIds.indexOf(n.id) >= 0; });
  const results = [];

  // Track this loop's body scope so general-custom-js (and any handler that
  // consults the scope stack) can build the params / innerParams arrays the
  // workflow editor advertises. Stored as { loopNodeId, bodyNodeIds: {id:true} }
  // so the consuming handler can use a simple membership check.
  const bodyNodeIdsMap = {};
  for (let bi = 0; bi < bodyNodeIds.length; bi++) {
    bodyNodeIdsMap[bodyNodeIds[bi]] = true;
  }
  if (!context.__loopScopeStack) context.__loopScopeStack = [];
  context.__loopScopeStack.push({ loopNodeId: loopNode.id, bodyNodeIds: bodyNodeIdsMap });
  // Persistent registry of every loop scaffold node id we've ever entered.
  // After an inner loop completes its scaffold value remains in context;
  // siblings need to recognise it as scaffolding (not data) when building
  // params / innerParams.
  if (!context.__loopNodeIds) context.__loopNodeIds = {};
  context.__loopNodeIds[loopNode.id] = true;

  try {
  if (loopType === 'forEach' || loopType === 'map') {
    // Helper-node outputs are commonly wrapped in metadata envelopes
    // (transform-* -> {result, ...}, integration-* -> {records, ...},
    // utility-search -> {matches, ...}). If the upstream binding targets
    // the parent node id without drilling, unwrap the single-array envelope
    // here so the loop iterates over the actual array instead of collapsing
    // to []. Mirrors the same guard in the server-segment runtime.
    const collection = unwrapWorkflowCollection(resolveValue(config.collection, context));
    const iterator = config.iterator || 'item';
    const indexVar = config.indexVariable || 'index';
    const parallel = config.parallel || false;

    if (parallel && collection.length > 1) {
      const concurrency = config.concurrency || collection.length;
      var parallelErrors = [];
      for (let batchStart = 0; batchStart < collection.length; batchStart += concurrency) {
        const batchEnd = Math.min(batchStart + concurrency, collection.length);
        var batchPromises = [];
        for (let bi = batchStart; bi < batchEnd; bi++) {
          (function(idx) {
            var iterCtx = Object.assign({}, context);
            // Per-branch copy of the scope stack so nested loops in one
            // parallel iteration don't pollute another iteration's view
            // of which loop scopes are active. Object.assign would otherwise
            // share the array reference across branches and a nested
            // executeLoop in branch A would still appear pushed when
            // branch B resumes from an await.
            iterCtx.__loopScopeStack = (context.__loopScopeStack || []).slice();
            iterCtx.__loopItem = collection[idx];
            iterCtx.__loopIndex = idx;
            iterCtx[loopNode.id + '_iter'] = {};
            iterCtx[loopNode.id + '_iter'][iterator] = collection[idx];
            iterCtx[loopNode.id + '_iter'][indexVar] = idx;
            batchPromises.push(
              executeNodes(bodyNodes, edges, iterCtx, nodeHandlers, workflowConfig, callServerSegment, executionId)
                .then(function() { return { success: true, context: iterCtx }; })
                .catch(function(err) { return { success: false, error: err, context: iterCtx }; })
            );
          })(bi);
        }
        var batchResults = await Promise.all(batchPromises);
        for (var br = 0; br < batchResults.length; br++) {
          if (batchResults[br].success) {
            Object.assign(context, batchResults[br].context);
            if (loopType === 'map' && bodyNodes.length > 0) {
              var lastBodyNode = bodyNodes[bodyNodes.length - 1];
              results.push(batchResults[br].context[lastBodyNode.id]);
            }
          } else {
            parallelErrors.push(batchResults[br].error);
            if (loopType === 'map') {
              results.push(undefined);
            }
          }
        }
      }
      if (parallelErrors.length > 0 && parallelErrors.length === collection.length) {
        throw parallelErrors[0];
      }
    } else {
      for (let idx = 0; idx < collection.length; idx++) {
        const iterCtx = Object.assign({}, context);
        iterCtx.__loopItem = collection[idx];
        iterCtx.__loopIndex = idx;
        iterCtx[loopNode.id + '_iter'] = {};
        iterCtx[loopNode.id + '_iter'][iterator] = collection[idx];
        iterCtx[loopNode.id + '_iter'][indexVar] = idx;
        await executeNodes(bodyNodes, edges, iterCtx, nodeHandlers, workflowConfig, callServerSegment, executionId);
        Object.assign(context, iterCtx);
        if (loopType === 'map' && bodyNodes.length > 0) {
          const lastBodyNode = bodyNodes[bodyNodes.length - 1];
          results.push(iterCtx[lastBodyNode.id]);
        }
      }
    }
    context[loopNode.id] = loopType === 'map'
      ? { results: results, iterations: collection.length }
      : { completed: true, iterations: collection.length };
  } else if (loopType === 'for') {
    const start = resolveValue(config.startIndex, context) || 0;
    const end = resolveValue(config.endIndex, context) || 0;
    const step = resolveValue(config.step, context) || 1;
    let count = 0;
    for (let fi = start; step > 0 ? fi < end : fi > end; fi += step) {
      const forCtx = Object.assign({}, context);
      forCtx[loopNode.id + '_iter'] = { index: fi };
      await executeNodes(bodyNodes, edges, forCtx, nodeHandlers, workflowConfig, callServerSegment, executionId);
      Object.assign(context, forCtx);
      count++;
    }
    context[loopNode.id] = { completed: true, iterations: count };
  } else {
    const maxIter = resolveValue(config.maxIterations, context) || 1000;
    let iter = 0;
    while (iter < maxIter) {
      const whileCtx = Object.assign({}, context);
      whileCtx[loopNode.id + '_iter'] = { iteration: iter };
      const condStr = resolveValue(config.condition, whileCtx);
      let condResult;
      try { condResult = new Function('context', 'return (' + condStr + ')')(whileCtx); } catch(e) { condResult = false; }
      if (loopType === 'while' && !condResult) break;
      if (loopType === 'until' && condResult) break;
      await executeNodes(bodyNodes, edges, whileCtx, nodeHandlers, workflowConfig, callServerSegment, executionId);
      Object.assign(context, whileCtx);
      iter++;
    }
    context[loopNode.id] = { completed: true, iterations: iter };
  }
  } finally {
    context.__loopScopeStack.pop();
  }
}

function getLoopBodyNodeIds(loopNodeId, edges) {
  const entryEdge = edges.find(function(e) { return e.source === loopNodeId && e.sourceHandle === 'loop'; });
  if (!entryEdge) return [];
  const bodyIds = [];
  const visited = {};
  const queue = [entryEdge.target];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (visited[cur] || cur === loopNodeId) continue;
    visited[cur] = true;
    bodyIds.push(cur);
    const outEdges = edges.filter(function(e) { return e.source === cur; });
    outEdges.forEach(function(e) {
      if (!(e.sourceHandle === 'loop-body-out' && e.targetHandle === 'loop-back') && e.target !== loopNodeId) {
        queue.push(e.target);
      }
    });
  }
  return bodyIds;
}

async function executeParallel(parallelNode, config, allNodes, edges, context, nodeHandlers, workflowConfig, callServerSegment, executionId) {
  const branchEdges = edges.filter(function(e) { return e.source === parallelNode.id && e.sourceHandle === 'parallel'; });
  const waitForAll = config.waitForAll !== false;
  const stopOnError = config.stopOnError || false;

  const promises = branchEdges.map(function(be) {
    const branchNodes = collectBranchNodes(be.target, allNodes, edges, parallelNode.id);
    const branchContext = Object.assign({}, context);
    return executeNodes(branchNodes, edges, branchContext, nodeHandlers, workflowConfig, callServerSegment, executionId)
      .then(function() {
        branchNodes.forEach(function(bn) { context[bn.id] = branchContext[bn.id]; });
        return { success: true };
      })
      .catch(function(err) { return { success: false, error: err }; });
  });

  let results;
  if (waitForAll) {
    results = await Promise.all(promises);
  } else {
    const continueAfter = config.continueAfter || 1;
    results = await new Promise(function(resolve) {
      const settled = [];
      let resolved = false;
      promises.forEach(function(p) {
        p.then(function(r) {
          settled.push(r);
          if (!resolved && settled.length >= continueAfter) {
            resolved = true;
            resolve(settled);
          }
        }).catch(function() {
          settled.push({ success: false });
          if (!resolved && settled.length >= promises.length) {
            resolved = true;
            resolve(settled);
          }
        });
      });
    });
  }

  const errors = results.filter(function(r) { return !r.success; }).map(function(r) { return r.error; });
  context[parallelNode.id] = {
    results: results,
    completedBranches: results.filter(function(r) { return r.success; }).length,
    errors: errors.length > 0 ? errors : undefined
  };

  if (stopOnError && errors.length > 0) {
    throw errors[0];
  }
}

const __AI_NODE_TYPES = ['ai-custom-prompt', 'ai-sentiment-analysis', 'ai-summarization', 'ai-text-classifier', 'ai-text-transform', 'ai-detect-language'];

function isStreamingAINode(node, config) {
  if (!config || !config.streaming) return false;
  return __AI_NODE_TYPES.indexOf(node.type) >= 0;
}

function collectBranchNodes(startId, allNodes, edges, excludeParentId) {
  const ids = [];
  const visited = {};
  const queue = [startId];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (visited[cur] || cur === excludeParentId) continue;
    visited[cur] = true;
    const n = allNodes.find(function(nd) { return nd.id === cur; });
    if (n) ids.push(n);
    const outEdges = edges.filter(function(e) { return e.source === cur; });
    outEdges.forEach(function(e) { if (e.target !== excludeParentId) queue.push(e.target); });
  }
  return ids;
}

module.exports = {
  resolveValue,
  resolveSecret,
  resolveConfig,
  resolveContextRef,
  resolveRichTextContext,
  unwrapWorkflowCollection,
  evaluateCondition,
  evaluateSingleComparison,
  normalizeComparisonOperator,
  resolveTemplateTokenString,
  applyTemplateParams,
  expandListBlocks,
  finalizeResolvedConfig,
  executeWorkflow,
  executeNodes,
  executeLoop,
  getLoopBodyNodeIds,
  executeParallel,
  collectBranchNodes,
  markAllBranchNodes,
  isStreamingAINode,
  isFatalNodeResult,
  fatalNodeResultMessage,
  isFireAndForgetNode,
  startFireAndForgetNode,
  registerPendingNodePromise,
  settlePendingNodePromises
};
`
}

export const generateClientRuntimeCode = (): string => {
  return `const utils = require('./runtime-utils');

// A live DOM element (the workflow trigger element) cannot cross the network
// to a server segment — JSON.stringify throws on its circular references, so it
// used to prune down to { __serializationError: true }. That dropped the
// element's dataset, which server nodes rely on (e.g. a cart "+" button whose
// data-select filters products by trigger.element.dataset.productId, or a
// cart-update node reading trigger.element.dataset.cartItemId). We replace any
// DOM node with a serializable snapshot carrying its dataset + form value, so
// those reads keep resolving on both sides of the round-trip.
function isDomNode(v) {
  return !!v && typeof v === 'object' && typeof v.nodeType === 'number' && v.nodeType === 1;
}

function snapshotDomNode(el) {
  var snap = { __domSnapshot: true, dataset: {} };
  try { snap.tagName = el.tagName || null; } catch (e) {}
  try { snap.id = el.id || ''; } catch (e) {}
  try { snap.name = el.name || ''; } catch (e) {}
  try { snap.type = el.type || ''; } catch (e) {}
  try { snap.className = typeof el.className === 'string' ? el.className : ''; } catch (e) {}
  try { if ('value' in el) snap.value = el.value; } catch (e) {}
  try { if ('checked' in el) snap.checked = el.checked; } catch (e) {}
  try {
    if (el.dataset) {
      for (var k in el.dataset) { snap.dataset[k] = el.dataset[k]; }
    }
  } catch (e) {}
  return snap;
}

function domSerializationReplacer(key, value) {
  return isDomNode(value) ? snapshotDomNode(value) : value;
}

function pruneContext(context) {
  const pruned = {};
  const keys = Object.keys(context);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const val = context[key];
    if (val === undefined || val === null) continue;
    if (typeof val === 'function') continue;
    // In-flight fire-and-forget promises are local to whichever runtime started
    // them; serializing them would ship a list of empty objects and let a
    // server response overwrite the client's live list.
    if (key === '__pendingNodePromises') continue;
    try {
      // Replace DOM nodes with serializable snapshots as we stringify, then
      // re-parse so the request body itself (JSON.stringify(prunedContext) in
      // callServerSegment, which has no replacer) never sees a live DOM node.
      const serialized = JSON.stringify(val, domSerializationReplacer);
      if (serialized === undefined) continue;
      if (serialized.length > 100000) {
        pruned[key] = { __truncated: true, type: typeof val };
      } else {
        pruned[key] = JSON.parse(serialized);
      }
    } catch(e) {
      pruned[key] = { __serializationError: true };
    }
  }
  return pruned;
}

// Merge a server segment's returned context back into the live client context.
// Two rules protect client-only state that cannot survive the round-trip:
//   1. A server-side placeholder ({ __serializationError } / { __truncated })
//      must never overwrite a real client value.
//   2. The trigger element/node is authoritative on the client. The live DOM
//      element is sent to the server as a snapshot (see pruneContext) and
//      echoed back as that snapshot; keeping the client's real element means a
//      post-server client node (cart-update reading
//      trigger.element.dataset.cartItemId, or any node calling a DOM method)
//      still works against the genuine element rather than a frozen copy.
function mergeServerResults(context, serverResults, triggerNodeId) {
  if (!serverResults || typeof serverResults !== 'object') return;
  const keys = Object.keys(serverResults);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const clientVal = context[key];
    // Keep the client's authoritative live DOM trigger element. The top-level
    // triggerElement holds the node directly; the trigger node's context holds
    // it under .element. The generic .element guard also covers the trigger
    // node id even when it is not passed in (e.g. inside a custom node).
    if (key === 'triggerElement' && isDomNode(clientVal)) continue;
    if (triggerNodeId && key === triggerNodeId && clientVal && isDomNode(clientVal.element)) continue;
    if (clientVal && typeof clientVal === 'object' && isDomNode(clientVal.element)) continue;
    const val = serverResults[key];
    // A server-side serialization placeholder must never clobber a real value.
    if (val && typeof val === 'object' && (val.__serializationError === true || val.__truncated === true)) continue;
    context[key] = val;
  }
}

// Absolutizes a workflow-segment URL for server-side execution.
//
// Custom nodes are generated once and shared between client and server
// runtimes: a user clicks "Toggle Favourite" in the browser (client path
// → same-origin fetch with a relative URL is fine), but Stripe also hits
// /api/webhooks/stripe-payment server-side, and THAT handler drives the
// same custom node. When the server-side path reaches its first server
// segment, the custom node calls \`callServerSegment\` with the same
// relative URL — but Node's undici fetch rejects relative URLs with
// "Failed to parse URL from /api/workflows/...".
//
// The api-route generator stashes the live request base URL on
// \`context.__baseUrl\` (e.g. "http://localhost:3000") before dispatching
// nodes; that context flows into every custom-node call, so we use it
// here to produce a fully-qualified URL. Browser callers never hit this
// branch because \`typeof window !== 'undefined'\` and the relative URL
// works natively via window.location.
function absolutizeSegmentUrl(segmentUrl, context) {
  if (!segmentUrl || typeof segmentUrl !== 'string') return segmentUrl;
  if (typeof window !== 'undefined') return segmentUrl;
  if (/^https?:\\/\\//i.test(segmentUrl)) return segmentUrl;
  var baseUrl = context && context.__baseUrl;
  if (!baseUrl) return segmentUrl;
  var trimmed = String(baseUrl).replace(/\\/+$/, '');
  return segmentUrl.charAt(0) === '/' ? trimmed + segmentUrl : trimmed + '/' + segmentUrl;
}

async function callServerSegment(segmentUrl, context) {
  const prunedContext = pruneContext(context);
  const targetUrl = absolutizeSegmentUrl(segmentUrl, context);
  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: prunedContext })
  });
  if (!response.ok) {
    let errorData;
    try { errorData = await response.json(); } catch(e) { errorData = { error: response.statusText }; }
    if (response.status === 429) {
      var rlErr = new Error(errorData.message || 'Rate limit exceeded');
      rlErr.__skipErrorHandler = true;
      rlErr.__rateLimited = true;
      rlErr.__earlyResponse = errorData;
      throw rlErr;
    }
    throw new Error(errorData.error || 'Server workflow segment failed');
  }
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Server workflow segment failed');
  return data.results;
}

function buildContext(workflowConfig, triggerContext) {
  const context = {};
  // Created eagerly so every nested custom node (which shallow-copies this
  // object) pushes into the SAME fire-and-forget queue instead of its own.
  context.__pendingNodePromises = [];
  context[workflowConfig.triggerNodeId] = triggerContext;
  if (triggerContext) {
    if (triggerContext.__stateValues) context.__stateValues = triggerContext.__stateValues;
    if (triggerContext.__routeParams) context.__routeParams = triggerContext.__routeParams;
    if (triggerContext.__dynamicRouteParam) context.__dynamicRouteParam = triggerContext.__dynamicRouteParam;
    if (triggerContext.triggerElement) context.triggerElement = triggerContext.triggerElement;
  }
  return context;
}

function findErrorHandlerNodes(workflowConfig) {
  const ehId = workflowConfig.errorHandlerNodeId;
  if (!ehId) return null;
  const allNodes = workflowConfig.nodes || [];
  const allEdges = workflowConfig.edges || [];
  const firstEdge = allEdges.filter(function(e) { return e.source === ehId; })[0];
  if (!firstEdge) return null;
  const errorNodes = utils.collectBranchNodes(firstEdge.target, allNodes, allEdges, ehId);
  return errorNodes.length > 0 ? { nodes: errorNodes, edges: allEdges } : null;
}

function findStreamingAINodes(allNodes, allEdges) {
  const map = {};
  const aiTypes = ['ai-custom-prompt', 'ai-sentiment-analysis', 'ai-summarization', 'ai-text-classifier', 'ai-text-transform', 'ai-detect-language'];
  for (let ni = 0; ni < allNodes.length; ni++) {
    const n = allNodes[ni];
    if (aiTypes.indexOf(n.type) >= 0 && n.config && n.config.streaming) {
      let onStreamEdge = null;
      let onEndEdge = null;
      for (let ei = 0; ei < allEdges.length; ei++) {
        if (allEdges[ei].source === n.id) {
          if (allEdges[ei].sourceHandle === 'on-stream') onStreamEdge = allEdges[ei];
          if (allEdges[ei].sourceHandle === 'on-end') onEndEdge = allEdges[ei];
        }
      }
      const onStreamNodes = onStreamEdge ? utils.collectBranchNodes(onStreamEdge.target, allNodes, allEdges, n.id) : [];
      const onEndNodes = onEndEdge ? utils.collectBranchNodes(onEndEdge.target, allNodes, allEdges, n.id) : [];
      map[n.id] = { node: n, onStreamNodes: onStreamNodes, onEndNodes: onEndNodes };
    }
  }
  return map;
}

// A streaming AI node's on-stream / on-end branches are collected from the
// FULL workflow node list, so they may contain server nodes (e.g. the SQL
// insert persisting a chat answer). Those already execute inside their own
// server segments with full configs; the browser bundle only ships their
// config redacted down to the client-safe whitelist (segment-splitter's
// redactServerNodeConfig), so executing them here with CLIENT handlers both
// double-executes them and crashes on the missing config. Emitted nodes carry
// executionEnv for exactly this filter; nodes without the marker (older
// bundles) keep executing client-side as before.
function clientExecutableBranchNodes(branchNodes) {
  return branchNodes.filter(function(n) { return !n || n.executionEnv !== 'server'; });
}

async function callStreamingServerSegment(segmentUrl, context, streamingInfo, allNodes, allEdges, clientHandlers, workflowConfig, executionId) {
  const prunedContext = pruneContext(context);
  const handledNodeIds = {};
  const streamedNodeIds = {};
  // Same relative-URL problem as callServerSegment above — required even
  // for streaming segments because a server-side caller (e.g. an AI
  // chat webhook) would otherwise fail to parse the URL.
  const streamingTargetUrl = absolutizeSegmentUrl(segmentUrl, context);
  const response = await fetch(streamingTargetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: prunedContext })
  });

  if (!response.ok) {
    let errorData;
    try { errorData = await response.json(); } catch(e) { errorData = { error: response.statusText }; }
    if (response.status === 429) {
      var rlErr = new Error(errorData.message || 'Rate limit exceeded');
      rlErr.__skipErrorHandler = true;
      rlErr.__rateLimited = true;
      rlErr.__earlyResponse = errorData;
      throw rlErr;
    }
    throw new Error(errorData.error || 'Streaming workflow segment failed');
  }
  if (!response.body) {
    throw new Error('Streaming response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const readResult = await reader.read();
    if (readResult.done) break;

    buffer += decoder.decode(readResult.value, { stream: true });
    const parts = buffer.split('\\n\\n');
    buffer = parts.pop() || '';

    for (let pi = 0; pi < parts.length; pi++) {
      const part = parts[pi].trim();
      if (!part || part.indexOf('data: ') !== 0) continue;
      const jsonStr = part.substring(6);
      let data;
      try { data = JSON.parse(jsonStr); } catch(e) { continue; }

      if (data.type === 'chunk' && data.nodeId) {
        streamedNodeIds[data.nodeId] = true;
        context[data.nodeId] = { chunk: data.chunk, fullResponse: data.fullResponse, model: data.model };
        const info = streamingInfo[data.nodeId];
        if (info && info.onStreamNodes.length > 0) {
          const runnableStreamNodes = clientExecutableBranchNodes(info.onStreamNodes);
          if (runnableStreamNodes.length > 0) {
            await utils.executeNodes(runnableStreamNodes, allEdges, context, clientHandlers, workflowConfig, null, executionId);
          }
          for (let sni = 0; sni < info.onStreamNodes.length; sni++) {
            handledNodeIds[info.onStreamNodes[sni].id] = true;
          }
        }
      } else if (data.type === 'node-result' && data.nodeId) {
        context[data.nodeId] = data.result;
      } else if (data.type === 'done') {
        if (data.results) {
          mergeServerResults(context, data.results, workflowConfig && workflowConfig.triggerNodeId);
        }
        const streamedKeys = Object.keys(streamedNodeIds);
        for (let sk = 0; sk < streamedKeys.length; sk++) {
          const endInfo = streamingInfo[streamedKeys[sk]];
          if (endInfo && endInfo.onEndNodes.length > 0) {
            const runnableEndNodes = clientExecutableBranchNodes(endInfo.onEndNodes);
            if (runnableEndNodes.length > 0) {
              await utils.executeNodes(runnableEndNodes, allEdges, context, clientHandlers, workflowConfig, null, executionId);
            }
            for (let eni = 0; eni < endInfo.onEndNodes.length; eni++) {
              handledNodeIds[endInfo.onEndNodes[eni].id] = true;
            }
          }
        }
      } else if (data.type === 'error') {
        throw new Error(data.error || 'Streaming workflow segment failed');
      }
    }
  }

  return handledNodeIds;
}

async function executeWorkflowWithSegments(workflowConfig, triggerContext, clientHandlers, serverSegmentUrls) {
  const context = buildContext(workflowConfig, triggerContext);
  const segments = workflowConfig.segments || [];
  const executionId = Date.now().toString();
  const allNodes = workflowConfig.nodes || [];
  const allEdges = workflowConfig.edges || [];
  const streamingInfo = findStreamingAINodes(allNodes, allEdges);
  const handledNodeIds = {};

  try {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.env === 'client') {
        const clientNodes = seg.nodes.filter(function(n) { return !handledNodeIds[n.id] && !(context.__skippedNodes && context.__skippedNodes[n.id]); });
        if (clientNodes.length > 0) {
          await utils.executeNodes(clientNodes, seg.edges, context, clientHandlers, workflowConfig, null, executionId);
        }
        // After a client segment with if-statements, mark non-taken branch
        // nodes in subsequent segments as skipped (same logic as server segments).
        var cSegIfNodes = seg.nodes.filter(function(n) { return n.type === 'general-if-statement' && context[n.id]; });
        for (var ci = 0; ci < cSegIfNodes.length; ci++) {
          var cIfNode = cSegIfNodes[ci];
          var cIfRes = context[cIfNode.id];
          if (typeof cIfRes.result === 'boolean') {
            var cSkipHandle = cIfRes.result ? 'false' : 'true';
            var cSkipEdge = allEdges.find(function(e) { return e.source === cIfNode.id && e.sourceHandle === cSkipHandle; });
            if (cSkipEdge) {
              var cSkipBranch = utils.collectBranchNodes(cSkipEdge.target, allNodes, allEdges, cIfNode.id);
              if (!context.__skippedNodes) context.__skippedNodes = {};
              for (var csk = 0; csk < cSkipBranch.length; csk++) {
                context.__skippedNodes[cSkipBranch[csk].id] = true;
              }
            }
          }
        }
        // After a client segment with switch nodes, mark non-matched branches as skipped.
        var cSegSwNodes = seg.nodes.filter(function(n) { return n.type === 'general-switch' && context[n.id]; });
        for (var csi = 0; csi < cSegSwNodes.length; csi++) {
          var cSwNode = cSegSwNodes[csi];
          var cSwRes = context[cSwNode.id];
          if (cSwRes && cSwRes.matchedCase !== undefined) {
            var cSwEdges = allEdges.filter(function(e) { return e.source === cSwNode.id; });
            cSwEdges.forEach(function(be) {
              var isMatched = (be.sourceHandle === 'switch' && be.data && be.data.caseId === cSwRes.matchedCase) ||
                              (cSwRes.matchedCase === 'default' && be.sourceHandle === 'default');
              if (!isMatched) {
                var cSwSkipBranch = utils.collectBranchNodes(be.target, allNodes, allEdges, cSwNode.id);
                if (!context.__skippedNodes) context.__skippedNodes = {};
                cSwSkipBranch.forEach(function(n) { context.__skippedNodes[n.id] = true; });
              }
            });
          }
        }
      } else if (seg.env === 'server') {
        // Skip entire server segment if all its nodes are in __skippedNodes
        if (context.__skippedNodes && seg.nodes.length > 0) {
          var allSkipped = seg.nodes.every(function(n) { return context.__skippedNodes[n.id]; });
          if (allSkipped) continue;
        }
        // Every node in this segment is fire-and-forget, so nothing downstream
        // can read anything it produces — dispatch it and keep going instead of
        // making the visitor wait for the database round trip. The route itself
        // still awaits each query before it responds; we simply ignore the
        // response. Errors are logged, never routed to the error handler:
        // the workflow already moved past this point.
        //
        // seg.fireAndForget is computed STATICALLY (every node in the segment
        // is a fire-and-forget data node). A segment that MIXES fire-and-forget
        // and awaited nodes stays blocking statically — but when branch
        // skipping has already eliminated the awaited nodes at runtime, only
        // fire-and-forget work remains, so the same "nothing downstream can
        // read it" guarantee holds for the nodes that will actually run. The
        // dynamic check below upgrades exactly that case.
        var segLiveNodes = seg.nodes.filter(function(n) { return !(context.__skippedNodes && context.__skippedNodes[n.id]); });
        var segIsFireAndForget = seg.fireAndForget ||
          (segLiveNodes.length > 0 && segLiveNodes.every(utils.isFireAndForgetNode));
        if (segIsFireAndForget) {
          const ffUrl = serverSegmentUrls[seg.id];
          if (!ffUrl) throw new Error('No server URL for segment: ' + seg.id);
          utils.registerPendingNodePromise(
            context,
            callServerSegment(ffUrl, context).catch(function(err) {
              console.error('[workflow] Segment "' + seg.id + '" failed (not awaited):', err);
            })
          );
          for (var ffi = 0; ffi < seg.nodes.length; ffi++) {
            // A node on a branch that was not taken must stay absent from the
            // context, exactly as it would if the segment had been awaited.
            if (context.__skippedNodes && context.__skippedNodes[seg.nodes[ffi].id]) continue;
            context[seg.nodes[ffi].id] = null;
          }
          context.__previousNodeResult = null;
          continue;
        }
        const hasStreaming = seg.hasStreamingAI || seg.nodes.some(function(n) {
          return streamingInfo[n.id];
        });

        if (hasStreaming) {
          const url = serverSegmentUrls[seg.id];
          if (!url) throw new Error('No server URL for segment: ' + seg.id);
          const newHandled = await callStreamingServerSegment(url, context, streamingInfo, allNodes, allEdges, clientHandlers, workflowConfig, executionId);
          Object.assign(handledNodeIds, newHandled);
        } else {
          const url = serverSegmentUrls[seg.id];
          if (!url) throw new Error('No server URL for segment: ' + seg.id);
          const serverResults = await callServerSegment(url, context);
          mergeServerResults(context, serverResults, workflowConfig.triggerNodeId);
          var segNodes = seg.nodes;
          if (segNodes && segNodes.length > 0 && serverResults) {
            var sortedSeg = segNodes.slice().sort(function(a, b) {
              return (a.stepNumber || 0) - (b.stepNumber || 0);
            });
            var lastSegNode = sortedSeg[sortedSeg.length - 1];
            if (lastSegNode && lastSegNode.id && serverResults[lastSegNode.id] !== undefined) {
              context.__previousNodeResult = serverResults[lastSegNode.id];
            }
            // Propagate non-taken if-statement branches from this server
            // segment into subsequent segments. We iterate every if-statement
            // in the segment (not just the last node), because mid-segment
            // if-statements followed by further nodes in the same segment
            // still affect downstream client/server segments. The BFS uses
            // workflow-wide edges so descendants in other segments are
            // marked too — the server's own BFS only sees segment-local
            // edges, so it cannot reach across segment boundaries.
            var segIfNodes = sortedSeg.filter(function(n) { return n.type === 'general-if-statement' && context[n.id]; });
            for (var sifi = 0; sifi < segIfNodes.length; sifi++) {
              var sifNode = segIfNodes[sifi];
              var sifRes = context[sifNode.id];
              if (sifRes && typeof sifRes.result === 'boolean') {
                var sifSkipHandle = sifRes.result ? 'false' : 'true';
                var sifSkipEdge = allEdges.find(function(e) { return e.source === sifNode.id && e.sourceHandle === sifSkipHandle; });
                if (sifSkipEdge) {
                  var sifSkipBranch = utils.collectBranchNodes(sifSkipEdge.target, allNodes, allEdges, sifNode.id);
                  if (!context.__skippedNodes) context.__skippedNodes = {};
                  for (var sifk = 0; sifk < sifSkipBranch.length; sifk++) {
                    context.__skippedNodes[sifSkipBranch[sifk].id] = true;
                  }
                }
              }
            }
            // When a server segment contains switch nodes, mark non-matched
            // branches as skipped so subsequent client segments honour them.
            var segSwitchNodes = sortedSeg.filter(function(n) { return n.type === 'general-switch' && serverResults && serverResults[n.id]; });
            for (var swsi = 0; swsi < segSwitchNodes.length; swsi++) {
              var swsNode = segSwitchNodes[swsi];
              var swsRes = context[swsNode.id];
              if (swsRes && swsRes.matchedCase !== undefined) {
                var swsEdges = allEdges.filter(function(e) { return e.source === swsNode.id; });
                swsEdges.forEach(function(be) {
                  var swsIsMatched = (be.sourceHandle === 'switch' && be.data && be.data.caseId === swsRes.matchedCase) ||
                                     (swsRes.matchedCase === 'default' && be.sourceHandle === 'default');
                  if (!swsIsMatched) {
                    var swsSkipBranch = utils.collectBranchNodes(be.target, allNodes, allEdges, swsNode.id);
                    if (!context.__skippedNodes) context.__skippedNodes = {};
                    swsSkipBranch.forEach(function(n) { context.__skippedNodes[n.id] = true; });
                  }
                });
              }
            }
          }
        }
      }
      // If ANY node in the current segment returned __terminal, stop processing.
      // The previous implementation only inspected __previousNodeResult, which
      // is the highest-stepNumber node's output. That breaks for workflows
      // that wire a payment-charge-user (terminal) at e.g. stepNumber 25 with
      // any downstream low-stock or email-template node at stepNumber 26-28 —
      // the terminal flag never reaches the runtime. The full sweep below
      // covers that case: payment-charge-user's __redirectUrl points the
      // buyer at the hosted Stripe/PayPal page even when the AI's UIDL
      // appended bookkeeping nodes after the charge step.
      var __terminalResult = null;
      if (context.__previousNodeResult && context.__previousNodeResult.__terminal) {
        __terminalResult = context.__previousNodeResult;
      } else {
        var __ctxKeys = Object.keys(context);
        for (var __ki = 0; __ki < __ctxKeys.length; __ki++) {
          var __v = context[__ctxKeys[__ki]];
          if (__v && typeof __v === 'object' && __v.__terminal === true) {
            __terminalResult = __v;
            break;
          }
        }
      }
      if (__terminalResult) {
        var __redirectUrl = __terminalResult.__redirectUrl;
        if (typeof __redirectUrl === 'string' && __redirectUrl.length > 0 && typeof window !== 'undefined' && window.location) {
          window.location.href = __redirectUrl;
        }
        break;
      }
    }
  } catch (error) {
    if (error.__skipErrorHandler || error.__rateLimited) {
      return context;
    }
    const errorHandler = findErrorHandlerNodes(workflowConfig);
    if (errorHandler) {
      context[workflowConfig.errorHandlerNodeId] = {
        error: { message: error.message || String(error), stack: error.stack || '' },
        errorMessage: error.message || String(error)
      };
      try {
        await utils.executeNodes(errorHandler.nodes, errorHandler.edges, context, clientHandlers, workflowConfig, null, executionId);
      } catch (innerErr) {
        console.error('Workflow error handler failed:', innerErr);
      }
    } else {
      throw error;
    }
  }

  return context;
}

module.exports = { executeWorkflowWithSegments, callServerSegment, callStreamingServerSegment, mergeServerResults, findStreamingAINodes };
`
}

export const generateServerRuntimeCode = (): string => {
  return `const utils = require('./runtime-utils');

module.exports = utils;
`
}
