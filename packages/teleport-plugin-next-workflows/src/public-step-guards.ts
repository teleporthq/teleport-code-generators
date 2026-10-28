import { TableAccess } from '@teleporthq/teleport-shared'
import { UIDLAuthentication } from '@teleporthq/teleport-types'
import { isAutomationWorkflow } from './automations/automations-scope'
import { isPaymentWebhookConfig } from './payments'

/**
 * Steps no visitor may run, refused at generation when their workflow's route
 * answers callers it should not.
 *
 * - `push-send-notification` sends to every subscriber of the site (or to one
 *   user's browsers), with a title, text and link the workflow fills in.
 * - The runtime-storage file steps act on ANY file of the project with the
 *   project's storage key: the storage worker keeps no owner per file, and a
 *   file's id is in its public address.
 *
 * Who may run them:
 *
 * - Sending a push, deleting or listing files (`STAFF`): only this
 *   deployment's own server code — a route that is `serverOnly`, a cron (signed
 *   by the crons worker), an automation (the in-app event bus), a webhook that
 *   verifies its signature — or a route that requires a session with a named
 *   staff role: every role it admits is one of the project's staff roles (the
 *   admin panel's and `admin`, `TableAccess.resolveStaffRoles`, the rule the
 *   data API uses). "Any signed-in user" is not enough: on a site with open
 *   sign-up that is one sign-up away from anyone.
 * - Reading one file's details (`SESSION`): the same, or any session — a
 *   private file comes back without an address, and a public one is public.
 *
 * A custom node only server code may call (`serverOnly`) runs in its CALLERS'
 * server segments with this deployment's credentials, so it is as reachable
 * as its most reachable caller: a public page's workflow calling it can replay
 * its push or its delete.
 *
 * The refusal is thrown before any code is emitted, the way the raw-SQL and
 * custom-code gates refuse; the editor shows its `message` (see
 * {@link PublicStepRefusalError}). Disabled workflows are checked too: the
 * generator emits every workflow it is given.
 */

export const PUBLIC_STEP_REFUSAL_CODE = 'PUBLIC_STEP_REFUSED'

type StepGate = 'staff' | 'session'

/** What each refused step does, in the words the editor shows, and who may run it. */
const RESTRICTED_STEPS: Record<string, { does: string; gate: StepGate }> = {
  'push-send-notification': { does: 'sends a push notification', gate: 'staff' },
  'file-storage-delete': { does: 'deletes a stored file', gate: 'staff' },
  'file-storage-list': { does: 'lists the stored files', gate: 'staff' },
  'file-storage-get-details': { does: "reads a stored file's details", gate: 'session' },
}

export const PUBLIC_RESTRICTED_STEP_TYPES: ReadonlyArray<string> = Object.keys(RESTRICTED_STEPS)

export interface PublicStepRefusal {
  /** The workflow's id, or the custom node's. */
  ownerId: string
  ownerName: string
  ownerKind: 'workflow' | 'custom-node'
  nodeId: string
  nodeType: string
  stepName: string
  /** For a server-only custom node: the caller that makes it reachable. */
  calledFrom?: string
  /**
   * Who can start the route today: absent for anyone, `[]` for any session,
   * else the roles it admits (none of them all staff).
   */
  admits?: string[]
}

/** The longest sentence the editor shows as it is (`getApiErrorMessage` in teleport-gui). */
const MAX_SENTENCE_LENGTH = 400
const LISTED_STEPS = 3

const quote = (text: string): string => `"${text.replace(/["\r\n]+/g, ' ').trim()}"`

const quoteList = (values: string[]): string => values.map(quote).join(' or ')

/** Who can start the step's route today, in words. */
const whoCanStart = (refusal: PublicStepRefusal): string =>
  refusal.admits === undefined
    ? 'any visitor'
    : refusal.admits.length === 0
    ? 'anyone signed in'
    : `anyone with the role ${quoteList(refusal.admits)}`

const describe = (refusal: PublicStepRefusal): string =>
  `${quote(refusal.stepName)} (${RESTRICTED_STEPS[refusal.nodeType].does}) in ${
    refusal.ownerKind === 'custom-node' ? 'the custom node' : 'the workflow'
  } ${quote(refusal.ownerName)}${
    refusal.calledFrom ? `, started from ${quote(refusal.calledFrom)}` : ''
  }, which ${whoCanStart(refusal)} can start`

/**
 * What to change: the roles that count as staff here (the admin panel's and
 * `admin`), and how a role becomes one — by the admin-panel pages admitting it.
 */
const adviceFor = (staffRoles: string[]): string =>
  `Only an admin or your server should run it: let only the role ${quoteList(
    staffRoles.length > 0 ? staffRoles : [TableAccess.ADMIN_ROLE]
  )} start it (another role counts once your admin-panel pages admit it), or move it into a scheduled, signed webhook or automation workflow, then publish again.`

const SHORT_ADVICE =
  'Let only an admin role start it (a role your admin-panel pages admit), or move it into a scheduled, signed webhook or automation workflow, then publish again.'

/** One line of plain prose, for the person publishing. */
export const describePublicStepRefusals = (
  refusals: PublicStepRefusal[],
  staffRoles: string[] = [TableAccess.ADMIN_ROLE]
): string => {
  const advice = adviceFor(staffRoles)
  const listed = refusals.slice(0, LISTED_STEPS).map(describe)
  const more = refusals.length - listed.length
  const subject =
    refusals.length === 1
      ? `On your site the step ${listed[0]}.`
      : `On your site ${
          refusals.length
        } steps meant only for an admin or your own server can be started by others: ${listed.join(
          '; '
        )}${more > 0 ? `; and ${more} more` : ''}.`
  for (const candidate of [
    `${subject} ${advice}`,
    `${subject} ${SHORT_ADVICE}`,
    `On your site the step ${describe(refusals[0])}${
      refusals.length > 1 ? `, and ${refusals.length - 1} more` : ''
    }. ${SHORT_ADVICE}`,
  ]) {
    if (candidate.length <= MAX_SENTENCE_LENGTH) {
      return candidate
    }
  }
  return `On your site ${
    refusals.length === 1 ? 'a step' : `${refusals.length} steps`
  } meant only for an admin or your own server (a push notification or a stored-file step) can be started by others. ${SHORT_ADVICE}`
}

/**
 * Thrown when a restricted step sits on a route that answers callers it should
 * not. Its message carries a JSON body whose `message` is one sentence for the
 * person publishing — the editor's publish flow shows exactly that sentence
 * ("Publishing failed. …") instead of its "contact support" notice, the same
 * contract a server refusal uses (`getApiErrorMessage`). `refusals` lists
 * every refused step.
 */
export class PublicStepRefusalError extends Error {
  readonly code = PUBLIC_STEP_REFUSAL_CODE
  readonly refusals: PublicStepRefusal[]

  constructor(refusals: PublicStepRefusal[], staffRoles?: string[]) {
    super(
      `Publishing refused: ${JSON.stringify({
        code: PUBLIC_STEP_REFUSAL_CODE,
        message: describePublicStepRefusals(refusals, staffRoles),
        steps: refusals.map((r) => ({ owner: r.ownerId, node: r.nodeId, type: r.nodeType })),
      })}`
    )
    // `extends Error` loses the prototype when downlevelled to ES5.
    Object.setPrototypeOf(this, PublicStepRefusalError.prototype)
    this.name = 'PublicStepRefusalError'
    this.refusals = refusals
  }
}

interface NodeLike {
  id?: string
  type?: string
  name?: string
  label?: string
  config?: Record<string, unknown>
}

interface WorkflowLike {
  name?: string
  nodes?: NodeLike[]
  trigger?: { type?: string }
  webhookConfig?: { verifySignature?: boolean }
  protection?: RoutePolicyLike
}

/** The fields of a route's policy (`UIDLWorkflowProtection`) that gate its callers. */
interface RoutePolicyLike {
  requiresAuth?: boolean
  allowedRoles?: string[]
  serverOnly?: boolean
}

interface WorkflowsLike {
  workflows?: Record<string, WorkflowLike>
  customNodes?: Record<string, WorkflowLike>
}

/** Who can make a route run, from the most reachable to the least. */
type RouteAccess = 'public' | 'session' | 'staff' | 'server'
const ACCESS_ORDER: RouteAccess[] = ['public', 'session', 'staff', 'server']

const lessGuarded = (a: RouteAccess, b: RouteAccess): RouteAccess =>
  ACCESS_ORDER.indexOf(a) <= ACCESS_ORDER.indexOf(b) ? a : b

const allows = (access: RouteAccess, gate: StepGate): boolean =>
  access === 'server' || access === 'staff' || (gate === 'session' && access === 'session')

const policyAccess = (
  protection: RoutePolicyLike | undefined,
  staffRoles: Set<string>
): RouteAccess => {
  if (!protection) {
    return 'public'
  }
  if (protection.serverOnly === true) {
    return 'server'
  }
  if (protection.requiresAuth === true) {
    const roles = Array.isArray(protection.allowedRoles) ? protection.allowedRoles : []
    return roles.length > 0 && roles.every((role) => staffRoles.has(role)) ? 'staff' : 'session'
  }
  return 'public'
}

/** Who can make the route(s) a workflow compiles to run. */
const workflowAccess = (workflow: WorkflowLike, staffRoles: Set<string>): RouteAccess => {
  // An automation runs in the in-app event bus, from this deployment's own code.
  if (isAutomationWorkflow(workflow as never)) {
    return 'server'
  }
  const triggerType = workflow.trigger && workflow.trigger.type
  // A cron route refuses every request the crons worker did not sign.
  if (triggerType === 'event-cron-triggered') {
    return 'server'
  }
  // A webhook route is the trigger's own: guarded only when it checks a signature.
  if (triggerType === 'event-webhook-received' && workflow.webhookConfig) {
    return isPaymentWebhookConfig(workflow.webhookConfig) ||
      workflow.webhookConfig.verifySignature === true
      ? 'server'
      : 'public'
  }
  return policyAccess(workflow.protection, staffRoles)
}

const calledCustomNodeIds = (owner: WorkflowLike): string[] =>
  (owner.nodes || [])
    .filter((node) => !!node && node.type === 'general-custom-node')
    .map((node) => (node.config || {}).customNodeId || (node.config || {}).customWorkflowNodeId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

interface Reach {
  access: RouteAccess
  /** The caller that makes a server-only custom node that reachable. */
  via?: string
  /** For a route any session of these roles reaches: the roles (`[]`: any session). */
  admits?: string[]
}

/** How reachable a workflow's route is, with the roles it admits when a session is enough. */
const workflowReach = (workflow: WorkflowLike, staffRoles: Set<string>): Reach => {
  const access = workflowAccess(workflow, staffRoles)
  return access === 'session'
    ? { access, admits: (workflow.protection && workflow.protection.allowedRoles) || [] }
    : { access }
}

/**
 * How reachable each custom node's steps are: a custom node with a policy of
 * its own is called by the browser and its route answers by that policy; a
 * server-only one runs in its callers' server segments, so it is as reachable
 * as its most reachable caller (a workflow, or another custom node, the same
 * way). Server-only with no caller: only server code reaches it.
 */
const customNodeReach = (
  workflows: WorkflowsLike,
  staffRoles: Set<string>
): Record<string, Reach> => {
  const customNodes = workflows.customNodes || {}
  const callers: Record<string, Array<{ name: string; reach: () => Reach }>> = {}
  const reach: Record<string, Reach> = {}
  const resolving = new Set<string>()

  const reachOf = (customNodeId: string): Reach => {
    if (reach[customNodeId]) {
      return reach[customNodeId]
    }
    const customNode = customNodes[customNodeId]
    const own = policyAccess(customNode && customNode.protection, staffRoles)
    if (own !== 'server') {
      reach[customNodeId] =
        own === 'session'
          ? {
              access: own,
              admits: (customNode.protection && customNode.protection.allowedRoles) || [],
            }
          : { access: own }
      return reach[customNodeId]
    }
    if (resolving.has(customNodeId)) {
      // A cycle back to itself adds no caller of its own.
      return { access: own }
    }
    resolving.add(customNodeId)
    let result: Reach = { access: 'server' }
    for (const caller of callers[customNodeId] || []) {
      const callerReach = caller.reach()
      const access = lessGuarded(result.access, callerReach.access)
      if (access !== result.access) {
        result = {
          access,
          via: callerReach.via || caller.name,
          ...(callerReach.admits ? { admits: callerReach.admits } : {}),
        }
      }
    }
    resolving.delete(customNodeId)
    reach[customNodeId] = result
    return result
  }

  for (const [workflowId, workflow] of Object.entries(workflows.workflows || {})) {
    if (!workflow) {
      continue
    }
    for (const id of calledCustomNodeIds(workflow)) {
      ;(callers[id] = callers[id] || []).push({
        name: workflow.name || workflowId,
        reach: () => workflowReach(workflow, staffRoles),
      })
    }
  }
  for (const [callerId, caller] of Object.entries(customNodes)) {
    if (!caller) {
      continue
    }
    for (const id of calledCustomNodeIds(caller)) {
      ;(callers[id] = callers[id] || []).push({
        name: caller.name || callerId,
        reach: () => reachOf(callerId),
      })
    }
  }
  for (const id of Object.keys(customNodes)) {
    reachOf(id)
  }
  return reach
}

const collectFrom = (
  owners: Record<string, WorkflowLike> | undefined,
  ownerKind: PublicStepRefusal['ownerKind'],
  reachOf: (ownerId: string, owner: WorkflowLike) => Reach,
  out: PublicStepRefusal[]
): void => {
  for (const [ownerId, owner] of Object.entries(owners || {})) {
    if (!owner || !Array.isArray(owner.nodes)) {
      continue
    }
    const restricted = owner.nodes.filter(
      (node) => !!node && typeof node.type === 'string' && node.type in RESTRICTED_STEPS
    )
    if (restricted.length === 0) {
      continue
    }
    const reach = reachOf(ownerId, owner)
    for (const node of restricted) {
      if (allows(reach.access, RESTRICTED_STEPS[node.type as string].gate)) {
        continue
      }
      out.push({
        ownerId,
        ownerName: owner.name || ownerId,
        ownerKind,
        nodeId: node.id || '?',
        nodeType: node.type as string,
        stepName: node.name || node.label || (node.type as string),
        ...(reach.via ? { calledFrom: reach.via } : {}),
        ...(reach.access === 'session' ? { admits: reach.admits || [] } : {}),
      })
    }
  }
}

export interface PublicStepGuardOptions {
  /** The project's staff roles; `['admin']` when not given. */
  staffRoles?: string[]
}

/** Every restricted step on a route that answers callers it should not (custom nodes included). */
export const findPublicRestrictedSteps = (
  workflows: WorkflowsLike | undefined,
  options: PublicStepGuardOptions = {}
): PublicStepRefusal[] => {
  const refusals: PublicStepRefusal[] = []
  if (!workflows) {
    return refusals
  }
  const staffRoles = new Set(options.staffRoles || [TableAccess.ADMIN_ROLE])
  collectFrom(
    workflows.workflows,
    'workflow',
    (_id, workflow) => workflowReach(workflow, staffRoles),
    refusals
  )
  const reach = customNodeReach(workflows, staffRoles)
  collectFrom(
    workflows.customNodes,
    'custom-node',
    (id) => reach[id] || { access: 'public' },
    refusals
  )
  return refusals
}

/** How reachable one custom node's push and file steps are, with the roles a session reach admits. */
export interface CustomNodeStepReach {
  access: 'public' | 'session' | 'staff' | 'server'
  admits?: string[]
}

/**
 * The reach `findPublicRestrictedSteps` judges one custom node's steps by: its
 * own policy, or — when it is server-only — its least-guarded caller's,
 * workflows and custom nodes alike (`customNodeReach`). The editor's workflow
 * agents read it (teleport-gui `workflow-route-access.ts`), so they refuse what
 * the publish refuses.
 */
export const customNodeStepReach = (
  workflows: WorkflowsLike,
  customNodeId: string,
  options: PublicStepGuardOptions = {}
): CustomNodeStepReach => {
  const staffRoles = new Set(options.staffRoles || [TableAccess.ADMIN_ROLE])
  const reach = customNodeReach(workflows, staffRoles)[customNodeId] || { access: 'public' }
  return { access: reach.access, ...(reach.admits ? { admits: reach.admits } : {}) }
}

/**
 * Throws {@link PublicStepRefusalError} when any restricted step sits on a
 * route that answers callers it should not. The staff roles are the project's
 * (`TableAccess.resolveStaffRoles(authentication)`).
 */
export const assertNoPublicRestrictedSteps = (
  workflows: WorkflowsLike | undefined,
  authentication?: UIDLAuthentication | null
): void => {
  const staffRoles = TableAccess.resolveStaffRoles(authentication)
  const refusals = findPublicRestrictedSteps(workflows, { staffRoles })
  if (refusals.length > 0) {
    throw new PublicStepRefusalError(refusals, staffRoles)
  }
}
