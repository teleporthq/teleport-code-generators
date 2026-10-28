import { TableAccess } from '@teleporthq/teleport-shared'
import {
  UIDLAuthentication,
  UIDLCustomWorkflowNode,
  UIDLWebhookConfig,
  UIDLWorkflow,
  UIDLWorkflowEdge,
  UIDLWorkflowNode,
  UIDLWorkflowProtection,
  UIDLWorkflows,
} from '@teleporthq/teleport-types'
import { CLIENT_ONLY_NODES, isVerifiedWebhookConfig } from './api-route-generator'
import { isAutomationWorkflow } from './automations/automations-scope'
import { stepNameOf } from './nodes/email/message-trust'
import {
  describeRefusedSend,
  markVisitorBoundMessageNodes,
  markWebhookMessageNodes,
  REFUSE_SEND_KEY,
} from './nodes/email/outbound-message-guard'
import {
  assertNoPublicRestrictedSteps,
  describePublicStepRefusals,
  findPublicRestrictedSteps,
} from './public-step-guards'
import {
  parameterizeAllWorkflowRawSql,
  parameterizeWorkflowRawSqlInterpolations,
  WorkflowSqlInterpolationError,
} from './raw-sql-param-binding'
import { assertWorkflowsAreSecure, CodegenSecurityError } from './security-scanner'
import { splitIntoSegments } from './segment-splitter'
import { buildSegmentTrust, SegmentTrust } from './segment-trust'
import {
  assertServerBoundCallParameters,
  findBrowserBoundCallParameters,
} from './server-custom-node-call'
import { WorkflowSegment } from './types'

/**
 * Every refusal this code generator makes over a project's workflows at
 * publish, in ONE place. `workflow-project-plugin` makes them through
 * `assertWorkflowPublishGates` (before any code is emitted) and
 * `assertSegmentRouteGates` (as it emits each server segment route), throwing
 * the first; the editor asks `collectWorkflowPublishRefusals`, which runs the
 * same checks over the same routes and reports every refused step, before an
 * AI write lands and before a publish goes out (teleport-gui
 * `publish-refusal-checks.ts`). A new workflow refusal is added here, to the
 * gates below, so the editor's assistant applies it with no change of its own.
 *
 * Two kinds:
 * - `refused`: the export stops (raw SQL a value cannot be bound into, custom
 *   code naming a platform secret, a push or stored-file step on a route
 *   callers it should not serve can start, a recorded event fed by a browser
 *   value);
 * - `never-sends`: the export goes on, but an email or SMS step that sends only
 *   the visitor's input to an address the visitor supplies, or takes its sender
 *   from the visitor, is refused at run time (`outbound-message-guard.ts`).
 */

export type WorkflowPublishRefusalKind = 'refused' | 'never-sends'

export interface WorkflowPublishRefusal {
  kind: WorkflowPublishRefusalKind
  /** Which of the generator's checks refused it. */
  check: string
  /** The workflow's id, or the custom node's. */
  ownerId: string
  ownerKind: 'workflow' | 'custom-node'
  /** The refused step; absent when the check names it only in `message`. */
  nodeId?: string
  /** One sentence for the owner, in the generator's words. */
  message: string
}

type Refusal = Omit<WorkflowPublishRefusal, 'kind' | 'check'>

interface WorkflowBlockGate {
  check: string
  /** The plugin's call: throws the generator's refusal, and rewrites the block as publishing does. */
  assert: (workflows: UIDLWorkflows, authentication?: UIDLAuthentication | null) => void
  /** The same check, every refused step reported, the block rewritten as `assert` rewrites it. */
  collect: (workflows: UIDLWorkflows, authentication?: UIDLAuthentication | null) => Refusal[]
}

interface Owner {
  ownerId: string
  ownerName: string
  ownerKind: WorkflowPublishRefusal['ownerKind']
  graph: { nodes?: UIDLWorkflowNode[]; edges?: UIDLWorkflowEdge[] }
}

const ownersOf = (workflows: UIDLWorkflows): Owner[] => [
  ...Object.entries(workflows.workflows || {})
    .filter(([, workflow]) => !!workflow)
    .map(([ownerId, workflow]) => ({
      ownerId,
      ownerName: workflow.name || ownerId,
      ownerKind: 'workflow' as const,
      graph: workflow,
    })),
  ...Object.entries(workflows.customNodes || {})
    .filter(([, customNode]) => !!customNode)
    .map(([ownerId, customNode]) => ({
      ownerId,
      ownerName: customNode.name || ownerId,
      ownerKind: 'custom-node' as const,
      graph: customNode,
    })),
]

const stepName = (owner: Owner, nodeId: string): string => {
  const node = (owner.graph.nodes || []).find((candidate) => candidate && candidate.id === nodeId)
  return node ? stepNameOf(node) : nodeId
}

const rawSqlRefusals = (workflows: UIDLWorkflows): Refusal[] =>
  ownersOf(workflows).flatMap((owner) => {
    try {
      parameterizeWorkflowRawSqlInterpolations(owner.graph)
      return []
    } catch (error) {
      if (!(error instanceof WorkflowSqlInterpolationError)) {
        throw error
      }
      return error.residualsByNode.map((residual) => ({
        ownerId: owner.ownerId,
        ownerKind: owner.ownerKind,
        nodeId: residual.nodeId,
        message: `The step "${stepName(owner, residual.nodeId)}" in "${owner.ownerName}": ${
          new WorkflowSqlInterpolationError([residual]).message
        }`,
      }))
    }
  })

const customCodeRefusals = (workflows: UIDLWorkflows): Refusal[] => {
  try {
    assertWorkflowsAreSecure(workflows)
    return []
  } catch (error) {
    if (!(error instanceof CodegenSecurityError)) {
      throw error
    }
    return error.violations.map((violation) => {
      // A violation names the graph it is in by id, a workflow's or a custom node's.
      const owner = ownersOf(workflows).find(
        (candidate) => candidate.ownerId === violation.workflowId
      )
      return {
        ownerId: violation.workflowId,
        ownerKind: owner ? owner.ownerKind : ('workflow' as const),
        nodeId: violation.nodeId,
        message: `The step "${owner ? stepName(owner, violation.nodeId) : violation.nodeId}" in "${
          violation.workflowName || violation.workflowId
        }" ${violation.message}, so publishing refuses it.`,
      }
    })
  }
}

const publicStepRefusals = (
  workflows: UIDLWorkflows,
  authentication?: UIDLAuthentication | null
): Refusal[] => {
  const staffRoles = TableAccess.resolveStaffRoles(authentication)
  return findPublicRestrictedSteps(workflows, { staffRoles }).map((refusal) => ({
    ownerId: refusal.ownerId,
    ownerKind: refusal.ownerKind,
    nodeId: refusal.nodeId,
    message: describePublicStepRefusals([refusal], staffRoles),
  }))
}

/** R-N23: what the owner is told about a newsletter sign-up step anywhere else. */
export const NEWSLETTER_SIGNUP_REFUSAL_MESSAGE =
  'The newsletter sign-up step runs only when a visitor submits a form.'

/**
 * A `newsletter-subscribe` step outside a workflow a visitor's form submit
 * starts: on a page load, a click, a cron, a webhook, an automation or in a
 * custom node (which any of those may call), the address would come from
 * somewhere else than a person typing their own (a link's parameter, a row),
 * and the site would mail whomever it names. The editor refuses it too.
 */
const newsletterSignupRefusals = (workflows: UIDLWorkflows): Refusal[] =>
  ownersOf(workflows).flatMap((owner) => {
    const trigger = owner.ownerKind === 'workflow' ? (owner.graph as UIDLWorkflow).trigger : null
    if (trigger && trigger.type === 'event-form-submitted') {
      return []
    }
    return (owner.graph.nodes || [])
      .filter((node) => !!node && node.type === 'newsletter-subscribe')
      .map((node) => ({
        ownerId: owner.ownerId,
        ownerKind: owner.ownerKind,
        nodeId: node.id,
        message: `The step "${stepNameOf(node)}" in "${
          owner.ownerName
        }": ${NEWSLETTER_SIGNUP_REFUSAL_MESSAGE}`,
      }))
  })

export class NewsletterSignupRefusalError extends Error {
  readonly code = 'NEWSLETTER_SIGNUP_REFUSED'

  constructor(refusals: Refusal[]) {
    super(refusals.map((refusal) => refusal.message).join(' '))
    // `extends Error` loses the prototype when downlevelled to ES5.
    Object.setPrototypeOf(this, NewsletterSignupRefusalError.prototype)
    this.name = 'NewsletterSignupRefusalError'
  }
}

const assertNewsletterSignupOnFormSubmit = (workflows: UIDLWorkflows): void => {
  const refusals = newsletterSignupRefusals(workflows)
  if (refusals.length > 0) {
    throw new NewsletterSignupRefusalError(refusals)
  }
}

/**
 * The gates the plugin runs over the whole block before any code is emitted,
 * in its order: raw SQL is bound first, so the gates after it read the SQL
 * that ships.
 */
const WORKFLOW_BLOCK_GATES: WorkflowBlockGate[] = [
  { check: 'raw-sql', assert: parameterizeAllWorkflowRawSql, collect: rawSqlRefusals },
  { check: 'custom-code', assert: assertWorkflowsAreSecure, collect: customCodeRefusals },
  { check: 'public-steps', assert: assertNoPublicRestrictedSteps, collect: publicStepRefusals },
  {
    check: 'newsletter-sign-up',
    assert: assertNewsletterSignupOnFormSubmit,
    collect: newsletterSignupRefusals,
  },
]

/** The plugin's gates over the workflow block, before any code is emitted: throws the first refusal. */
export const assertWorkflowPublishGates = (
  workflows: UIDLWorkflows | undefined,
  authentication?: UIDLAuthentication | null
): void => {
  if (!workflows) {
    return
  }
  for (const gate of WORKFLOW_BLOCK_GATES) {
    gate.assert(workflows, authentication)
  }
}

export interface SegmentRouteGateOptions {
  /** The workflow's or custom node's name. */
  owner: string
  /** Its nodes, for the step names. */
  graphNodes?: UIDLWorkflowNode[]
  protection?: UIDLWorkflowProtection
  /** The roles only the business's staff hold (`TableAccess.resolveStaffRoles`). */
  staffRoles?: string[]
}

interface SegmentRouteGate {
  check: string
  /** The plugin's call as it emits the route: throws the generator's refusal. */
  assert: (
    segment: WorkflowSegment,
    trust: SegmentTrust | undefined,
    options: SegmentRouteGateOptions
  ) => void
  /** The same check, every refused step of the route reported. */
  collect: (
    segment: WorkflowSegment,
    trust: SegmentTrust | undefined,
    options: SegmentRouteGateOptions
  ) => Array<{ nodeId: string; message: string }>
}

/** The checks the plugin makes on each server segment route it emits. */
const SEGMENT_ROUTE_GATES: SegmentRouteGate[] = [
  {
    check: 'server-bound-calls',
    assert: assertServerBoundCallParameters,
    collect: findBrowserBoundCallParameters,
  },
]

/** The checks the plugin makes as it emits one server segment route: throws the first refusal. */
export const assertSegmentRouteGates = (
  segment: WorkflowSegment,
  trust: SegmentTrust | undefined,
  options: SegmentRouteGateOptions
): void => {
  for (const gate of SEGMENT_ROUTE_GATES) {
    gate.assert(segment, trust, options)
  }
}

/** A server segment route the plugin emits, for a workflow or a custom node. */
interface SegmentRoute {
  owner: Owner
  protection?: UIDLWorkflowProtection
  segment: WorkflowSegment
  trust: SegmentTrust
}

const serverSegmentRoutes = (
  owner: Owner,
  graph: UIDLWorkflow,
  protection: UIDLWorkflowProtection | undefined
): SegmentRoute[] => {
  const segments = splitIntoSegments(graph)
  const segmentGraph = {
    id: owner.ownerId,
    nodes: graph.nodes || [],
    edges: graph.edges || [],
    segments,
  }
  return segments
    .filter((segment) => segment.env === 'server')
    .map((segment) => ({
      owner,
      protection,
      segment,
      trust: buildSegmentTrust(segment, segmentGraph),
    }))
}

const isWebhookRoute = (workflow: UIDLWorkflow): boolean =>
  !!workflow.trigger &&
  workflow.trigger.type === 'event-webhook-received' &&
  !!workflow.webhookConfig

/**
 * The server segment routes, as `workflow-project-plugin` emits them: an
 * automation runs in the event bus and a cron route on the server, neither
 * through a segment route; a webhook has its own route (`webhookNeverSends`);
 * a custom node's graph is split as a workflow started by hand.
 */
const collectSegmentRoutes = (workflows: UIDLWorkflows): SegmentRoute[] =>
  ownersOf(workflows).flatMap((owner) => {
    if (owner.ownerKind === 'custom-node') {
      const customNode = owner.graph as UIDLCustomWorkflowNode
      const pseudoWorkflow = {
        nodes: customNode.nodes || [],
        edges: customNode.edges || [],
        trigger: { type: 'manual' },
      } as unknown as UIDLWorkflow
      return serverSegmentRoutes(owner, pseudoWorkflow, customNode.protection)
    }
    const workflow = owner.graph as UIDLWorkflow
    if (
      isAutomationWorkflow(workflow) ||
      (workflow.trigger && workflow.trigger.type === 'event-cron-triggered') ||
      isWebhookRoute(workflow)
    ) {
      return []
    }
    return serverSegmentRoutes(owner, workflow, workflow.protection)
  })

const neverSendsOf = (nodes: UIDLWorkflowNode[], owner: Owner): Refusal[] =>
  nodes
    .filter((node) => !!node.config && typeof node.config[REFUSE_SEND_KEY] === 'string')
    .map((node) => ({
      ownerId: owner.ownerId,
      ownerKind: owner.ownerKind,
      nodeId: node.id,
      message: describeRefusedSend(
        owner.ownerName,
        stepNameOf(node),
        node.config[REFUSE_SEND_KEY] as string
      ),
    }))

/** A webhook route's sends, marked as `generateWebhookWorkflowAPIRoute` marks them. */
const webhookNeverSends = (workflows: UIDLWorkflows): Refusal[] =>
  ownersOf(workflows).flatMap((owner) => {
    const workflow = owner.graph as UIDLWorkflow
    if (
      owner.ownerKind !== 'workflow' ||
      isAutomationWorkflow(workflow) ||
      !isWebhookRoute(workflow)
    ) {
      return []
    }
    const serverNodes = (workflow.nodes || []).filter(
      (node: UIDLWorkflowNode) => !CLIENT_ONLY_NODES.has(node.type)
    )
    const serverNodeIds = new Set(serverNodes.map((node) => node.id))
    const serverEdges = (workflow.edges || []).filter(
      (edge: UIDLWorkflowEdge) => serverNodeIds.has(edge.source) || serverNodeIds.has(edge.target)
    )
    const marked = markWebhookMessageNodes(
      workflow,
      serverNodes,
      serverEdges,
      isVerifiedWebhookConfig(workflow.webhookConfig as UIDLWebhookConfig),
      { silent: true }
    )
    return neverSendsOf(marked.nodes, owner)
  })

/**
 * Every refusal publishing would make over `workflows` (the project's exported
 * UIDL block, or the part of it a change touches): the gates above, run over a
 * copy of the block so `workflows` stays as it is, and the routes' sends,
 * marked without a build-log line. `authentication` is the project's
 * (`uidl.authentication`): it names the staff roles.
 */
export const collectWorkflowPublishRefusals = (
  workflows: UIDLWorkflows | undefined,
  authentication?: UIDLAuthentication | null
): WorkflowPublishRefusal[] => {
  if (!workflows) {
    return []
  }
  const block = JSON.parse(JSON.stringify(workflows)) as UIDLWorkflows
  const refusals: WorkflowPublishRefusal[] = []
  for (const gate of WORKFLOW_BLOCK_GATES) {
    for (const refusal of gate.collect(block, authentication)) {
      refusals.push({ kind: 'refused', check: gate.check, ...refusal })
    }
  }

  const staffRoles = TableAccess.resolveStaffRoles(authentication)
  for (const route of collectSegmentRoutes(block)) {
    const options = {
      owner: route.owner.ownerName,
      graphNodes: route.owner.graph.nodes || [],
      protection: route.protection,
      staffRoles,
    }
    for (const gate of SEGMENT_ROUTE_GATES) {
      for (const found of gate.collect(route.segment, route.trust, options)) {
        refusals.push({
          kind: 'refused',
          check: gate.check,
          ownerId: route.owner.ownerId,
          ownerKind: route.owner.ownerKind,
          nodeId: found.nodeId,
          message: found.message,
        })
      }
    }
    const marked = markVisitorBoundMessageNodes(
      route.segment,
      route.trust,
      route.protection,
      route.owner.ownerName,
      { silent: true }
    )
    for (const refusal of neverSendsOf(marked.nodes, route.owner)) {
      refusals.push({ kind: 'never-sends', check: 'outbound-message', ...refusal })
    }
  }
  for (const refusal of webhookNeverSends(block)) {
    refusals.push({ kind: 'never-sends', check: 'outbound-message', ...refusal })
  }
  return refusals
}
