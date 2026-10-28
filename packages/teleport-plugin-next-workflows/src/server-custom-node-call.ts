import type { UIDLWorkflowNode, UIDLWorkflowProtection } from '@teleporthq/teleport-types'
import { WorkflowSegment } from './types'
import { SegmentTrust } from './segment-trust'

/**
 * The shared "Record Event" writer answers only this deployment's own server
 * code (its protection is `serverOnly`): its route refuses anything without
 * the internal-call token. The editor therefore marks every call of the writer
 * `executionEnv: 'server'` (teleport-gui
 * `mappers/domain-to-uidl/workflows/protection`), the segment splitter keeps
 * that call in a server segment of its caller, and that segment's route runs
 * it — the writer's own segment is then called with the route's internal
 * credentials (`context.__internalHeaders`), as a webhook or cron route calls
 * a custom node.
 *
 * Only those calls: each is baked into its route by node id and custom-node
 * id. Any other custom-node call a server segment holds (a loop that also
 * reads the database pulls its whole body onto the server) stays the inert
 * marker it always was there, so it never borrows the internal-call token
 * past its own login, role, subscription or cost gates.
 *
 * And only from what the server did: every parameter of such a call must be a
 * literal of the route's own config or the result of a node that ran on the
 * server (in this segment, or a signed result of an earlier one). A value the
 * visitor's browser supplied — a browser step's result, the trigger, the page
 * state, the clicked element — refuses the export with the owner's reason,
 * so the next builder cannot record an event a visitor makes up. Two kinds of
 * route are not asked: one only server code calls (`serverOnly`: its
 * "browser" steps run on the server), and one every role of which is a staff
 * role (`TableAccess.resolveStaffRoles`: the generated admin — whoever runs it
 * can do what the event says anyway). A role a visitor can hold (`user`, a
 * customer role) is asked.
 *
 * The marked node runs with the route's internal credentials. A custom-node
 * call nested inside it runs as the visitor would run it — without the
 * internal-call token — so it keeps its own login, role and subscription
 * gates; inside a server job (a webhook, cron or automation run, whose context
 * carries the server-job flag) it keeps the token, and the run stays the
 * job's end to end.
 */

/**
 * What this code generator does with the calls the editor marks. The editor
 * imports it where it marks them: an editor built against a code generator
 * without this behaviour fails to build instead of shipping calls the writer's
 * route refuses.
 */
export const SERVER_CUSTOM_NODE_CALLS_VERSION = 1

/** A call the editor marked to run in its caller's server segment. */
const isServerRunCall = (node: UIDLWorkflowNode): boolean => {
  const customNodeId = (node.config as { customNodeId?: unknown } | undefined)?.customNodeId
  return (
    node.type === 'general-custom-node' &&
    node.executionEnv === 'server' &&
    typeof customNodeId === 'string' &&
    customNodeId.length > 0
  )
}

export const serverRunCustomNodeCalls = (segment: WorkflowSegment): UIDLWorkflowNode[] =>
  segment.nodes.filter(isServerRunCall)

const WHOLE_TEMPLATE_TOKEN = /^\s*\{\{[\s\S]*\}\}\s*$/
const CONTEXT_CHIP_CLASS = 'context-value-inline'

// A quoted attribute of an opening tag, read as the runtime reads it
// (extractHtmlAttr in executor-generator).
const htmlAttribute = (tag: string, name: string): string => {
  const key = `${name}=`
  const at = tag.indexOf(key)
  if (at === -1) {
    return ''
  }
  const quote = tag.charAt(at + key.length)
  if (quote !== '"' && quote !== "'") {
    return ''
  }
  const start = at + key.length + 1
  const end = tag.indexOf(quote, start)
  return end === -1 ? '' : tag.slice(start, end)
}

/**
 * The nodes the context chips of a rich text read, by the runtime's own rule
 * (richTextChipRef in executor-generator): a chip's node id, else the first
 * segment of its path — so a chip with no node id, or an empty one, is read
 * from where the runtime would read it.
 */
const chipSourceNodeIds = (html: string): string[] => {
  if (html.indexOf(CONTEXT_CHIP_CLASS) === -1) {
    return []
  }
  const nodeIds: string[] = []
  let at = 0
  while (at < html.length) {
    const spanStart = html.indexOf('<span', at)
    if (spanStart === -1) {
      break
    }
    const openEnd = html.indexOf('>', spanStart)
    if (openEnd === -1) {
      break
    }
    const openTag = html.slice(spanStart, openEnd + 1)
    at = openEnd + 1
    if (openTag.indexOf(CONTEXT_CHIP_CLASS) === -1) {
      continue
    }
    let nodeId = htmlAttribute(openTag, 'data-ctx-node-id')
    if (!nodeId) {
      const pathRaw = htmlAttribute(openTag, 'data-ctx-path')
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&amp;/g, '&')
      try {
        const path = pathRaw ? JSON.parse(pathRaw) : null
        if (Array.isArray(path) && path.length > 0) {
          nodeId = String(path[0])
        }
      } catch {
        nodeId = ''
      }
    }
    if (nodeId) {
      nodeIds.push(nodeId)
    }
  }
  return nodeIds
}

interface ParameterSources {
  nodeIds: string[]
  /** Set when a value comes from the page itself, not from any step. */
  pageValue: string | null
}

const collectSources = (value: unknown, into: ParameterSources): void => {
  if (value === null || value === undefined) {
    return
  }
  if (typeof value === 'string') {
    if (WHOLE_TEMPLATE_TOKEN.test(value)) {
      into.pageValue = into.pageValue || value.trim()
      return
    }
    into.nodeIds.push(...chipSourceNodeIds(value))
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectSources(item, into))
    return
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.type === 'workflowContext' && typeof record.nodeId === 'string') {
      into.nodeIds.push(record.nodeId)
      return
    }
    if (record.type === 'ctx') {
      into.pageValue = into.pageValue || 'the element the visitor used'
      return
    }
    Object.keys(record).forEach((key) => collectSources(record[key], into))
  }
}

const describeStep = (node: UIDLWorkflowNode | undefined, fallbackId: string): string => {
  const named = node && ((node as { name?: string }).name || node.label)
  return named ? `"${named}" (${fallbackId})` : `the step ${fallbackId}`
}

interface ServerBoundCallOptions {
  owner: string
  graphNodes?: UIDLWorkflowNode[]
  protection?: UIDLWorkflowProtection
  /** The roles only the business's staff hold (`TableAccess.resolveStaffRoles`). */
  staffRoles?: string[]
}

/** A marked call that takes a value the browser supplied, with the refusal's sentence. */
export interface BrowserBoundCall {
  nodeId: string
  message: string
}

/**
 * Every marked call of the segment that takes a value the browser supplied,
 * naming the step and its source. `graphNodes` are the caller's nodes, for the
 * names.
 */
export const findBrowserBoundCallParameters = (
  segment: WorkflowSegment,
  trust: SegmentTrust | undefined,
  options: ServerBoundCallOptions
): BrowserBoundCall[] => {
  const protection = options.protection
  const staff = new Set(options.staffRoles || ['admin'])
  const roles = (protection && protection.allowedRoles) || []
  if (
    protection &&
    (protection.serverOnly ||
      (protection.requiresAuth && roles.length > 0 && roles.every((role) => staff.has(role))))
  ) {
    return []
  }
  const fromServer = new Set<string>([
    ...segment.nodeIds,
    ...((trust && trust.signedNodeIds) || []),
  ])
  const byId = new Map<string, UIDLWorkflowNode>()
  for (const node of options.graphNodes || segment.nodes) {
    byId.set(node.id, node)
  }
  const found: BrowserBoundCall[] = []
  for (const call of serverRunCustomNodeCalls(segment)) {
    const sources: ParameterSources = { nodeIds: [], pageValue: null }
    collectSources((call.config as { parameters?: unknown }).parameters, sources)
    const fromBrowser = sources.nodeIds.find((nodeId) => !fromServer.has(nodeId))
    if (!fromBrowser && !sources.pageValue) {
      continue
    }
    const source = fromBrowser
      ? `the result of ${describeStep(
          byId.get(fromBrowser),
          fromBrowser
        )}, which runs in the visitor's browser`
      : `${sources.pageValue}, a value the visitor's browser sends`
    found.push({
      nodeId: call.id,
      message: `The step ${describeStep(call, call.id)} in "${
        options.owner
      }" records an event with ${source}. An event can only be recorded from what the site's server did, or a visitor could record one that never happened. Run the setup of the feature that made this workflow again (or remove the step), then publish again.`,
    })
  }
  return found
}

/** Throws the first of `findBrowserBoundCallParameters`: the export stops there. */
export const assertServerBoundCallParameters = (
  segment: WorkflowSegment,
  trust: SegmentTrust | undefined,
  options: ServerBoundCallOptions
): void => {
  const [first] = findBrowserBoundCallParameters(segment, trust, options)
  if (first) {
    throw new Error(first.message)
  }
}

/**
 * Emitted right after a server segment route's `nodeHandlers`, only when the
 * segment holds a marked call (every other route is byte-identical): the
 * `general-custom-node` handler — whose browser version only hands back a
 * marker — then runs exactly the marked calls, in the route's main pass, its
 * loop bodies and its parallel branches alike, and hands every other call
 * back as the marker. A marked node this build does not have is an error,
 * never a silent skip, with the reason the custom-node module did not load.
 */
export const generateServerCustomNodeCallCode = (
  segment: WorkflowSegment,
  relativePrefix: string
): string => {
  const calls = serverRunCustomNodeCalls(segment)
  if (calls.length === 0) {
    return ''
  }
  const baked: Record<string, string> = {}
  for (const call of calls) {
    baked[call.id] = (call.config as { customNodeId: string }).customNodeId
  }
  return `
// The calls the editor marked to run on the server (the event writer, which
// answers this deployment's server code only): they run here, the node's own
// segment called with this route's internal credentials. Any other custom-node
// call stays the marker it is in a browser. One nested inside a marked node
// runs as the visitor would run it, without the internal-call token — except
// in a server job (the server-job flag), where it keeps the token. See
// server-custom-node-call.ts.
var __SERVER_RUN_CALLS = ${JSON.stringify(baked)};
var __serverCustomNodes = null;
var __serverCustomNodesError = null;
try { __serverCustomNodes = require('${relativePrefix}/utils/workflows/custom-nodes'); } catch (error) { __serverCustomNodesError = error; }
function __serverCustomNode(customNodeId) {
  var run = __serverCustomNodes ? __serverCustomNodes[customNodeId] : null;
  if (typeof run !== 'function') {
    throw new Error(
      'This site has no custom node ' + customNodeId +
      (__serverCustomNodesError ? ' (the custom nodes did not load: ' + (__serverCustomNodesError.message || String(__serverCustomNodesError)) + ')' : '')
    );
  }
  return run;
}
(function (handlers) {
  var marker = handlers['general-custom-node'];
  // What the marked node's own steps get: a visitor's nested custom-node call
  // runs with the visitor's credentials only (the cookie, the deployment
  // bypass), so its route asks for its own session, role and subscription; a
  // server job's keeps the internal-call token (below).
  var nested = Object.assign({}, handlers);
  nested['general-custom-node'] = async function (config, context) {
    var call = await marker(config, context);
    if (!call || !call.__customNode) return call;
    var asVisitor = Object.assign({}, context);
    asVisitor.__internalHeaders = Object.assign({}, context && context.__internalHeaders);
    // A server job's nested call (a webhook, cron or automation run, whose
    // context alone carries the server-job flag) stays the job's end to end:
    // it keeps the token, so its routes keep the flag. A visitor's runs with
    // the visitor's credentials only.
    if (asVisitor.__internalHeaders['x-tq-server-job'] !== '1') {
      delete asVisitor.__internalHeaders['x-teleport-internal'];
    }
    return __serverCustomNode(call.customNodeId)(asVisitor, call.parameters || {}, nested);
  };
  handlers['general-custom-node'] = async function (config, context) {
    var call = await marker(config, context);
    var nodeId = config && config.__nodeId;
    if (
      !call ||
      !call.__customNode ||
      typeof nodeId !== 'string' ||
      !Object.prototype.hasOwnProperty.call(__SERVER_RUN_CALLS, nodeId) ||
      __SERVER_RUN_CALLS[nodeId] !== call.customNodeId
    ) {
      return call;
    }
    return __serverCustomNode(call.customNodeId)(context, call.parameters || {}, nested);
  };
})(nodeHandlers);
`
}
