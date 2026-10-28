import { UIDLWorkflowEdge, UIDLWorkflowNode } from '@teleporthq/teleport-types'

/**
 * Which node results the email/SMS guard may trust (see outbound-message-guard).
 * Trust is derived, never assumed from where a node runs, and there are two
 * kinds:
 *
 * - **Owner recipients** (a recipient or sender that is never counted or
 *   refused): a read of the owner's settings the server runs (the store
 *   settings node, a read of an owner-settings table), the platform's
 *   owner-notification payload builders, which bake the business's own
 *   addresses from its settings into their code, and its owner-recipient
 *   builders, which read them from the settings read just before them. A
 *   server pass-through (custom JavaScript, a transform, a utility, a loop)
 *   is one only when it has inputs and every one of them is (or carries no
 *   data: an if / switch decision, a delay). Any other database read is not:
 *   it may hold an address the visitor just wrote to a row.
 * - **Trusted HTML** (a whole body sent as it is): only the platform's
 *   owner-notification payload builders, which build their HTML from database
 *   rows and escape every value themselves.
 *
 * Everything else counts as visitor input: the trigger, any node the browser
 * runs, a custom node's first step (it reads the caller's parameters), any
 * other server node. A builder is found by its builder label: `builderLabel`
 * (the editor's stable key, exported when the step was renamed), else `name`,
 * else `label`.
 */

/** Reads of the owner's settings, by node type. */
const OWNER_SETTINGS_NODE_TYPES: ReadonlySet<string> = new Set(['ecommerce-get-settings'])

/** Tables that hold the owner's settings (a `data-select` / `data-count` of one is an owner read). */
export const OWNER_SETTINGS_TABLES: ReadonlySet<string> = new Set(['teleport_booking_settings'])

const TABLE_READ_NODE_TYPES: ReadonlySet<string> = new Set(['data-select', 'data-count'])

/**
 * The platform's owner-notification payload builders, by builder label. Each
 * bakes the owner's notification addresses into its code and builds its HTML
 * from database rows, escaping every value. Trusted only when the server runs
 * it; in the browser it is visitor input like any other result.
 */
export const OWNER_NOTIFICATION_BUILDER_LABELS: ReadonlySet<string> = new Set([
  'Build Order-Notification Email Payload',
  'Build Low-Stock Email Payload',
])

/**
 * The platform's owner-recipient builders, by builder label: each turns a
 * read of the owner's settings (the step just before it, its
 * `previousContext`) into the addresses the business's own notices go to,
 * with the address baked at build as the fallback. Recipients only: what
 * they return is never sent as HTML. Trusted only when the server runs it.
 */
export const OWNER_RECIPIENT_BUILDER_LABELS: ReadonlySet<string> = new Set([
  'Build Booking Alert Recipients',
])

/** Nodes whose output is what they were handed, reshaped. */
const isPassThroughType = (type: string): boolean =>
  type === 'general-custom-js' ||
  type === 'general-loop' ||
  type.startsWith('transform-') ||
  type.startsWith('utility-')

/** Nodes whose output carries no value a recipient or body could be read from. */
const DATALESS_NODE_TYPES: ReadonlySet<string> = new Set([
  'general-if-statement',
  'general-switch',
  'general-delay',
  'general-parallel',
  'general-rate-limiter',
  'general-wait',
])

/** The key a platform builder is found by (see above). */
export const builderKeyOf = (node: UIDLWorkflowNode): string => {
  const exported = node as UIDLWorkflowNode & { builderLabel?: unknown }
  const key =
    typeof exported.builderLabel === 'string' && exported.builderLabel
      ? exported.builderLabel
      : typeof node.name === 'string' && node.name
      ? node.name
      : node.label
  return typeof key === 'string' ? key : ''
}

/** The name a step is shown under (its own name, else its type's label). */
export const stepNameOf = (node: { id: string; label?: string; name?: string }): string =>
  node.name || node.label || node.id

export interface MessageTrustGraph {
  nodes: UIDLWorkflowNode[]
  edges: UIDLWorkflowEdge[]
  /** The ids of the nodes this deployment's server runs. */
  serverNodeIds: Set<string>
}

export interface MessageTrust {
  /** Node results a recipient or sender may be read from without being counted. */
  ownerRecipientNodeIds: string[]
  /** Node results a whole body may be sent from as HTML. */
  trustedHtmlNodeIds: string[]
}

const isOwnerNotificationBuilder = (node: UIDLWorkflowNode): boolean =>
  node.type === 'general-custom-js' && OWNER_NOTIFICATION_BUILDER_LABELS.has(builderKeyOf(node))

const isOwnerRecipientBuilder = (node: UIDLWorkflowNode): boolean =>
  node.type === 'general-custom-js' && OWNER_RECIPIENT_BUILDER_LABELS.has(builderKeyOf(node))

const isOwnerSettingsRead = (node: UIDLWorkflowNode): boolean => {
  if (OWNER_SETTINGS_NODE_TYPES.has(node.type)) {
    return true
  }
  const table = node.config && (node.config as Record<string, unknown>).tableName
  return (
    TABLE_READ_NODE_TYPES.has(node.type) &&
    typeof table === 'string' &&
    OWNER_SETTINGS_TABLES.has(table)
  )
}

export const collectMessageTrust = (graph: MessageTrustGraph): MessageTrust => {
  const byId = new Map<string, UIDLWorkflowNode>()
  graph.nodes.forEach((node) => byId.set(node.id, node))
  const predecessors = new Map<string, string[]>()
  graph.edges.forEach((edge) => {
    const list = predecessors.get(edge.target) || []
    list.push(edge.source)
    predecessors.set(edge.target, list)
  })

  const memo = new Map<string, boolean>()
  const ownerRecipient = (id: string, visiting: Set<string>): boolean => {
    if (memo.has(id)) {
      return memo.get(id) as boolean
    }
    const node = byId.get(id)
    let result = false
    if (node && graph.serverNodeIds.has(id)) {
      if (
        isOwnerSettingsRead(node) ||
        isOwnerNotificationBuilder(node) ||
        isOwnerRecipientBuilder(node)
      ) {
        result = true
      } else if (isPassThroughType(node.type)) {
        result = everyInputOwner(id, visiting)
      }
    }
    memo.set(id, result)
    return result
  }
  // At least one node comes before `id`, and every one of them is an owner
  // read or carries no data. A step with nothing before it reads its inputs
  // from the caller (a custom node's parameters): it is not one.
  const everyInputOwner = (id: string, visiting: Set<string>): boolean => {
    const first = predecessors.get(id) || []
    if (first.length === 0) {
      return false
    }
    const seen = new Set<string>([id])
    const queue = first.slice()
    let sawData = false
    while (queue.length > 0) {
      const ancestorId = queue.shift() as string
      if (seen.has(ancestorId)) {
        continue
      }
      seen.add(ancestorId)
      const ancestor = byId.get(ancestorId)
      const dataless = !!ancestor && DATALESS_NODE_TYPES.has(ancestor.type)
      if (!dataless) {
        if (visiting.has(ancestorId)) {
          return false
        }
        const next = new Set(visiting)
        next.add(id)
        if (!ownerRecipient(ancestorId, next)) {
          return false
        }
        sawData = true
      }
      ;(predecessors.get(ancestorId) || []).forEach((p) => queue.push(p))
    }
    return sawData
  }

  return {
    ownerRecipientNodeIds: graph.nodes
      .filter((node) => ownerRecipient(node.id, new Set()))
      .map((node) => node.id),
    trustedHtmlNodeIds: graph.nodes
      .filter((node) => graph.serverNodeIds.has(node.id) && isOwnerNotificationBuilder(node))
      .map((node) => node.id),
  }
}
