import { IntegrationHandlerGenerator } from '../types'

const escapeForJsString = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')

// PAIRED EDIT: keep in sync with
//   teleport-services-worker/src/modules/workflow-node-runtime/node-handlers/integrations/_generic.ts
// The same auth-chain field names and provider-error recogniser must execute
// in both the test runtime and the published Next.js app.
const AUTH_FIELD_NAMES = [
  'apiKey',
  'token',
  'accessToken',
  'secretKey',
  'authorization',
  'apiToken',
  'authToken',
  'bearerToken',
  'oauthToken',
  'serverToken',
  'rapidApiKey',
  'projectToken',
  'tokenValue',
  'accessKeySecret',
  'writeKey',
]

/**
 * Generic server integration for WorkflowNodeType entries that use IntegrationNodeConfig.
 * Serialized handler embeds nodeType (no closure — required for generateHandler() string output).
 */
export function createGenericIntegration(
  nodeType: string,
  // Some providers (e.g. Linear, whose personal API keys are sent raw) do NOT
  // use the `Bearer ` Authorization scheme. Pass 'raw' to send the token
  // verbatim. Defaults to 'bearer'.
  authScheme: 'bearer' | 'raw' = 'bearer'
): IntegrationHandlerGenerator {
  const fnName = nodeType.replace(/-/g, '_')
  const ntLiteral = escapeForJsString(nodeType)
  const authFieldsLiteral = AUTH_FIELD_NAMES.map((f) => `'${f}'`).join(', ')
  const reservedLiteral = AUTH_FIELD_NAMES.map((f) => `${f}: true`).join(', ')
  const authPrefixLiteral = authScheme === 'raw' ? "''" : "'Bearer '"

  return {
    nodeType,
    executionEnv: 'server',
    secretFields: [...AUTH_FIELD_NAMES],
    generateHandler(): string {
      return `async function ${fnName}(config, context) {
  var nodeType = '${ntLiteral}';
  var AUTH_FIELDS = [${authFieldsLiteral}];
  function extractProviderError(data, text, status) {
    if (data && typeof data === 'object') {
      if (data.error && typeof data.error === 'object' && data.error.message) {
        var code = data.error.code ? ' [' + data.error.code + ']' : '';
        return data.error.message + code;
      }
      if (typeof data.message === 'string' && data.message) {
        if (data.more_info && typeof data.more_info === 'string') {
          return data.message + ' (' + data.more_info + ')';
        }
        if (Array.isArray(data.errors) && data.errors.length > 0) {
          var detail = data.errors.map(function (e) {
            return e && typeof e === 'object' ? (e.message || e.code || JSON.stringify(e)) : String(e);
          }).join('; ');
          return data.message + ': ' + detail;
        }
        return data.message;
      }
      if (Array.isArray(data.errorMessages) && data.errorMessages.length > 0) {
        return data.errorMessages.join('; ');
      }
      if (data.errors && typeof data.errors === 'object' && !Array.isArray(data.errors)) {
        var parts = Object.keys(data.errors).map(function (k) { return k + ': ' + data.errors[k]; });
        if (parts.length > 0) { return parts.join('; '); }
      }
      if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
        var first = data[0];
        if (typeof first.message === 'string') {
          var code2 = first.errorCode ? ' [' + first.errorCode + ']' : '';
          return first.message + code2;
        }
      }
    }
    var xmlMatch = text && typeof text === 'string' && text.indexOf('<Error>') !== -1 ? text.match(/<Message>([^<]+)<\\/Message>/) : null;
    if (xmlMatch && xmlMatch[1]) {
      var codeMatch = text.match(/<Code>([^<]+)<\\/Code>/);
      return codeMatch ? xmlMatch[1] + ' [' + codeMatch[1] + ']' : xmlMatch[1];
    }
    if (typeof text === 'string' && text) { return text; }
    return 'HTTP ' + status;
  }
  var action = config.action;
  if (!action) {
    throw new Error(nodeType + ': action is required');
  }
  var url = config.url;
  if (!url) {
    var base = config.baseUrl || config.apiUrl || config.endpoint;
    var path = config.path || '';
    if (base) {
      var b = String(base).replace(/\\/$/, '');
      url = path ? b + (String(path).charAt(0) === '/' ? path : '/' + path) : b;
    }
  }
  if (!url || typeof url !== 'string') {
    throw new Error(nodeType + ': configure url, or baseUrl/apiUrl/endpoint with path');
  }
  var method = (config.method || 'POST').toUpperCase();
  var headers = { 'Content-Type': 'application/json' };
  if (config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers)) {
    var hk = Object.keys(config.headers);
    for (var hi = 0; hi < hk.length; hi++) {
      headers[hk[hi]] = String(config.headers[hk[hi]]);
    }
  }
  var tok;
  for (var ai = 0; ai < AUTH_FIELDS.length; ai++) {
    if (config[AUTH_FIELDS[ai]]) { tok = config[AUTH_FIELDS[ai]]; break; }
  }
  if (tok && !headers['Authorization'] && !headers['authorization']) {
    headers['Authorization'] = ${authPrefixLiteral} + tok;
  }
  var body = undefined;
  var reserved = { action: true, outputVariable: true, url: true, method: true, headers: true, body: true,
    baseUrl: true, apiUrl: true, endpoint: true, path: true, ${reservedLiteral} };
  if (method !== 'GET' && method !== 'HEAD') {
    if (config.body !== undefined && config.body !== null) {
      body = typeof config.body === 'string' ? config.body : JSON.stringify(config.body);
    } else {
      var payload = {};
      var ck = Object.keys(config);
      for (var ci = 0; ci < ck.length; ci++) {
        if (!reserved[ck[ci]]) payload[ck[ci]] = config[ck[ci]];
      }
      if (Object.keys(payload).length > 0) body = JSON.stringify(payload);
    }
  } else {
    // GET / HEAD: append every non-reserved config key as a query-string
    // parameter so schema-declared params actually reach the upstream API.
    // Arrays serialize as repeated key=a&key=b; objects JSON-stringify.
    var ckg = Object.keys(config);
    var parts = [];
    for (var cgi = 0; cgi < ckg.length; cgi++) {
      var kg = ckg[cgi];
      if (reserved[kg]) continue;
      var vg = config[kg];
      if (vg === undefined || vg === null || vg === '') continue;
      if (Array.isArray(vg)) {
        for (var vi = 0; vi < vg.length; vi++) {
          var item = vg[vi];
          if (item === undefined || item === null || item === '') continue;
          parts.push(encodeURIComponent(kg) + '=' + encodeURIComponent(typeof item === 'object' ? JSON.stringify(item) : String(item)));
        }
        continue;
      }
      var ser = typeof vg === 'object' ? JSON.stringify(vg) : String(vg);
      parts.push(encodeURIComponent(kg) + '=' + encodeURIComponent(ser));
    }
    if (parts.length > 0) {
      url = url + (url.indexOf('?') === -1 ? '?' : '&') + parts.join('&');
    }
  }
  var res = await fetch(url, { method: method, headers: headers, body: body });
  var text = await res.text();
  var data;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    var errMsg = extractProviderError(data, text, res.status);
    return { success: false, error: errMsg, status: res.status, data: data };
  }
  return { success: true, data: data, action: action };
}`
    },
  }
}
