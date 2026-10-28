import {
  UIDLWorkflow,
  UIDLWorkflows,
  UIDLWorkflowNode,
  UIDLWorkflowEdge,
  UIDLWebhookConfig,
  UIDLCustomWorkflowNode,
  UIDLWorkflowProtection,
} from '@teleporthq/teleport-types'
import { WorkflowSegment } from './types'
import { SegmentTrust } from './segment-trust'
import { securityRuntimeSpecifier } from './security-runtime/security-runtime-code'
import { isCostBearingNodeType } from './nodes/cost-bearing-node-types'
import { nodeRegistry } from './nodes'
import { NodeHandlerGenerator, ServerHandlerOptions, resolveHandlerEntryName } from './nodes/types'
import { generalWait } from './nodes/general/general-wait'
import { needsVisitorRequest, VISITOR_REQUEST_INJECTION } from './nodes/general/visitor-request'
import {
  markVisitorBoundMessageNodes,
  markWebhookMessageNodes,
  PUBLIC_CALLER_INJECTION,
} from './nodes/email/outbound-message-guard'
import { AI_PUBLIC_REFUSALS } from './nodes/ai/ai-provider-utils'
import { AUTOMATION_HANDLERS_PATH, automationEventType } from './automations/automations-scope'
import { AI_NODE_TYPES, collectCalledCustomNodeTypes } from './graph-utils'
import {
  generateWebhookBodyCode,
  generateAllSignatureVerificationCode,
  generatePaymentWebhookVerificationCode,
} from './webhook-signature-verification'
import { buildWorkflowAuthInjection } from './workflow-auth-generator'
import { buildVisitorStepLimitGuard } from './visitor-step-limits'
import {
  hasEmailSendingNodeType,
  isEmailSendingNodeType,
} from './sent-email-log/sent-email-log-scope'
import { workflowUtilsAliasLine } from './workflow-utils-alias'
import { adminCustomNodesRequireLine } from './custom-node-modules'
import { generateServerCustomNodeCallCode } from './server-custom-node-call'
import {
  generatePaymentDriversPreamble,
  isPaymentWebhookConfig,
  readWebhookPaymentProvider,
} from './payments'
import { usesPaymentDriverNode } from './payments/payment-drivers-scope'
import { generateCartPricingPreamble } from './cart-pricing-preamble'
import {
  WEBHOOK_DELIVERY_LEASE_FILE_NAME,
  WEBHOOK_DELIVERY_LEASE_PATH,
  WEBHOOK_DELIVERY_RETRY_AFTER_SECONDS,
} from './webhook-delivery-lease/webhook-delivery-lease-scope'
import { generateCronRequestVerificationCode } from './cron-request-verification'

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

/**
 * Where a server segment's branches can begin: a node with a predecessor
 * outside the segment, or with none at all. The splitter computes it over the
 * whole workflow; a segment built without it falls back to the nodes nothing
 * inside the segment leads to.
 */
const resolveSegmentEntryNodeIds = (segment: WorkflowSegment): string[] => {
  if (segment.entryNodeIds) {
    return segment.entryNodeIds
  }
  const targets = new Set(segment.edges.map((e) => e.target))
  return segment.nodes.filter((n) => !targets.has(n.id)).map((n) => n.id)
}

export interface ServerSegmentRouteOptions {
  /** A custom node's inner node ids, in the order its runner lists them. */
  customNodeIds?: string[]
  /**
   * What the route may believe about results earlier segments of the same
   * graph hand it (see segment-trust.ts). Every route the project plugin
   * emits carries it.
   */
  trust?: SegmentTrust
  /**
   * The project's custom nodes: a custom node this segment runs itself (a
   * server-only one, see server-custom-node-call.ts) is gated like the steps
   * it runs.
   */
  customNodes?: Record<string, UIDLCustomWorkflowNode>
}

export { isCostBearingNodeType }

/** Per visitor address, per route: a minute's and a day's allowance. */
export const COST_BEARING_STEP_LIMITS = { perMinute: 30, perDay: 300 }

/** What a visitor sees when a step fails; the detail stays in the server log. */
export const SEGMENT_PUBLIC_ERROR = 'Something went wrong. Please try again.'

/** What a segment route reads about the visitor (SEGMENT_CONFIG.session). */
interface SegmentRouteSession {
  identityNodes: Record<string, string>
  identityReads: Record<string, string[]>
  bindings?: unknown[]
}

/**
 * The visitor's identity a route reads: what the graph says (current-user
 * readers, identity-filtered reads, {{Current User.*}} tokens — see
 * segment-trust.ts) plus the route's `userScoped` identity columns, which the
 * route binds again after the node that produces them has run.
 */
const resolveSegmentSession = (
  options: ServerSegmentRouteOptions,
  protection: UIDLWorkflowProtection | undefined
): SegmentRouteSession | undefined => {
  const needs = options.trust?.session
  const bindings = (protection?.userScoped?.bindings || []) as unknown[]
  if (!needs && bindings.length === 0) {
    return undefined
  }
  return {
    identityNodes: needs?.identityNodes || {},
    identityReads: needs?.identityReads || {},
    ...(bindings.length > 0 ? { bindings } : {}),
  }
}

/**
 * The env var names a segment's node configs reference (project-secret
 * references): a reply never carries one, even inside a node's error result.
 */
const collectSecretNames = (segment: WorkflowSegment): string[] => {
  const names = new Set<string>()
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      if (/^WORKFLOW_SECRET_[A-Za-z0-9_]+$/.test(value)) {
        names.add(value)
      } else if (value.indexOf('teleporthq.secrets.') === 0 && value.length > 19) {
        names.add(value.slice(19))
      }
      return
    }
    if (!value || typeof value !== 'object') {
      return
    }
    const ref = value as { type?: unknown; content?: { referenceType?: unknown; id?: unknown } }
    if (
      ref.type === 'dynamic' &&
      ref.content &&
      ref.content.referenceType === 'secret' &&
      typeof ref.content.id === 'string' &&
      ref.content.id
    ) {
      names.add(ref.content.id)
      return
    }
    Object.keys(value as Record<string, unknown>).forEach((key) =>
      walk((value as Record<string, unknown>)[key])
    )
  }
  segment.nodes.forEach((n) => walk(n.config))
  return Array.from(names).sort()
}

/**
 * Whether `nodes` run a cost-bearing step, themselves or through a custom node
 * they call (transitively): in-process, a server-only custom node's own
 * segments are internal calls, which the gate does not count.
 */
const runsCostBearingStep = (
  nodes: UIDLWorkflowNode[],
  customNodes: Record<string, UIDLCustomWorkflowNode> | undefined,
  visited: Set<string> = new Set<string>()
): boolean =>
  nodes.some((n) => {
    if (isCostBearingNodeType(n.type)) {
      return true
    }
    const customNodeId = ((n.config || {}) as Record<string, unknown>).customNodeId
    if (n.type !== 'general-custom-node' || typeof customNodeId !== 'string') {
      return false
    }
    if (visited.has(customNodeId)) {
      return false
    }
    visited.add(customNodeId)
    const called = customNodes ? customNodes[customNodeId] : undefined
    return !!called && runsCostBearingStep(called.nodes || [], customNodes, visited)
  })

/**
 * The rate-limit scope of a segment route that runs a cost-bearing step, else
 * null. Its own prefix: `workflow-step:<nodeId>` is a step's declared visitor
 * limit (visitor-step-limits.ts).
 */
const resolveAbuseScope = (
  segment: WorkflowSegment,
  workflowName: string | undefined,
  options: ServerSegmentRouteOptions
): string | null => {
  if (!runsCostBearingStep(segment.nodes, options.customNodes)) {
    return null
  }
  const owner = options.trust?.workflowId || workflowName || 'workflow'
  return `workflow-route:${owner}:${segment.id}`
}

const SEGMENT_SECURITY_RUNTIME = securityRuntimeSpecifier('../../..')

/**
 * Module-level code every segment route carries: the shared security runtime
 * (required guarded, so a route still loads where it is absent — the abuse
 * gate then refuses), the generic error a visitor sees, and the log line its
 * detail goes to under the same opaque id.
 */
const SEGMENT_SECURITY_PREAMBLE = `// The shared security runtime: the generic error a visitor is shown (its detail
// stays in the server log, under the id the visitor sees) and the rate limit of
// a step that spends the site's money.
var __security = null;
try { __security = require('${SEGMENT_SECURITY_RUNTIME}'); } catch (_e) { __security = null; }
var __PUBLIC_ERROR = ${JSON.stringify(SEGMENT_PUBLIC_ERROR)};
// The refusals that name nothing secret (an AI step: a prompt too long, the
// site's daily AI budget spent, AI unavailable) are shown as they are, with
// their status; any other error is the generic one.
var __PUBLIC_REFUSALS = ${JSON.stringify(AI_PUBLIC_REFUSALS)};
function __publicRefusal(error) {
  var message = error && typeof error.message === 'string' ? error.message : '';
  return Object.prototype.hasOwnProperty.call(__PUBLIC_REFUSALS, message) ? message : null;
}
// Answers the generic error (when \`res\` can still answer) and logs \`error\`;
// returns the id the log line carries. An error the server runtime raised for
// the visitor to read (\`__tqPublic\`: a run that expired) keeps its message.
function __clientError(res, error) {
  var own = error && error.__tqPublic && typeof error.__tqPublic.message === 'string' ? error.__tqPublic : null;
  var refusal = own ? own.message : __publicRefusal(error);
  var status = own ? own.status : refusal ? __PUBLIC_REFUSALS[refusal] : 500;
  var message = refusal || __PUBLIC_ERROR;
  if (__security && typeof __security.sendClientError === 'function') {
    return __security.sendClientError(res, status, message, error);
  }
  console.error('Workflow segment error:', error);
  if (res && !res.headersSent && typeof res.status === 'function') {
    res.status(status).json({ error: message });
  }
  return null;
}
// What a parallel branch that failed reports: the generic error and its log id.
function __branchError(error) {
  var id = __clientError({ headersSent: true }, error);
  var message = __publicRefusal(error) || __PUBLIC_ERROR;
  return id ? message + ' (' + id + ')' : message;
}
`

/**
 * First thing a segment route does when its segment spends the site's money
 * or reaches outside it: count the visitor against this route, whatever the
 * page's protection. This deployment's own server code (a webhook or cron
 * running a custom node) carries the internal-call token and is not counted.
 */
const generateAbuseGateCode = (scope: string | null): string => {
  if (!scope) {
    return ''
  }
  const { perMinute, perDay } = COST_BEARING_STEP_LIMITS
  const scopeLiteral = JSON.stringify(scope)
  return `
    // This step spends the site's money or reaches outside it (an AI model, a
    // mail, SMS or payment provider, another site): every visitor address is
    // allowed ${perMinute} calls a minute and ${perDay} a day here, whatever the page's
    // protection. This deployment's own server code is not a visitor.
    if (!utils.isInternalCall(req)) {
      if (!__security) {
        res.status(503).json({ error: 'This action is unavailable right now.' });
        return;
      }
      var __minute = { scope: ${scopeLiteral}, limit: ${perMinute}, windowSeconds: 60 };
      if (!(await __security.rateLimitRequest(req, res, __minute))) return;
      var __day = { scope: ${scopeLiteral}, limit: ${perDay}, windowSeconds: 86400 };
      if (!(await __security.rateLimitRequest(req, res, __day))) return;
    }`
}

/** The session binding a route that reads the visitor runs before its guard and its nodes. */
const generateSessionBindCode = (session: SegmentRouteSession | undefined): string =>
  session
    ? `
    // Who the visitor is comes from the session cookie, never from the request
    // (see bindSessionIdentity in the server runtime).
    await utils.bindSessionIdentity(req, SEGMENT_CONFIG, context);`
    : ''

/** Module-level: the handlers that read or bind the visitor's identity, wrapped. */
const generateSessionHandlersCode = (session: SegmentRouteSession | undefined): string =>
  session && (Object.keys(session.identityReads).length > 0 || (session.bindings || []).length > 0)
    ? `// Identity-filtered reads and userScoped identity columns (see
// bindSessionHandlers in the server runtime).
utils.bindSessionHandlers(SEGMENT_CONFIG, nodeHandlers);
`
    : ''

const buildSegmentConfig = (
  segment: WorkflowSegment,
  options: ServerSegmentRouteOptions,
  session?: SegmentRouteSession
): string => {
  const secretNames = collectSecretNames(segment)
  return JSON.stringify(
    {
      ...(options.trust || {}),
      session,
      ...(secretNames.length > 0 ? { secretNames } : {}),
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
      entryNodeIds: resolveSegmentEntryNodeIds(segment),
      ...(options.customNodeIds ? { customNodeIds: options.customNodeIds } : {}),
    },
    null,
    2
  )
}

export const generateServerSegmentAPIRoute = (
  segment: WorkflowSegment,
  workflowName?: string,
  protection?: UIDLWorkflowProtection,
  options: ServerSegmentRouteOptions = {}
): string => {
  const usedNodeTypes = new Set(segment.nodes.map((n) => n.type))
  const nodeHandlersEntries = generateNodeHandlersForSegment(usedNodeTypes, true)
  const auth = buildWorkflowAuthInjection(protection)
  const session = resolveSegmentSession(options, protection)
  const abuseScope = resolveAbuseScope(segment, workflowName, options)

  const segmentConfig = buildSegmentConfig(
    markVisitorBoundMessageNodes(segment, options.trust, protection, workflowName),
    options,
    session
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

  const requestInjection = needsVisitorRequest(usedNodeTypes) ? VISITOR_REQUEST_INJECTION : ''

  return `${header}
const utils = require('../../../utils/workflows/server-runtime');
${auth.requireLine}const resolveNodeConfig = utils.resolveNodeConfig;
${workflowUtilsAliasLine('utils')}
${generateCartPricingPreamble(usedNodeTypes, '../../..')}${generateSentEmailLogPreamble(
    usedNodeTypes,
    '../../..'
  )}${generatePaymentDriversPreamble(usesPaymentDriverNode(usedNodeTypes), '../../..')}
${SEGMENT_SECURITY_PREAMBLE}
const SEGMENT_CONFIG = ${segmentConfig};
${auth.policyConst}
const nodeHandlers = {
${nodeHandlersEntries}
};
${generateServerCustomNodeCallCode(segment, '../../..')}${generateSessionHandlersCode(session)}
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  // Kept outside the try so the catch below can still drain any fire-and-forget
  // query this segment started before it failed.
  var __wfContext = null;
  try {${generateAbuseGateCode(abuseScope)}
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const incomingContext = body.context || {};
    // What the caller already holds, so the reply below carries only what this
    // run produced or changed (see segmentReply in runtime-utils).
    const __incomingSnapshot = utils.snapshotIncomingContext(incomingContext);

    const context = Object.assign({}, incomingContext);
    utils.claimSegmentContext(SEGMENT_CONFIG, context);
    __wfContext = context;${generateSessionBindCode(session)}
    // Created eagerly so a custom node invoked from here shares the SAME
    // fire-and-forget queue (it shallow-copies this context) and its queries
    // are drained by the settle below rather than being lost when we reply.
    context.__pendingNodePromises = [];${requestInjection}
    // Where this deployment calls its own routes — never a host the request
    // named (see trustedBaseUrl in the server runtime).
    context.__baseUrl = utils.trustedBaseUrl(req);
    // Credentials for this deployment's calls to its own /api/data routes —
    // without them a protected deployment 401s itself and every data node
    // returns no rows. See internalRequestHeaders in runtime-utils.
    context.__internalHeaders = utils.internalRequestHeaders(req);
    // A server job's hop — a webhook, cron or automation running a custom
    // node, which calls this route with the internal-call token only this
    // deployment's server code can mint — stays the job's: its data calls keep
    // the server-job flag (see __dataIsServerJob). A browser's request never
    // carries the token, so never the flag.
    if (utils.isInternalCall(req) && req.headers && req.headers['x-tq-server-job'] === '1') {
      context.__internalHeaders['x-tq-server-job'] = '1';
    }
    // The language of the page this run started on — carried by the client
    // context, else read off the request — so a customer email node sends the
    // copy that matches the storefront the visitor is browsing.
    context.__locale = utils.resolveWorkflowLocale(req, incomingContext);${
      auth.guardCall
    }${buildVisitorStepLimitGuard(segment)}
    const sortedNodes = SEGMENT_CONFIG.nodes.slice().sort(function(a, b) { return a.stepNumber - b.stepNumber; });

    for (let i = 0; i < sortedNodes.length; i++) {
      const node = sortedNodes[i];
      // A node of a non-taken if-statement branch is never resolved nor run —
      // an if-statement there included: evaluated, its \`{ result }\` would reach
      // the caller as if that branch had run (a custom node answers the output
      // of the last node it ran).
      if (context.__skippedNodes && context.__skippedNodes[node.id]) continue;
      const resolved = resolveNodeConfig(node, context);
      // Every data node lives in a SERVER segment, so this guard — which turns an
      // unresolved {{…}} into a validation error instead of letting the literal
      // token reach SQL — was doing nothing at all: it ran only in the CLIENT
      // executor. Run 02783f65 shipped 55 route files, none of which called it.
      const __configError = utils.finalizeResolvedConfig(node.type, resolved);
      if (__configError) { throw new Error(__configError); }
      resolved.__nodeId = node.id;

      // If-statement nodes must be evaluated using the runtime's evaluateCondition
      // rather than the stub handler, which always returns { result: true }.
      // After evaluating, mark the non-taken branch nodes as skipped.
      if (node.type === 'general-if-statement') {
        const condResult = utils.evaluateCondition(resolved, context, node.config);
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
          context[node.id] = utils.loopIterationContext(collection, li);
          for (var bi = 0; bi < bodyNodes.length; bi++) {
            var bNode = bodyNodes[bi];
            var bResolved = resolveNodeConfig(bNode, context);
            bResolved.__nodeId = bNode.id;
            if (bNode.type === 'general-if-statement') {
              context[bNode.id] = { result: utils.evaluateCondition(bResolved, context, bNode.config) };
              continue;
            }
            var bHandler = nodeHandlers[bNode.type];
            if (!bHandler) continue;
            if (utils.isFireAndForgetNode(bNode)) {
              utils.registerPendingNodePromise(context, utils.startFireAndForgetNode(bNode, bHandler, bResolved, context));
              context[bNode.id] = null;
              continue;
            }
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
        // Only an authored case expression is compiled; request text is data
        // (see matchSwitchCase in runtime-utils).
        var matchedCase = utils.matchSwitchCase(node.config, resolved, context);
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
              var pRes = resolveNodeConfig(pNode, branchCtx);
              pRes.__nodeId = pNode.id;
              var pHandler = nodeHandlers[pNode.type];
              if (!pHandler) continue;
              if (utils.isFireAndForgetNode(pNode)) {
                // Registered on the ROUTE context (not the branch copy) so the
                // response still waits for the query to land.
                utils.registerPendingNodePromise(context, utils.startFireAndForgetNode(pNode, pHandler, pRes, branchCtx));
                branchCtx[pNode.id] = null;
                continue;
              }
              var pResult = await pHandler(pRes, branchCtx);
              branchCtx[pNode.id] = pResult;
            }
            return branchCtx;
          })().then(function(bc) {
            branchNodes.forEach(function(bn) { context[bn.id] = bc[bn.id]; });
            return { success: true };
          }).catch(function(err) {
            // The branch result reaches the browser: the detail stays in the log.
            return { success: false, error: __branchError(err) };
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
      if (utils.isFireAndForgetNode(node)) {
        utils.registerPendingNodePromise(context, utils.startFireAndForgetNode(node, handler, resolved, context));
        context[node.id] = null;
        continue;
      }
      const result = await handler(resolved, context);
      if (result && result.__earlyResponse) {
        var earlyRes = result.__earlyResponse;
        var hKeys = Object.keys(earlyRes.headers || {});
        for (var h = 0; h < hKeys.length; h++) {
          res.setHeader(hKeys[h], earlyRes.headers[hKeys[h]]);
        }
        await utils.handOffPendingNodePromises(context);
        res.status(earlyRes.status || 500).json(earlyRes.body || {});
        return;
      }
      if (utils.isFatalNodeResult(result) && !utils.continuesOnError(node)) {
        throw new Error(utils.fatalNodeResultMessage(result));
      }
      context[node.id] = result;
      if (result && result.__terminal) break;
    }

    // Every not-awaited step must still land: the platform may freeze this
    // function the moment the response is sent, which would drop the work. On
    // Vercel it finishes after the reply (waitUntil); elsewhere the reply waits
    // for it (see handOffPendingNodePromises in the server runtime).
    await utils.handOffPendingNodePromises(context);
    delete context.__request;
    delete context.__pendingNodePromises;
    // MUST be stripped before replying: the results payload below IS this
    // context, serialized straight to the browser. __internalHeaders carries
    // the visitor's forwarded cookie, and writing it into a JS-readable
    // response body would hand the session token to any script on the page,
    // undoing the httpOnly flag it was set with.
    delete context.__internalHeaders;
    res.status(200).json({ success: true, results: utils.segmentReply(SEGMENT_CONFIG, context, __incomingSnapshot) });
  } catch (error) {
    if (__wfContext) { await utils.handOffPendingNodePromises(__wfContext); }
    // A generic error and an opaque id: a driver, provider or secret-name
    // detail never reaches the browser (it is logged under the same id).
    __clientError(res, error);
  }
};
`
}

export const hasStreamingAINode = (segment: WorkflowSegment): boolean => {
  return segment.nodes.some((n) => AI_NODE_TYPES.has(n.type) && n.config?.streaming === true)
}

export const generateStreamingServerSegmentAPIRoute = (
  segment: WorkflowSegment,
  workflowName?: string,
  protection?: UIDLWorkflowProtection,
  options: ServerSegmentRouteOptions = {}
): string => {
  const usedNodeTypes = new Set(segment.nodes.map((n) => n.type))
  const nodeHandlersEntries = generateNodeHandlersForSegment(usedNodeTypes, true)
  const auth = buildWorkflowAuthInjection(protection)
  const session = resolveSegmentSession(options, protection)
  const abuseScope = resolveAbuseScope(segment, workflowName, options)

  const segmentConfig = buildSegmentConfig(
    markVisitorBoundMessageNodes(segment, options.trust, protection, workflowName),
    options,
    session
  )

  const aiNodeTypes = JSON.stringify(Array.from(AI_NODE_TYPES))

  const header = workflowName
    ? `/**\n * Workflow Streaming Server Segment API Route\n * Workflow: ${sanitizeForBlockComment(
        workflowName
      )}\n * Segment ID: ${sanitizeForBlockComment(segment.id)}\n */\n`
    : `/**\n * Workflow Streaming Server Segment API Route\n * Segment ID: ${sanitizeForBlockComment(
        segment.id
      )}\n */\n`

  const requestInjection = needsVisitorRequest(usedNodeTypes) ? VISITOR_REQUEST_INJECTION : ''

  return `${header}
const utils = require('../../../utils/workflows/server-runtime');
${auth.requireLine}const resolveNodeConfig = utils.resolveNodeConfig;
${workflowUtilsAliasLine('utils')}
${generateCartPricingPreamble(usedNodeTypes, '../../..')}${generateSentEmailLogPreamble(
    usedNodeTypes,
    '../../..'
  )}${generatePaymentDriversPreamble(usesPaymentDriverNode(usedNodeTypes), '../../..')}
${SEGMENT_SECURITY_PREAMBLE}
const SEGMENT_CONFIG = ${segmentConfig};
${auth.policyConst}
const nodeHandlers = {
${nodeHandlersEntries}
};
${generateServerCustomNodeCallCode(segment, '../../..')}${generateSessionHandlersCode(session)}
const __streamingAITypes = ${aiNodeTypes};

function __isStreamingAI(node, config) {
  return config && config.streaming && __streamingAITypes.indexOf(node.type) >= 0;
}

// One node's result to the browser — never one kept on the server nor a
// credential (the closing reply carries that one sealed), and a data node's
// rows without the users table's credentials (see segmentReply).
const __credentialResultIds = utils.credentialResultNodeIds(SEGMENT_CONFIG);
function __streamNodeResult(res, nodeId, result) {
  if (__credentialResultIds[nodeId]) return;
  const kept = SEGMENT_CONFIG.nodes.find(function(nd) { return nd.id === nodeId; });
  if (kept && kept.config && kept.config.keepResultOnServer === true && !utils.isBranchingNodeType(kept.type)) return;
  res.write('data: ' + JSON.stringify({ type: 'node-result', nodeId: nodeId, result: utils.scrubSecretNames(SEGMENT_CONFIG, utils.withoutCredentialColumns(kept, result)) }) + '\\n\\n');
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

  // Kept outside the try so the catch below can still drain any fire-and-forget
  // query this segment started before it failed.
  var __wfContext = null;
  try {${generateAbuseGateCode(abuseScope)}
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const context = Object.assign({}, body.context || {});
    // See the non-streaming segment route: the reply carries only what changed.
    const __incomingSnapshot = utils.snapshotIncomingContext(body.context || {});
    utils.claimSegmentContext(SEGMENT_CONFIG, context);
    __wfContext = context;${generateSessionBindCode(session)}
    // See the non-streaming segment route — shared queue for nested custom nodes.
    context.__pendingNodePromises = [];${requestInjection}
    // Where this deployment calls its own routes — never a host the request
    // named (see trustedBaseUrl in the server runtime).
    context.__baseUrl = utils.trustedBaseUrl(req);
    // Credentials for this deployment's calls to its own /api/data routes —
    // without them a protected deployment 401s itself and every data node
    // returns no rows. See internalRequestHeaders in runtime-utils.
    context.__internalHeaders = utils.internalRequestHeaders(req);
    // A server job's hop — a webhook, cron or automation running a custom
    // node, which calls this route with the internal-call token only this
    // deployment's server code can mint — stays the job's: its data calls keep
    // the server-job flag (see __dataIsServerJob). A browser's request never
    // carries the token, so never the flag.
    if (utils.isInternalCall(req) && req.headers && req.headers['x-tq-server-job'] === '1') {
      context.__internalHeaders['x-tq-server-job'] = '1';
    }
    // See the non-streaming segment route: the run's language.
    context.__locale = utils.resolveWorkflowLocale(req, body.context);${
      auth.guardCall
    }${buildVisitorStepLimitGuard(segment)}
    const sortedNodes = SEGMENT_CONFIG.nodes.slice().sort(function(a, b) { return a.stepNumber - b.stepNumber; });
    const executed = {};

    for (let i = 0; i < sortedNodes.length; i++) {
      const node = sortedNodes[i];
      if (executed[node.id]) continue;
      const resolved = resolveNodeConfig(node, context);
      // See the non-streaming segment above — without this the unresolved-token
      // guard never runs on the server, which is where every data node executes.
      const __configError = utils.finalizeResolvedConfig(node.type, resolved);
      if (__configError) { throw new Error(__configError); }
      resolved.__nodeId = node.id;

      // If-statement nodes must be evaluated using the runtime's evaluateCondition
      if (node.type === 'general-if-statement') {
        const condResult = utils.evaluateCondition(resolved, context, node.config);
        context[node.id] = { result: condResult };
        executed[node.id] = true;
        if (streamStarted) {
          __streamNodeResult(res, node.id, context[node.id]);
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
          context[node.id] = utils.loopIterationContext(ssLoopCollection, ssli);
          for (var ssbi = 0; ssbi < ssBodyNodes.length; ssbi++) {
            var ssbNode = ssBodyNodes[ssbi];
            var ssbRes = resolveNodeConfig(ssbNode, context);
            ssbRes.__nodeId = ssbNode.id;
            if (ssbNode.type === 'general-if-statement') {
              context[ssbNode.id] = { result: utils.evaluateCondition(ssbRes, context, ssbNode.config) };
              continue;
            }
            var ssbHandler = nodeHandlers[ssbNode.type];
            if (!ssbHandler) continue;
            if (utils.isFireAndForgetNode(ssbNode)) {
              utils.registerPendingNodePromise(context, utils.startFireAndForgetNode(ssbNode, ssbHandler, ssbRes, context));
              context[ssbNode.id] = null;
              continue;
            }
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
          __streamNodeResult(res, node.id, context[node.id]);
        }
        continue;
      }

      // Switch nodes in streaming segments
      if (node.type === 'general-switch') {
        // See the non-streaming segment route: only authored expressions run.
        var ssMatchedCase = utils.matchSwitchCase(node.config, resolved, context);
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
          __streamNodeResult(res, node.id, context[node.id]);
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
              var sspRes = resolveNodeConfig(sspNode, ssPBranchCtx);
              sspRes.__nodeId = sspNode.id;
              var sspHandler = nodeHandlers[sspNode.type];
              if (!sspHandler) continue;
              if (utils.isFireAndForgetNode(sspNode)) {
                // Registered on the ROUTE context (not the branch copy) so the
                // response still waits for the query to land.
                utils.registerPendingNodePromise(context, utils.startFireAndForgetNode(sspNode, sspHandler, sspRes, ssPBranchCtx));
                ssPBranchCtx[sspNode.id] = null;
                continue;
              }
              var sspResult = await sspHandler(sspRes, ssPBranchCtx);
              ssPBranchCtx[sspNode.id] = sspResult;
            }
            return ssPBranchCtx;
          })().then(function(bc) {
            ssPBranchNodes.forEach(function(bn) { context[bn.id] = bc[bn.id]; });
            return { success: true };
          }).catch(function(err) {
            // The branch result reaches the browser: the detail stays in the log.
            return { success: false, error: __branchError(err) };
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
          __streamNodeResult(res, node.id, context[node.id]);
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
          context[node.id] = { chunk: chunkData.chunk, fullResponse: chunkData.fullResponse };
          res.write('data: ' + JSON.stringify({
            type: 'chunk',
            nodeId: node.id,
            chunk: chunkData.chunk,
            fullResponse: chunkData.fullResponse
          }) + '\\n\\n');
          for (let si = 0; si < onStreamNodes.length; si++) {
            const sn = onStreamNodes[si];
            const snHandler = nodeHandlers[sn.type];
            if (!snHandler) continue;
            const snResolved = resolveNodeConfig(sn, context);
            snResolved.__nodeId = sn.id;
            if (utils.isFireAndForgetNode(sn)) {
              utils.registerPendingNodePromise(context, utils.startFireAndForgetNode(sn, snHandler, snResolved, context));
              context[sn.id] = null;
              continue;
            }
            const snResult = await snHandler(snResolved, context);
            context[sn.id] = snResult;
            __streamNodeResult(res, sn.id, snResult);
          }
        });
        // A provider/auth failure surfaces as { error: true, message, code }.
        // Without this gate the on-end branch would run against a failed AI
        // result (e.g. persist a NULL chat answer → NOT NULL 500 downstream).
        if (utils.isFatalNodeResult(result) && !utils.continuesOnError(node)) {
          throw new Error(utils.fatalNodeResultMessage(result));
        }
        context[node.id] = result;
        __streamNodeResult(res, node.id, result);

        for (let oi = 0; oi < onEndNodes.length; oi++) {
          const en = onEndNodes[oi];
          const enHandler = nodeHandlers[en.type];
          if (!enHandler) continue;
          const enResolved = resolveNodeConfig(en, context);
          enResolved.__nodeId = en.id;
          if (utils.isFireAndForgetNode(en)) {
            utils.registerPendingNodePromise(context, utils.startFireAndForgetNode(en, enHandler, enResolved, context));
            context[en.id] = null;
            executed[en.id] = true;
            continue;
          }
          const enResult = await enHandler(enResolved, context);
          context[en.id] = enResult;
          __streamNodeResult(res, en.id, enResult);
          executed[en.id] = true;
        }
        for (let si2 = 0; si2 < onStreamNodes.length; si2++) {
          executed[onStreamNodes[si2].id] = true;
        }
      } else {
        if (utils.isFireAndForgetNode(node)) {
          utils.registerPendingNodePromise(context, utils.startFireAndForgetNode(node, nodeHandler, resolved, context));
          context[node.id] = null;
          continue;
        }
        const result = await nodeHandler(resolved, context);
        if (result && result.__earlyResponse) {
          await utils.handOffPendingNodePromises(context);
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
        if (utils.isFatalNodeResult(result) && !utils.continuesOnError(node)) {
          throw new Error(utils.fatalNodeResultMessage(result));
        }
        context[node.id] = result;
        if (streamStarted) {
          __streamNodeResult(res, node.id, result);
        }
        if (result && result.__terminal) break;
      }
    }

    // See the non-streaming segment route: every not-awaited step must still
    // land, after the reply on Vercel, before it anywhere else.
    await utils.handOffPendingNodePromises(context);
    delete context.__request;
    delete context.__pendingNodePromises;
    // MUST be stripped before replying: the results payload below IS this
    // context, serialized straight to the browser. __internalHeaders carries
    // the visitor's forwarded cookie, and writing it into a JS-readable
    // response body would hand the session token to any script on the page,
    // undoing the httpOnly flag it was set with.
    delete context.__internalHeaders;
    const __reply = utils.segmentReply(SEGMENT_CONFIG, context, __incomingSnapshot);
    if (streamStarted) {
      res.write('data: ' + JSON.stringify({ type: 'done', success: true, results: __reply }) + '\\n\\n');
      res.end();
    } else {
      res.status(200).json({ success: true, results: __reply });
    }
  } catch (error) {
    if (__wfContext) { await utils.handOffPendingNodePromises(__wfContext); }
    // See the non-streaming segment route: a generic error and an opaque id.
    if (streamStarted) {
      var __errorId = __clientError({ headersSent: true }, error);
      try {
        res.write('data: ' + JSON.stringify({ type: 'error', error: __publicRefusal(error) || __PUBLIC_ERROR, id: __errorId }) + '\\n\\n');
      } catch(e) {}
      res.end();
    } else {
      __clientError(res, error);
    }
  }
};
`
}

/**
 * A node an automation cannot run: one that only works in a visitor's
 * browser. The editor refuses them in automations; a handler module that
 * still meets one fails the run with the reason instead of stubbing it the
 * way a webhook route does (a stub would report a step that never happened).
 */
const isBrowserOnlyNode = (nodeType: string, generator: NodeHandlerGenerator | undefined) =>
  CLIENT_ONLY_NODES.has(nodeType) ||
  (!!generator && generator.executionEnv === 'client' && !generator.generateServerHandler)

/**
 * The step types a cron, webhook or automation route needs handlers for: its
 * own, and those of every custom node it calls, recursively — it runs them in
 * process (`utils/workflows/custom-nodes.js`) with this route's handler map. A
 * custom node's browser-only steps stay without one, as before (the runner
 * skips a step it has no handler for).
 */
const jobRouteNodeTypes = (
  ownNodes: UIDLWorkflowNode[],
  customNodes?: Record<string, UIDLCustomWorkflowNode>
): Set<string> => {
  const types = new Set<string>(ownNodes.map((n: UIDLWorkflowNode) => n.type))
  for (const type of collectCalledCustomNodeTypes(ownNodes, customNodes)) {
    if (!isBrowserOnlyNode(type, nodeRegistry[type])) {
      types.add(type)
    }
  }
  return types
}

const generateBrowserOnlyAutomationHandler = (nodeType: string): string => {
  const fnName = nodeType.replace(/-/g, '_')
  return `async function ${fnName}(config, context) {
  throw new Error(${JSON.stringify(
    `The ${nodeType} step only runs in a visitor's browser, so an automation cannot run it`
  )});
}`
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
//      collide — e.g. state-update-local-state and payment-refund can
//      both legitimately mangle down to the same short name. Declared as
//      bare siblings in one shared scope, the second declaration would
//      silently shadow the first, so BOTH map entries end up pointing at the
//      SAME (wrong-for-one-of-them) function — a silent wrong-handler-
//      executes bug, not even a crash. An IIFE per entry gives every handler
//      its own scope, so a same-named collision between two unrelated
//      handlers can never shadow each other.
/**
 * The sent-email ledger hook a route needs when it runs a node that sends
 * mail. Guarded require + a wrapper that degrades to the bare handler, so a
 * route evaluated where the module is absent (a test harness, a stub
 * `require`) still loads. Empty for routes without such a node, which keeps
 * every other route byte-identical.
 */
const generateSentEmailLogPreamble = (
  usedNodeTypes: Set<string>,
  relativePrefix: string
): string => {
  if (!hasEmailSendingNodeType(usedNodeTypes)) {
    return ''
  }
  return `var __sentEmailLog = null;
try { __sentEmailLog = require('${relativePrefix}/utils/email/sent-email-log'); } catch (_e) { __sentEmailLog = null; }
function __wrapEmailHandler(nodeType, handler) {
  return __sentEmailLog && typeof __sentEmailLog.wrapEmailNodeHandler === 'function'
    ? __sentEmailLog.wrapEmailNodeHandler(nodeType, handler)
    : handler;
}
`
}

const generateNodeHandlersForSegment = (
  usedNodeTypes: Set<string>,
  forServer = false,
  automation = false,
  serverHandlerOptions: ServerHandlerOptions = {}
): string => {
  return Array.from(usedNodeTypes)
    .map((nodeType) => {
      const generator =
        automation && nodeType === generalWait.nodeType ? generalWait : nodeRegistry[nodeType]
      let source: string
      if (automation && isBrowserOnlyNode(nodeType, generator)) {
        source = generateBrowserOnlyAutomationHandler(nodeType)
      } else if (generator) {
        if (forServer && generator.generateServerHandler) {
          source = generator.generateServerHandler(serverHandlerOptions)
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
      const handlerExpr = `(function () {\n${trimmed}\nreturn ${entryFn};\n})()`
      // Every server node that sends mail passes through the sent-email
      // ledger (see generateSentEmailLogPreamble, emitted by the same routes).
      if (forServer && isEmailSendingNodeType(nodeType)) {
        return `  '${nodeType}': __wrapEmailHandler('${nodeType}', ${handlerExpr})`
      }
      return `  '${nodeType}': ${handlerExpr}`
    })
    .join(',\n')
}

/**
 * The browser-only nodes a server route drops (and an automation refuses).
 * The editor's copy is `CLIENT_ONLY_NODE_TYPES` in teleport-gui
 * `packages/workflow-schema`; automations-catalog-drift.test.ts compares them.
 */
export const CLIENT_ONLY_NODES = new Set([
  'navigation-go-to-page',
  'navigation-navigate-to-url',
  'navigation-refresh-page',
  'navigation-go-back',
  'element-show',
  'element-hide',
  'element-scroll-to',
  'element-video-control',
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
  'browser-unsubscribe-from-push',
  'browser-get-push-subscription',
  'browser-share',
  'browser-get-device-info',
  'browser-get-network-status',
  'browser-fullscreen',
  'browser-print',
  'browser-text-to-speech',
  'browser-get-media-devices',
  'browser-speech-to-text',
  'browser-speech-recognition',
  'general-trigger-download',
  'general-extract-form-data',
  'general-emit-custom-event',
  'realtime-join-channel',
  'realtime-leave-channel',
  'realtime-list-channels',
  'realtime-list-channel-members',
])

/** What a cron or webhook route is generated for. */
export interface ServerWorkflowRouteOptions {
  /** The project has the in-app event bus (`hasAutomationsBus`). */
  withAutomations?: boolean
}

/**
 * What a cron or webhook route hands its nodes as `context.__request`: the
 * caller's ip for a rate limiter, and the request's headers for a signup in a
 * project with automations, which records its event on the origin the request
 * reached (see account-signup).
 */
const serverRouteRequestInjection = (
  nodeTypes: Set<string>,
  withAutomations: boolean | undefined
): string => {
  if (nodeTypes.has('general-rate-limiter')) {
    return VISITOR_REQUEST_INJECTION
  }
  if (withAutomations && nodeTypes.has('account-signup')) {
    return `\n    // The signup records its event on the origin this request reached.\n    context.__request = { headers: req.headers || {} };`
  }
  return ''
}

export const generateCronAPIRoute = (
  workflow: UIDLWorkflow,
  customNodes?: Record<string, UIDLCustomWorkflowNode>,
  options: ServerWorkflowRouteOptions = {}
): string => {
  const serverNodes = workflow.nodes.filter((n: UIDLWorkflowNode) => !CLIENT_ONLY_NODES.has(n.type))
  const allNodeTypes = jobRouteNodeTypes(serverNodes, customNodes)
  // Cron routes live in pages/api/workflows.
  const nodeHandlersEntries = generateNodeHandlersForSegment(allNodeTypes, true, false, {
    withAutomations: options.withAutomations,
    relativePrefix: '../../..',
  })

  const serverNodeIds = new Set<string>(serverNodes.map((n: UIDLWorkflowNode) => n.id))
  const serverEdges = workflow.edges.filter(
    (e: UIDLWorkflowEdge) => serverNodeIds.has(e.source) || serverNodeIds.has(e.target)
  )

  const hasCustomNodeUsage = serverNodes.some((n) => n.type === 'general-custom-node')
  const hasCustomNodeDefs = !!customNodes && Object.keys(customNodes).length > 0
  const useCustomNodes = hasCustomNodeUsage && hasCustomNodeDefs

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

  const requestInjection = serverRouteRequestInjection(allNodeTypes, options.withAutomations)

  // Cron routes live at pages/api/workflows/<file>.js → three levels up to root.
  const customNodesImport = useCustomNodes
    ? `var __customNodes;\ntry { __customNodes = require('../../../utils/workflows/custom-nodes'); } catch (_e) { __customNodes = {}; }\n${adminCustomNodesRequireLine(
        serverNodes,
        customNodes,
        '../../..'
      )}`
    : ''

  // Reuse the shared execution loop (the same one webhook routes use) so cron
  // workflows support loops, if/switch branching, and per-node templateParams
  // merging (component-bodied emails). Its earlyResponse/terminal handling and
  // sortedNodes declaration are self-contained.
  const executionLoop = generateNodeExecutionLoop('WORKFLOW_CONFIG', {
    hasCustomNodes: useCustomNodes,
  })

  return `/**
 * Workflow Cron API Route
 * Workflow: ${sanitizeForBlockComment(workflow.name || workflow.id)}
 * Trigger: ${sanitizeForBlockComment(String(workflow.trigger.config.schedule || 'cron'))}
 */

const utils = require('../../../utils/workflows/server-runtime');
const resolveNodeConfig = utils.resolveNodeConfig;
${workflowUtilsAliasLine('utils')}
${customNodesImport}${generateCartPricingPreamble(
    allNodeTypes,
    '../../..'
  )}${generateSentEmailLogPreamble(allNodeTypes, '../../..')}${generatePaymentDriversPreamble(
    usesPaymentDriverNode(allNodeTypes),
    '../../..'
  )}
${generateCronRequestVerificationCode()}

const WORKFLOW_CONFIG = ${workflowConfig};

const nodeHandlers = {
${nodeHandlersEntries}
};
module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!verifyCronRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  // Kept outside the try so the catch below can still drain any fire-and-forget
  // work this run started before it failed.
  var __wfContext = null;
  try {
    const triggerContext = { timestamp: Date.now(), schedule: '${
      (workflow.trigger.config.schedule as string) || ''
    }' };
    const context = {};
    __wfContext = context;
    // Shared fire-and-forget queue (see the segment routes) — drained by the
    // execution loop before this route responds.
    context.__pendingNodePromises = [];
    // The store's origin, as crons-worker requested it — custom scripts read
    // it as \`runtime.baseUrl\` instead of touching the environment themselves.
    // Where this deployment calls its own routes — never a host the request
    // named (see trustedBaseUrl in the server runtime).
    context.__baseUrl = utils.trustedBaseUrl(req);
    // Credentials for this deployment's calls to its own /api/data routes —
    // without them a protected deployment 401s itself and every data node
    // returns no rows. See internalRequestHeaders in runtime-utils.
    context.__internalHeaders = utils.internalRequestHeaders(req);
    // A server job: no visitor's request runs here, so the data API reads the
    // customer records unscoped (see __dataIsServerJob; the flag counts only
    // with the app secret, which every data node presents).
    context.__internalHeaders['x-tq-server-job'] = '1';
    context[WORKFLOW_CONFIG.triggerNodeId] = triggerContext;${requestInjection}

${executionLoop}

    res.status(200).json({ success: true, timestamp: Date.now() });
  } catch (error) {
    console.error('Cron workflow error:', error);
    if (__wfContext) { await utils.settlePendingNodePromises(__wfContext); }
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
    // The segment id is short (`server-N`) and must stay whole: an 8-char cap
    // spelled `server-10`, `server-11` and `server-12` as `server-1`, so a
    // workflow with ten or more server segments wrote its last segment over
    // its first and the client's URL map sent the first call to the wrong
    // route — a checkout that charged the buyer before validating the cart.
    return `${safeName}-${idSuffix}-seg-${sanitizeFileName(segmentId)}`
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
  options?: { hasCustomNodes?: boolean; automation?: boolean }
): string => {
  const automation = options?.automation === true
  // An automation handler resumes a parked run at `resumeFrom` (the node
  // after its Wait): the nodes before it ran in the earlier part, and the
  // restored context carries their results and branch decisions.
  const resumeBlock = automation
    ? `
    var __startIndex = 0;
    if (resumeFrom) {
      __startIndex = sortedNodes.findIndex(function(n) { return n.id === resumeFrom; });
      if (__startIndex === -1) { throw new Error('This automation has no step ' + resumeFrom + ' to resume at'); }
    }
`
    : ''
  // An automation has no caller to answer, so a response node only ends the
  // run; a Wait stored the run (see general-wait) and nothing after it runs now.
  const earlyResponseBlock = automation
    ? `
      if (result && result.__earlyResponse) {
        await utils.settlePendingNodePromises(context);
        return { waiting: false };
      }
      if (result && result.__wait) {
        await utils.settlePendingNodePromises(context);
        return { waiting: true, until: result.until, wouldWait: result.wouldWait || null };
      }`
    : `
      if (result && result.__earlyResponse) {
        var earlyRes = result.__earlyResponse;
        var hKeys = Object.keys(earlyRes.headers || {});
        for (var h = 0; h < hKeys.length; h++) {
          res.setHeader(hKeys[h], earlyRes.headers[hKeys[h]]);
        }
        await utils.settlePendingNodePromises(context);
        res.status(earlyRes.status || 500).json(earlyRes.body || {});
        return;
      }`
  // A branch runs on a copy of the context, so a Wait there could neither
  // store the run nor stop it.
  const parallelWaitGuard = automation
    ? `
              if (wlpNode.type === 'general-wait') { throw new Error('A Wait cannot run inside a parallel branch'); }`
    : ''
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
  // A custom node inside a loop body runs once per item, exactly as a
  // top-level one does: its handler only hands back the marker.
  const loopBodyCustomNodeBlock = options?.hasCustomNodes
    ? `
            if (bResult && bResult.__customNode) {
              var bcnFn = typeof __customNodes !== 'undefined' ? __customNodes[bResult.customNodeId] : null;
              context[bNode.id] = bcnFn ? await bcnFn(context, bResult.parameters, nodeHandlers) : null;
              continue;
            }`
    : ''

  return `    var sortedNodes = ${configVar}.nodes.slice().sort(function(a, b) { return a.stepNumber - b.stepNumber; });
${resumeBlock}
    for (var i = ${automation ? '__startIndex' : '0'}; i < sortedNodes.length; i++) {
      var node = sortedNodes[i];
      // Never resolved nor run on a non-taken branch, an if-statement included
      // (see the segment executor above).
      if (context.__skippedNodes && context.__skippedNodes[node.id]) continue;
      var resolved = resolveNodeConfig(node, context);
      // See the other segment executors — the unresolved-token guard must run
      // wherever data nodes execute, and they all execute on the server.
      var __configError = utils.finalizeResolvedConfig(node.type, resolved);
      if (__configError) { throw new Error(__configError); }
      resolved.__nodeId = node.id;

      if (node.type === 'general-if-statement') {
        var condResult = utils.evaluateCondition(resolved, context, node.config);
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
          context[node.id] = utils.loopIterationContext(collection, li);
          for (var bi = 0; bi < bodyNodes.length; bi++) {
            var bNode = bodyNodes[bi];
            var bResolved = resolveNodeConfig(bNode, context);
            bResolved.__nodeId = bNode.id;
            if (bNode.type === 'general-if-statement') {
              context[bNode.id] = { result: utils.evaluateCondition(bResolved, context, bNode.config) };
              continue;
            }
            var bHandler = nodeHandlers[bNode.type];
            if (!bHandler) continue;
            if (utils.isFireAndForgetNode(bNode)) {
              utils.registerPendingNodePromise(context, utils.startFireAndForgetNode(bNode, bHandler, bResolved, context));
              context[bNode.id] = null;
              continue;
            }
            var bResult = await bHandler(bResolved, context);${loopBodyCustomNodeBlock}
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
        // Only an authored case expression is compiled (see matchSwitchCase).
        var swMatchedCase = utils.matchSwitchCase(node.config, resolved, context);
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
              var wlpNode = wlBranchNodes[wlpbi];${parallelWaitGuard}
              var wlpRes = resolveNodeConfig(wlpNode, wlBranchCtx);
              wlpRes.__nodeId = wlpNode.id;
              var wlpHandler = nodeHandlers[wlpNode.type];
              if (!wlpHandler) continue;
              if (utils.isFireAndForgetNode(wlpNode)) {
                // Registered on the ROUTE context (not the branch copy) so the
                // response still waits for the query to land.
                utils.registerPendingNodePromise(context, utils.startFireAndForgetNode(wlpNode, wlpHandler, wlpRes, wlBranchCtx));
                wlBranchCtx[wlpNode.id] = null;
                continue;
              }
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
      if (utils.isFireAndForgetNode(node)) {
        utils.registerPendingNodePromise(context, utils.startFireAndForgetNode(node, handler, resolved, context));
        context[node.id] = null;
        continue;
      }
      var result = await handler(resolved, context);${earlyResponseBlock}${customNodeBlock}
      if (utils.isFatalNodeResult(result) && !utils.continuesOnError(node)) {
        throw new Error(utils.fatalNodeResultMessage(result));
      }
      context[node.id] = result;
      if (result && result.__terminal) break;
    }

    // Land every fire-and-forget query before this route responds — a
    // serverless function can be frozen the instant it replies.
    await utils.settlePendingNodePromises(context);`
}

/** A webhook whose payload a signature vouches for: a payment provider's, or a verified scheme other than `custom`. */
export const isVerifiedWebhookConfig = (webhookConfig: UIDLWebhookConfig): boolean =>
  isPaymentWebhookConfig(webhookConfig) ||
  (!!webhookConfig.verifySignature && webhookConfig.signatureAlgorithm !== 'custom')

export const generateWebhookWorkflowAPIRoute = (
  workflow: UIDLWorkflow,
  customNodes?: Record<string, UIDLCustomWorkflowNode>,
  options: ServerWorkflowRouteOptions = {}
): string => {
  const webhookConfig = workflow.webhookConfig as UIDLWebhookConfig
  const serverNodes = workflow.nodes.filter((n: UIDLWorkflowNode) => !CLIENT_ONLY_NODES.has(n.type))
  const allNodeTypes = jobRouteNodeTypes(serverNodes, customNodes)
  const nodeHandlersEntries = generateNodeHandlersForSegment(allNodeTypes, true, false, {
    withAutomations: options.withAutomations,
    relativePrefix: getWebhookRoutePath(workflow)
      .map(() => '..')
      .join('/'),
  })

  const serverNodeIds = new Set<string>(serverNodes.map((n: UIDLWorkflowNode) => n.id))
  const serverEdges = workflow.edges.filter(
    (e: UIDLWorkflowEdge) => serverNodeIds.has(e.source) || serverNodeIds.has(e.target)
  )

  const hasCustomNodeUsage = serverNodes.some((n) => n.type === 'general-custom-node')
  const hasCustomNodeDefs = customNodes && Object.keys(customNodes).length > 0

  // Without a verified signature the payload is anyone's: email/SMS nodes are
  // marked for the send guard as on a page's route, and so are the sends of
  // the custom nodes it calls (see PUBLIC_CALLER_INJECTION).
  const webhookVerified = isVerifiedWebhookConfig(webhookConfig)
  const webhookMessages = markWebhookMessageNodes(
    workflow,
    serverNodes,
    serverEdges,
    webhookVerified
  )

  const workflowConfig = JSON.stringify(
    {
      triggerNodeId: workflow.trigger.nodeId,
      nodes: webhookMessages.nodes.map((n: UIDLWorkflowNode) => ({
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

  // A payment webhook ALWAYS verifies, through the store's driver for its
  // provider, whatever an older stored trigger said (see
  // readWebhookPaymentProvider): unverified, it would mark orders paid on
  // any request.
  // A trigger set to verify through a payment driver is a payment webhook
  // even when no known provider can be read from it: it still verifies, and
  // with no driver to verify through it refuses every request.
  const paymentProvider = readWebhookPaymentProvider(webhookConfig)
  const isPaymentWebhook = isPaymentWebhookConfig(webhookConfig)
  if (isPaymentWebhook) {
    normalisedWebhookConfig.verifySignature = true
    normalisedWebhookConfig.signatureAlgorithm = 'payment-driver'
    normalisedWebhookConfig.paymentProvider = paymentProvider || ''
  }
  const webhookConfigJson = JSON.stringify(normalisedWebhookConfig, null, 2)
  const signatureVerificationCode = isPaymentWebhook
    ? generatePaymentWebhookVerificationCode()
    : normalisedWebhookConfig.verifySignature
    ? generateAllSignatureVerificationCode()
    : ''
  const webhookBodyCode = generateWebhookBodyCode()

  const errorHandlerNodes = workflow.errorHandler ? getErrorHandlerNodes(workflow) : null
  const errorHandlerNodesJson = errorHandlerNodes
    ? JSON.stringify(errorHandlerNodes, null, 2)
    : 'null'

  const routePath = getWebhookRoutePath(workflow)
  const relativePrefix = routePath.map(() => '..').join('/')
  const deliveryLease = generateWebhookDeliveryLeaseBlocks(isPaymentWebhook, relativePrefix)

  const customNodesImport =
    hasCustomNodeUsage && hasCustomNodeDefs
      ? `var __customNodes;\ntry { __customNodes = require('${relativePrefix}/utils/workflows/custom-nodes'); } catch (_e) { __customNodes = {}; }\n${adminCustomNodesRequireLine(
          serverNodes,
          customNodes,
          relativePrefix
        )}`
      : ''

  const requestInjection =
    (webhookMessages.marked
      ? VISITOR_REQUEST_INJECTION
      : serverRouteRequestInjection(allNodeTypes, options.withAutomations)) +
    (!webhookVerified && hasCustomNodeUsage ? PUBLIC_CALLER_INJECTION : '')

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
const resolveNodeConfig = utils.resolveNodeConfig;
${workflowUtilsAliasLine('utils')}
${customNodesImport}${generateCartPricingPreamble(
    allNodeTypes,
    relativePrefix
  )}${generateSentEmailLogPreamble(allNodeTypes, relativePrefix)}${generatePaymentDriversPreamble(
    usesPaymentDriverNode(allNodeTypes) || isPaymentWebhook,
    relativePrefix
  )}${deliveryLease.preamble}
${webhookBodyCode}

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
${deliveryLease.declare}
  try {
    var rawBody = await getRawBody(req);
    var body = parseWebhookBody(req, rawBody);

    var isSignatureValid = true;
${generateSignatureVerificationBlock(normalisedWebhookConfig)}${deliveryLease.claim}

    var triggerContext = {
      headers: req.headers,
      body: body,
      query: req.query || {},
      method: req.method,
      path: req.url,
      isSignatureValid: isSignatureValid,
    };

    var context = {};
    // Shared fire-and-forget queue (see the segment routes) — drained by the
    // execution loop before this route responds.
    context.__pendingNodePromises = [];
    context[WORKFLOW_CONFIG.triggerNodeId] = triggerContext;
    // Where this deployment calls its own routes — never a host the request
    // named (see trustedBaseUrl in the server runtime).
    context.__baseUrl = utils.trustedBaseUrl(req);
    // Credentials for this deployment's calls to its own /api/data routes —
    // without them a protected deployment 401s itself and every data node
    // returns no rows. See internalRequestHeaders in runtime-utils.
    context.__internalHeaders = utils.internalRequestHeaders(req);
    // A server job: no visitor's request runs here, so the data API reads the
    // customer records unscoped (see __dataIsServerJob; the flag counts only
    // with the app secret, which every data node presents).
    context.__internalHeaders['x-tq-server-job'] = '1';${requestInjection}

${executionLoop}
${deliveryLease.release}
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook workflow error:', error);
${generateErrorHandlerRunBlock('Webhook error handler failed:')}
    // Land whatever the main run started (an email's ledger row, a
    // fire-and-forget write) before replying — see the segment routes.
    if (typeof context !== 'undefined' && context) { await utils.settlePendingNodePromises(context); }${
      deliveryLease.release
    }
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

module.exports.config = { api: { bodyParser: false } };
`
}

/**
 * Runs the workflow's error-handler branch (`ERROR_HANDLER_NODES`) after the
 * main run threw `error`, on a copy of `context` that carries the error. A
 * failure of the branch itself is only logged, with `failureLabel`.
 */
const generateErrorHandlerRunBlock = (
  failureLabel: string
): string => `    if (ERROR_HANDLER_NODES) {
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
          var eResolved = resolveNodeConfig(eNode, errCtx);
          eResolved.__nodeId = eNode.id;
          var eHandler = nodeHandlers[eNode.type];
          if (eHandler) {
            if (utils.isFireAndForgetNode(eNode)) {
              utils.registerPendingNodePromise(errCtx, utils.startFireAndForgetNode(eNode, eHandler, eResolved, errCtx));
              errCtx[eNode.id] = null;
              continue;
            }
            var eResult = await eHandler(eResolved, errCtx);
            errCtx[eNode.id] = eResult;
          }
        }
        await utils.settlePendingNodePromises(errCtx);
      } catch (innerErr) {
        console.error('${failureLabel}', innerErr);
      }
    }`

/**
 * An automation's handler module (`lib/automations/handlers/<file>.js`, see
 * automations/handler-module-generator.ts): the webhook route's node loop as
 * an importable function, `module.exports.run = async (event, context,
 * resumeFrom)`, which the in-app dispatcher awaits.
 *
 * - `event` is the event envelope (`{ event, actor, <entity> }`): the trigger
 *   node's output. A resumed run passes it again, read afresh.
 * - `context` is `{}` for a new run (plus `__baseUrl` when the dispatcher
 *   knows the app's origin), or the context a Wait stored.
 * - `resumeFrom` is the node to resume at; every node before it ran already.
 *
 * Every node runs as in a webhook route — server handlers, the same
 * `__baseUrl` / internal headers, the error-handler branch — except the
 * browser-only ones, which fail the run, and a Wait (`general-wait`), which
 * stores the run and resolves `{ waiting: true }` (a test event's Wait stores
 * nothing and resolves `{ waiting: true, wouldWait }`; a Wait with no step
 * after it stores nothing and the run ends there). A run that fails rejects,
 * after the error-handler branch ran, so the dispatcher records the failure.
 */
export const generateHandlerFunction = (
  workflow: UIDLWorkflow,
  customNodes?: Record<string, UIDLCustomWorkflowNode>
): string => {
  const relativePrefix = AUTOMATION_HANDLERS_PATH.map(() => '..').join('/')
  const nodes = workflow.nodes || []
  const allNodeTypes = jobRouteNodeTypes(nodes, customNodes)
  // An automation runs only in a project that has the event bus.
  const nodeHandlersEntries = generateNodeHandlersForSegment(allNodeTypes, true, true, {
    withAutomations: true,
    relativePrefix,
  })

  const hasCustomNodeUsage = nodes.some((n) => n.type === 'general-custom-node')
  const useCustomNodes = hasCustomNodeUsage && !!customNodes && Object.keys(customNodes).length > 0

  const workflowConfig = JSON.stringify(
    {
      triggerNodeId: workflow.trigger.nodeId,
      nodes: nodes.map((n: UIDLWorkflowNode) => ({
        id: n.id,
        type: n.type,
        config: n.config,
        stepNumber: n.stepNumber,
        label: n.label,
      })),
      edges: workflow.edges || [],
      errorHandlerNodeId: workflow.errorHandler?.nodeId || null,
    },
    null,
    2
  )
  const errorHandlerNodes = workflow.errorHandler ? getErrorHandlerNodes(workflow) : null
  const errorHandlerNodesJson = errorHandlerNodes
    ? JSON.stringify(errorHandlerNodes, null, 2)
    : 'null'

  const customNodesImport = useCustomNodes
    ? `var __customNodes;\ntry { __customNodes = require('${relativePrefix}/utils/workflows/custom-nodes'); } catch (_e) { __customNodes = {}; }\n${adminCustomNodesRequireLine(
        nodes,
        customNodes,
        relativePrefix
      )}`
    : ''

  const executionLoop = generateNodeExecutionLoop('WORKFLOW_CONFIG', {
    hasCustomNodes: useCustomNodes,
    automation: true,
  })

  return `/**
 * Automation handler
 * Workflow: ${sanitizeForBlockComment(workflow.name || workflow.id)}
 * Event: ${sanitizeForBlockComment(automationEventType(workflow) || 'none')}
 */
if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = require('node-fetch');
}

const utils = require('${relativePrefix}/utils/workflows/server-runtime');
const resolveNodeConfig = utils.resolveNodeConfig;
${workflowUtilsAliasLine('utils')}
${customNodesImport}${generateCartPricingPreamble(
    allNodeTypes,
    relativePrefix
  )}${generateSentEmailLogPreamble(allNodeTypes, relativePrefix)}${generatePaymentDriversPreamble(
    usesPaymentDriverNode(allNodeTypes),
    relativePrefix
  )}
var __automationStore = require('../store');

var WORKFLOW_ID = ${JSON.stringify(workflow.id)};

const WORKFLOW_CONFIG = ${workflowConfig};

var ERROR_HANDLER_NODES = ${errorHandlerNodesJson};

const nodeHandlers = {
${nodeHandlersEntries}
};
// Rebuilt by every run, so never stored with a parked one: the queue of
// fire-and-forget work, where and with which credentials the run calls the
// app's own routes, and the run itself.
var RUNTIME_CONTEXT_KEYS = ['__pendingNodePromises', '__baseUrl', '__internalHeaders', '__automation', '__request', '__emailAttribution'];

var SORTED_NODE_IDS = WORKFLOW_CONFIG.nodes
  .slice()
  .sort(function(a, b) { return a.stepNumber - b.stepNumber; })
  .map(function(n) { return n.id; });

// Stores the run at a Wait: the next node, and the context so far.
async function park(context, nodeId, until) {
  var at = SORTED_NODE_IDS.indexOf(nodeId);
  var resumeNodeId = at === -1 ? null : SORTED_NODE_IDS[at + 1] || null;
  // Nothing after the Wait: the run is over.
  if (!resumeNodeId) return null;
  if (!context.__automation.eventId) {
    throw new Error('A Wait needs the event the automation runs for');
  }
  var saved = {};
  Object.keys(context).forEach(function(key) {
    if (RUNTIME_CONTEXT_KEYS.indexOf(key) === -1) saved[key] = context[key];
  });
  await __automationStore.saveWait({
    eventId: context.__automation.eventId,
    workflowId: WORKFLOW_ID,
    resumeNodeId: resumeNodeId,
    context: JSON.stringify(saved),
    runAt: until,
  });
  return resumeNodeId;
}

async function runNodes(context, resumeFrom) {
${executionLoop}
    return { waiting: false };
}

async function run(event, context, resumeFrom) {
  context = context && typeof context === 'object' ? context : {};
  // Shared fire-and-forget queue — drained before the run settles.
  context.__pendingNodePromises = [];
  // Where this deployment calls its own routes, and with which credentials
  // (see the webhook routes).
  if (!context.__baseUrl) {
    context.__baseUrl = __automationStore.appBaseUrl();
  }
  context.__internalHeaders = utils.internalRequestHeaders(null);
  // A server job: no visitor's request runs here, so the data API reads the
  // customer records unscoped (see __dataIsServerJob; the flag counts only
  // with the app secret, which every data node presents).
  context.__internalHeaders['x-tq-server-job'] = '1';
  if (event) {
    context[WORKFLOW_CONFIG.triggerNodeId] = event;
  }
  var trigger = context[WORKFLOW_CONFIG.triggerNodeId] || {};
  context.__automation = {
    workflowId: WORKFLOW_ID,
    eventId: trigger.event && trigger.event.id ? String(trigger.event.id) : '',
    // A test event runs once and never parks at a Wait (see general-wait).
    test: !!(trigger.event && trigger.event.test === true),
    park: function(nodeId, until) { return park(context, nodeId, until); },
  };
  // The mail this run sends is filed under the automation, and under the
  // event's order when it has one (the sent-email ledger reads this).
  context.__emailAttribution = {
    source: 'automation',
    sourceRef: WORKFLOW_ID,
    orderId: trigger.order && trigger.order.id ? String(trigger.order.id) : null,
  };
  try {
    return await runNodes(context, resumeFrom || null);
  } catch (error) {
${generateErrorHandlerRunBlock('Automation error handler failed:')}
    await utils.settlePendingNodePromises(context);
    throw error;
  }
}

module.exports.run = run;
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

/**
 * The address the store serves a provider's payment webhook at
 * (`/api/webhooks/paypal-payment`), or null when no workflow receives it.
 */
export const findPaymentWebhookRouteUrl = (
  workflows: UIDLWorkflows | undefined,
  providerId: string
): string | null => {
  for (const workflow of Object.values(workflows?.workflows || {})) {
    if (
      workflow?.trigger?.type === 'event-webhook-received' &&
      workflow.webhookConfig &&
      readWebhookPaymentProvider(workflow.webhookConfig) === providerId
    ) {
      const directory = getWebhookRoutePath(workflow).slice(1)
      return `/${[...directory, getWebhookRouteFileName(workflow)].join('/')}`
    }
  }
  return null
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

/**
 * The payment webhook route's delivery lease (see webhook-delivery-lease):
 * the verified delivery claims its body, a twin that arrives while it runs is
 * told to come back (503 + Retry-After), and the claim is released before the
 * route replies. Every block is empty on any other webhook, which keeps those
 * routes byte-identical.
 */
function generateWebhookDeliveryLeaseBlocks(
  isPaymentWebhook: boolean,
  relativePrefix: string
): { preamble: string; declare: string; claim: string; release: string } {
  if (!isPaymentWebhook) {
    return { preamble: '', declare: '', claim: '', release: '' }
  }
  return {
    preamble: `
var __webhookDeliveryLease = null;
try { __webhookDeliveryLease = require('${relativePrefix}/${WEBHOOK_DELIVERY_LEASE_PATH.join(
      '/'
    )}/${WEBHOOK_DELIVERY_LEASE_FILE_NAME}'); } catch (_e) { __webhookDeliveryLease = null; }`,
    declare: `  // Released before every reply below, so a twin delivery is never turned away for long.
  var __delivery = null;
`,
    claim: `
    // One run per delivery at a time: a provider re-delivers what it did not
    // see answered in time, and two runs side by side can both pass a check.
    __delivery = __webhookDeliveryLease
      ? await __webhookDeliveryLease.claimWebhookDelivery(WEBHOOK_CONFIG.urlPath, rawBody, body)
      : null;
    if (__delivery && !__delivery.claimed) {
      __delivery = null;
      res.setHeader('Retry-After', '${WEBHOOK_DELIVERY_RETRY_AFTER_SECONDS}');
      res.status(503).json({ error: 'This delivery is already being processed' });
      return;
    }`,
    release: `
    if (__delivery) { await __delivery.release(); __delivery = null; }`,
  }
}

function generateSignatureVerificationBlock(webhookConfig: UIDLWebhookConfig): string {
  if (!webhookConfig.verifySignature) {
    return ''
  }
  if (webhookConfig.signatureAlgorithm === 'payment-driver') {
    // A provider outage asks the provider to deliver again (503); anything
    // else is a refusal it should not retry.
    return `    var paymentVerification = await verifyPaymentWebhook(req, rawBody, body, WEBHOOK_CONFIG);
    if (!paymentVerification.ok) {
      res.status(paymentVerification.retry ? 503 : 401).json({ error: paymentVerification.retry ? 'The payment could not be verified yet' : 'Invalid signature' });
      return;
    }
    body = paymentVerification.body;`
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
