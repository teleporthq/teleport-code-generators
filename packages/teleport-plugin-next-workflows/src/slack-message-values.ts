import type { UIDLWorkflowNode, UIDLWorkflows } from '@teleporthq/teleport-types'

/**
 * A Slack step's message is mrkdwn, where `<…>` is a link, a mention or
 * `<!channel>`, and the values an automation puts in it come from the event —
 * what a customer typed among them. Each value must reach Slack escaped
 * (`&`, `<`, `>`: the only characters Slack decodes). A value embedded in the
 * message (a context chip) is escaped by the runtime as it is filled in
 * (`resolveRichTextContext`); a message that IS one value (the whole field
 * bound to it) is written here as that same chip, so it is escaped the same
 * way. Every other step is left as it is — in an automation, a page workflow,
 * a webhook or a custom node alike.
 */
const SLACK_NODE_TYPE = 'integration-slack'
const SLACK_MESSAGE_KEYS = ['text']

interface ContextReference {
  type: 'workflowContext'
  nodeId: string
  path: string[]
}

const isContextReference = (value: unknown): value is ContextReference => {
  const candidate = value as ContextReference | null
  return (
    !!candidate &&
    typeof candidate === 'object' &&
    candidate.type === 'workflowContext' &&
    typeof candidate.nodeId === 'string' &&
    candidate.nodeId.length > 0 &&
    Array.isArray(candidate.path)
  )
}

// The chip the editor writes for a value, read back by resolveRichTextContext:
// the path as JSON in a double-quoted attribute (`&quot;`), with `<`, `>` and
// `&` written as JSON escapes so nothing in it can end the tag or the entity.
const asContextChip = (reference: ContextReference): string => {
  const path = JSON.stringify(reference.path)
    .replace(/[<>&]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .replace(/"/g, '&quot;')
  const nodeId = reference.nodeId.replace(/[^A-Za-z0-9_-]/g, '')
  return `<span class="context-value-inline" data-ctx-node-id="${nodeId}" data-ctx-path="${path}">value</span>`
}

const withSlackMessageValuesEscaped = (node: UIDLWorkflowNode): UIDLWorkflowNode => {
  if (node.type !== SLACK_NODE_TYPE || !node.config) {
    return node
  }
  const config = node.config as Record<string, unknown>
  const bound = SLACK_MESSAGE_KEYS.filter((key) => isContextReference(config[key]))
  if (bound.length === 0) {
    return node
  }
  const escaped: Record<string, unknown> = { ...config }
  for (const key of bound) {
    escaped[key] = asContextChip(config[key] as ContextReference)
  }
  return { ...node, config: escaped }
}

/** The nodes with every whole-field Slack message written as a chip; the same array when none is. */
export const escapeSlackMessageBindings = (nodes: UIDLWorkflowNode[]): UIDLWorkflowNode[] => {
  const escaped = nodes.map(withSlackMessageValuesEscaped)
  return escaped.some((node, index) => node !== nodes[index]) ? escaped : nodes
}

/** Every workflow's and custom node's Slack messages, in place, before any route is written. */
export const escapeSlackMessageBindingsInWorkflows = (
  workflows: UIDLWorkflows | undefined
): void => {
  if (!workflows) {
    return
  }
  const graphs = [
    ...Object.values(workflows.workflows || {}),
    ...Object.values(workflows.customNodes || {}),
  ]
  for (const graph of graphs) {
    if (Array.isArray(graph.nodes)) {
      graph.nodes = escapeSlackMessageBindings(graph.nodes)
    }
  }
}
