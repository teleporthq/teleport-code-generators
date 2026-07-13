import {
  UIDLWorkflow,
  UIDLWorkflowNode,
  UIDLWorkflowEdge,
  UIDLWebhookConfig,
  UIDLCustomWorkflowNode,
} from '@teleporthq/teleport-types'
import { WorkflowSegment } from './types'
import { nodeRegistry } from './nodes'
import { resolveHandlerEntryName } from './nodes/types'
import { AI_NODE_TYPES } from './graph-utils'
import {
  generateGetRawBodyCode,
  generateAllSignatureVerificationCode,
} from './webhook-signature-verification'

// Workflow/segment names, cron schedules, and webhook paths are free-form
// UIDL data — never guaranteed not to contain `*/`. Every generated route
// file opens with a `/** ... */` JSDoc header interpolating these values
// directly; an ORDINARY cron schedule like `*/5 * * * *` contains `*/` and
// would prematurely close that comment block, corrupting the rest of the
// generated file's syntax (the very first statement after the header would
// silently become live code instead of a comment, or a dangling `*` token
// breaks parsing outright). Breaking up any `*/` sequence keeps the comment
// intact; this is purely cosmetic (header text only, never evaluated).
const sanitizeForBlockComment = (value: string): string => value.replace(/\*\//g, '* /')

export const generateServerSegmentAPIRoute = (
  segment: WorkflowSegment,
  workflowName?: string
): string => {
  const usedNodeTypes = new Set(segment.nodes.map((n) => n.type))
  const nodeHandlersEntries = generateNodeHandlersForSegment(usedNodeTypes, true)
  const hasRateLimiter = usedNodeTypes.has('general-rate-limiter')

  const segmentConfig = JSON.stringify(
    {
      nodes: segment.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        config: n.config,
        stepNumber: n.stepNumber,
        label: n.label,
      })),
      edges: segment.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        data: e.data,
      })),
    },
    null,
    2
  )

  const header = workflowName
    ? `/**
 * Workflow Server Segment API Route
 * Workflow: ${sanitizeForBlockComment(workflowName)}
 * Segment ID: ${sanitizeForBlockComment(segment.id)}
 */
`
    : `/**
 * Workflow Server Segment API Route
 * Segment ID: ${sanitizeForBlockComment(segment.id)}
 */
`

  const requestInjection = hasRateLimiter
    ? `\n    context.__request = { ip: __getClientIp(req), headers: req.headers || {} };`
    : ''

  return `${header}
const utils = require('../../../utils/workflows/server-runtime');
const resolveConfig = utils.resolveConfig;

const SEGMENT_CONFIG = ${segmentConfig};

const nodeHandlers = {
${nodeHandlersEntries}
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const incomingContext = body.context || {};

    const context = Object.assign({}, incomingContext);${requestInjection}
    var __proto = req.headers['x-forwarded-proto'] || (req.headers.host && (req.headers.host.startsWith('localhost') || req.headers.host.startsWith('127.0.0.1')) ? 'http' : 'https');
    context.__baseUrl = __proto + '://' + req.headers.host;
    const sortedNodes = SEGMENT_CONFIG.nodes.slice().sort(function(a, b) { return a.stepNumber - b.stepNumber; });

    for (let i = 0; i < sortedNodes.length; i++) {
      const node = sortedNodes[i];
      const resolved = resolveConfig(node.config, context);
      resolved.__nodeId = node.id;

      // If-statement nodes must be evaluated using the runtime's evaluateCondition
      // rather than the stub handler, which always returns { result: true }.
      // After evaluating, mark the non-taken branch nodes as skipped.
      if (node.type === 'general-if-statement') {
        const condResult = utils.evaluateCondition(resolved, context);
        context[node.id] = { result: condResult };
        var skipHandle = condResult ? 'false' : 'true';
        var segEdgesIf = SEGMENT_CONFIG.edges || [];
        var skipEdge = segEdgesIf.find(function(e) { return e.source === node.id && e.sourceHandle === skipHandle; });
        if (skipEdge) {
          // BFS to collect all nodes in the non-taken branch
          var skipIds = {};
          var skipQueue = [skipEdge.target];
          while (skipQueue.length > 0) {
            var sid = skipQueue.shift();
            if (skipIds[sid] || sid === node.id) continue;
            skipIds[sid] = true;
            segEdgesIf.forEach(function(e) {
              if (e.source === sid && !skipIds[e.target] && e.target !== node.id) skipQueue.push(e.target);
            });
          }
          if (!context.__skippedNodes) context.__skippedNodes = {};
          Object.assign(context.__skippedNodes, skipIds);
        }
        continue;
      }

      // Skip nodes that were marked as belonging to a non-taken if-statement branch
      if (context.__skippedNodes && context.__skippedNodes[node.id]) continue;

      // Loop nodes must be handled specially: iterate over the collection,
      // execute loop body nodes for each item, then continue after the loop.
      if (node.type === 'general-loop') {
        const loopEdges = SEGMENT_CONFIG.edges.filter(function(e) { return e.source === node.id; });
        const loopBodyEdge = loopEdges.find(function(e) { return e.sourceHandle === 'loop'; });
        const exitEdge = loopEdges.find(function(e) { return e.sourceHandle === 'exit'; });

        // Collect loop body node IDs by following loop-body edges
        const bodyNodeIds = {};
        if (loopBodyEdge) {
          const queue = [loopBodyEdge.target];
          while (queue.length > 0) {
            const nid = queue.shift();
            if (bodyNodeIds[nid] || nid === node.id) continue;
            bodyNodeIds[nid] = true;
            SEGMENT_CONFIG.edges.forEach(function(e) {
              if (e.source === nid && (e.sourceHandle === 'loop-body-out' || !e.sourceHandle)) {
                if (e.target !== node.id) queue.push(e.target);
              }
            });
          }
        }
        const bodyNodes = sortedNodes.filter(function(n) { return bodyNodeIds[n.id]; });
        // For loopType=map, the schema (general-loop in node-context-schemas.json)
        // defines results as the array of last body node outputs (same as
        // Array.prototype.map). Pick the last body node so downstream nodes
        // (e.g. state-update-global-state) consume the transformed value
        // instead of the per-iteration scaffolding object.
        const __loopType = resolved.loopType || 'forEach';
        const __lastBodyNode = bodyNodes[bodyNodes.length - 1];

        // Resolve the collection to iterate over. unwrapWorkflowCollection
        // handles the common envelope shape that helper nodes return —
        // transform-array { result, ... }, integration-airtable { records, ... },
        // utility-semantic-search { matches, ... } — by unwrapping a single
        // array property when the upstream binding pointed at the parent node
        // instead of the inner field. See runtime-utils for the full rules.
        var collection = utils.unwrapWorkflowCollection(resolved.collection);
        var loopResults = [];

        // Track this loop's body scope so general-custom-js (and any handler
        // that consults the scope stack) can build the params / innerParams
        // arrays the workflow editor advertises: params = nodes BEFORE the
        // outermost loop, innerParamsN = nodes inside the loop at depth N.
        if (!context.__loopScopeStack) context.__loopScopeStack = [];
        context.__loopScopeStack.push({ loopNodeId: node.id, bodyNodeIds: bodyNodeIds });
        // Persistent registry of every loop scaffold node we've entered, so
        // a sibling that runs AFTER an inner loop completes still recognises
        // that inner loop id as scaffolding (not as a regular workflow node).
        if (!context.__loopNodeIds) context.__loopNodeIds = {};
        context.__loopNodeIds[node.id] = true;

        for (var li = 0; li < collection.length; li++) {
          context[node.id] = { currentItem: collection[li], currentIndex: li, iterations: li + 1 };
          for (var bi = 0; bi < bodyNodes.length; bi++) {
            var bNode = bodyNodes[bi];
            var bResolved = resolveConfig(bNode.config, context);
            bResolved.__nodeId = bNode.id;
            if (bNode.type === 'general-if-statement') {
              context[bNode.id] = { result: utils.evaluateCondition(bResolved, context) };
              continue;
            }
            var bHandler = nodeHandlers[bNode.type];
            if (!bHandler) continue;
            var bResult = await bHandler(bResolved, context);
            if (bResult && (bResult.success === false || (typeof bResult.error === 'string' && bResult.error))) {
              throw new Error(bResult.error || 'Loop body node execution failed');
            }
            context[bNode.id] = bResult;
          }
          if (__loopType === 'map') {
            loopResults.push(__lastBodyNode ? context[__lastBodyNode.id] : context[node.id]);
          }
        }

        context.__loopScopeStack.pop();

        context[node.id] = { completed: true, iterations: collection.length, results: loopResults };
        // Store body node IDs so the outer loop can skip them
        if (!context.__loopBodyNodeIds) context.__loopBodyNodeIds = {};
        Object.assign(context.__loopBodyNodeIds, bodyNodeIds);
        continue;
      }

      // Skip nodes that were part of a loop body (already executed inside the loop)
      if (context.__loopBodyNodeIds && context.__loopBodyNodeIds[node.id]) continue;

      // Switch nodes evaluate a value, match a case, execute that branch, skip all others
      if (node.type === 'general-switch') {
        var switchVal = utils.resolveValue(resolved.switchValue, context);
        var switchCases = resolved.cases || [];
        var matchedCase = 'default';
        for (var swci = 0; swci < switchCases.length; swci++) {
          var caseVal = utils.resolveValue(switchCases[swci].condition, context);
          if (resolved.comparisonMode === 'expression') {
            try { if (new Function('value', 'context', 'return (' + caseVal + ')')(switchVal, context)) { matchedCase = switchCases[swci].id; break; } } catch(e) {}
          } else {
            if (switchVal === caseVal) { matchedCase = switchCases[swci].id; break; }
          }
        }
        context[node.id] = { matchedCase: matchedCase };
        var segSwitchEdges = SEGMENT_CONFIG.edges || [];
        var allSwitchBranchEdges = segSwitchEdges.filter(function(e) { return e.source === node.id; });
        allSwitchBranchEdges.forEach(function(be) {
          var isMatched = (be.sourceHandle === 'switch' && be.data && be.data.caseId === matchedCase) ||
                          (matchedCase === 'default' && be.sourceHandle === 'default');
          if (!isMatched) {
            var swSkipQueue = [be.target];
            while (swSkipQueue.length > 0) {
              var swSid = swSkipQueue.shift();
              if (!swSid || swSid === node.id) continue;
              if (!context.__skippedNodes) context.__skippedNodes = {};
              if (context.__skippedNodes[swSid]) continue;
              context.__skippedNodes[swSid] = true;
              segSwitchEdges.forEach(function(e) {
                if (e.source === swSid && e.target !== node.id) swSkipQueue.push(e.target);
              });
            }
          }
        });
        continue;
      }

      // Parallel nodes execute multiple branches concurrently then merge results
      if (node.type === 'general-parallel') {
        var parallelEdges = SEGMENT_CONFIG.edges.filter(function(e) { return e.source === node.id && e.sourceHandle === 'parallel'; });
        var parallelWaitForAll = resolved.waitForAll !== false;
        var parallelBodyIds = {};
        var parallelPromises = parallelEdges.map(function(be) {
          var branchIds = {};
          var pbq = [be.target];
          while (pbq.length > 0) {
            var pbid = pbq.shift();
            if (branchIds[pbid] || pbid === node.id) continue;
            branchIds[pbid] = true;
            parallelBodyIds[pbid] = true;
            SEGMENT_CONFIG.edges.forEach(function(e) {
              if (e.source === pbid && e.target !== node.id) pbq.push(e.target);
            });
          }
          var branchNodes = sortedNodes.filter(function(n) { return branchIds[n.id]; });
          var branchCtx = Object.assign({}, context);
          return (async function() {
            for (var pbi = 0; pbi < branchNodes.length; pbi++) {
              var pNode = branchNodes[pbi];
              var pRes = resolveConfig(pNode.config, branchCtx);
              pRes.__nodeId = pNode.id;
              var pHandler = nodeHandlers[pNode.type];
              if (!pHandler) continue;
              var pResult = await pHandler(pRes, branchCtx);
              branchCtx[pNode.id] = pResult;
            }
            return branchCtx;
          })().then(function(bc) {
            branchNodes.forEach(function(bn) { context[bn.id] = bc[bn.id]; });
            return { success: true };
          }).catch(function(err) {
            return { success: false, error: err.message || String(err) };
          });
        });
        var parallelResults;
        if (parallelWaitForAll) {
          parallelResults = await Promise.all(parallelPromises);
        } else {
          var pContinueAfter = resolved.continueAfter || 1;
          parallelResults = await new Promise(function(pResolve) {
            var pSettled = [];
            var pDone = false;
            parallelPromises.forEach(function(p) {
              p.then(function(r) {
                pSettled.push(r);
                if (!pDone && pSettled.length >= pContinueAfter) { pDone = true; pResolve(pSettled); }
              }).catch(function() {
                pSettled.push({ success: false });
                if (!pDone && pSettled.length >= parallelPromises.length) { pDone = true; pResolve(pSettled); }
              });
            });
          });
        }
        var parallelErrors = parallelResults.filter(function(r) { return !r.success; }).map(function(r) { return r.error; });
        context[node.id] = {
          results: parallelResults,
          completedBranches: parallelResults.filter(function(r) { return r.success; }).length,
          errors: parallelErrors.length > 0 ? parallelErrors : undefined
        };
        if (resolved.stopOnError && parallelErrors.length > 0) throw new Error(parallelErrors[0]);
        if (!context.__loopBodyNodeIds) context.__loopBodyNodeIds = {};
        Object.assign(context.__loopBodyNodeIds, parallelBodyIds);
        continue;
      }

      const handler = nodeHandlers[node.type];
      if (!handler) {
        console.warn('No handler for node type: ' + node.type);
        continue;
      }
      const result = await handler(resolved, context);
      if (result && result.__earlyResponse) {
        var earlyRes = result.__earlyResponse;
        var hKeys = Object.keys(earlyRes.headers || {});
        for (var h = 0; h < hKeys.length; h++) {
          res.setHeader(hKeys[h], earlyRes.headers[hKeys[h]]);
        }
        res.status(earlyRes.status || 500).json(earlyRes.body || {});
        return;
      }
      if (utils.isFatalNodeResult(result)) {
        throw new Error(utils.fatalNodeResultMessage(result));
      }
      context[node.id] = result;
      if (result && result.__terminal) break;
    }

    delete context.__request;
    res.status(200).json({ success: true, results: context });
  } catch (error) {
    console.error('Workflow segment error:', error);
    res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
};
`
}

export const hasStreamingAINode = (segment: WorkflowSegment): boolean => {
  return segment.nodes.some((n) => AI_NODE_TYPES.has(n.type) && n.config?.streaming === true)
}

export const generateStreamingServerSegmentAPIRoute = (
  segment: WorkflowSegment,
  workflowName?: string
): string => {
  const usedNodeTypes = new Set(segment.nodes.map((n) => n.type))
  const nodeHandlersEntries = generateNodeHandlersForSegment(usedNodeTypes, true)
  const hasRateLimiter = usedNodeTypes.has('general-rate-limiter')

  const segmentConfig = JSON.stringify(
    {
      nodes: segment.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        config: n.config,
        stepNumber: n.stepNumber,
        label: n.label,
      })),
      edges: segment.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        data: e.data,
      })),
    },
    null,
    2
  )

  const aiNodeTypes = JSON.stringify(Array.from(AI_NODE_TYPES))

  const header = workflowName
    ? `/**\n * Workflow Streaming Server Segment API Route\n * Workflow: ${sanitizeForBlockComment(
        workflowName
      )}\n * Segment ID: ${sanitizeForBlockComment(segment.id)}\n */\n`
    : `/**\n * Workflow Streaming Server Segment API Route\n * Segment ID: ${sanitizeForBlockComment(
        segment.id
      )}\n */\n`

  const requestInjection = hasRateLimiter
    ? `\n    context.__request = { ip: __getClientIp(req), headers: req.headers || {} };`
    : ''

  return `${header}
const utils = require('../../../utils/workflows/server-runtime');
const resolveConfig = utils.resolveConfig;

const SEGMENT_CONFIG = ${segmentConfig};

const nodeHandlers = {
${nodeHandlersEntries}
};

const __streamingAITypes = ${aiNodeTypes};

function __isStreamingAI(node, config) {
  return config && config.streaming && __streamingAITypes.indexOf(node.type) >= 0;
}

function __collectSegBranchNodes(startId, excludeId) {
  const ids = [];
  const visited = {};
  const queue = [startId];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (visited[cur] || cur === excludeId) continue;
    visited[cur] = true;
    const n = SEGMENT_CONFIG.nodes.find(function(nd) { return nd.id === cur; });
    if (n) ids.push(n);
    SEGMENT_CONFIG.edges.filter(function(e) { return e.source === cur; })
      .forEach(function(e) { if (e.target !== excludeId) queue.push(e.target); });
  }
  return ids;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var streamStarted = false;
  function ensureStream() {
    if (!streamStarted) {
      streamStarted = true;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
    }
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const context = Object.assign({}, body.context || {});${requestInjection}
    var __proto = req.headers['x-forwarded-proto'] || (req.headers.host && (req.headers.host.startsWith('localhost') || req.headers.host.startsWith('127.0.0.1')) ? 'http' : 'https');
    context.__baseUrl = __proto + '://' + req.headers.host;
    const sortedNodes = SEGMENT_CONFIG.nodes.slice().sort(function(a, b) { return a.stepNumber - b.stepNumber; });
    const executed = {};

    for (let i = 0; i < sortedNodes.length; i++) {
      const node = sortedNodes[i];
      if (executed[node.id]) continue;
      const resolved = resolveConfig(node.config, context);
      resolved.__nodeId = node.id;

      // If-statement nodes must be evaluated using the runtime's evaluateCondition
      if (node.type === 'general-if-statement') {
        const condResult = utils.evaluateCondition(resolved, context);
        context[node.id] = { result: condResult };
        executed[node.id] = true;
        if (streamStarted) {
          res.write('data: ' + JSON.stringify({ type: 'node-result', nodeId: node.id, result: context[node.id] }) + '\\n\\n');
        }
        continue;
      }

      // Loop nodes in streaming segments
      if (node.type === 'general-loop') {
        var ssLoopEdges = SEGMENT_CONFIG.edges.filter(function(e) { return e.source === node.id; });
        var ssLoopBodyEdge = ssLoopEdges.find(function(e) { return e.sourceHandle === 'loop'; });
        var ssBodyNodeIds = {};
        if (ssLoopBodyEdge) {
          var sslq = [ssLoopBodyEdge.target];
          while (sslq.length > 0) {
            var sslnid = sslq.shift();
            if (ssBodyNodeIds[sslnid] || sslnid === node.id) continue;
            ssBodyNodeIds[sslnid] = true;
            SEGMENT_CONFIG.edges.forEach(function(e) {
              if (e.source === sslnid && (e.sourceHandle === 'loop-body-out' || !e.sourceHandle)) {
                if (e.target !== node.id) sslq.push(e.target);
              }
            });
          }
        }
        var ssBodyNodes = sortedNodes.filter(function(n) { return ssBodyNodeIds[n.id]; });
        // See the regular-segment loop above: loopType=map must publish the
        // last body node output as results[i] so the schema contract holds.
        var ssLoopType = resolved.loopType || 'forEach';
        var ssLastBodyNode = ssBodyNodes[ssBodyNodes.length - 1];
        // Same envelope unwrap as the regular-segment loop above.
        var ssLoopCollection = utils.unwrapWorkflowCollection(resolved.collection);
        var ssLoopResults = [];
        // Same loop-scope tracking as the regular-segment loop above. Custom-js
        // bodies can read context.__loopScopeStack to recover the params /
        // innerParams contract documented in workflow-utils.ts.
        if (!context.__loopScopeStack) context.__loopScopeStack = [];
        context.__loopScopeStack.push({ loopNodeId: node.id, bodyNodeIds: ssBodyNodeIds });
        if (!context.__loopNodeIds) context.__loopNodeIds = {};
        context.__loopNodeIds[node.id] = true;
        for (var ssli = 0; ssli < ssLoopCollection.length; ssli++) {
          context[node.id] = { currentItem: ssLoopCollection[ssli], currentIndex: ssli, iterations: ssli + 1 };
          for (var ssbi = 0; ssbi < ssBodyNodes.length; ssbi++) {
            var ssbNode = ssBodyNodes[ssbi];
            var ssbRes = resolveConfig(ssbNode.config, context);
            ssbRes.__nodeId = ssbNode.id;
            if (ssbNode.type === 'general-if-statement') {
              context[ssbNode.id] = { result: utils.evaluateCondition(ssbRes, context) };
              continue;
            }
            var ssbHandler = nodeHandlers[ssbNode.type];
            if (!ssbHandler) continue;
            var ssbResult = await ssbHandler(ssbRes, context);
            context[ssbNode.id] = ssbResult;
          }
          if (ssLoopType === 'map') {
            ssLoopResults.push(ssLastBodyNode ? context[ssLastBodyNode.id] : context[node.id]);
          }
        }
        context.__loopScopeStack.pop();
        context[node.id] = { completed: true, iterations: ssLoopCollection.length, results: ssLoopResults };
        Object.keys(ssBodyNodeIds).forEach(function(k) { executed[k] = true; });
        executed[node.id] = true;
        if (streamStarted) {
          res.write('data: ' + JSON.stringify({ type: 'node-result', nodeId: node.id, result: context[node.id] }) + '\\n\\n');
        }
        continue;
      }

      // Switch nodes in streaming segments
      if (node.type === 'general-switch') {
        var ssSwitchVal = utils.resolveValue(resolved.switchValue, context);
        var ssSwitchCases = resolved.cases || [];
        var ssMatchedCase = 'default';
        for (var ssswci = 0; ssswci < ssSwitchCases.length; ssswci++) {
          var ssCaseVal = utils.resolveValue(ssSwitchCases[ssswci].condition, context);
          if (resolved.comparisonMode === 'expression') {
            try { if (new Function('value', 'context', 'return (' + ssCaseVal + ')')(ssSwitchVal, context)) { ssMatchedCase = ssSwitchCases[ssswci].id; break; } } catch(e) {}
          } else {
            if (ssSwitchVal === ssCaseVal) { ssMatchedCase = ssSwitchCases[ssswci].id; break; }
          }
        }
        context[node.id] = { matchedCase: ssMatchedCase };
        executed[node.id] = true;
        var ssSwitchEdges = SEGMENT_CONFIG.edges || [];
        var ssAllBranchEdges = ssSwitchEdges.filter(function(e) { return e.source === node.id; });
        ssAllBranchEdges.forEach(function(be) {
          var ssIsMatched = (be.sourceHandle === 'switch' && be.data && be.data.caseId === ssMatchedCase) ||
                            (ssMatchedCase === 'default' && be.sourceHandle === 'default');
          if (!ssIsMatched) {
            var ssSwSkipQueue = [be.target];
            while (ssSwSkipQueue.length > 0) {
              var ssSwSid = ssSwSkipQueue.shift();
              if (!ssSwSid || ssSwSid === node.id) continue;
              if (!context.__skippedNodes) context.__skippedNodes = {};
              if (context.__skippedNodes[ssSwSid]) continue;
              context.__skippedNodes[ssSwSid] = true;
              ssSwitchEdges.forEach(function(e) {
                if (e.source === ssSwSid && e.target !== node.id) ssSwSkipQueue.push(e.target);
              });
            }
          }
        });
        if (streamStarted) {
          res.write('data: ' + JSON.stringify({ type: 'node-result', nodeId: node.id, result: context[node.id] }) + '\\n\\n');
        }
        continue;
      }

      // Parallel nodes in streaming segments
      if (node.type === 'general-parallel') {
        var ssParallelEdges = SEGMENT_CONFIG.edges.filter(function(e) { return e.source === node.id && e.sourceHandle === 'parallel'; });
        var ssParallelWaitForAll = resolved.waitForAll !== false;
        var ssParallelBodyIds = {};
        var ssParallelPromises = ssParallelEdges.map(function(be) {
          var ssPBranchIds = {};
          var sspbq = [be.target];
          while (sspbq.length > 0) {
            var sspbid = sspbq.shift();
            if (ssPBranchIds[sspbid] || sspbid === node.id) continue;
            ssPBranchIds[sspbid] = true;
            ssParallelBodyIds[sspbid] = true;
            SEGMENT_CONFIG.edges.forEach(function(e) {
              if (e.source === sspbid && e.target !== node.id) sspbq.push(e.target);
            });
          }
          var ssPBranchNodes = sortedNodes.filter(function(n) { return ssPBranchIds[n.id]; });
          var ssPBranchCtx = Object.assign({}, context);
          return (async function() {
            for (var sspbi = 0; sspbi < ssPBranchNodes.length; sspbi++) {
              var sspNode = ssPBranchNodes[sspbi];
              var sspRes = resolveConfig(sspNode.config, ssPBranchCtx);
              sspRes.__nodeId = sspNode.id;
              var sspHandler = nodeHandlers[sspNode.type];
              if (!sspHandler) continue;
              var sspResult = await sspHandler(sspRes, ssPBranchCtx);
              ssPBranchCtx[sspNode.id] = sspResult;
            }
            return ssPBranchCtx;
          })().then(function(bc) {
            ssPBranchNodes.forEach(function(bn) { context[bn.id] = bc[bn.id]; });
            return { success: true };
          }).catch(function(err) {
            return { success: false, error: err.message || String(err) };
          });
        });
        var ssParallelResults;
        if (ssParallelWaitForAll) {
          ssParallelResults = await Promise.all(ssParallelPromises);
        } else {
          var sspContinueAfter = resolved.continueAfter || 1;
          ssParallelResults = await new Promise(function(sspResolve) {
            var sspSettled = [];
            var sspDone = false;
            ssParallelPromises.forEach(function(p) {
              p.then(function(r) {
                sspSettled.push(r);
                if (!sspDone && sspSettled.length >= sspContinueAfter) { sspDone = true; sspResolve(sspSettled); }
              }).catch(function() {
                sspSettled.push({ success: false });
                if (!sspDone && sspSettled.length >= ssParallelPromises.length) { sspDone = true; sspResolve(sspSettled); }
              });
            });
          });
        }
        var ssParallelErrors = ssParallelResults.filter(function(r) { return !r.success; }).map(function(r) { return r.error; });
        context[node.id] = {
          results: ssParallelResults,
          completedBranches: ssParallelResults.filter(function(r) { return r.success; }).length,
          errors: ssParallelErrors.length > 0 ? ssParallelErrors : undefined
        };
        Object.keys(ssParallelBodyIds).forEach(function(k) { executed[k] = true; });
        executed[node.id] = true;
        if (resolved.stopOnError && ssParallelErrors.length > 0) throw new Error(ssParallelErrors[0]);
        if (streamStarted) {
          res.write('data: ' + JSON.stringify({ type: 'node-result', nodeId: node.id, result: context[node.id] }) + '\\n\\n');
        }
        continue;
      }

      const nodeHandler = nodeHandlers[node.type];
      if (!nodeHandler) {
        console.warn('No handler for node type: ' + node.type);
        continue;
      }

      if (__isStreamingAI(node, resolved)) {
        ensureStream();
        const segEdges = SEGMENT_CONFIG.edges.filter(function(e) { return e.source === node.id; });
        const onStreamEdge = segEdges.find(function(e) { return e.sourceHandle === 'on-stream'; });
        const onEndEdge = segEdges.find(function(e) { return e.sourceHandle === 'on-end'; });
        const onStreamNodes = onStreamEdge ? __collectSegBranchNodes(onStreamEdge.target, node.id) : [];
        const onEndNodes = onEndEdge ? __collectSegBranchNodes(onEndEdge.target, node.id) : [];

        const result = await nodeHandler(resolved, context, async function(chunkData) {
          context[node.id] = { chunk: chunkData.chunk, fullResponse: chunkData.fullResponse, model: chunkData.model };
          res.write('data: ' + JSON.stringify({
            type: 'chunk',
            nodeId: node.id,
            chunk: chunkData.chunk,
            fullResponse: chunkData.fullResponse,
            model: chunkData.model
          }) + '\\n\\n');
          for (let si = 0; si < onStreamNodes.length; si++) {
            const sn = onStreamNodes[si];
            const snHandler = nodeHandlers[sn.type];
            if (!snHandler) continue;
            const snResolved = resolveConfig(sn.config, context);
            const snResult = await snHandler(snResolved, context);
            context[sn.id] = snResult;
            res.write('data: ' + JSON.stringify({ type: 'node-result', nodeId: sn.id, result: snResult }) + '\\n\\n');
          }
        });
        // A provider/auth failure surfaces as { error: true, message, code }.
        // Without this gate the on-end branch would run against a failed AI
        // result (e.g. persist a NULL chat answer → NOT NULL 500 downstream).
        if (utils.isFatalNodeResult(result)) {
          throw new Error(utils.fatalNodeResultMessage(result));
        }
        context[node.id] = result;
        res.write('data: ' + JSON.stringify({ type: 'node-result', nodeId: node.id, result: result }) + '\\n\\n');

        for (let oi = 0; oi < onEndNodes.length; oi++) {
          const en = onEndNodes[oi];
          const enHandler = nodeHandlers[en.type];
          if (!enHandler) continue;
          const enResolved = resolveConfig(en.config, context);
          const enResult = await enHandler(enResolved, context);
          context[en.id] = enResult;
          res.write('data: ' + JSON.stringify({ type: 'node-result', nodeId: en.id, result: enResult }) + '\\n\\n');
          executed[en.id] = true;
        }
        for (let si2 = 0; si2 < onStreamNodes.length; si2++) {
          executed[onStreamNodes[si2].id] = true;
        }
      } else {
        const result = await nodeHandler(resolved, context);
        if (result && result.__earlyResponse) {
          if (streamStarted) {
            res.write('data: ' + JSON.stringify({ type: 'error', error: (result.__earlyResponse.body && result.__earlyResponse.body.message) || 'Request rejected' }) + '\\n\\n');
            res.end();
          } else {
            var earlyRes = result.__earlyResponse;
            var hKeys = Object.keys(earlyRes.headers || {});
            for (var h = 0; h < hKeys.length; h++) {
              res.setHeader(hKeys[h], earlyRes.headers[hKeys[h]]);
            }
            res.status(earlyRes.status || 500).json(earlyRes.body || {});
          }
          return;
        }
        if (utils.isFatalNodeResult(result)) {
          throw new Error(utils.fatalNodeResultMessage(result));
        }
        context[node.id] = result;
        if (streamStarted) {
          res.write('data: ' + JSON.stringify({ type: 'node-result', nodeId: node.id, result: result }) + '\\n\\n');
        }
        if (result && result.__terminal) break;
      }
    }

    delete context.__request;
    if (streamStarted) {
      res.write('data: ' + JSON.stringify({ type: 'done', success: true, results: context }) + '\\n\\n');
      res.end();
    } else {
      res.status(200).json({ success: true, results: context });
    }
  } catch (error) {
    console.error('Streaming workflow segment error:', error);
    if (streamStarted) {
      try {
        res.write('data: ' + JSON.stringify({ type: 'error', error: error.message || 'Internal server error' }) + '\\n\\n');
      } catch(e) {}
      res.end();
    } else {
      res.status(500).json({ success: false, error: error.message || 'Internal server error' });
    }
  }
};
`
}

const generateClientOnlyServerStub = (nodeType: string): string => {
  const fnName = nodeType.replace(/-/g, '_')
  return `async function ${fnName}(config, context) {
  var nid = config.__nodeId
  if (nid !== undefined && context[nid] !== undefined) return context[nid]
  return {}
}`
}

// Returns the BODY of a `nodeHandlers = {...}` object literal — one entry per
// used node type, e.g. `  'general-if-statement': (function () { ... })()`.
//
// Each handler is isolated in its own IIFE rather than declared as a bare
// sibling statement in a shared scope (which is what this used to do, joined
// with the outer `nodeHandlers` map built separately from a statically
// computed `nodeType.replace(/-/g, '_')` name). Two problems, both closed by
// this shape:
//   1. A handler built from `handlerToString(fn)` on a real function embeds
//      `fn.toString()` — a snapshot of whatever `fn` was actually named at
//      that moment. When this package is bundled/minified by a consumer
//      (e.g. teleport-gui's browser packer worker), the minifier freely
//      renames `fn`'s declaration, since nothing in the bundle calls it by
//      name — only this runtime `.toString()` read does, which is invisible
//      to the minifier. A statically computed reference name would then be
//      undefined — resolveHandlerEntryName reads the name the source
//      ACTUALLY declares instead.
//   2. Two DIFFERENT node types are minified independently (each in its own
//      source file), so their real declared names can coincidentally
//      collide — e.g. state-update-local-state and payment-cancel-plan can
//      both legitimately mangle down to the same short name. Declared as
//      bare siblings in one shared scope, the second declaration would
//      silently shadow the first, so BOTH map entries end up pointing at the
//      SAME (wrong-for-one-of-them) function — a silent wrong-handler-
//      executes bug, not even a crash. An IIFE per entry gives every handler
//      its own scope, so a same-named collision between two unrelated
//      handlers can never shadow each other.
const generateNodeHandlersForSegment = (usedNodeTypes: Set<string>, forServer = false): string => {
  return Array.from(usedNodeTypes)
    .map((nodeType) => {
      const generator = nodeRegistry[nodeType]
      let source: string
      if (generator) {
        if (forServer && generator.generateServerHandler) {
          source = generator.generateServerHandler()
        } else if (forServer && generator.executionEnv === 'client') {
          source = generateClientOnlyServerStub(nodeType)
        } else {
          source = generator.generateHandler()
        }
      } else {
        source = `
async function ${nodeType.replace(/-/g, '_')}(config, context) {
  throw new Error('No implementation for node type: ${nodeType}');
}`
      }
      const trimmed = source.trim()
      const entryFn = resolveHandlerEntryName(trimmed, nodeType)
      return `  '${nodeType}': (function () {\n${trimmed}\nreturn ${entryFn};\n})()`
    })
    .join(',\n')
}

const CLIENT_ONLY_NODES = new Set([
  'navigation-go-to-page',
  'navigation-navigate-to-url',
  'navigation-refresh-page',
  'navigation-go-back',
  'element-show',
  'element-hide',
  'element-scroll-to',
  'element-get-input-value',
  'element-set-text',
  'element-set-attribute',
  'element-add-class',
  'element-remove-class',
  'element-toggle-class',
  'form-set-value',
  'form-reset',
  'form-focus',
  'form-blur',
  'url-get-current-url',
  'url-get-query-parameter',
  'storage-local-get',
  'storage-local-set',
  'storage-local-remove',
  'storage-session-get',
  'storage-session-set',
  'storage-session-remove',
  'state-update-local-state',
  'state-update-global-state',
  'cart-add-item',
  'cart-remove-item',
  'cart-update-item-quantity',
  'cart-clear',
  'cart-get-items',
  'cart-get-total',
  'browser-ask-permission',
  'browser-get-location',
  'browser-pick-files',
  'browser-read-clipboard',
  'browser-write-clipboard',
  'browser-show-notification',
  'browser-subscribe-to-push',
  'browser-share',
  'browser-get-device-info',
  'browser-get-network-status',
  'browser-fullscreen',
  'browser-print',
  'browser-text-to-speech',
  'browser-get-media-devices',
  'browser-speech-to-text',
  'general-trigger-download',
  'general-extract-form-data',
  'general-emit-custom-event',
  'realtime-join-channel',
  'realtime-leave-channel',
  'realtime-list-channels',
  'realtime-list-channel-members',
])

export const generateCronAPIRoute = (workflow: UIDLWorkflow): string => {
  const serverNodes = workflow.nodes.filter((n: UIDLWorkflowNode) => !CLIENT_ONLY_NODES.has(n.type))
  const allNodeTypes = new Set<string>(serverNodes.map((n: UIDLWorkflowNode) => n.type))
  const nodeHandlersEntries = generateNodeHandlersForSegment(allNodeTypes, true)
  const hasRateLimiter = allNodeTypes.has('general-rate-limiter')

  const serverNodeIds = new Set<string>(serverNodes.map((n: UIDLWorkflowNode) => n.id))
  const serverEdges = workflow.edges.filter(
    (e: UIDLWorkflowEdge) => serverNodeIds.has(e.source) || serverNodeIds.has(e.target)
  )

  const workflowConfig = JSON.stringify(
    {
      triggerNodeId: workflow.trigger.nodeId,
      nodes: serverNodes.map((n: UIDLWorkflowNode) => ({
        id: n.id,
        type: n.type,
        config: n.config,
        stepNumber: n.stepNumber,
        label: n.label,
      })),
      edges: serverEdges,
    },
    null,
    2
  )

  const requestInjection = hasRateLimiter
    ? `\n    context.__request = { ip: __getClientIp(req), headers: req.headers || {} };`
    : ''

  return `/**
 * Workflow Cron API Route
 * Workflow: ${sanitizeForBlockComment(workflow.name || workflow.id)}
 * Trigger: ${sanitizeForBlockComment(String(workflow.trigger.config.schedule || 'cron'))}
 */

const utils = require('../../../utils/workflows/server-runtime');
const resolveConfig = utils.resolveConfig;

const WORKFLOW_CONFIG = ${workflowConfig};

const nodeHandlers = {
${nodeHandlersEntries}
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const triggerContext = { timestamp: Date.now(), schedule: '${
      (workflow.trigger.config.schedule as string) || ''
    }' };
    const context = {};
    context[WORKFLOW_CONFIG.triggerNodeId] = triggerContext;${requestInjection}

    const sortedNodes = WORKFLOW_CONFIG.nodes.slice().sort(function(a, b) { return a.stepNumber - b.stepNumber; });

    for (let i = 0; i < sortedNodes.length; i++) {
      const node = sortedNodes[i];
      const resolved = resolveConfig(node.config, context);
      resolved.__nodeId = node.id;

      if (node.type === 'general-if-statement') {
        const condResult = utils.evaluateCondition(resolved, context);
        context[node.id] = { result: condResult };
        continue;
      }

      const handler = nodeHandlers[node.type];
      if (!handler) continue;
      const result = await handler(resolved, context);
      if (result && result.__earlyResponse) {
        var earlyRes = result.__earlyResponse;
        var hKeys = Object.keys(earlyRes.headers || {});
        for (var h = 0; h < hKeys.length; h++) {
          res.setHeader(hKeys[h], earlyRes.headers[hKeys[h]]);
        }
        res.status(earlyRes.status || 500).json(earlyRes.body || {});
        return;
      }
      if (utils.isFatalNodeResult(result)) {
        throw new Error(utils.fatalNodeResultMessage(result));
      }
      context[node.id] = result;
      if (result && result.__terminal) break;
    }

    res.status(200).json({ success: true, timestamp: Date.now() });
  } catch (error) {
    console.error('Cron workflow error:', error);
    res.status(500).json({ success: false, error: error.message || 'Cron workflow failed' });
  }
};
`
}

export const getAPIRouteFileName = (
  workflowId: string,
  segmentId: string,
  workflowName?: string
): string => {
  if (workflowName) {
    const safeName = sanitizeFileName(workflowName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50)
      .replace(/-+$/g, '')
    // Append a workflow-id suffix so two workflows whose names slug to the
    // same prefix don't collide. The 50-char slug cap (combined with the
    // generator's local sanitizeFileName, which also caps at 50) makes
    // collisions easy: e.g. "Admin Panel: Customer Testimonials List -
    // Open Detail Panel" and "...Open Detail Panel From URL" both slug to
    // "admin-panel-customer-testimonials-list-open-det". Without the
    // suffix the second emitted file silently overwrites the first, and
    // the overwritten workflow's client segments still try to read their
    // data-select results out of the server response by node id —
    // producing an empty detail panel because the merged context never
    // contains the expected node id.
    const idSuffix = sanitizeFileName(workflowId).toLowerCase().slice(0, 8)
    return `${safeName}-${idSuffix}-seg-${sanitizeFileName(segmentId).slice(0, 8)}`
  }
  return `wf-${sanitizeFileName(workflowId)}-${sanitizeFileName(segmentId)}`
}

export const getCronRouteFileName = (workflow: UIDLWorkflow): string => {
  const urlPath = workflow.trigger.config.urlPath as string
  if (urlPath) {
    return sanitizeFileName(urlPath)
  }
  if (workflow.name) {
    const safeName = sanitizeFileName(workflow.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50)
    return `cron-${safeName}`
  }
  return `wf-cron-${sanitizeFileName(workflow.id)}`
}

/**
 * Generates the common node execution loop used by webhook, cron, and segment routes.
 * Handles if-statements, loops, early responses, custom nodes, and terminal results.
 */
const generateNodeExecutionLoop = (
  configVar: string,
  options?: { hasCustomNodes?: boolean }
): string => {
  const customNodeBlock = options?.hasCustomNodes
    ? `
      if (result && result.__customNode) {
        var cnFn = typeof __customNodes !== 'undefined' ? __customNodes[result.customNodeId] : null;
        if (cnFn) {
          var cnResult = await cnFn(context, result.parameters, nodeHandlers);
          context[node.id] = cnResult;
        }
        continue;
      }`
    : ''

  return `    var sortedNodes = ${configVar}.nodes.slice().sort(function(a, b) { return a.stepNumber - b.stepNumber; });

    for (var i = 0; i < sortedNodes.length; i++) {
      var node = sortedNodes[i];
      var resolved = resolveConfig(node.config, context);
      resolved.__nodeId = node.id;

      if (node.type === 'general-if-statement') {
        var condResult = utils.evaluateCondition(resolved, context);
        context[node.id] = { result: condResult };
        var skipHandle = condResult ? 'false' : 'true';
        var cfgEdges = ${configVar}.edges || [];
        var skipEdge = cfgEdges.find(function(e) { return e.source === node.id && e.sourceHandle === skipHandle; });
        if (skipEdge) {
          var skipIds = {};
          var skipQueue = [skipEdge.target];
          while (skipQueue.length > 0) {
            var sid = skipQueue.shift();
            if (skipIds[sid] || sid === node.id) continue;
            skipIds[sid] = true;
            cfgEdges.forEach(function(e) {
              if (e.source === sid && !skipIds[e.target] && e.target !== node.id) skipQueue.push(e.target);
            });
          }
          if (!context.__skippedNodes) context.__skippedNodes = {};
          Object.assign(context.__skippedNodes, skipIds);
        }
        continue;
      }

      if (context.__skippedNodes && context.__skippedNodes[node.id]) continue;

      if (node.type === 'general-loop') {
        var loopEdges = ${configVar}.edges.filter(function(e) { return e.source === node.id; });
        var loopBodyEdge = loopEdges.find(function(e) { return e.sourceHandle === 'loop'; });

        var bodyNodeIds = {};
        if (loopBodyEdge) {
          var lQueue = [loopBodyEdge.target];
          while (lQueue.length > 0) {
            var nid = lQueue.shift();
            if (bodyNodeIds[nid] || nid === node.id) continue;
            bodyNodeIds[nid] = true;
            ${configVar}.edges.forEach(function(e) {
              if (e.source === nid && (e.sourceHandle === 'loop-body-out' || !e.sourceHandle)) {
                if (e.target !== node.id) lQueue.push(e.target);
              }
            });
          }
        }
        var bodyNodes = sortedNodes.filter(function(n) { return bodyNodeIds[n.id]; });
        // For loopType=map, the schema (general-loop in node-context-schemas.json)
        // defines results as the array of last body node outputs (same as
        // Array.prototype.map). Pick the last body node so downstream nodes
        // (e.g. state-update-global-state) consume the transformed value.
        var __wfLoopType = resolved.loopType || 'forEach';
        var __wfLastBodyNode = bodyNodes[bodyNodes.length - 1];

        // Same envelope unwrap as the regular-segment loop above.
        var collection = utils.unwrapWorkflowCollection(resolved.collection);
        var loopResults = [];

        // Same loop-scope tracking as the regular-segment loop above so
        // general-custom-js inside the loop body sees the right params /
        // innerParams. Required for webhook + cron routes.
        if (!context.__loopScopeStack) context.__loopScopeStack = [];
        context.__loopScopeStack.push({ loopNodeId: node.id, bodyNodeIds: bodyNodeIds });
        if (!context.__loopNodeIds) context.__loopNodeIds = {};
        context.__loopNodeIds[node.id] = true;

        for (var li = 0; li < collection.length; li++) {
          context[node.id] = { currentItem: collection[li], currentIndex: li, iterations: li + 1 };
          for (var bi = 0; bi < bodyNodes.length; bi++) {
            var bNode = bodyNodes[bi];
            var bResolved = resolveConfig(bNode.config, context);
            bResolved.__nodeId = bNode.id;
            if (bNode.type === 'general-if-statement') {
              context[bNode.id] = { result: utils.evaluateCondition(bResolved, context) };
              continue;
            }
            var bHandler = nodeHandlers[bNode.type];
            if (!bHandler) continue;
            var bResult = await bHandler(bResolved, context);
            if (bResult && (bResult.success === false || (typeof bResult.error === 'string' && bResult.error))) {
              throw new Error(bResult.error || 'Loop body node execution failed');
            }
            context[bNode.id] = bResult;
          }
          if (__wfLoopType === 'map') {
            loopResults.push(__wfLastBodyNode ? context[__wfLastBodyNode.id] : context[node.id]);
          }
        }

        context.__loopScopeStack.pop();

        context[node.id] = { completed: true, iterations: collection.length, results: loopResults };
        if (!context.__loopBodyNodeIds) context.__loopBodyNodeIds = {};
        Object.assign(context.__loopBodyNodeIds, bodyNodeIds);
        continue;
      }

      if (context.__loopBodyNodeIds && context.__loopBodyNodeIds[node.id]) continue;

      if (node.type === 'general-switch') {
        var swVal = utils.resolveValue(resolved.switchValue, context);
        var swCases = resolved.cases || [];
        var swMatchedCase = 'default';
        for (var swci = 0; swci < swCases.length; swci++) {
          var swCaseVal = utils.resolveValue(swCases[swci].condition, context);
          if (resolved.comparisonMode === 'expression') {
            try { if (new Function('value', 'context', 'return (' + swCaseVal + ')')(swVal, context)) { swMatchedCase = swCases[swci].id; break; } } catch(e) {}
          } else {
            if (swVal === swCaseVal) { swMatchedCase = swCases[swci].id; break; }
          }
        }
        context[node.id] = { matchedCase: swMatchedCase };
        var swEdges = ${configVar}.edges || [];
        var swBranchEdges = swEdges.filter(function(e) { return e.source === node.id; });
        swBranchEdges.forEach(function(be) {
          var swIsMatched = (be.sourceHandle === 'switch' && be.data && be.data.caseId === swMatchedCase) ||
                            (swMatchedCase === 'default' && be.sourceHandle === 'default');
          if (!swIsMatched) {
            var swSQ = [be.target];
            while (swSQ.length > 0) {
              var swSid = swSQ.shift();
              if (!swSid || swSid === node.id) continue;
              if (!context.__skippedNodes) context.__skippedNodes = {};
              if (context.__skippedNodes[swSid]) continue;
              context.__skippedNodes[swSid] = true;
              swEdges.forEach(function(e) {
                if (e.source === swSid && e.target !== node.id) swSQ.push(e.target);
              });
            }
          }
        });
        continue;
      }

      if (node.type === 'general-parallel') {
        var wlParallelEdges = ${configVar}.edges.filter(function(e) { return e.source === node.id && e.sourceHandle === 'parallel'; });
        var wlParallelWaitForAll = resolved.waitForAll !== false;
        var wlParallelBodyIds = {};
        var wlParallelPromises = wlParallelEdges.map(function(be) {
          var wlBranchIds = {};
          var wlpbq = [be.target];
          while (wlpbq.length > 0) {
            var wlpbid = wlpbq.shift();
            if (wlBranchIds[wlpbid] || wlpbid === node.id) continue;
            wlBranchIds[wlpbid] = true;
            wlParallelBodyIds[wlpbid] = true;
            ${configVar}.edges.forEach(function(e) {
              if (e.source === wlpbid && e.target !== node.id) wlpbq.push(e.target);
            });
          }
          var wlBranchNodes = sortedNodes.filter(function(n) { return wlBranchIds[n.id]; });
          var wlBranchCtx = Object.assign({}, context);
          return (async function() {
            for (var wlpbi = 0; wlpbi < wlBranchNodes.length; wlpbi++) {
              var wlpNode = wlBranchNodes[wlpbi];
              var wlpRes = resolveConfig(wlpNode.config, wlBranchCtx);
              wlpRes.__nodeId = wlpNode.id;
              var wlpHandler = nodeHandlers[wlpNode.type];
              if (!wlpHandler) continue;
              var wlpResult = await wlpHandler(wlpRes, wlBranchCtx);
              wlBranchCtx[wlpNode.id] = wlpResult;
            }
            return wlBranchCtx;
          })().then(function(bc) {
            wlBranchNodes.forEach(function(bn) { context[bn.id] = bc[bn.id]; });
            return { success: true };
          }).catch(function(err) {
            return { success: false, error: err.message || String(err) };
          });
        });
        var wlParallelResults;
        if (wlParallelWaitForAll) {
          wlParallelResults = await Promise.all(wlParallelPromises);
        } else {
          var wlpContinueAfter = resolved.continueAfter || 1;
          wlParallelResults = await new Promise(function(wlpResolve) {
            var wlpSettled = [];
            var wlpDone = false;
            wlParallelPromises.forEach(function(p) {
              p.then(function(r) {
                wlpSettled.push(r);
                if (!wlpDone && wlpSettled.length >= wlpContinueAfter) { wlpDone = true; wlpResolve(wlpSettled); }
              }).catch(function() {
                wlpSettled.push({ success: false });
                if (!wlpDone && wlpSettled.length >= wlParallelPromises.length) { wlpDone = true; wlpResolve(wlpSettled); }
              });
            });
          });
        }
        var wlParallelErrors = wlParallelResults.filter(function(r) { return !r.success; }).map(function(r) { return r.error; });
        context[node.id] = {
          results: wlParallelResults,
          completedBranches: wlParallelResults.filter(function(r) { return r.success; }).length,
          errors: wlParallelErrors.length > 0 ? wlParallelErrors : undefined
        };
        if (resolved.stopOnError && wlParallelErrors.length > 0) throw new Error(wlParallelErrors[0]);
        if (!context.__loopBodyNodeIds) context.__loopBodyNodeIds = {};
        Object.assign(context.__loopBodyNodeIds, wlParallelBodyIds);
        continue;
      }

      var handler = nodeHandlers[node.type];
      if (!handler) {
        console.warn('No handler for node type: ' + node.type);
        continue;
      }
      var result = await handler(resolved, context);
      if (result && result.__earlyResponse) {
        var earlyRes = result.__earlyResponse;
        var hKeys = Object.keys(earlyRes.headers || {});
        for (var h = 0; h < hKeys.length; h++) {
          res.setHeader(hKeys[h], earlyRes.headers[hKeys[h]]);
        }
        res.status(earlyRes.status || 500).json(earlyRes.body || {});
        return;
      }${customNodeBlock}
      if (utils.isFatalNodeResult(result)) {
        throw new Error(utils.fatalNodeResultMessage(result));
      }
      context[node.id] = result;
      if (result && result.__terminal) break;
    }`
}

export const generateWebhookWorkflowAPIRoute = (
  workflow: UIDLWorkflow,
  customNodes?: Record<string, UIDLCustomWorkflowNode>
): string => {
  const webhookConfig = workflow.webhookConfig as UIDLWebhookConfig
  const serverNodes = workflow.nodes.filter((n: UIDLWorkflowNode) => !CLIENT_ONLY_NODES.has(n.type))
  const allNodeTypes = new Set<string>(serverNodes.map((n: UIDLWorkflowNode) => n.type))
  const nodeHandlersEntries = generateNodeHandlersForSegment(allNodeTypes, true)
  const hasRateLimiter = allNodeTypes.has('general-rate-limiter')

  const serverNodeIds = new Set<string>(serverNodes.map((n: UIDLWorkflowNode) => n.id))
  const serverEdges = workflow.edges.filter(
    (e: UIDLWorkflowEdge) => serverNodeIds.has(e.source) || serverNodeIds.has(e.target)
  )

  const hasCustomNodeUsage = serverNodes.some((n) => n.type === 'general-custom-node')
  const hasCustomNodeDefs = customNodes && Object.keys(customNodes).length > 0

  const workflowConfig = JSON.stringify(
    {
      triggerNodeId: workflow.trigger.nodeId,
      nodes: serverNodes.map((n: UIDLWorkflowNode) => ({
        id: n.id,
        type: n.type,
        config: n.config,
        stepNumber: n.stepNumber,
        label: n.label,
      })),
      edges: serverEdges,
      errorHandlerNodeId: workflow.errorHandler?.nodeId || null,
    },
    null,
    2
  )

  // Normalise signatureSecret into a flat env-var-name string before
  // serialising. The Teleport UIDL ships this field as either a bare string
  // (legacy) or a DynamicNode of the shape
  //   { type: 'dynamic', content: { referenceType: 'secret', id: 'ENV_NAME' } }
  // The generated runtime signature-verification code does
  //   process.env[webhookConfig.signatureSecret]
  // so we must hand it a string. Otherwise `process.env[<object>]` coerces to
  // `process.env['[object Object]']` (undefined) and every webhook request
  // fails the signature check with 401 — even when the caller's signature is
  // correct.
  const normaliseSignatureSecret = (value: unknown): string => {
    if (typeof value === 'string') {
      return value
    }
    if (value && typeof value === 'object') {
      const anyVal = value as {
        type?: string
        content?: { referenceType?: string; id?: string }
        id?: string
      }
      if (
        anyVal.type === 'dynamic' &&
        anyVal.content &&
        anyVal.content.referenceType === 'secret' &&
        typeof anyVal.content.id === 'string'
      ) {
        return anyVal.content.id
      }
    }
    return ''
  }
  const normalisedWebhookConfig = {
    ...webhookConfig,
    signatureSecret: normaliseSignatureSecret(
      (webhookConfig as unknown as { signatureSecret?: unknown }).signatureSecret
    ),
  }

  const webhookConfigJson = JSON.stringify(normalisedWebhookConfig, null, 2)
  const needsSignatureVerification = webhookConfig.verifySignature
  const signatureVerificationCode = needsSignatureVerification
    ? generateAllSignatureVerificationCode()
    : ''
  const getRawBodyCode = generateGetRawBodyCode()

  const errorHandlerNodes = workflow.errorHandler ? getErrorHandlerNodes(workflow) : null
  const errorHandlerNodesJson = errorHandlerNodes
    ? JSON.stringify(errorHandlerNodes, null, 2)
    : 'null'

  const routePath = getWebhookRoutePath(workflow)
  const relativePrefix = routePath.map(() => '..').join('/')

  const customNodesImport =
    hasCustomNodeUsage && hasCustomNodeDefs
      ? `var __customNodes;\ntry { __customNodes = require('${relativePrefix}/utils/workflows/custom-nodes'); } catch (_e) { __customNodes = {}; }\n`
      : ''

  const requestInjection = hasRateLimiter
    ? `\n    context.__request = { ip: __getClientIp(req), headers: req.headers || {} };`
    : ''

  const executionLoop = generateNodeExecutionLoop('WORKFLOW_CONFIG', {
    hasCustomNodes: hasCustomNodeUsage && hasCustomNodeDefs,
  })

  return `/**
 * Webhook API Route
 * Workflow: ${sanitizeForBlockComment(workflow.name || workflow.id)}
 * Path: ${sanitizeForBlockComment(webhookConfig.urlPath)}
 * Method: ${sanitizeForBlockComment(webhookConfig.httpMethod)}
 */
if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = require('node-fetch');
}

const utils = require('${relativePrefix}/utils/workflows/server-runtime');
const resolveConfig = utils.resolveConfig;
${customNodesImport}
${getRawBodyCode}

${signatureVerificationCode}

const WEBHOOK_CONFIG = ${webhookConfigJson};

const WORKFLOW_CONFIG = ${workflowConfig};

var ERROR_HANDLER_NODES = ${errorHandlerNodesJson};

const nodeHandlers = {
${nodeHandlersEntries}
};

module.exports = async function handler(req, res) {
  if (req.method !== '${webhookConfig.httpMethod}') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

${generateExpectedHeadersCheck(webhookConfig)}

  try {
    var rawBody = await getRawBody(req);
    var body;
    try { body = JSON.parse(rawBody.toString('utf-8')); } catch (_e) { body = {}; }

    var isSignatureValid = true;
${generateSignatureVerificationBlock(webhookConfig)}

    var triggerContext = {
      headers: req.headers,
      body: body,
      query: req.query || {},
      method: req.method,
      path: req.url,
      isSignatureValid: isSignatureValid,
    };

    var context = {};
    context[WORKFLOW_CONFIG.triggerNodeId] = triggerContext;
    var __proto = req.headers['x-forwarded-proto'] || (req.headers.host && (req.headers.host.startsWith('localhost') || req.headers.host.startsWith('127.0.0.1')) ? 'http' : 'https');
    context.__baseUrl = __proto + '://' + req.headers.host;${requestInjection}

${executionLoop}

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook workflow error:', error);
    if (ERROR_HANDLER_NODES) {
      try {
        var errCtx = Object.assign({}, context || {});
        if (WORKFLOW_CONFIG.errorHandlerNodeId) {
          errCtx[WORKFLOW_CONFIG.errorHandlerNodeId] = {
            error: { message: error.message || String(error), stack: error.stack || '' },
            errorMessage: error.message || String(error),
          };
        }
        for (var ei = 0; ei < ERROR_HANDLER_NODES.length; ei++) {
          var eNode = ERROR_HANDLER_NODES[ei];
          var eResolved = resolveConfig(eNode.config, errCtx);
          eResolved.__nodeId = eNode.id;
          var eHandler = nodeHandlers[eNode.type];
          if (eHandler) {
            var eResult = await eHandler(eResolved, errCtx);
            errCtx[eNode.id] = eResult;
          }
        }
      } catch (innerErr) {
        console.error('Webhook error handler failed:', innerErr);
      }
    }
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

module.exports.config = { api: { bodyParser: false } };
`
}

export const getWebhookRouteFileName = (workflow: UIDLWorkflow): string => {
  const webhookConfig = workflow.webhookConfig
  if (webhookConfig?.urlPath) {
    const parts = webhookConfig.urlPath.replace(/^\//, '').split('/').filter(Boolean)
    const lastPart = parts[parts.length - 1]
    if (lastPart) {
      return sanitizeFileName(lastPart)
    }
  }
  if (workflow.name) {
    const safeName = sanitizeFileName(workflow.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50)
    return `webhook-${safeName}`
  }
  return `webhook-${sanitizeFileName(workflow.id)}`
}

export const getWebhookRoutePath = (workflow: UIDLWorkflow): string[] => {
  const DEFAULT_PATH = ['pages', 'api', 'webhooks']
  const webhookConfig = workflow.webhookConfig
  if (!webhookConfig?.urlPath) {
    return DEFAULT_PATH
  }
  const parts = webhookConfig.urlPath.replace(/^\//, '').split('/').filter(Boolean)
  // Strip a leading "api" segment if the author already included it, so we
  // never emit "pages/api/api/...". The generator always owns the "api"
  // prefix — everything between "api" and the filename is the directory.
  if (parts.length > 0 && parts[0].toLowerCase() === 'api') {
    parts.shift()
  }
  // When the author specifies only a filename (no directory), preserve the
  // legacy default of emitting into pages/api/webhooks/.
  if (parts.length <= 1) {
    return DEFAULT_PATH
  }
  // Otherwise use the directory portion verbatim, under pages/api/.
  // (The last segment is the filename — it's consumed by getWebhookFileName.)
  return ['pages', 'api', ...parts.slice(0, -1)]
}

function getErrorHandlerNodes(
  workflow: UIDLWorkflow
): Array<{ id: string; type: string; config: Record<string, unknown>; stepNumber: number }> | null {
  if (!workflow.errorHandler) {
    return null
  }
  const errorNodeId = workflow.errorHandler.nodeId
  const errorBranchIds = new Set<string>()
  const queue: string[] = []
  for (const e of workflow.edges) {
    if (e.source === errorNodeId) {
      queue.push(e.target)
    }
  }
  const nodeIdSet = new Set(workflow.nodes.map((n) => n.id))
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (errorBranchIds.has(cur) || !nodeIdSet.has(cur)) {
      continue
    }
    errorBranchIds.add(cur)
    for (const e of workflow.edges) {
      if (e.source === cur) {
        queue.push(e.target)
      }
    }
  }
  if (errorBranchIds.size === 0) {
    return null
  }
  return workflow.nodes
    .filter((n) => errorBranchIds.has(n.id))
    .sort((a, b) => a.stepNumber - b.stepNumber)
    .map((n) => ({ id: n.id, type: n.type, config: n.config, stepNumber: n.stepNumber }))
}

function generateExpectedHeadersCheck(webhookConfig: UIDLWebhookConfig): string {
  if (!webhookConfig.expectedHeaders || webhookConfig.expectedHeaders.length === 0) {
    return ''
  }
  const checks: string[] = []
  for (const h of webhookConfig.expectedHeaders) {
    const key = h.key.toLowerCase()
    checks.push(
      `  var hdr_${key.replace(/[^a-z0-9]/g, '_')} = req.headers[${JSON.stringify(key)}];`
    )
    checks.push(`  if (!hdr_${key.replace(/[^a-z0-9]/g, '_')}) {`)
    checks.push(`    res.status(400).json({ error: 'Missing required header: ${h.key}' });`)
    checks.push(`    return;`)
    checks.push(`  }`)
    if (h.value) {
      checks.push(`  if (hdr_${key.replace(/[^a-z0-9]/g, '_')} !== ${JSON.stringify(h.value)}) {`)
      checks.push(`    res.status(400).json({ error: 'Invalid header value for: ${h.key}' });`)
      checks.push(`    return;`)
      checks.push(`  }`)
    }
  }
  return checks.join('\n')
}

function generateSignatureVerificationBlock(webhookConfig: UIDLWebhookConfig): string {
  if (!webhookConfig.verifySignature) {
    return ''
  }
  return `    isSignatureValid = await verifyWebhookSignature(req, rawBody, WEBHOOK_CONFIG);
    if (!isSignatureValid) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }`
}

const sanitizeFileName = (str: string): string => {
  return str.replace(/[^a-zA-Z0-9-_]/g, '-').substring(0, 50)
}
