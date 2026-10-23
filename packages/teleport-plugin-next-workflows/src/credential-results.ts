import { nodeRegistry } from './nodes'

/**
 * The node types whose result is a credential, read off the node registry
 * (`resultIsCredential`): today the password-hashing node. Its result stays on
 * the server. A server segment replies it to the browser only sealed —
 * encrypted with a key derived from the app secret, signed like every other
 * result — and a later server segment opens it again, so a workflow that
 * hashes in one segment and writes in another still works (see the server
 * runtime: `sealResult`, `openSealedResults`).
 */
export const CREDENTIAL_RESULT_NODE_TYPES: string[] = Object.keys(nodeRegistry).filter(
  (nodeType) => nodeRegistry[nodeType].resultIsCredential === true
)

/**
 * `credentialResultNodeIds(segmentConfig)`: the nodes of a segment whose
 * result is a credential — every node of a credential type, and every map
 * loop whose results are such a node's results (the loop's last body step, as
 * the route runs it; a loop of loops follows its inner loop).
 */
export const generateCredentialResultsCode = (): string => `
var __CREDENTIAL_RESULT_NODE_TYPES = ${JSON.stringify(CREDENTIAL_RESULT_NODE_TYPES)};

function lastLoopBodyNodeId(loopId, sortedNodes, edges) {
  var start = edges.find(function(e) { return e.source === loopId && e.sourceHandle === 'loop'; });
  if (!start) return null;
  var body = {};
  var queue = [start.target];
  while (queue.length > 0) {
    var current = queue.shift();
    if (body[current] || current === loopId) continue;
    body[current] = true;
    edges.forEach(function(e) {
      if (e.source === current && (e.sourceHandle === 'loop-body-out' || !e.sourceHandle) && e.target !== loopId) {
        queue.push(e.target);
      }
    });
  }
  var last = null;
  sortedNodes.forEach(function(n) { if (body[n.id]) last = n.id; });
  return last;
}

function credentialResultNodeIds(segmentConfig) {
  var nodes = (segmentConfig && segmentConfig.nodes) || [];
  var edges = (segmentConfig && segmentConfig.edges) || [];
  var ids = {};
  nodes.forEach(function(n) {
    if (__CREDENTIAL_RESULT_NODE_TYPES.indexOf(n.type) !== -1) ids[n.id] = true;
  });
  var sortedNodes = nodes.slice().sort(function(a, b) { return (a.stepNumber || 0) - (b.stepNumber || 0); });
  var mapLoops = nodes.filter(function(n) {
    var loopType = n.config && n.config.loopType;
    return n.type === 'general-loop' && !!loopType && loopType !== 'forEach';
  });
  var grew = true;
  while (grew) {
    grew = false;
    mapLoops.forEach(function(loop) {
      if (ids[loop.id]) return;
      var last = lastLoopBodyNodeId(loop.id, sortedNodes, edges);
      if (last && ids[last]) {
        ids[loop.id] = true;
        grew = true;
      }
    });
  }
  return ids;
}
`
