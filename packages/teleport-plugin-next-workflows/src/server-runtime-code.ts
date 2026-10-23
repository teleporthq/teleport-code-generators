/**
 * `utils/workflows/server-runtime.js`: what every server route loads. It is the
 * shared runtime utilities plus the parts only a server may run — the signed
 * hand-off between server segments and the internal-call credential — so none
 * of it reaches the browser bundle.
 *
 * WHY THE HAND-OFF IS SIGNED. A workflow runs as a chain of segments, and the
 * result of every server segment reaches the next one THROUGH the caller: the
 * browser holds the context between hops and posts it back. Without a check,
 * a crafted request could hand a later server segment any "result" of an
 * earlier one — an order marked valid, a password-reset token marked checked
 * — and the later segment acted on it. So:
 *
 * - `segmentReply` signs every result its segment produced (`__sig`, an HMAC
 *   keyed from NEXTAUTH_SECRET over the node id and the JSON value) and the
 *   order of the context's keys as the caller will hold them (`__sigOrder`),
 *   since `params` in custom JavaScript are read by position.
 * - `claimSegmentContext` puts the keys back in that signed order (a key the
 *   request left out keeps its slot, empty), empties every server result
 *   whose signature does not hold or that the signed order does not list,
 *   drops custom-node and loop bookkeeping a request cannot legitimately
 *   carry, skips every node a server if / switch upstream did not choose
 *   (or whose decision is missing), and takes `__previousNodeResult` from the
 *   signed result of the server node that ran just before.
 *
 * What the BROWSER itself computes stays untrusted by design; a server segment
 * that needs a trustworthy figure (a price, an owner) reads it from the
 * database itself.
 *
 * A result that is a credential (a password hash, see credential-results.ts)
 * makes the same trip SEALED: `segmentReply` replies it encrypted with a key
 * derived from NEXTAUTH_SECRET (AES-256-GCM) and signs the sealed form, and
 * `claimSegmentContext` opens every sealed value a request hands it (a
 * relayed result once its signature holds). The browser relays it without
 * ever reading it, and a later segment's reply hands back the sealed form,
 * never the opened one.
 *
 * The facts about the graph each route needs are baked into its
 * SEGMENT_CONFIG at generation time (see segment-trust.ts).
 */
export const generateServerRuntimeCode = (): string => `'use strict';
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

var __sealKeyCache = { secret: null, key: null };

function sealKey() {
  var secret = process.env.NEXTAUTH_SECRET || '';
  if (__sealKeyCache.secret !== secret) {
    __sealKeyCache = {
      secret: secret,
      key: crypto.createHmac('sha256', secret).update('teleport-workflow-seal:v1').digest()
    };
  }
  return __sealKeyCache.key;
}

var SEAL_IV_BYTES = 12;
var SEAL_TAG_BYTES = 16;

var SEAL_AAD = Buffer.from('teleport-workflow-sealed-result:v1', 'utf8');

// The sealed form of a credential result; undefined (the result is then not
// replied at all) without an app secret, whose key anyone could derive.
function sealResult(value) {
  if (!process.env.NEXTAUTH_SECRET) return undefined;
  var serialized;
  try { serialized = JSON.stringify(value); } catch (e) { return undefined; }
  if (serialized === undefined) return undefined;
  var iv = crypto.randomBytes(SEAL_IV_BYTES);
  var cipher = crypto.createCipheriv('aes-256-gcm', sealKey(), iv);
  cipher.setAAD(SEAL_AAD);
  var data = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
  return { __sealed: Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64') };
}

function isSealedResult(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.__sealed === 'string' && Object.keys(value).length === 1;
}

// { value } when the sealed form opens under this app's key, else null.
function openSealedResult(sealed) {
  if (!process.env.NEXTAUTH_SECRET) return null;
  try {
    var raw = Buffer.from(sealed.__sealed, 'base64');
    if (raw.length <= SEAL_IV_BYTES + SEAL_TAG_BYTES) return null;
    var decipher = crypto.createDecipheriv('aes-256-gcm', sealKey(), raw.subarray(0, SEAL_IV_BYTES));
    decipher.setAAD(SEAL_AAD);
    decipher.setAuthTag(raw.subarray(SEAL_IV_BYTES, SEAL_IV_BYTES + SEAL_TAG_BYTES));
    var data = Buffer.concat([decipher.update(raw.subarray(SEAL_IV_BYTES + SEAL_TAG_BYTES)), decipher.final()]);
    return { value: JSON.parse(data.toString('utf8')) };
  } catch (e) {
    return null;
  }
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

function resultMac(nodeId, value) {
  var serialized;
  try { serialized = JSON.stringify(value); } catch (e) { return null; }
  if (serialized === undefined) return null;
  return mac('result|' + nodeId + '|' + serialized);
}

function orderMac(keys) {
  return mac('order|' + JSON.stringify(keys));
}

// The order the caller holds its keys in, as the last server segment signed
// it; null when the request carries no valid signed order.
function readSignedOrder(context) {
  var order = context.__sigOrder;
  if (!order || typeof order !== 'object' || !Array.isArray(order.keys)) return null;
  for (var i = 0; i < order.keys.length; i++) {
    if (typeof order.keys[i] !== 'string' || isControlKey(order.keys[i])) return null;
  }
  return sameMac(order.mac, orderMac(order.keys)) ? order.keys : null;
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

function dropUnsignedResults(segmentConfig, context, orderKeys) {
  var ids = segmentConfig.signedNodeIds || [];
  if (ids.length === 0) return;
  var listed = {};
  for (var o = 0; o < (orderKeys || []).length; o++) listed[orderKeys[o]] = true;
  var sigs = context.__sig && typeof context.__sig === 'object' && !Array.isArray(context.__sig) ? context.__sig : {};
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    if (!has(context, id) || context[id] === undefined) continue;
    var expected = resultMac(id, context[id]);
    if (!listed[id] || !expected || !sameMac(sigs[id], expected)) {
      context[id] = undefined;
    }
  }
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

// The keys the caller holds, in order, before this segment's own results were
// dropped — segmentReply appends what the run adds, exactly as the caller's
// merge will.
var __incomingOrders = new WeakMap();

// The sealed results this segment opened, so its reply hands the caller back
// the sealed form it relayed (see resealRelayedResults).
var __openedResults = new WeakMap();

// Opens every sealed value the request hands this segment, so its nodes read
// the credential itself: a relayed server result (whose signature
// dropUnsignedResults checked first), or a value the browser holds from one
// (a custom node's output, the previous result). Only this app's server
// seals, so what opens is what it sealed.
function openSealedResults(context) {
  var opened = [];
  Object.keys(context).forEach(function(key) {
    if (isControlKey(key) && key !== '__previousNodeResult') return;
    if (!isSealedResult(context[key])) return;
    var result = openSealedResult(context[key]);
    if (!result) return;
    opened.push({ sealed: context[key], value: result.value });
    context[key] = result.value;
  });
  __openedResults.set(context, opened);
}

// Every reply entry that is an opened value (the value itself, or the previous
// result taken from it) goes back sealed.
function resealRelayedResults(context, reply) {
  var opened = __openedResults.get(context) || [];
  if (opened.length === 0) return;
  Object.keys(reply).forEach(function(key) {
    for (var i = 0; i < opened.length; i++) {
      if (reply[key] === opened[i].value) {
        reply[key] = opened[i].sealed;
        return;
      }
    }
  });
}

function claimSegmentContext(segmentConfig, context) {
  var orderKeys = readSignedOrder(context);
  if (orderKeys) restoreOrder(context, orderKeys);
  dropUnsignedResults(segmentConfig, context, orderKeys);
  openSealedResults(context);
  stripForeignControlKeys(segmentConfig, context);
  __incomingOrders.set(context, Object.keys(context).filter(function(k) { return !isControlKey(k); }));
  utils.claimSegmentContext(segmentConfig, context);
  enforceBranchGates(segmentConfig, context);
  resetPreviousResult(segmentConfig, context);
}

function segmentReply(segmentConfig, context, snapshot) {
  var reply = utils.segmentReply(segmentConfig, context, snapshot);
  resealRelayedResults(context, reply);
  var credentialIds = utils.credentialResultNodeIds(segmentConfig);
  Object.keys(credentialIds).forEach(function(id) {
    if (context[id] === undefined) return;
    var sealed = sealResult(context[id]);
    if (sealed) reply[id] = sealed;
  });
  var sigs = {};
  var incoming = context.__sig && typeof context.__sig === 'object' && !Array.isArray(context.__sig) ? context.__sig : {};
  Object.keys(incoming).forEach(function(id) {
    if (typeof incoming[id] === 'string') sigs[id] = incoming[id];
  });
  var nodes = segmentConfig.nodes || [];
  for (var i = 0; i < nodes.length; i++) {
    var id = nodes[i].id;
    if (!has(reply, id) || reply[id] === undefined) continue;
    var signature = resultMac(id, reply[id]);
    if (signature) sigs[id] = signature; else delete sigs[id];
  }
  reply.__sig = sigs;
  var keys = (__incomingOrders.get(context) || []).slice();
  var listed = {};
  keys.forEach(function(k) { listed[k] = true; });
  Object.keys(reply).forEach(function(k) {
    if (!isControlKey(k) && !listed[k]) {
      keys.push(k);
      listed[k] = true;
    }
  });
  reply.__sigOrder = { keys: keys, mac: orderMac(keys) };
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
// on another port than NEXTAUTH_URL's keeps its own loopback address.)
function trustedBaseUrl(req) {
  var headers = (req && req.headers) || {};
  var host = headers.host || '';
  var proto = headers['x-forwarded-proto'] || (isLoopbackHost(host) ? 'http' : 'https');
  var requestOrigin = String(proto).split(',')[0].trim() + '://' + host;
  if (process.env.VERCEL) return requestOrigin;
  var configured = String(process.env.NEXTAUTH_URL || '').trim();
  if (!configured) return requestOrigin;
  var origin;
  try { origin = new URL(configured).origin; } catch (e) { return requestOrigin; }
  if (isLoopbackHost(host) && isLoopbackHost(new URL(origin).host)) return requestOrigin;
  return origin;
}

module.exports = Object.assign({}, utils, {
  claimSegmentContext: claimSegmentContext,
  segmentReply: segmentReply,
  internalRequestHeaders: internalRequestHeaders,
  isInternalCall: isInternalCall,
  trustedBaseUrl: trustedBaseUrl
});
`
