import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ProjectUIDL } from '@teleporthq/teleport-types'
import {
  describeStoreFixture,
  fixtureIdentityPath,
  projectIdFromConnectionString,
  readFixtureIdentity,
} from '../src/store-fixture-summary'

/**
 * The end-of-run summary that names what a generated store was built from.
 * What is pinned: the three inputs it reads (sidecar, `.env`, UIDL settings),
 * and that every state a merchant can be confused by — no fee saved, zones not
 * exported, a database belonging to another project — is a WARNING line, not
 * silence.
 */

const PROJECT_ID = 'e90fcac9-56cf-4438-9c57-82ace5793ee3'
const OTHER_PROJECT_ID = 'e3c308d9-baa1-48f1-9f1c-2e11d696f7c1'
const databaseUrl = (projectId: string) =>
  `postgresql://user:secret@ep-example.eu-central-1.aws.neon.tech/p_${projectId.replace(
    /-/g,
    '_'
  )}?sslmode=require`

const identity = {
  projectId: PROJECT_ID,
  projectName: 'Frail Extra Small Gnat',
  exportedAt: '2026-09-18T14:33:00.000Z',
}

const store = (ecommerceSettings: Record<string, unknown> | undefined): ProjectUIDL =>
  ({ name: 'Frail Extra Small Gnat', ecommerceSettings } as unknown as ProjectUIDL)

const texts = (lines: Array<{ tone: string; text: string }>, tone?: string) =>
  lines.filter((line) => !tone || line.tone === tone).map((line) => line.text)

describe('projectIdFromConnectionString', () => {
  it('reads the project id out of a per-project database name', () => {
    expect(projectIdFromConnectionString(databaseUrl(PROJECT_ID))).toBe(PROJECT_ID)
    expect(
      projectIdFromConnectionString(databaseUrl(PROJECT_ID).replace('?sslmode=require', ''))
    ).toBe(PROJECT_ID)
  })

  it('returns null for a custom database, an empty value or a malformed name', () => {
    expect(projectIdFromConnectionString('postgresql://u:p@host/shop')).toBeNull()
    expect(projectIdFromConnectionString('postgresql://u:p@host/p_not_a_uuid')).toBeNull()
    expect(projectIdFromConnectionString('')).toBeNull()
    expect(projectIdFromConnectionString(undefined)).toBeNull()
  })
})

describe('readFixtureIdentity', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fixture-identity-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads the sidecar the editor writes beside the UIDL', () => {
    const uidlPath = join(dir, 'project.json')
    expect(fixtureIdentityPath(uidlPath)).toBe(join(dir, 'project.meta.json'))
    writeFileSync(fixtureIdentityPath(uidlPath), JSON.stringify(identity), 'utf8')
    expect(readFixtureIdentity(uidlPath)).toEqual(identity)
  })

  it('is null without a sidecar, and for one that names no project', () => {
    const uidlPath = join(dir, 'project.json')
    expect(readFixtureIdentity(uidlPath)).toBeNull()
    writeFileSync(fixtureIdentityPath(uidlPath), '{"projectName":"x"}', 'utf8')
    expect(readFixtureIdentity(uidlPath)).toBeNull()
    writeFileSync(fixtureIdentityPath(uidlPath), 'not json', 'utf8')
    expect(readFixtureIdentity(uidlPath)).toBeNull()
  })
})

describe('describeStoreFixture', () => {
  const configured = store({
    deliveryEnabled: true,
    deliveryConfig: { deliveryPrice: 50, freeDeliveryEnabled: true, freeDeliveryThreshold: 50 },
    regionalPricing: { enabled: true },
  })

  it('names the project, its database, its delivery fee and its zones when everything is in place', () => {
    const lines = describeStoreFixture({
      uidl: configured,
      identity,
      env: { TELEPORT_DB_CONNECTION_STRING: databaseUrl(PROJECT_ID) },
    })
    expect(texts(lines, 'warning')).toEqual([])
    expect(texts(lines)).toEqual([
      `Project: "Frail Extra Small Gnat" (${PROJECT_ID}, exported 2026-09-18T14:33:00.000Z)`,
      `Database: project ${PROJECT_ID}`,
      'Delivery: fee 50.00, free from 50.00',
      'Shipping zones & tax regions: exported (zones, rates and tax rows are read from the database at runtime)',
    ])
  })

  it('warns when the fee was never saved and the zones were not exported — the "free shipping everywhere" store', () => {
    const lines = describeStoreFixture({
      uidl: store({ deliveryEnabled: true, deliveryConfig: null }),
      identity,
      env: { TELEPORT_DB_CONNECTION_STRING: databaseUrl(PROJECT_ID) },
    })
    expect(texts(lines, 'warning')).toEqual([
      'Delivery: NOT CONFIGURED — Delivery Settings were never saved in this project, so every order ships free',
      'Shipping zones & tax regions: NOT exported — the store prices from its Delivery Settings only. Turn on "Shipping & Tax Regions" in THIS project (and recreate a checkout built before them) before exporting',
    ])
  })

  it('warns when .env belongs to a different project than the UIDL', () => {
    const lines = describeStoreFixture({
      uidl: configured,
      identity,
      env: { TELEPORT_DB_CONNECTION_STRING: databaseUrl(OTHER_PROJECT_ID) },
    })
    const database = lines[1]
    expect(database.tone).toBe('warning')
    expect(database.text).toContain(`project ${OTHER_PROJECT_ID}'s database, NOT this project's`)
  })

  it('cannot judge the database without an export record, and says so', () => {
    const lines = describeStoreFixture({
      uidl: configured,
      identity: null,
      env: { TELEPORT_DB_CONNECTION_STRING: databaseUrl(OTHER_PROJECT_ID) },
    })
    expect(lines[0]).toEqual({
      tone: 'info',
      text: 'Project: "Frail Extra Small Gnat" (no export record beside the UIDL — an export from the editor stamps the project id)',
    })
    expect(lines[1]).toEqual({ tone: 'info', text: `Database: project ${OTHER_PROJECT_ID}` })
  })

  it('reads a missing connection string and a custom database differently', () => {
    expect(describeStoreFixture({ uidl: configured, identity, env: {} })[1]).toEqual({
      tone: 'warning',
      text: 'Database: no TELEPORT_DB_CONNECTION_STRING in .env — every data read will fail',
    })
    expect(
      describeStoreFixture({
        uidl: configured,
        identity,
        env: { TELEPORT_DB_CONNECTION_STRING: 'postgresql://u:p@host/shop' },
      })[1]
    ).toEqual({
      tone: 'info',
      text: 'Database: a custom connection string (not a per-project TeleportHQ database)',
    })
  })

  it('describes a pickup-only store and a fee without a threshold', () => {
    expect(
      texts(describeStoreFixture({ uidl: store({ deliveryEnabled: false }), identity, env: {} }))[2]
    ).toBe('Delivery: off (store pickup only)')
    expect(
      texts(
        describeStoreFixture({
          uidl: store({
            deliveryEnabled: true,
            deliveryConfig: {
              deliveryPrice: 12.5,
              freeDeliveryEnabled: false,
              freeDeliveryThreshold: 50,
            },
          }),
          identity,
          env: {},
        })
      )[2]
    ).toBe('Delivery: fee 12.50, no free-delivery threshold')
  })

  it('says only where a non-store project came from', () => {
    const lines = describeStoreFixture({ uidl: store(undefined), identity, env: {} })
    expect(lines).toHaveLength(2)
  })
})
