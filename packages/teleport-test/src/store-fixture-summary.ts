import { existsSync, readFileSync } from 'fs'
import { ProjectUIDL } from '@teleporthq/teleport-types'

/**
 * What a generated store was built FROM, said out loud at the end of a run.
 *
 * Three things decide what a generated store charges, and none of them is
 * visible in the output: WHICH project the UIDL came from (the fixture is one
 * shared file that the editor's dev export overwrites, whatever project is open),
 * which project's database `.env` points at (preserved across regenerations,
 * so it can outlive the fixture it was written for), and what that project's
 * e-commerce settings held at export time. A merchant who configured delivery
 * and shipping zones in project A and generated project B sees "free shipping
 * everywhere" with no error anywhere — it cost a full investigation once.
 *
 * The editor's dev exports stamp a `<uidl>.meta.json` sidecar beside the UIDL
 * (project id, name, export time); `.env` names the database after the project
 * (`p_<project id>`); the UIDL carries the settings. Reading the three together
 * is what makes the mix-up a one-line warning instead of a mystery.
 */

export interface FixtureIdentity {
  projectId: string
  projectName: string
  exportedAt: string
}

/** `<uidl>.json` → `<uidl>.meta.json`, the sidecar the editor's dev exports write. */
export const fixtureIdentityPath = (uidlPath: string): string =>
  `${uidlPath.replace(/\.json$/i, '')}.meta.json`

/** The sidecar beside `uidlPath`, or null when there is none or it is unreadable. */
export const readFixtureIdentity = (uidlPath: string): FixtureIdentity | null => {
  const path = fixtureIdentityPath(uidlPath)
  if (!existsSync(path)) {
    return null
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<FixtureIdentity> | null
    if (!parsed || typeof parsed.projectId !== 'string' || !parsed.projectId) {
      return null
    }
    return {
      projectId: parsed.projectId,
      projectName: typeof parsed.projectName === 'string' ? parsed.projectName : '',
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
    }
  } catch {
    return null
  }
}

/**
 * A TeleportHQ per-project database is named `p_<project id>` with the id's
 * dashes turned into underscores — the one place the project id survives into
 * a connection string.
 */
const PROJECT_DATABASE_NAME =
  /\/p_([0-9a-f]{8})_([0-9a-f]{4})_([0-9a-f]{4})_([0-9a-f]{4})_([0-9a-f]{12})(?:[?/]|$)/i

/** The project id a TeleportHQ connection string's database name carries, or null. */
export const projectIdFromConnectionString = (
  connectionString: string | undefined
): string | null => {
  const match = PROJECT_DATABASE_NAME.exec(String(connectionString ?? ''))
  return match ? match.slice(1, 6).join('-').toLowerCase() : null
}

export interface StoreFixtureSummaryLine {
  tone: 'info' | 'warning'
  text: string
}

export interface StoreFixtureSummaryInput {
  uidl: ProjectUIDL
  identity: FixtureIdentity | null
  /** The generated project's `.env`, parsed. */
  env: Record<string, string>
}

const formatMoney = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : '0.00')

const describeProject = (
  uidl: ProjectUIDL,
  identity: FixtureIdentity | null
): StoreFixtureSummaryLine => {
  if (!identity) {
    return {
      tone: 'info',
      text: `Project: "${uidl.name}" (no export record beside the UIDL — an export from the editor stamps the project id)`,
    }
  }
  const name = identity.projectName || uidl.name
  const exported = identity.exportedAt ? `, exported ${identity.exportedAt}` : ''
  return { tone: 'info', text: `Project: "${name}" (${identity.projectId}${exported})` }
}

const describeDatabase = (
  env: Record<string, string>,
  identity: FixtureIdentity | null
): StoreFixtureSummaryLine => {
  const connectionString = env.TELEPORT_DB_CONNECTION_STRING
  if (!connectionString) {
    return {
      tone: 'warning',
      text: 'Database: no TELEPORT_DB_CONNECTION_STRING in .env — every data read will fail',
    }
  }
  const databaseProjectId = projectIdFromConnectionString(connectionString)
  if (!databaseProjectId) {
    return {
      tone: 'info',
      text: 'Database: a custom connection string (not a per-project TeleportHQ database)',
    }
  }
  if (identity && identity.projectId.toLowerCase() !== databaseProjectId) {
    return {
      tone: 'warning',
      text:
        `Database: .env points at project ${databaseProjectId}'s database, NOT this project's — ` +
        "the store will read another project's products, orders and shipping zones. " +
        "Paste this project's connection string into .env, or use the editor's Teleport & run, which writes both.",
    }
  }
  return { tone: 'info', text: `Database: project ${databaseProjectId}` }
}

const describeDelivery = (uidl: ProjectUIDL): StoreFixtureSummaryLine => {
  const settings = uidl.ecommerceSettings
  if (!settings?.deliveryEnabled) {
    return { tone: 'info', text: 'Delivery: off (store pickup only)' }
  }
  const config = settings.deliveryConfig
  if (!config) {
    return {
      tone: 'warning',
      text: 'Delivery: NOT CONFIGURED — Delivery Settings were never saved in this project, so every order ships free',
    }
  }
  const threshold = config.freeDeliveryEnabled
    ? `free from ${formatMoney(config.freeDeliveryThreshold)}`
    : 'no free-delivery threshold'
  return { tone: 'info', text: `Delivery: fee ${formatMoney(config.deliveryPrice)}, ${threshold}` }
}

const describeRegionalPricing = (uidl: ProjectUIDL): StoreFixtureSummaryLine => {
  if (uidl.ecommerceSettings?.regionalPricing?.enabled) {
    return {
      tone: 'info',
      text: 'Shipping zones & tax regions: exported (zones, rates and tax rows are read from the database at runtime)',
    }
  }
  return {
    tone: 'warning',
    text:
      'Shipping zones & tax regions: NOT exported — the store prices from its Delivery Settings only. ' +
      'Turn on "Shipping & Tax Regions" in THIS project (and recreate a checkout built before them) before exporting',
  }
}

/**
 * The lines to print. A project without e-commerce says only where it came
 * from and which database it reads.
 */
export const describeStoreFixture = (
  input: StoreFixtureSummaryInput
): StoreFixtureSummaryLine[] => {
  const { uidl, identity, env } = input
  const lines = [describeProject(uidl, identity), describeDatabase(env, identity)]
  if (uidl.ecommerceSettings) {
    lines.push(describeDelivery(uidl), describeRegionalPricing(uidl))
  }
  return lines
}
