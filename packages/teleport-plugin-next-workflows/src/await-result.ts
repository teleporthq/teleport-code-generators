import { UIDLWorkflowNode } from '@teleporthq/teleport-types'
import { WorkflowSegment } from './types'

/**
 * Every node in the `data` category. Mirrors `DATA_NODE_TYPES` in
 * teleport-gui's `@teleport/workflow-schema` (`constants/data-node-await.ts`) —
 * the two repos cannot import each other, so this list is a PAIRED EDIT.
 */
export const DATA_NODE_TYPES: ReadonlyArray<string> = [
  'data-select',
  'data-count',
  'data-raw-query',
  'data-create-item',
  'data-update-item',
  'data-delete-item',
]

/**
 * The other steps the author may choose not to wait for: server work whose
 * result nothing downstream needs (a cash order's invoice, rendered, stored
 * and mailed while the buyer is already on the confirmation page). The
 * editor offers the choice on the same steps (`supportsAwaitResultOption` in
 * teleport-gui's `@teleport/workflow-schema`) — a PAIRED EDIT.
 */
export const NOT_AWAITABLE_SERVER_NODE_TYPES: ReadonlyArray<string> = ['ecommerce-generate-invoice']

/**
 * Config key carrying the author's await choice. Only `false` opts out —
 * `undefined` (never configured) and `true` both mean "await", so every
 * project generated before this option existed keeps its old behaviour.
 */
export const AWAIT_RESULT_CONFIG_KEY = 'awaitResult'

const AWAIT_OPTIONAL_NODE_TYPE_SET = new Set<string>([
  ...DATA_NODE_TYPES,
  ...NOT_AWAITABLE_SERVER_NODE_TYPES,
])

/**
 * True when this node runs fire-and-forget: the runtime starts the step,
 * publishes `null` under the node's id and moves straight on to the next node.
 */
export const isFireAndForgetNode = (node: UIDLWorkflowNode | undefined | null): boolean => {
  if (!node || !AWAIT_OPTIONAL_NODE_TYPE_SET.has(node.type)) {
    return false
  }
  const config = node.config as Record<string, unknown> | undefined
  return !!config && config[AWAIT_RESULT_CONFIG_KEY] === false
}

/**
 * True when a whole SERVER segment can be dispatched without awaiting the
 * response — i.e. every node it holds is fire-and-forget, so nothing
 * downstream can read anything the segment produces.
 *
 * The API route itself still lands each step (a serverless function may be
 * frozen the moment it responds, which would drop an in-flight write: on
 * Vercel the step finishes after the reply, elsewhere the reply waits); what
 * this flag removes is the CLIENT's wait on that round trip.
 */
export const isFireAndForgetSegment = (segment: WorkflowSegment): boolean =>
  segment.env === 'server' &&
  segment.nodes.length > 0 &&
  segment.nodes.every((node) => isFireAndForgetNode(node))
