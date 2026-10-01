import { UIDLCustomWorkflowNode, UIDLWorkflowNode } from '@teleporthq/teleport-types'

/**
 * Which of the page's state a server segment can read.
 *
 * The browser hands a server segment the workflow context it holds, and that
 * context carries `__stateValues` — a snapshot of EVERY state the page has,
 * once at the top level and once inside the trigger context. A checkout page
 * holds its country list, its cart and its order history there; a voucher
 * check reads none of it, yet every request shipped all of it, and every
 * reply echoed it back.
 *
 * What a server segment can read off that bag is fixed when the app is
 * generated, because a server node reads page state only through these:
 *   - a whole-string `{{state.<name>...}}` template token
 *     (`resolveTemplateTokenString`), or `{{Current User.id}}`, which reads
 *     `currentUser`;
 *   - a `workflowContext` reference whose path walks through `__stateValues`;
 *   - a JS expression evaluated against the context (an expression condition,
 *     an expression switch, a while / until loop), which can name the bag —
 *     any string that mentions it is taken as reading all of it;
 *   - a custom node it calls, whose own nodes may do any of the above; the
 *     custom node's inner server segments prune for themselves, but they can
 *     only prune what the calling segment carried, so the need is transitive.
 * A custom-JS node cannot: the bag is a reserved key its handler never exposes.
 *
 * The client runtime keeps exactly these entries in the request
 * (`pruneContext`); '*' keeps the whole bag, as before.
 */

/** Every state entry travels — an expression may read any of them. */
export const ALL_STATE_KEYS = '*'

export type SegmentStateKeys = string[] | typeof ALL_STATE_KEYS

const STATE_BAG_KEY = '__stateValues'
/** The state a `{{Current User.id}}` / `{{currentUser.id}}` token reads. */
const CURRENT_USER_STATE_KEY = 'currentUser'

const STATE_TOKEN_PATTERN = /\{\{\s*state\.([A-Za-z_$][\w$]*)/g
const CURRENT_USER_TOKEN_PATTERN = /\{\{\s*(?:Current User\.id|currentUser\.id)\s*\}\}/

interface Collector {
  keys: Set<string>
  all: boolean
}

const collectFromString = (value: string, into: Collector): void => {
  if (value.indexOf(STATE_BAG_KEY) !== -1) {
    into.all = true
    return
  }
  if (value.indexOf('{{') === -1) {
    return
  }
  STATE_TOKEN_PATTERN.lastIndex = 0
  let match = STATE_TOKEN_PATTERN.exec(value)
  while (match) {
    into.keys.add(match[1])
    match = STATE_TOKEN_PATTERN.exec(value)
  }
  if (CURRENT_USER_TOKEN_PATTERN.test(value)) {
    into.keys.add(CURRENT_USER_STATE_KEY)
  }
}

const collectFromContextRef = (path: unknown[], into: Collector): void => {
  const bagIndex = path.indexOf(STATE_BAG_KEY)
  if (bagIndex === -1) {
    return
  }
  const stateName = path[bagIndex + 1]
  if (typeof stateName === 'string' && stateName.length > 0) {
    into.keys.add(stateName)
  } else {
    into.all = true
  }
}

const collectFromValue = (value: unknown, into: Collector): void => {
  if (into.all) {
    return
  }
  if (typeof value === 'string') {
    collectFromString(value, into)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectFromValue(entry, into)
    }
    return
  }
  if (!value || typeof value !== 'object') {
    return
  }
  const record = value as Record<string, unknown>
  if (record.type === 'workflowContext' && Array.isArray(record.path)) {
    // A reference names the bag in its path on purpose; that is a walk into
    // one state, not an expression that may read all of them.
    collectFromContextRef(record.path, into)
    return
  }
  for (const key of Object.keys(record)) {
    collectFromValue(record[key], into)
  }
}

const collectFromNodes = (
  nodes: UIDLWorkflowNode[],
  customNodes: Record<string, UIDLCustomWorkflowNode> | undefined,
  visited: Set<string>,
  into: Collector
): void => {
  for (const node of nodes) {
    if (into.all) {
      return
    }
    const config = (node.config || {}) as Record<string, unknown>
    collectFromValue(config, into)
    if (node.type !== 'general-custom-node' || !customNodes) {
      continue
    }
    const customNodeId = config.customNodeId
    if (typeof customNodeId !== 'string' || visited.has(customNodeId)) {
      continue
    }
    visited.add(customNodeId)
    const customNode = customNodes[customNodeId]
    if (customNode && Array.isArray(customNode.nodes)) {
      collectFromNodes(customNode.nodes, customNodes, visited, into)
    }
  }
}

/**
 * The page-state names the given nodes — and, transitively, the custom nodes
 * they call — can read, sorted; or '*' when one of them evaluates an
 * expression that may read the whole bag.
 */
export const collectSegmentStateKeys = (
  nodes: UIDLWorkflowNode[],
  customNodes: Record<string, UIDLCustomWorkflowNode> | undefined
): SegmentStateKeys => {
  const into: Collector = { keys: new Set<string>(), all: false }
  collectFromNodes(nodes, customNodes, new Set<string>(), into)
  return into.all ? ALL_STATE_KEYS : Array.from(into.keys).sort()
}
