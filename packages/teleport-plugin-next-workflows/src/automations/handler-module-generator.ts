import type { UIDLCustomWorkflowNode, UIDLWorkflow } from '@teleporthq/teleport-types'
import { generateHandlerFunction } from '../api-route-generator'
import { escapeSlackMessageBindings } from '../slack-message-values'
import { automationEventType } from './automations-scope'

/**
 * One handler module per automation (`lib/automations/handlers/<file>.js`,
 * exporting `run(event, context, resumeFrom)`, see generateHandlerFunction)
 * and the registry the dispatcher reads them from.
 */

export interface AutomationRegistryEntry {
  eventType: string
  workflowId: string
  name: string
  fileName: string
}

const slugOf = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '')

/**
 * `<slug of the name>-<first 8 of the id>`, unique within the project: a
 * name taken already gets the whole id, then a counter.
 */
export const resolveAutomationHandlerFileNames = (
  workflows: UIDLWorkflow[]
): Map<string, string> => {
  const taken = new Set<string>()
  const names = new Map<string, string>()
  for (const workflow of workflows) {
    const nameSlug = slugOf(workflow.name || '')
    const idSlug = slugOf(workflow.id)
    const join = (idPart: string) =>
      [nameSlug, idPart].filter(Boolean).join('-').replace(/-+$/g, '') || 'automation'
    let fileName = join(idSlug.slice(0, 8))
    if (taken.has(fileName)) {
      fileName = join(idSlug)
    }
    const base = fileName
    for (let counter = 2; taken.has(fileName); counter++) {
      fileName = `${base}-${counter}`
    }
    taken.add(fileName)
    names.set(workflow.id, fileName)
  }
  return names
}

export const generateAutomationHandlerModule = (
  workflow: UIDLWorkflow,
  customNodes?: Record<string, UIDLCustomWorkflowNode>
): string => {
  const nodes = workflow.nodes || []
  const escaped = escapeSlackMessageBindings(nodes)
  return generateHandlerFunction(
    escaped === nodes ? workflow : { ...workflow, nodes: escaped },
    customNodes
  )
}

export const toRegistryEntry = (
  workflow: UIDLWorkflow,
  fileName: string
): AutomationRegistryEntry => ({
  eventType: automationEventType(workflow),
  workflowId: workflow.id,
  name: workflow.name || workflow.id,
  fileName,
})

/**
 * `lib/automations/registry.js`: `{ '<event-type>': [{ workflowId, name, run }] }`,
 * in the order the workflows are listed.
 */
export const generateAutomationRegistryCode = (entries: AutomationRegistryEntry[]): string => {
  const byType = new Map<string, AutomationRegistryEntry[]>()
  for (const entry of entries) {
    const list = byType.get(entry.eventType) || []
    list.push(entry)
    byType.set(entry.eventType, list)
  }
  const blocks = Array.from(byType.entries()).map(([eventType, list]) => {
    const lines = list.map(
      (entry) =>
        `    { workflowId: ${JSON.stringify(entry.workflowId)}, name: ${JSON.stringify(
          entry.name
        )}, run: require('./handlers/${entry.fileName}.js').run },`
    )
    return `  ${JSON.stringify(eventType)}: [\n${lines.join('\n')}\n  ],`
  })
  return `'use strict';
/**
 * The project's automations by the event they react to (generated). The
 * dispatcher (./dispatcher.js) runs the handlers of an event's type that are
 * switched on in teleport_automations.
 */
module.exports = {
${blocks.join('\n')}
};
`
}
