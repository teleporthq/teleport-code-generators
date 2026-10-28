import * as fs from 'fs'
import * as path from 'path'
import { CLIENT_ONLY_NODES } from '../src/api-route-generator'
import { automationEntityOf, automationEnvelopeKeys } from '../src/automations/automations-scope'

/**
 * The code generator keeps its own copies of two things the editor's
 * workflow schema (teleport-gui `packages/workflow-schema`) owns, because this
 * package cannot import it:
 *
 * - the envelope of every business event: `automationEntityOf` (the entity's
 *   key) and `automationEnvelopeKeys` (its top-level blocks), against the
 *   catalog's `entity` and `details`;
 * - the browser-only nodes a server route drops (`CLIENT_ONLY_NODES`), against
 *   the schema's `CLIENT_ONLY_NODE_TYPES`, which the editor refuses in
 *   automations.
 *
 * Both are hand-synced: this spec reads the schema's built constants and
 * fails the moment either copy drifts, by contents.
 */

const SCHEMA_CONSTANTS = ['teleport-gui', 'packages', 'workflow-schema', 'dist', 'constants']

/** Locates the workflow schema's built constants by walking up from here. */
const findSchemaConstants = (): string | null => {
  let dir = __dirname
  for (let i = 0; i < 14; i++) {
    const candidate = path.join(dir, ...SCHEMA_CONSTANTS)
    if (fs.existsSync(path.join(candidate, 'business-events.js'))) {
      return candidate
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  return null
}

interface CatalogEvent {
  type: string
  entity: string
  details: Array<{ path: string }>
}

const constantsDir = findSchemaConstants()

describe('automations — the copies of the workflow schema', () => {
  if (!constantsDir) {
    // tslint:disable-next-line:no-console
    console.warn(
      `automations catalog not compared: ${SCHEMA_CONSTANTS.join(
        '/'
      )}/business-events.js was not found above ${__dirname} (build teleport-gui's workflow-schema beside this repo)`
    )
    it.todo('builds every event envelope from the catalog blocks')
    it.todo('drops the browser-only nodes the schema lists')
    return
  }
  // tslint:disable-next-line:no-var-requires
  const catalog = require(path.join(constantsDir, 'business-events.js'))
    .BUSINESS_EVENTS as CatalogEvent[]
  // tslint:disable-next-line:no-var-requires
  const schemaClientOnly = require(path.join(constantsDir, 'automation-workflow.js'))
    .CLIENT_ONLY_NODE_TYPES as Set<string>

  it('builds every event envelope from the catalog blocks', () => {
    expect(catalog.length).toBeGreaterThan(0)
    const drift = catalog
      .map((event) => {
        const blocks = Array.from(
          new Set(
            event.details
              .map((detail) => detail.path)
              .filter((at) => at.indexOf('.') === -1 && at !== 'event' && at !== 'actor')
          )
        ).sort()
        return {
          type: event.type,
          entity: automationEntityOf(event.type),
          blocks: (automationEnvelopeKeys(event.type) || []).slice().sort(),
          catalog: { entity: event.entity, blocks },
        }
      })
      .filter(
        (row) =>
          row.entity !== row.catalog.entity ||
          JSON.stringify(row.blocks) !== JSON.stringify(row.catalog.blocks)
      )
    expect(drift).toEqual([])
  })

  it('drops the browser-only nodes the schema lists', () => {
    expect(Array.from(CLIENT_ONLY_NODES).sort()).toEqual(Array.from(schemaClientOnly).sort())
  })
})
