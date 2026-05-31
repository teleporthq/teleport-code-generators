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
    if (result === undefined || result === null) return undefined;
    result = result[ref.path[i]];
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
          return resolveSecret(item, context);
        });
      } else {
        resolved[key] = val.map(function(item) {
          if (isSecretRef(item)) {
            return resolveSecret(item, context);
          }
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            return resolveConfig(item, context);
          }
          return resolveSecret(item, context);
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
      resolved[key] = resolveSecret(val, context);
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

function evaluateSingleComparison(config, context) {
  var rawLeft = resolveValue(config.leftValue, context);
  var rawRight = resolveValue(config.rightValue, context);
  const op = config.operator || 'equals';
  var isUnary = op === 'is-empty' || op === 'is-not-empty' || op === 'is-truthy' || op === 'is-falsy';
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
    case 'not-contains': return !String(left).includes(String(right));
    case 'starts-with': return String(left).startsWith(String(right));
    case 'ends-with': return String(left).endsWith(String(right));
    case 'is-empty': return left === '' || left === null || left === undefined || (Array.isArray(left) && left.length === 0);
    case 'is-not-empty': return left !== '' && left !== null && left !== undefined && !(Array.isArray(left) && left.length === 0);
    case 'is-truthy': return !!left;
    case 'is-falsy': return !left;
    case 'matches-regex': try { return new RegExp(String(right)).test(String(left)); } catch(e) { return false; }
    default: return left == right;
  }
}

async function executeWorkflow(workflowConfig, triggerContext, nodeHandlers, options) {
  options = options || {};
  const context = {};
  const executionId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  context[workflowConfig.triggerNodeId] = triggerContext;
  if (triggerContext && triggerContext.__stateValues) {
    context.__stateValues = triggerContext.__stateValues;
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

      if (result && (result.success === false || (typeof result.error === 'string' && result.error))) {
        throw new Error(result.error || 'Node execution failed');
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
  unwrapWorkflowCollection,
  evaluateCondition,
  evaluateSingleComparison,
  executeWorkflow,
  executeNodes,
  executeLoop,
  getLoopBodyNodeIds,
  executeParallel,
  collectBranchNodes,
  markAllBranchNodes,
  isStreamingAINode
};
`
}

export const generateClientRuntimeCode = (): string => {
  return `const utils = require('./runtime-utils');

function pruneContext(context) {
  const pruned = {};
  const keys = Object.keys(context);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const val = context[key];
    if (val === undefined || val === null) continue;
    if (typeof val === 'function') continue;
    try {
      const serialized = JSON.stringify(val);
      if (serialized.length > 100000) {
        pruned[key] = { __truncated: true, type: typeof val };
      } else {
        pruned[key] = val;
      }
    } catch(e) {
      pruned[key] = { __serializationError: true };
    }
  }
  return pruned;
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
  context[workflowConfig.triggerNodeId] = triggerContext;
  if (triggerContext) {
    if (triggerContext.__stateValues) context.__stateValues = triggerContext.__stateValues;
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
          await utils.executeNodes(info.onStreamNodes, allEdges, context, clientHandlers, workflowConfig, null, executionId);
          for (let sni = 0; sni < info.onStreamNodes.length; sni++) {
            handledNodeIds[info.onStreamNodes[sni].id] = true;
          }
        }
      } else if (data.type === 'node-result' && data.nodeId) {
        context[data.nodeId] = data.result;
      } else if (data.type === 'done') {
        if (data.results) {
          const rKeys = Object.keys(data.results);
          for (let rk = 0; rk < rKeys.length; rk++) {
            context[rKeys[rk]] = data.results[rKeys[rk]];
          }
        }
        const streamedKeys = Object.keys(streamedNodeIds);
        for (let sk = 0; sk < streamedKeys.length; sk++) {
          const endInfo = streamingInfo[streamedKeys[sk]];
          if (endInfo && endInfo.onEndNodes.length > 0) {
            await utils.executeNodes(endInfo.onEndNodes, allEdges, context, clientHandlers, workflowConfig, null, executionId);
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
          if (serverResults) Object.assign(context, serverResults);
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

module.exports = { executeWorkflowWithSegments, callServerSegment, callStreamingServerSegment, findStreamingAINodes };
`
}

export const generateServerRuntimeCode = (): string => {
  return `const utils = require('./runtime-utils');

module.exports = utils;
`
}
