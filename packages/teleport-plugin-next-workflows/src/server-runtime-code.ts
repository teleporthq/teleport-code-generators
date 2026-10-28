import { CONFIGURED_NEXTAUTH_URL_EXPRESSION } from './configured-nextauth-url'
import { generateCommonJsSessionTokenResolverCode } from './session-cookie-resolver'
import { ROLE_OF_TOKEN_CODE } from './workflow-auth-generator'
import { SESSION_STAMP_KEY } from './session-revocation-generator'

/** How long a signed step result stays good: older ones are refused. */
export const SIGNED_RESULT_MAX_AGE_MS = 10 * 60 * 1000

/** How far ahead of a route's clock another instance's signature may be dated. */
export const SIGNED_RESULT_CLOCK_SKEW_MS = 60 * 1000

/** What a visitor is told when the run a step continues has expired (409). */
export const STEP_EXPIRED_MESSAGE = 'This took too long. Please start again.'

/**
 * `utils/workflows/server-runtime.js`: what every server route loads. It is the
 * shared runtime utilities plus the parts only a server may run — the signed
 * hand-off between server segments, the visitor's session identity and the
 * internal-call credential — so none of it reaches the browser bundle.
 *
 * WHY THE HAND-OFF IS SIGNED. A workflow runs as a chain of segments, and the
 * result of every server segment reaches the next one THROUGH the caller: the
 * browser holds the context between hops and posts it back. Without a check,
 * a crafted request could hand a later server segment any "result" of an
 * earlier one — an order marked valid, a password-reset token marked checked
 * — and the later segment acted on it. So:
 *
 * - Every result belongs to a RUN (`__sigRun`): one execution of the workflow.
 *   The first server segment of the graph opens it with a random id signed for
 *   this workflow; every later segment continues the run its request carries.
 * - `segmentReply` signs every result its segment produced (`__sig`, an HMAC
 *   keyed from NEXTAUTH_SECRET over the workflow, the producing segment, the
 *   run, the time of signing, the node id and the JSON value), and one link of
 *   the run's chain (`__sigOrder`): the order of the context's keys as the
 *   caller will hold them (`params` in custom JavaScript are read by
 *   position), the call's number in the run, and the signature of every result
 *   the caller may hand on, bound to the same workflow, run and time.
 * - `claimSegmentContext` puts the keys back in that signed order (a key the
 *   request left out keeps its slot, empty), empties every server result whose
 *   signature does not hold — another workflow's, another run's, one older
 *   than ten minutes, one the link does not list with that very signature (a
 *   result of another call of the same segment: a run is one chain) — drops
 *   custom-node and loop bookkeeping a request cannot legitimately carry,
 *   skips every node a server if / switch upstream did not choose (or whose
 *   decision is missing), and takes `__previousNodeResult` from the signed
 *   result of the server node that ran just before.
 *
 * WHO THE VISITOR IS comes from the session cookie, never from the request
 * body. `claimSegmentContext` drops whatever the request says about it and
 * leaves the reserved keys `__sessionUserId`, `__sessionRole` and
 * `__sessionUser` empty (and the page state's `currentUser` with them); a route
 * whose segment reads the visitor (SEGMENT_CONFIG.session) fills them from the
 * session with `bindSessionIdentity`, rebuilds the result of the graph's
 * current-user readers from them, binds the route's `userScoped` identity
 * columns, and — through `bindSessionHandlers` — binds those columns again
 * after the node that produces them runs inside the segment, and answers an
 * identity-filtered read with no rows when there is no identity to filter by.
 *
 * What the BROWSER itself computes stays untrusted by design; a server segment
 * that needs a trustworthy figure (a price, an owner) reads it from the
 * database itself.
 *
 * The facts about the graph each route needs are baked into its
 * SEGMENT_CONFIG at generation time (see segment-trust.ts).
 */
export const generateServerRuntimeCode = (
  options: { withSessionRevocation?: boolean } = {}
): string => `'use strict';
var crypto = require('crypto');
var utils = require('./runtime-utils');

var __stepKeyCache = { secret: null, key: null };

function stepKey() {
  var secret = process.env.NEXTAUTH_SECRET || '';
  if (__stepKeyCache.secret !== secret) {
    __stepKeyCache = {
      secret: secret,
      key: crypto.createHmac('sha256', secret).update('teleport-workflow-step:v1').digest()
    };
  }
  return __stepKeyCache.key;
}

function mac(text) {
  return crypto.createHmac('sha256', stepKey()).update(text).digest('hex');
}

// Without an app secret every key here would derive from '' — a value anyone
// can compute — so nothing verifies: relayed server results are dropped and no
// request passes as an internal call. (The generator gives every app with
// server routes a secret.)
function sameMac(given, expected) {
  if (!process.env.NEXTAUTH_SECRET) {
    return false;
  }
  if (typeof given !== 'string' || typeof expected !== 'string' || given.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isControlKey(key) {
  return key.indexOf('__') === 0;
}

// ---------------------------------------------------------------------------
// The signed hand-off
// ---------------------------------------------------------------------------

// A signed result is good for this long, and may be dated this far ahead of
// this instance's clock (another instance signed it).
var SIGNED_MAX_AGE_MS = ${SIGNED_RESULT_MAX_AGE_MS};
var SIGNED_CLOCK_SKEW_MS = ${SIGNED_RESULT_CLOCK_SKEW_MS};

function workflowIdOf(segmentConfig) {
  return segmentConfig && typeof segmentConfig.workflowId === 'string' ? segmentConfig.workflowId : '';
}

function segmentIdOf(segmentConfig) {
  return segmentConfig && typeof segmentConfig.segmentId === 'string' ? segmentConfig.segmentId : '';
}

// The segment of this graph that produces a node's result.
function producerOf(segmentConfig, nodeId) {
  var by = segmentConfig && segmentConfig.signedBy;
  return by && typeof by === 'object' && typeof by[nodeId] === 'string' ? by[nodeId] : '';
}

function runMac(workflowId, runId) {
  return mac(JSON.stringify(['run', 2, workflowId, runId]));
}

function openRun(workflowId) {
  var id = crypto.randomBytes(16).toString('hex');
  return { id: id, mac: runMac(workflowId, id) };
}

// The run the request continues, or null when it names none this workflow opened.
function readRun(workflowId, context) {
  var run = context.__sigRun;
  if (!run || typeof run !== 'object' || typeof run.id !== 'string' || !/^[0-9a-f]{32}$/.test(run.id)) {
    return null;
  }
  return sameMac(run.mac, runMac(workflowId, run.id)) ? { id: run.id, mac: run.mac } : null;
}

function isFresh(at, now) {
  return typeof at === 'number' && isFinite(at) && at <= now + SIGNED_CLOCK_SKEW_MS && now - at <= SIGNED_MAX_AGE_MS;
}

function resultMac(workflowId, segmentId, runId, at, nodeId, value) {
  var serialized;
  try { serialized = JSON.stringify(value); } catch (e) { return null; }
  if (serialized === undefined) return null;
  return mac(JSON.stringify(['result', 2, workflowId, segmentId, runId, at, nodeId, serialized]));
}

// A result's signature: '<when it was signed, ms>.<mac>'.
function signResult(workflowId, segmentId, run, at, nodeId, value) {
  var signature = resultMac(workflowId, segmentId, run.id, at, nodeId, value);
  return signature ? at + '.' + signature : null;
}

// 'valid', 'expired' (signed in this run, but too long ago or dated too far
// ahead) or 'invalid'.
function signatureVerdict(segmentConfig, run, nodeId, value, signature, now) {
  if (typeof signature !== 'string') return 'invalid';
  var dot = signature.indexOf('.');
  var stamp = dot > 0 ? signature.slice(0, dot) : '';
  if (!/^[0-9]{1,16}$/.test(stamp)) return 'invalid';
  var at = Number(stamp);
  var expected = resultMac(workflowIdOf(segmentConfig), producerOf(segmentConfig, nodeId), run.id, at, nodeId, value);
  if (!expected || !sameMac(signature.slice(dot + 1), expected)) return 'invalid';
  return isFresh(at, now) ? 'valid' : 'expired';
}

// The link of the run's chain one segment call signs: the order of the keys
// the caller will hold, the call's number in the run (\`n\`), and the
// signature of every result the caller may hand on — the ones this call was
// given and accepted, and its own. A later call accepts a relayed result only
// when its signature is the one the link it is given lists, so a run is one
// chain: a segment called twice in a run forks it, and no request can combine
// results of the two forks.
function orderMac(workflowId, runId, at, n, keys, sigs) {
  return mac(JSON.stringify(['order', 3, workflowId, runId, at, n, keys, sigs]));
}

var NO_ORDER = { keys: null, n: 0, sigs: {} };

// The link the request continues, as the last server segment of this run
// signed it; \`keys: null\` when the request carries no valid one (\`expired\`
// when it is this run's, signed too long ago).
function readSignedOrder(segmentConfig, run, context, now) {
  var order = context.__sigOrder;
  if (!order || typeof order !== 'object' || !Array.isArray(order.keys) || typeof order.at !== 'number') return NO_ORDER;
  if (typeof order.n !== 'number' || !(order.n >= 1) || Math.floor(order.n) !== order.n || !Array.isArray(order.sigs)) return NO_ORDER;
  for (var i = 0; i < order.keys.length; i++) {
    if (typeof order.keys[i] !== 'string' || isControlKey(order.keys[i])) return NO_ORDER;
  }
  var sigs = {};
  for (var s = 0; s < order.sigs.length; s++) {
    var pair = order.sigs[s];
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string' || has(sigs, pair[0])) return NO_ORDER;
    sigs[pair[0]] = pair[1];
  }
  if (!sameMac(order.mac, orderMac(workflowIdOf(segmentConfig), run.id, order.at, order.n, order.keys, order.sigs))) return NO_ORDER;
  if (!isFresh(order.at, now)) return { keys: null, n: 0, sigs: {}, expired: true };
  return { keys: order.keys, n: order.n, sigs: sigs };
}

function restoreOrder(context, keys) {
  var snapshot = {};
  var all = Object.keys(context);
  for (var i = 0; i < all.length; i++) {
    snapshot[all[i]] = context[all[i]];
    delete context[all[i]];
  }
  var placed = {};
  for (var c = 0; c < all.length; c++) {
    if (isControlKey(all[c])) {
      context[all[c]] = snapshot[all[c]];
      placed[all[c]] = true;
    }
  }
  for (var k = 0; k < keys.length; k++) {
    if (placed[keys[k]]) continue;
    context[keys[k]] = has(snapshot, keys[k]) ? snapshot[keys[k]] : undefined;
    placed[keys[k]] = true;
  }
  for (var r = 0; r < all.length; r++) {
    if (!placed[all[r]]) context[all[r]] = snapshot[all[r]];
  }
}

// Empties every relayed result whose signature does not hold — checked against
// the signature the link the request continues lists for it, never one the
// request supplies alongside — and returns { accepted, expired }: the
// signatures of the results it kept, and whether one of them was signed in this
// run but has expired.
function dropUnsignedResults(segmentConfig, run, context, order, now) {
  var ids = segmentConfig.signedNodeIds || [];
  var accepted = {};
  var expired = false;
  var listed = {};
  for (var o = 0; o < (order.keys || []).length; o++) listed[order.keys[o]] = true;
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    if (!has(context, id) || context[id] === undefined) continue;
    var signature = has(order.sigs, id) ? order.sigs[id] : null;
    var verdict = signature ? signatureVerdict(segmentConfig, run, id, context[id], signature, now) : 'invalid';
    if (verdict === 'expired') expired = true;
    if (!listed[id] || verdict !== 'valid') {
      context[id] = undefined;
    } else {
      accepted[id] = signature;
    }
  }
  return { accepted: accepted, expired: expired };
}

// What the visitor is told when the run they are continuing has expired (a
// step waited longer than a signed result is good for): start again.
var STEP_EXPIRED_MESSAGE = ${JSON.stringify(STEP_EXPIRED_MESSAGE)};

function expiredRunError() {
  var error = new Error('the signed results this request continues are older than ' + SIGNED_MAX_AGE_MS + ' ms');
  error.__tqPublic = { status: 409, message: STEP_EXPIRED_MESSAGE };
  return error;
}

function stripForeignControlKeys(segmentConfig, context) {
  if (!segmentConfig.customNodeIds) {
    delete context.__isInsideCustomNode;
    delete context.__customNodeIds;
    delete context.__customParams;
  }
  var bodies = segmentConfig.loopBodies || {};
  if (context.__loopNodeIds && typeof context.__loopNodeIds === 'object') {
    var keptLoops = {};
    Object.keys(context.__loopNodeIds).forEach(function(id) {
      if (has(bodies, id) && context.__loopNodeIds[id]) keptLoops[id] = true;
    });
    context.__loopNodeIds = keptLoops;
  } else {
    delete context.__loopNodeIds;
  }
  if (Array.isArray(context.__loopScopeStack)) {
    context.__loopScopeStack = context.__loopScopeStack
      .filter(function(scope) { return scope && typeof scope.loopNodeId === 'string' && has(bodies, scope.loopNodeId); })
      .map(function(scope) {
        var claimed = scope.bodyNodeIds && typeof scope.bodyNodeIds === 'object' ? scope.bodyNodeIds : {};
        var body = {};
        bodies[scope.loopNodeId].forEach(function(id) { if (claimed[id]) body[id] = true; });
        return { loopNodeId: scope.loopNodeId, bodyNodeIds: body };
      });
  } else {
    delete context.__loopScopeStack;
  }
}

function gateTook(gate, when, decision) {
  if (!decision || typeof decision !== 'object') return false;
  if (gate.kind === 'if') {
    return typeof decision.result === 'boolean' && when === (decision.result ? 'true' : 'false');
  }
  if (decision.matchedCase === undefined || decision.matchedCase === null) return false;
  if (when === 'default') return decision.matchedCase === 'default';
  return when === 'case:' + decision.matchedCase;
}

function enforceBranchGates(segmentConfig, context) {
  var gates = segmentConfig.branchGates || [];
  if (gates.length === 0) return;
  if (!context.__skippedNodes || typeof context.__skippedNodes !== 'object') context.__skippedNodes = {};
  for (var g = 0; g < gates.length; g++) {
    var gate = gates[g];
    var decision = context[gate.id];
    for (var b = 0; b < gate.branches.length; b++) {
      var branch = gate.branches[b];
      if (gateTook(gate, branch.when, decision)) continue;
      for (var n = 0; n < branch.nodeIds.length; n++) context.__skippedNodes[branch.nodeIds[n]] = true;
    }
  }
}

function resetPreviousResult(segmentConfig, context) {
  var from = segmentConfig.previousFrom;
  if (!from) return;
  if (from.fireAndForget) {
    context.__previousNodeResult = null;
    return;
  }
  var value = context[from.nodeId];
  context.__previousNodeResult = value !== undefined ? value : {};
}

// ---------------------------------------------------------------------------
// The visitor's identity, from the session cookie
// ---------------------------------------------------------------------------

${generateCommonJsSessionTokenResolverCode('../..', {
  withRevocation: options.withSessionRevocation !== false,
})}
${ROLE_OF_TOKEN_CODE}

// Reserved context keys: set here from the session, never read from a request.
var SESSION_KEYS = ['__sessionUserId', '__sessionRole', '__sessionUser'];

// What a decoded session token carries besides the user (see the session
// callback of the auth route, which leaves the same keys off session.user).
var SESSION_TOKEN_BOOKKEEPING = { iat: true, exp: true, jti: true, sub: true, __userRefreshedAt: true, ${SESSION_STAMP_KEY}: true };

// A session whose account changed its password (or session_version) since it
// was issued is no session: the shared reader runs that check for every server
// file (utils/auth/session-revocation.js).
function liveSessionToken(req) {
  return __tqSessionToken(req);
}

// The signed-in user as /api/auth/session describes it, or null for a guest.
function sessionUserOf(token) {
  if (!token || typeof token !== 'object') return null;
  var id = token.id != null ? token.id : (token.sub != null ? token.sub : null);
  if (id == null || String(id) === '') return null;
  var user = {
    name: token.name != null ? token.name : null,
    email: token.email != null ? token.email : null,
    image: token.picture != null ? token.picture : null
  };
  Object.keys(token).forEach(function(key) {
    if (!SESSION_TOKEN_BOOKKEEPING[key]) user[key] = token[key];
  });
  user.id = id;
  return user;
}

// The page state's \`currentUser\`, shaped as the app's global context keeps it.
function currentUserState(user) {
  var state = { id: null, name: null, email: null, emailVerified: null, image: null, role: null };
  Object.keys(user).forEach(function(key) { state[key] = user[key] != null ? user[key] : null; });
  return state;
}

// Every copy of the page state the request carries: the context's own and the
// trigger's (see pruneContext in the client runtime).
function eachStateBag(context, visit) {
  Object.keys(context).forEach(function(key) {
    var value = context[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (key === '__stateValues') {
      visit(value);
    } else if (value.__stateValues && typeof value.__stateValues === 'object' && !Array.isArray(value.__stateValues)) {
      visit(value.__stateValues);
    }
  });
}

// The \`currentUser\` the request's own copies of the page state held, put back
// before replying: the run reads the session's user, the reply never carries
// a rewritten copy of the trigger's page state back to the browser.
var __rewrittenStateBags = new WeakMap();

function setSessionIdentity(context, user, role) {
  context.__sessionUserId = user ? user.id : null;
  context.__sessionRole = user && typeof role === 'string' && role ? role : null;
  context.__sessionUser = user || null;
  var rewritten = __rewrittenStateBags.get(context) || [];
  eachStateBag(context, function(bag) {
    if (!has(bag, 'currentUser')) return;
    if (!rewritten.some(function(entry) { return entry.bag === bag; })) {
      rewritten.push({ bag: bag, original: bag.currentUser });
    }
    bag.currentUser = user ? currentUserState(user) : null;
  });
  __rewrittenStateBags.set(context, rewritten);
}

function restoreStateBags(context) {
  var rewritten = __rewrittenStateBags.get(context) || [];
  for (var i = 0; i < rewritten.length; i++) rewritten[i].bag.currentUser = rewritten[i].original;
}

function clearSessionIdentity(context) {
  for (var i = 0; i < SESSION_KEYS.length; i++) delete context[SESSION_KEYS[i]];
  setSessionIdentity(context, null, null);
}

// What a current-user reader answers for this session: the user's fields flat
// plus \`user\` (see account-get-current, account-refresh-session, account-login).
function identityResult(type, user, previous) {
  var out = {};
  if (user) Object.keys(user).forEach(function(key) { out[key] = user[key]; });
  out.user = user || null;
  if (type === 'account-refresh-session') {
    out.refreshed = !!(user && previous && previous.refreshed === true);
  }
  if (type === 'account-login') {
    out.success = !!user;
  }
  return out;
}

function bindPath(root, path, value) {
  if (!root || !path || path.length === 0) return;
  var obj = root;
  for (var i = 0; i < path.length - 1; i++) {
    var key = path[i];
    if (obj[key] == null || typeof obj[key] !== 'object') obj[key] = {};
    obj = obj[key];
  }
  obj[path[path.length - 1]] = value;
}

// The value a \`userScoped\` binding takes: the session's role for a role
// claim, the session user for every other one — and, for a signed-out visitor,
// '' whatever the claim. An identity value never comes from the request: a
// guest's own rows are still written under the anonymous id the data API takes
// from the run (\`__anonymousUserId\`, see data-create-item).
function sessionClaim(binding, context) {
  if (binding.claim === 'role') return { value: context.__sessionRole || '' };
  return { value: context.__sessionUserId != null ? context.__sessionUserId : '' };
}

function bindingsOf(segmentConfig) {
  var needs = segmentConfig && segmentConfig.session;
  return needs && Array.isArray(needs.bindings) ? needs.bindings : [];
}

function bindResult(bindings, nodeId, context, result) {
  var bound = result;
  for (var i = 0; i < bindings.length; i++) {
    var binding = bindings[i];
    if (!binding || binding.nodeId !== nodeId) continue;
    var claim = sessionClaim(binding, context);
    if (!claim) continue;
    if (bound == null || typeof bound !== 'object') bound = {};
    bindPath(bound, binding.path || [], claim.value);
  }
  return bound;
}

/**
 * Fills the reserved session keys from the request's session cookie, then
 * rebuilds what the segment reads about the visitor from them: the result of
 * every current-user reader the request carries, and every \`userScoped\`
 * identity column of a node outside this segment (a node of the segment is
 * bound when it has run — see bindSessionHandlers). Without a session the
 * identity is absent: nothing the request says stands in for it.
 */
async function bindSessionIdentity(req, segmentConfig, context) {
  var needs = segmentConfig && segmentConfig.session;
  if (!needs) return;
  var token = null;
  try { token = await liveSessionToken(req); } catch (e) { token = null; }
  var user = sessionUserOf(token);
  setSessionIdentity(context, user, user ? roleOf(token) : null);
  var readers = needs.identityNodes || {};
  Object.keys(readers).forEach(function(id) {
    if (has(context, id) && context[id] !== undefined && context[id] !== null) {
      context[id] = identityResult(readers[id], user, context[id]);
    }
  });
  var own = {};
  (segmentConfig.nodes || []).forEach(function(node) { own[node.id] = true; });
  var bindings = bindingsOf(segmentConfig);
  for (var i = 0; i < bindings.length; i++) {
    var nodeId = bindings[i] && bindings[i].nodeId;
    if (!nodeId || own[nodeId]) continue;
    context[nodeId] = bindResult([bindings[i]], nodeId, context, context[nodeId]);
  }
}

// What a filter value must be to scope a read to the visitor: present, and
// nothing the data node would read as "no filter" (empty, an all-sentinel, an
// unresolved template).
var NOT_AN_IDENTITY = { all: true, any: true, everything: true, __all__: true };

function isIdentityFilterValue(filter, value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== 'string') return true;
  var text = value.trim().toLowerCase();
  if (!text || NOT_AN_IDENTITY[text] || text.indexOf('{{') !== -1) return false;
  if (typeof filter.treatAsAll === 'string' && filter.treatAsAll.trim().toLowerCase() === text) return false;
  if (Array.isArray(filter.skipIfValue) && filter.skipIfValue.indexOf(value) !== -1) return false;
  return true;
}

function scopedToIdentity(columns, config) {
  var filters = config && Array.isArray(config.filters) ? config.filters : [];
  for (var c = 0; c < columns.length; c++) {
    var scoped = false;
    for (var f = 0; f < filters.length && !scoped; f++) {
      var filter = filters[f] && typeof filters[f] === 'object' ? filters[f] : {};
      // Read as data-select reads it: \`destination\` before \`value\`.
      var column = filter.column || filter.source || filter.field;
      var value = filter.destination !== undefined ? filter.destination : filter.value;
      scoped = column === columns[c] && isIdentityFilterValue(filter, value);
    }
    if (!scoped) return false;
  }
  return true;
}

/**
 * Wraps the route's node handlers so that a read the segment filters by the
 * visitor's identity answers no rows when there is no identity to filter by
 * (it never widens to the whole table), and the \`userScoped\` identity columns
 * of a node this segment runs take the session's value once it has run — a
 * step that recomputes them from what the request carries (a custom node's
 * parameters) cannot undo the binding.
 */
function bindSessionHandlers(segmentConfig, nodeHandlers) {
  var needs = segmentConfig && segmentConfig.session;
  if (!needs || !nodeHandlers) return nodeHandlers;
  var reads = needs.identityReads || {};
  var bindings = bindingsOf(segmentConfig);
  Object.keys(nodeHandlers).forEach(function(type) {
    var handler = nodeHandlers[type];
    var isRead = type === 'data-select' || type === 'data-count';
    if (typeof handler !== 'function' || (!isRead && bindings.length === 0)) return;
    nodeHandlers[type] = async function(config, context) {
      var nodeId = config && config.__nodeId;
      if (isRead && nodeId && has(reads, nodeId) && !scopedToIdentity(reads[nodeId], config)) {
        return type === 'data-count' ? { count: 0 } : { rows: [], count: 0 };
      }
      var result = await handler.apply(this, arguments);
      return nodeId && bindings.length > 0 ? bindResult(bindings, nodeId, context, result) : result;
    };
  });
  return nodeHandlers;
}

// ---------------------------------------------------------------------------
// Claiming a request, replying to it
// ---------------------------------------------------------------------------

// The keys the caller holds, in order, before this segment's own results were
// dropped — segmentReply appends what the run adds, exactly as the caller's
// merge will. And the run each claimed context belongs to.
var __incomingOrders = new WeakMap();
var __claimedRuns = new WeakMap();
// The link each claimed context continues: its call number and the relayed
// signatures it accepted.
var __claimedLinks = new WeakMap();

function claimSegmentContext(segmentConfig, context) {
  var now = Date.now();
  var workflowId = workflowIdOf(segmentConfig);
  var run = (!segmentConfig.opensRun && readRun(workflowId, context)) || openRun(workflowId);
  __claimedRuns.set(context, run);
  var order = readSignedOrder(segmentConfig, run, context, now);
  if (order.keys) restoreOrder(context, order.keys);
  var verdict = dropUnsignedResults(segmentConfig, run, context, order, now);
  if (verdict.expired || order.expired) throw expiredRunError();
  __claimedLinks.set(context, { n: order.keys ? order.n : 0, accepted: verdict.accepted });
  context.__sigRun = { id: run.id, mac: run.mac };
  // The route's own (see VISITOR_REQUEST_INJECTION); a request never sets it.
  delete context.__request;
  stripForeignControlKeys(segmentConfig, context);
  clearSessionIdentity(context);
  __incomingOrders.set(context, Object.keys(context).filter(function(k) { return !isControlKey(k); }));
  utils.claimSegmentContext(segmentConfig, context);
  enforceBranchGates(segmentConfig, context);
  resetPreviousResult(segmentConfig, context);
}

// A reply never names an env var the segment's configs reference
// (SEGMENT_CONFIG.secretNames) — a node's error result may quote one. Returns
// \`value\` itself when nothing in it changes.
// Only a name shaped like an env var, as a whole word: a secret named \`KEY\`
// never rewrites "MONKEY".
var ENV_NAME_SHAPE = /^[A-Za-z_][A-Za-z0-9_]{3,}$/;

function scrubSecretNames(segmentConfig, value) {
  var names = segmentConfig && Array.isArray(segmentConfig.secretNames) ? segmentConfig.secretNames : [];
  var patterns = [];
  for (var i = 0; i < names.length; i++) {
    if (typeof names[i] === 'string' && ENV_NAME_SHAPE.test(names[i])) {
      patterns.push(new RegExp('(^|[^A-Za-z0-9_])' + names[i] + '(?![A-Za-z0-9_])', 'g'));
    }
  }
  return patterns.length === 0 ? value : scrubValue(value, patterns, 0);
}

function scrubValue(value, patterns, depth) {
  if (typeof value === 'string') {
    var text = value;
    for (var i = 0; i < patterns.length; i++) {
      patterns[i].lastIndex = 0;
      text = text.replace(patterns[i], '$1[secret]');
    }
    return text;
  }
  if (!value || typeof value !== 'object' || depth > 32) return value;
  var copy = null;
  var keys = Object.keys(value);
  for (var k = 0; k < keys.length; k++) {
    var before = value[keys[k]];
    var after = scrubValue(before, patterns, depth + 1);
    if (after !== before) {
      if (!copy) copy = Array.isArray(value) ? value.slice() : Object.assign({}, value);
      copy[keys[k]] = after;
    }
  }
  return copy || value;
}

function segmentReply(segmentConfig, context, snapshot) {
  restoreStateBags(context);
  var reply = scrubSecretNames(segmentConfig, utils.segmentReply(segmentConfig, context, snapshot));
  var workflowId = workflowIdOf(segmentConfig);
  var segmentId = segmentIdOf(segmentConfig);
  var run = __claimedRuns.get(context) || openRun(workflowId);
  var link = __claimedLinks.get(context) || { n: 0, accepted: {} };
  var at = Date.now();
  // What the next call may accept: the results this one accepted, and its own.
  var sigs = {};
  Object.keys(link.accepted).forEach(function(id) {
    if (has(reply, id) || has(context, id)) sigs[id] = link.accepted[id];
  });
  var nodes = segmentConfig.nodes || [];
  for (var i = 0; i < nodes.length; i++) {
    var id = nodes[i].id;
    if (!has(reply, id) || reply[id] === undefined) continue;
    var signature = signResult(workflowId, segmentId, run, at, id, reply[id]);
    if (signature) sigs[id] = signature; else delete sigs[id];
  }
  reply.__sig = sigs;
  reply.__sigRun = { id: run.id, mac: run.mac };
  var keys = (__incomingOrders.get(context) || []).slice();
  var listed = {};
  keys.forEach(function(k) { listed[k] = true; });
  Object.keys(reply).forEach(function(k) {
    if (!isControlKey(k) && !listed[k]) {
      keys.push(k);
      listed[k] = true;
    }
  });
  var n = link.n + 1;
  var pairs = Object.keys(sigs).sort().map(function(id) { return [id, sigs[id]]; });
  reply.__sigOrder = { keys: keys, at: at, n: n, sigs: pairs, mac: orderMac(workflowId, run.id, at, n, keys, pairs) };
  return reply;
}

// A call one of this deployment's server routes makes to another (a webhook
// or cron running a custom node's server segments). Only server code can mint
// the token, so a route that must never be called from a browser checks it.
function internalCallToken() {
  return mac('internal-call|v1');
}

function isInternalCall(req) {
  var given = req && req.headers ? req.headers['x-teleport-internal'] : '';
  return typeof given === 'string' && sameMac(given, internalCallToken());
}

function internalRequestHeaders(req) {
  var headers = utils.internalRequestHeaders(req);
  headers['x-teleport-internal'] = internalCallToken();
  return headers;
}

function isLoopbackHost(host) {
  var name = String(host || '').replace(/:[0-9]+$/, '').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]';
}

// The origin this deployment calls its own API routes on. On Vercel the
// request's host is the domain Vercel routed to this deployment; anywhere
// else the Host header is whatever the caller sent, so the canonical
// NEXTAUTH_URL wins when it is set — internal calls carry credentials, and
// they must never go to a host a request named. (A local development server
// on another port than NEXTAUTH_URL's keeps its own loopback address.) The
// value read is the configured one, kept before the auth route rewrites
// process.env.NEXTAUTH_URL from a request's headers (globalThis.__tqConfiguredNextAuthUrl).
function trustedBaseUrl(req) {
  var headers = (req && req.headers) || {};
  var host = headers.host || '';
  var proto = headers['x-forwarded-proto'] || (isLoopbackHost(host) ? 'http' : 'https');
  var requestOrigin = String(proto).split(',')[0].trim() + '://' + host;
  if (process.env.VERCEL) return requestOrigin;
  var configured = String(${CONFIGURED_NEXTAUTH_URL_EXPRESSION} || '').trim();
  if (!configured) return requestOrigin;
  var origin;
  try { origin = new URL(configured).origin; } catch (e) { return requestOrigin; }
  if (isLoopbackHost(host) && isLoopbackHost(new URL(origin).host)) return requestOrigin;
  return origin;
}

module.exports = Object.assign({}, utils, {
  claimSegmentContext: claimSegmentContext,
  segmentReply: segmentReply,
  bindSessionIdentity: bindSessionIdentity,
  bindSessionHandlers: bindSessionHandlers,
  scrubSecretNames: scrubSecretNames,
  internalRequestHeaders: internalRequestHeaders,
  isInternalCall: isInternalCall,
  trustedBaseUrl: trustedBaseUrl
});
`
