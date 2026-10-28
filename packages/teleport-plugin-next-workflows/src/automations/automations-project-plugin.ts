import {
  FileType,
  ProjectPluginStructure,
  UIDLCustomWorkflowNode,
  UIDLWorkflow,
} from '@teleporthq/teleport-types'
import { getDatabaseDriverDependencies } from '../auth-generator'
import { declareCronSecretEnv } from '../cron-request-verification'
import { enableSentEmailAttribution } from '../sent-email-log'
import {
  AUTOMATION_HANDLERS_PATH,
  AUTOMATION_HYDRATE_PATH,
  AUTOMATIONS_DISPATCH_ROUTE_PATH,
  AUTOMATIONS_FILE_KEY_PREFIX,
  AUTOMATIONS_PATH,
  AUTOMATIONS_UNAVAILABLE_REASON,
  VERCEL_FUNCTIONS_DEPENDENCY,
  automationEntityOf,
  automationEnvelopeKeys,
  automationEventType,
  resolveAutomationsDatabase,
} from './automations-scope'
import {
  generateAutomationEventBusCode,
  generateAutomationStoreCode,
  generateAutomationWaitUntilCode,
} from './event-bus-source'
import {
  generateAutomationDispatchRouteCode,
  generateAutomationDispatcherCode,
  generateAutomationsUnavailableRouteCode,
} from './dispatcher-source'
import { generateAutomationHydratorCode } from './hydrators-source'
import { generateAutomationDueCheckCode, installAutomationActivityKicks } from './activity-kicks'
import {
  generateAutomationHandlerModule,
  generateAutomationRegistryCode,
  resolveAutomationHandlerFileNames,
  toRegistryEntry,
} from './handler-module-generator'

export interface AutomationFilesOptions {
  customNodes?: Record<string, UIDLCustomWorkflowNode>
  /** The auth users table, read for the `user` block of account events. */
  usersTable: string
  /** The order details page's route prefix, for `order.pageUrl` (null: no link). */
  orderPagePrefix: string | null
}

const setFile = (
  structure: ProjectPluginStructure,
  key: string,
  path: string[],
  name: string,
  content: string
): void => {
  structure.files.set(`${AUTOMATIONS_FILE_KEY_PREFIX}${key}`, {
    path,
    files: [{ name, fileType: FileType.JS, content }],
  })
}

/**
 * Emits the in-app event bus for the project's automations (see
 * automations-scope.ts). Nothing at all without one: an automation whose
 * trigger names no event is skipped, with a warning, like a mis-scoped page
 * workflow. No bus either when the UIDL names no TeleportHQ database for the
 * automation tables (`uidl.automations`, the only database automations run
 * on): a bus that opened another database than the one the editor writes the
 * switches to would run nothing the owner sees. The build says why, and the
 * dispatch route answers why (503), so a test sent from the editor shows the
 * reason instead of a missing page.
 */
export const generateAutomationFiles = (
  structure: ProjectPluginStructure,
  workflows: UIDLWorkflow[],
  options: AutomationFilesOptions
): void => {
  const automations = workflows.filter((workflow) => {
    if (automationEventType(workflow)) {
      return true
    }
    console.warn(
      `[teleport-plugin-next-workflows] Automation "${
        workflow.name || workflow.id
      }" names no business event - skipping code generation for it. Pick the event in its trigger.`
    )
    return false
  })
  if (automations.length === 0) {
    return
  }
  const database = resolveAutomationsDatabase(structure.uidl.automations)
  if (!database) {
    console.warn(
      `[teleport-plugin-next-workflows] The project has automations but ${AUTOMATIONS_UNAVAILABLE_REASON} (uidl.automations) - no event bus is generated, so they do not run. Create the TeleportHQ database in Automations.`
    )
    setFile(
      structure,
      'dispatch-route',
      AUTOMATIONS_DISPATCH_ROUTE_PATH,
      'dispatch',
      generateAutomationsUnavailableRouteCode(AUTOMATIONS_UNAVAILABLE_REASON)
    )
    return
  }

  const fileNames = resolveAutomationHandlerFileNames(automations)
  const entries = automations.map((workflow) => {
    const fileName = fileNames.get(workflow.id) as string
    setFile(
      structure,
      `handler-${workflow.id}`,
      AUTOMATION_HANDLERS_PATH,
      fileName,
      generateAutomationHandlerModule(workflow, options.customNodes)
    )
    return toRegistryEntry(workflow, fileName)
  })

  const entityByType: Record<string, string | null> = {}
  const envelopeKeysByType: Record<string, string[] | null> = {}
  const hydratedEntities: string[] = []
  for (const { eventType } of entries) {
    const entity = automationEntityOf(eventType)
    entityByType[eventType] = entity
    envelopeKeysByType[eventType] = automationEnvelopeKeys(eventType)
    if (!entity || hydratedEntities.indexOf(entity) !== -1) {
      continue
    }
    const hydrator = generateAutomationHydratorCode(entity, {
      usersTable: options.usersTable,
      orderPagePrefix: options.orderPagePrefix,
    })
    if (hydrator) {
      hydratedEntities.push(entity)
      setFile(structure, `hydrate-${entity}`, AUTOMATION_HYDRATE_PATH, entity, hydrator)
    }
  }

  setFile(
    structure,
    'registry',
    AUTOMATIONS_PATH,
    'registry',
    generateAutomationRegistryCode(entries)
  )
  setFile(structure, 'store', AUTOMATIONS_PATH, 'store', generateAutomationStoreCode())
  setFile(
    structure,
    'wait-until',
    AUTOMATIONS_PATH,
    'wait-until',
    generateAutomationWaitUntilCode()
  )
  setFile(structure, 'event-bus', AUTOMATIONS_PATH, 'event-bus', generateAutomationEventBusCode())
  setFile(
    structure,
    'dispatcher',
    AUTOMATIONS_PATH,
    'dispatcher',
    generateAutomationDispatcherCode({ entityByType, envelopeKeysByType, hydratedEntities })
  )
  setFile(
    structure,
    'dispatch-route',
    AUTOMATIONS_DISPATCH_ROUTE_PATH,
    'dispatch',
    generateAutomationDispatchRouteCode()
  )
  // Due Waits and retries resume on the site's activity: the server reads of
  // the TeleportHQ database (and the data API, see data-api-route-generator)
  // start the due check.
  setFile(
    structure,
    'due-check',
    AUTOMATIONS_PATH,
    'due-check',
    generateAutomationDueCheckCode(
      entries.map((entry) => entry.workflowId),
      Array.from(new Set(entries.map((entry) => entry.eventType)))
    )
  )
  installAutomationActivityKicks(structure)
  // The route verifies the editor's signed test requests (and any signed
  // kick) with the project's cron signing keys, which the deploy fills only
  // where the env declares them.
  declareCronSecretEnv(structure.uidl)
  // The mail automations send is filed under them (and the event's order).
  enableSentEmailAttribution(structure)

  // The queue is Postgres (spec §5.1): the editor offers automations only on
  // a Postgres data source.
  const { pg } = getDatabaseDriverDependencies('postgresql')
  if (!structure.dependencies.pg) {
    structure.dependencies.pg = pg
  }
  // Vercel's waitUntil keeps a dispatch alive after the response (wait-until.js).
  if (!structure.dependencies[VERCEL_FUNCTIONS_DEPENDENCY.name]) {
    structure.dependencies[VERCEL_FUNCTIONS_DEPENDENCY.name] = VERCEL_FUNCTIONS_DEPENDENCY.version
  }
}
