import { createHash, createHmac } from 'crypto'
import * as nodePath from 'path'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { PROTECTED_TABLES } from '@teleporthq/teleport-shared/src/utils/table-access'
import { generateDataSourceFetcherWithCore } from '../../teleport-plugin-next-data-source/src/data-source-fetchers'
import { FETCH_BACKED_NETWORK, FetchCall, withEnv, withFetch } from './_helpers/fake-fetch'
import { insertedLines } from './_helpers/inserted-lines'

/**
 * The in-app event bus (spec §5.2): a project with an automation (a workflow
 * started by `event-business-event`) gets the bus, the queue worker, one
 * handler module per automation and the dispatch route; a project without one
 * gets none of it, and nothing else in its output changes. The generated
 * modules are EXECUTED against an in-memory Postgres that answers the
 * statements they send, so the claim, the delivery ledger and the Wait are
 * proven by what lands in the tables.
 */

type Row = Record<string, unknown>

const DATA_API_ROUTE = 'pages/api/data/[...params].js'

interface GeneratedFile {
  name: string
  fileType?: string
  content: unknown
}

interface GeneratedEntry {
  path: string[]
  files: GeneratedFile[]
}

interface Structure {
  uidl: Row & { globals: { env: Record<string, string> } }
  files: Map<string, GeneratedEntry>
  dependencies: Record<string, string>
}

const NOW = Date.now()
const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS
const ECHO = 'https://echo.test'
const trigger = (eventType: string) => ({
  type: 'event-business-event',
  nodeId: 't',
  scope: 'global',
  config: { eventType },
})
const ref = (nodeId: string, path: string[]) => ({ type: 'workflowContext', nodeId, path })
const post = (id: string, path: string, stepNumber: number, body: Row = {}) => ({
  id,
  type: 'general-http-request',
  config: { url: ECHO + path, method: 'POST', body },
  stepNumber,
  label: 'Post ' + path,
})

const AUTOMATIONS: Record<string, Row> = {
  'wf-paid-ok': {
    id: 'wf-paid-ok',
    name: 'Thank the customer',
    trigger: trigger('order-paid'),
    nodes: [
      post('thanks', '/thanks', 1, {
        email: ref('t', ['order', 'customer', 'email']),
        number: ref('t', ['order', 'number']),
        test: ref('t', ['event', 'test']),
        // Recorded by the writer, read by no hydrator: kept.
        giftMessage: ref('t', ['order', 'giftMessage']),
        // Not a block of order-paid: a test that sends it never passes it on.
        extra: ref('t', ['extra']),
      }),
    ],
    edges: [{ id: 'e1', source: 't', target: 'thanks' }],
  },
  'wf-paid-fail': {
    id: 'wf-paid-fail',
    name: 'Tell the warehouse',
    trigger: trigger('order-paid'),
    nodes: [
      post('warehouse', '/fails', 1, {
        actor: ref('t', ['actor', 'email']),
        email: ref('t', ['order', 'customer', 'email']),
      }),
    ],
    edges: [{ id: 'e1', source: 't', target: 'warehouse' }],
  },
  'wf-paid-off': {
    id: 'wf-paid-off',
    name: 'Switched off',
    trigger: trigger('order-paid'),
    nodes: [post('off', '/off', 1)],
    edges: [{ id: 'e1', source: 't', target: 'off' }],
  },
  'wf-signup-wait': {
    id: 'wf-signup-wait',
    name: 'Welcome two days later',
    trigger: trigger('user-signed-up'),
    nodes: [
      post('before', '/before', 1, { email: ref('t', ['user', 'email']) }),
      {
        id: 'wait',
        type: 'general-wait',
        config: { amount: 2, unit: 'days' },
        stepNumber: 2,
        label: 'Wait 2 days',
      },
      post('after', '/after', 3, {
        email: ref('t', ['user', 'email']),
        waitedUntil: ref('wait', ['until']),
      }),
    ],
    edges: [
      { id: 'e1', source: 't', target: 'before' },
      { id: 'e2', source: 'before', target: 'wait' },
      { id: 'e3', source: 'wait', target: 'after' },
    ],
  },
  'wf-booking-slow': {
    id: 'wf-booking-slow',
    name: 'Slow booking notice',
    trigger: trigger('booking-created'),
    nodes: [post('hold', '/hold', 1)],
    edges: [{ id: 'e1', source: 't', target: 'hold' }],
  },
}

// The rest of the project: a page workflow with a server data read and a link
// to the order details page, a global browser workflow (so
// `global-workflows.js` exists) and a webhook.
const BASE_WORKFLOWS: Record<string, Row> = {
  'wf-page': {
    id: 'wf-page',
    name: 'Load orders',
    trigger: { type: 'event-page-loaded', nodeId: 't', scope: 'page', config: { allPages: true } },
    nodes: [
      {
        id: 'select',
        type: 'data-select',
        config: { dataSourceId: 'ds-1', tableName: 'teleport_orders', filters: [] },
        stepNumber: 1,
        label: 'Orders',
      },
      { id: 'set', type: 'state-update-local-state', config: {}, stepNumber: 2, label: 'Set' },
      {
        id: 'open',
        type: 'navigation-go-to-page',
        config: {
          pageId: '/orders/[order_number]',
          targetPage: {
            isDetailsPage: true,
            rowOwnerTable: 'teleport_orders',
            staticUrl: '/orders',
          },
        },
        stepNumber: 3,
        label: 'Open the order',
      },
    ],
    edges: [
      { id: 'e1', source: 't', target: 'select' },
      { id: 'e2', source: 'select', target: 'set' },
      { id: 'e3', source: 'set', target: 'open' },
    ],
  },
  'wf-logout': {
    id: 'wf-logout',
    name: 'Forget the cart',
    trigger: { type: 'event-user-logged-out', nodeId: 't', scope: 'global', config: {} },
    nodes: [
      {
        id: 'forget',
        type: 'storage-local-remove',
        config: { key: 'cart' },
        stepNumber: 1,
        label: 'Forget',
      },
    ],
    edges: [{ id: 'e1', source: 't', target: 'forget' }],
  },
  'wf-hook': {
    id: 'wf-hook',
    name: 'Orders hook',
    trigger: { type: 'event-webhook-received', nodeId: 't', scope: 'global', config: {} },
    nodes: [post('relay', '/relay', 1)],
    edges: [{ id: 'e1', source: 't', target: 'relay' }],
    webhookConfig: { httpMethod: 'POST', urlPath: 'webhooks/orders' },
  },
}

// The data source the editor keeps the automation tables in (the GUI mapper's
// `automations`): the bus opens that database.
const TELEPORT_AUTOMATIONS = { dataSourceId: 'ds-1', dataSourceType: 'teleport' }

// The data-source modules the page plugins write before this plugin runs: a
// page's server read of the TeleportHQ database, an API route reading it, an
// API route that only re-exports a module, and another database's module.
const TELEPORT_SOURCE = { id: 'ds-1', type: 'teleport', name: 'Store', config: {} }
const OWN_POSTGRES = {
  id: 'ds-2',
  type: 'postgresql',
  name: 'Own',
  config: { connectionString: 'postgresql://u:p@db.test:5432/d' },
}
const TELEPORT_PRODUCTS_MODULE = 'utils/data-sources/teleport-products-ds-1.js'
const TELEPORT_ORDERS_ROUTE = 'pages/api/teleport-orders-ds-1.js'
const REEXPORT_ROUTE = 'pages/api/teleport-products-ds-1.js'
const OWN_ITEMS_MODULE = 'utils/data-sources/postgresql-items-ds-2.js'
const FETCHERS = (): Map<string, GeneratedEntry> => {
  const entry = (path: string, content: string): [string, GeneratedEntry] => {
    const parts = path.replace(/\.js$/, '').split('/')
    const name = parts.pop() as string
    return ['resource-' + path, { path: parts, files: [{ name, fileType: 'js', content }] }]
  }
  return new Map([
    entry(
      TELEPORT_PRODUCTS_MODULE,
      generateDataSourceFetcherWithCore(TELEPORT_SOURCE as never, 'teleport_products', false)
    ),
    entry(
      TELEPORT_ORDERS_ROUTE,
      generateDataSourceFetcherWithCore(TELEPORT_SOURCE as never, 'teleport_orders', true)
    ),
    entry(
      REEXPORT_ROUTE,
      "import dataSourceModule from '../../utils/data-sources/teleport-products-ds-1'\n\nexport default dataSourceModule.handler\n"
    ),
    entry(
      OWN_ITEMS_MODULE,
      generateDataSourceFetcherWithCore(OWN_POSTGRES as never, 'items', false)
    ),
  ])
}
const TELEPORT_READS = [TELEPORT_PRODUCTS_MODULE, TELEPORT_ORDERS_ROUTE]

const generate = async (
  workflows: Record<string, Row>,
  automations: Row | null = TELEPORT_AUTOMATIONS,
  // What the other generators wrote before this plugin runs, and more of the UIDL.
  extra: { files?: () => Map<string, GeneratedEntry>; uidl?: Row } = {}
): Promise<Structure> => {
  const structure = {
    uidl: {
      name: 'Store',
      globals: { settings: { title: 'Store', language: 'en' }, env: { NEXTAUTH_SECRET: 'k' } },
      root: {
        name: 'Root',
        stateDefinitions: {
          route: { type: 'string', defaultValue: 'Home', values: [{ value: 'Home' }] },
        },
        node: { type: 'element', content: { elementType: 'container', children: [] } },
      },
      components: {},
      dataSources: { 'ds-1': { id: 'ds-1', type: 'teleport', name: 'Store', config: {} } },
      ...(automations && { automations }),
      workflows: { workflows: JSON.parse(JSON.stringify(workflows)) },
      ...extra.uidl,
    },
    strategy: { pages: { options: {} } },
    files: extra.files ? extra.files() : new Map<string, GeneratedEntry>(),
    dependencies: {} as Record<string, string>,
    devDependencies: {},
  }
  await new NextWorkflowProjectPlugin().runAfter(structure as never)
  return structure as unknown as Structure
}

const filePath = (entry: GeneratedEntry, file: GeneratedFile): string =>
  [...entry.path, `${file.name}.${file.fileType || 'js'}`].join('/')

const sources = (structure: Structure): Map<string, string> => {
  const files = new Map<string, string>()
  for (const entry of structure.files.values()) {
    for (const file of entry.files) {
      files.set(filePath(entry, file), String(file.content))
    }
  }
  return files
}

// ---------------------------------------------------------------------------
// An in-memory Postgres for the statements the bus sends
// ---------------------------------------------------------------------------

interface EventRow {
  id: string
  event_type: string
  dedupe_key: string
  order_id: string | null
  entity_type: string | null
  entity_id: string | null
  payload: string | null
  actor: string | null
  actor_type: string
  status: string
  attempts: number
  claimed_at?: Date | null
  created_at: Date
  /** Held by another dispatcher's open claim: SKIP LOCKED passes it over. */
  locked?: boolean
}

interface AutomationRow {
  workflow_id: string
  event_type: string
  enabled: boolean
  enabled_at: Date | null
  created_at: Date
}

interface DeliveryRow {
  id: number
  event_id: string
  workflow_id: string
  status: string
  error: string | null
  attempts: number
  started_at: Date | null
  finished_at: Date | null
}

interface WaitRow {
  id: number
  event_id: string
  workflow_id: string
  resume_node_id: string
  context: string | null
  run_at: Date
  status: string
  created_at: Date
}

const STALE_MS = 15 * MINUTE_MS

class FakeDatabase {
  events: EventRow[] = []
  automations: AutomationRow[] = []
  deliveries: DeliveryRow[] = []
  waits: WaitRow[] = []
  orders: Row[] = []
  orderItems: Row[] = []
  users: Row[] = []
  bookings: Row[] = []
  sentEmails: Row[] = []
  mailSent: Row[] = []
  reviews: Row[] = []
  waitlistEntries: Row[] = []
  waitlists: Row[] = []
  statements: string[] = []
  /** What every database client was opened with. */
  clientOptions: Row[] = []
  /** Answers a read of teleport_orders with this error instead. */
  ordersError: (Error & { code?: string }) | null = null
  products: Row[] = []
  /** Runs right after a claim is answered (an owner switching automations off meanwhile). */
  afterClaim: (() => void) | null = null
  /** The signed requests the dispatch route took: key -> expires_at (unix seconds). */
  signedRequests = new Map<string, number>()
  /** Fails every statement on the signed-request table. */
  signedRequestsDown = false
  /** The editor did not make the signed-request table. */
  signedRequestsMissing = false
  /** As the site's role connects: it may read and write tables, and create none, whether or not one exists. */
  mayCreateTables = false
  private serial = 0

  query(sql: string, values: unknown[] = []): { rows: Row[]; rowCount?: number } {
    const text = sql.trim()
    this.statements.push(text)
    const event = (id: unknown) => this.events.find((candidate) => candidate.id === id)
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return { rows: [] }
    }
    if (text.includes('teleport_automation_requests') || text.includes('pg_advisory_xact_lock')) {
      if (this.signedRequestsDown) {
        throw new Error('connection terminated')
      }
      if (text === 'SELECT pg_advisory_xact_lock(hashtext($1))') {
        return { rows: [] }
      }
      if (
        text ===
          'CREATE TABLE IF NOT EXISTS teleport_automation_requests (request_key TEXT PRIMARY KEY, expires_at BIGINT NOT NULL)' ||
        text ===
          'CREATE INDEX IF NOT EXISTS teleport_automation_requests_expires_at ON teleport_automation_requests (expires_at)'
      ) {
        if (!this.mayCreateTables) {
          throw Object.assign(new Error('permission denied for schema public'), { code: '42501' })
        }
        this.signedRequestsMissing = false
        return { rows: [] }
      }
      if (this.signedRequestsMissing) {
        throw Object.assign(new Error('relation "teleport_automation_requests" does not exist'), {
          code: '42P01',
        })
      }
      if (
        text ===
        'DELETE FROM teleport_automation_requests WHERE request_key IN (SELECT request_key FROM teleport_automation_requests WHERE expires_at < $1 LIMIT 1000)'
      ) {
        this.signedRequests.forEach((expiresAt, key) => {
          if (expiresAt < Number(values[0])) {
            this.signedRequests.delete(key)
          }
        })
        return { rows: [] }
      }
      if (
        text ===
        'INSERT INTO teleport_automation_requests (request_key, expires_at) VALUES ($1, $2) ON CONFLICT (request_key) DO NOTHING RETURNING request_key'
      ) {
        const [key, expiresAt] = values as [string, number]
        if (this.signedRequests.has(key)) {
          return { rows: [] }
        }
        this.signedRequests.set(key, expiresAt)
        return { rows: [{ request_key: key }] }
      }
    }
    if (text.startsWith('INSERT INTO teleport_events (event_type, dedupe_key, order_id')) {
      const [type, dedupeKey, orderId, entityType, entityId, payload, actor, actorType] = values
      if (this.events.some((candidate) => candidate.dedupe_key === dedupeKey)) {
        return { rows: [] }
      }
      const id = this.newEvent({
        event_type: String(type),
        dedupe_key: String(dedupeKey),
        order_id: (orderId as string) || null,
        entity_type: (entityType as string) || null,
        entity_id: (entityId as string) || null,
        payload: (payload as string) || null,
        actor: (actor as string) || null,
        actor_type: String(actorType || 'system'),
      })
      return { rows: [{ id }] }
    }
    if (text.startsWith('INSERT INTO teleport_events (event_type, dedupe_key, payload')) {
      const [type, dedupeKey, payload, actor, actorType] = values
      const id = this.newEvent({
        event_type: String(type),
        dedupe_key: String(dedupeKey),
        payload: (payload as string) || null,
        actor: (actor as string) || null,
        actor_type: String(actorType || 'system'),
        status: 'test',
      })
      return { rows: [{ id, created_at: event(id)!.created_at }] }
    }
    if (text.includes('FROM teleport_events e') && text.includes('FOR UPDATE SKIP LOCKED')) {
      const [types, workflowIds] = values as string[][]
      const now = Date.now()
      // Answered as the statement asks: the clauses below are read off its text.
      const staleCountsDeliveries = text.includes(
        'GREATEST(COALESCE(e.claimed_at, e.created_at), COALESCE((SELECT max(d.started_at)'
      )
      const settlesExhausted = text.includes("OR (e.status = 'pending' AND e.attempts >= 5")
      const sparesWaiting = text.includes("d.status = 'waiting'")
      // Only a run parked by an automation of this build that is on holds the event.
      const sparesOnlyLiveWaits = text.includes(
        "d.status = 'waiting' AND d.workflow_id = ANY($2::text[]) AND EXISTS (SELECT 1 FROM teleport_automations a WHERE a.workflow_id = d.workflow_id AND a.enabled)"
      )
      const holdsEvent = (d: DeliveryRow) =>
        !sparesOnlyLiveWaits ||
        (workflowIds.includes(d.workflow_id) &&
          this.automations.some((a) => a.workflow_id === d.workflow_id && a.enabled))
      // Untouched for the stale window: its claim, and (as the claim asks) the
      // latest start of one of its deliveries.
      const stale = (candidate: EventRow) =>
        !(
          sparesWaiting &&
          this.deliveries.some(
            (d) => d.event_id === candidate.id && d.status === 'waiting' && holdsEvent(d)
          )
        ) &&
        Math.max(
          (candidate.claimed_at || candidate.created_at).getTime(),
          ...(staleCountsDeliveries
            ? this.deliveries
                .filter((d) => d.event_id === candidate.id && d.started_at)
                .map((d) => d.started_at!.getTime())
            : [])
        ) <
          now - STALE_MS
      const due = this.events.filter(
        (candidate) =>
          !candidate.locked &&
          types.includes(candidate.event_type) &&
          ((candidate.attempts < 5 &&
            ((candidate.status === 'recorded' &&
              candidate.created_at.getTime() > now - 3 * DAY_MS) ||
              candidate.status === 'failed' ||
              (candidate.status === 'pending' && stale(candidate))) &&
            this.enabledFor(candidate, workflowIds).length > 0) ||
            (settlesExhausted &&
              candidate.status === 'pending' &&
              candidate.attempts >= 5 &&
              stale(candidate)))
      )
      due.sort(
        (a, b) =>
          Number(a.status !== 'recorded') - Number(b.status !== 'recorded') ||
          a.created_at.getTime() - b.created_at.getTime()
      )
      const claimed = due.slice(0, 20).map((candidate) => ({ ...candidate }))
      if (this.afterClaim) {
        this.afterClaim()
      }
      return { rows: claimed }
    }
    // The claim's later writes hold only while it is still the claim.
    const holdsClaim = (target: EventRow | undefined, claimedAt: unknown): target is EventRow =>
      !!target &&
      target.status === 'pending' &&
      !!target.claimed_at &&
      claimedAt instanceof Date &&
      target.claimed_at.getTime() === claimedAt.getTime()
    if (text.startsWith("UPDATE teleport_events SET status = 'pending', claimed_at = date_trunc")) {
      const marked: Row[] = []
      for (const candidate of this.events) {
        if ((values[0] as string[]).includes(candidate.id)) {
          candidate.status = 'pending'
          candidate.claimed_at = new Date()
          // An attempt counted by the claim itself (it must not be: see the time budget).
          if (text.includes('attempts = attempts + 1')) {
            candidate.attempts += 1
          }
          marked.push({ id: candidate.id, claimed_at: candidate.claimed_at })
        }
      }
      return { rows: marked }
    }
    if (text.startsWith('UPDATE teleport_events SET attempts = attempts + 1')) {
      const target = event(values[0])
      if (holdsClaim(target, values[1])) {
        target.attempts += 1
      }
      return { rows: [] }
    }
    if (text.startsWith("UPDATE teleport_events SET status = 'failed', attempts = attempts + 1")) {
      const target = event(values[0])
      if (holdsClaim(target, values[1])) {
        target.status = 'failed'
        target.attempts += 1
      }
      return { rows: [] }
    }
    if (text.startsWith('UPDATE teleport_events SET status = $2')) {
      const target = event(values[0])
      // Guarded by the claim when the statement names it.
      const guarded = text.includes("AND status = 'pending' AND claimed_at = $3")
      if (target && (guarded ? holdsClaim(target, values[2]) : true)) {
        target.status = String(values[1])
      }
      return { rows: [] }
    }

    if (text.includes('FROM teleport_automations a JOIN teleport_events e')) {
      const target = event(values[0])
      return {
        rows: target
          ? this.enabledFor(target, values[1] as string[]).map((a) => ({
              workflow_id: a.workflow_id,
            }))
          : [],
      }
    }
    if (
      text.startsWith('INSERT INTO teleport_event_deliveries AS d') &&
      text.includes("VALUES ($1, $2, 'failed', 0, $3")
    ) {
      // A refusal: the automation never ran; its delivery says why.
      const [eventId, workflowId, error] = values as string[]
      const existing = this.deliveries.find(
        (d) => d.event_id === eventId && d.workflow_id === workflowId
      )
      if (!existing) {
        this.deliveries.push({
          id: ++this.serial,
          event_id: eventId,
          workflow_id: workflowId,
          status: 'failed',
          error,
          attempts: 0,
          started_at: new Date(),
          finished_at: new Date(),
        })
      } else if (existing.status === 'failed') {
        existing.error = error
      }
      return { rows: [] }
    }
    if (text.startsWith('INSERT INTO teleport_event_deliveries AS d')) {
      const [eventId, workflowId] = values as string[]
      const existing = this.deliveries.find(
        (d) => d.event_id === eventId && d.workflow_id === workflowId
      )
      if (!existing) {
        return { rows: [this.newDelivery(eventId, workflowId)] }
      }
      const stale =
        existing.status === 'running' &&
        !!existing.started_at &&
        existing.started_at.getTime() < Date.now() - STALE_MS
      if (existing.status !== 'failed' && !stale) {
        return { rows: [] }
      }
      existing.status = 'running'
      existing.attempts += 1
      existing.error = null
      existing.started_at = new Date()
      existing.finished_at = null
      return { rows: [{ id: existing.id, attempts: existing.attempts }] }
    }
    if (text.startsWith('INSERT INTO teleport_event_deliveries (event_id')) {
      const [eventId, workflowId] = values as string[]
      return { rows: [this.newDelivery(eventId, workflowId)] }
    }
    if (text.startsWith('WITH w AS (UPDATE teleport_automation_waits SET status = $1')) {
      // A resume's outcome, as one statement: the Wait under its claim token,
      // and its delivery only when that matched.
      const [waitStatus, waitId, runAt, status, error, startedAt, eventId, workflowId] = values
      const wait = this.waits.find((w) => w.id === waitId)
      const held =
        !!wait && wait.status === 'resuming' && wait.run_at.getTime() === (runAt as Date).getTime()
      if (!held) {
        return { rows: [], rowCount: 0 }
      }
      wait!.status = String(waitStatus)
      let rowCount = 0
      for (const d of this.deliveries) {
        if (d.event_id === eventId && d.workflow_id === workflowId && d.status === 'waiting') {
          d.status = String(status)
          d.error = (error as string) || null
          d.started_at = startedAt as Date
          d.finished_at = new Date()
          rowCount += 1
        }
      }
      return { rows: [], rowCount }
    }
    if (text.startsWith('INSERT INTO "teleport_sent_emails"')) {
      const columns = (text.match(/\(([^)]*)\) VALUES/) || ['', ''])[1]
        .split(',')
        .map((column) => column.trim().replace(/"/g, ''))
      this.sentEmails.push(Object.fromEntries(columns.map((column, i) => [column, values[i]])))
      return { rows: [] }
    }
    if (
      text.startsWith("UPDATE teleport_event_deliveries SET status = 'failed', error = 'Timed out'")
    ) {
      for (const d of this.deliveries) {
        if (
          d.event_id === values[0] &&
          d.status === 'running' &&
          d.started_at!.getTime() < Date.now() - STALE_MS
        ) {
          d.status = 'failed'
          d.error = 'Timed out'
          d.finished_at = new Date()
        }
      }
      return { rows: [] }
    }
    if (text.startsWith('UPDATE teleport_event_deliveries')) {
      const delivery = this.deliveries.find((d) => d.id === values[0])
      // Only while the same claim (its attempt number) holds the row.
      const guarded = text.includes("AND status = 'running' AND attempts = $4")
      if (delivery && guarded && delivery.status === 'running' && delivery.attempts === values[3]) {
        delivery.status = String(values[1])
        delivery.error = (values[2] as string) || null
        delivery.finished_at = new Date()
        return { rows: [], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }
    if (text.startsWith('SELECT workflow_id, status FROM teleport_event_deliveries')) {
      return {
        rows: this.deliveries
          .filter((d) => d.event_id === values[0])
          .map((d) => ({ workflow_id: d.workflow_id, status: d.status })),
      }
    }
    if (text.startsWith('INSERT INTO teleport_automation_waits')) {
      const [eventId, workflowId, resumeNodeId, context, runAt] = values
      this.waits.push({
        id: ++this.serial,
        event_id: String(eventId),
        workflow_id: String(workflowId),
        resume_node_id: String(resumeNodeId),
        context: (context as string) || null,
        run_at: new Date(String(runAt)),
        status: 'waiting',
        created_at: new Date(),
      })
      return { rows: [] }
    }
    if (text.includes('FROM teleport_automation_waits w') && text.includes('SKIP LOCKED')) {
      const workflowIds = values[0] as string[]
      const now = Date.now()
      return {
        rows: this.waits
          .filter(
            (w) =>
              workflowIds.includes(w.workflow_id) &&
              ((w.status === 'waiting' && w.run_at.getTime() <= now) ||
                (w.status === 'resuming' && w.run_at.getTime() < now - STALE_MS)) &&
              this.automations.some((a) => a.workflow_id === w.workflow_id && a.enabled)
          )
          .map((w) => ({ ...w })),
      }
    }
    if (text.startsWith("UPDATE teleport_automation_waits SET status = 'resuming'")) {
      const marked: Row[] = []
      for (const wait of this.waits) {
        if ((values[0] as number[]).includes(wait.id)) {
          wait.status = 'resuming'
          wait.run_at = new Date()
          marked.push({ id: wait.id, run_at: wait.run_at })
        }
      }
      return { rows: marked }
    }
    if (
      text.includes(
        "FROM teleport_automation_waits WHERE event_id = $1 AND workflow_id = $2 AND status = 'failed' ORDER BY id DESC LIMIT 1"
      )
    ) {
      const failed = this.waits
        .filter(
          (w) => w.event_id === values[0] && w.workflow_id === values[1] && w.status === 'failed'
        )
        .sort((a, b) => b.id - a.id)
      return { rows: failed.slice(0, 1).map((w) => ({ ...w })) }
    }
    if (
      text.startsWith(
        "UPDATE teleport_automation_waits SET status = 'done' WHERE id = $1 AND status = 'failed'"
      )
    ) {
      const wait = this.waits.find((w) => w.id === values[0])
      if (wait && wait.status === 'failed') {
        wait.status = 'done'
      }
      return { rows: [] }
    }
    if (text.startsWith('SELECT (EXISTS (SELECT 1 FROM teleport_automation_waits w')) {
      // The activity kick's due check, read the way the dispatcher's claims are.
      const [workflowIds, types] = values as string[][]
      const now = Date.now()
      const on = (workflowId: string) =>
        workflowIds.includes(workflowId) &&
        this.automations.some((a) => a.workflow_id === workflowId && a.enabled)
      const dueWait = this.waits.some(
        (w) =>
          on(w.workflow_id) &&
          ((w.status === 'waiting' && w.run_at.getTime() <= now) ||
            (w.status === 'resuming' && w.run_at.getTime() < now - STALE_MS))
      )
      const dueRetry = this.events.some(
        (e) =>
          types.includes(e.event_type) &&
          ((e.attempts < 5 &&
            (e.status === 'failed' || this.stalePending(e, workflowIds)) &&
            this.enabledFor(e, workflowIds).length > 0) ||
            (e.attempts >= 5 && this.stalePending(e, workflowIds)))
      )
      return { rows: [{ due: dueWait || dueRetry }] }
    }
    if (text.includes('FROM teleport_products WHERE id = $1')) {
      return { rows: this.products.filter((product) => product.id === values[0]) }
    }
    if (text.startsWith("UPDATE teleport_automation_waits SET status = 'waiting'")) {
      const wait = this.waits.find((w) => w.id === values[0])
      // Guarded by the claim's run_at token when the statement names it.
      const guarded = text.includes("AND status = 'resuming' AND run_at = $2")
      if (
        wait &&
        wait.status === 'resuming' &&
        (!guarded || wait.run_at.getTime() === (values[1] as Date).getTime())
      ) {
        wait.status = 'waiting'
      }
      return { rows: [] }
    }
    if (text.includes('FROM teleport_events e WHERE e.id = $1')) {
      return {
        rows: this.events
          .filter((candidate) => candidate.id === values[0])
          .map((candidate) => ({ ...candidate })),
      }
    }
    if (text.includes('FROM teleport_orders WHERE id = $1')) {
      if (this.ordersError) {
        throw this.ordersError
      }
      return { rows: this.orders.filter((order) => order.id === values[0]) }
    }
    if (text.includes('FROM teleport_order_items WHERE order_id = $1')) {
      return { rows: this.orderItems.filter((item) => item.order_id === values[0]) }
    }
    if (text.includes('FROM "users" WHERE LOWER(email) = LOWER($1)')) {
      return {
        rows: this.users.filter(
          (user) => String(user.email).toLowerCase() === String(values[0]).toLowerCase()
        ),
      }
    }
    if (text.includes('FROM teleport_product_reviews WHERE id = $1')) {
      return { rows: this.reviews.filter((review) => review.id === values[0]) }
    }
    if (text.includes('FROM teleport_waitlist_entries WHERE id = $1')) {
      return { rows: this.waitlistEntries.filter((entry) => entry.id === values[0]) }
    }
    if (text.includes('FROM teleport_waitlists WHERE id = $1')) {
      return { rows: this.waitlists.filter((list) => list.id === values[0]) }
    }
    if (text.includes('FROM "users" WHERE id = $1')) {
      return { rows: this.users.filter((user) => user.id === values[0]) }
    }
    if (text.includes('FROM teleport_bookings WHERE id = $1')) {
      return { rows: this.bookings.filter((booking) => booking.id === values[0]) }
    }
    throw new Error('Unexpected statement: ' + text)
  }

  claimStatement(): string {
    const claim = this.statements.find(
      (text) => text.includes('FROM teleport_events e') && text.includes('SKIP LOCKED')
    )
    if (!claim) {
      throw new Error('No claim was sent')
    }
    return claim
  }

  delivery(workflowId: string): DeliveryRow | undefined {
    return this.deliveries.find((d) => d.workflow_id === workflowId)
  }

  /** A pending event nothing touched for the stale window, as the dispatcher reads it. */
  private stalePending(event: EventRow, workflowIds: string[]): boolean {
    const heldByLiveWait = this.deliveries.some(
      (d) =>
        d.event_id === event.id &&
        d.status === 'waiting' &&
        workflowIds.includes(d.workflow_id) &&
        this.automations.some((a) => a.workflow_id === d.workflow_id && a.enabled)
    )
    const touched = Math.max(
      (event.claimed_at || event.created_at).getTime(),
      ...this.deliveries
        .filter((d) => d.event_id === event.id && d.started_at)
        .map((d) => d.started_at!.getTime())
    )
    return event.status === 'pending' && !heldByLiveWait && touched < Date.now() - STALE_MS
  }

  private enabledFor(event: EventRow, workflowIds: string[]): AutomationRow[] {
    return this.automations.filter(
      (a) =>
        a.event_type === event.event_type &&
        workflowIds.includes(a.workflow_id) &&
        a.enabled &&
        (a.enabled_at || a.created_at).getTime() <= event.created_at.getTime()
    )
  }

  private newEvent(values: Partial<EventRow>): string {
    const id = `00000000-0000-4000-8000-${String(++this.serial).padStart(12, '0')}`
    this.events.push({
      id,
      event_type: '',
      dedupe_key: '',
      order_id: null,
      entity_type: null,
      entity_id: null,
      payload: null,
      actor: null,
      actor_type: 'system',
      status: 'recorded',
      attempts: 0,
      created_at: new Date(),
      ...values,
    })
    return id
  }

  private newDelivery(eventId: string, workflowId: string): Row {
    const id = ++this.serial
    this.deliveries.push({
      id,
      event_id: eventId,
      workflow_id: workflowId,
      status: 'running',
      error: null,
      attempts: 1,
      started_at: new Date(),
      finished_at: null,
    })
    return { id, attempts: 1 }
  }
}

// ---------------------------------------------------------------------------
// Running the generated modules
// ---------------------------------------------------------------------------

const resolveRelative = (fromDir: string, id: string): string => {
  const joined = nodePath.posix.normalize(nodePath.posix.join(fromDir, id))
  return joined.endsWith('.js') ? joined : `${joined}.js`
}

/** A CommonJS loader over the generated files, with `pg` answered by `db`. */
const createApp = (files: Map<string, string>, db: FakeDatabase) => {
  const cache = new Map<string, { exports: unknown }>()
  class Client {
    constructor(options: Row) {
      db.clientOptions.push(options)
    }
    async connect(): Promise<void> {
      return undefined
    }
    async query(sql: string, values?: unknown[]) {
      return db.query(sql, values)
    }
    async end(): Promise<void> {
      return undefined
    }
  }
  const load = (path: string): unknown => {
    const cached = cache.get(path)
    if (cached) {
      return cached.exports
    }
    const source = files.get(path)
    if (source === undefined) {
      throw new Error(`Cannot find module '${path}'`)
    }
    const module = { exports: {} as unknown }
    cache.set(path, module)
    const dir = nodePath.posix.dirname(path)
    const localRequire = (id: string): unknown => {
      if (id === 'pg') {
        return { Client }
      }
      // The mail provider's SDK: every send succeeds, and is kept.
      if (id === 'resend') {
        return {
          Resend: class {
            emails = {
              send: async (payload: Row) => {
                db.mailSent.push(payload)
                return { data: { id: 'msg-' + db.mailSent.length } }
              },
            }
          },
        }
      }
      if (id === '@vercel/functions' || id === 'node-fetch') {
        throw new Error(`Cannot find module '${id}'`)
      }
      if (id.startsWith('.')) {
        return load(resolveRelative(dir, id))
      }
      if (id in FETCH_BACKED_NETWORK) {
        return FETCH_BACKED_NETWORK[id]
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(id)
    }
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', source)(module, module.exports, localRequire)
    return module.exports
  }
  return load
}

interface Totals {
  claimed: number
  delivered: number
  failed: number
  resumed: number
  wouldWait?: Row
}

interface Bus {
  emitBusinessEvent(input: Row, req?: Row): Promise<{ recorded: boolean; id: string | null }>
  scheduleDispatch(req?: Row): string
  dispatch(options?: Row): Promise<Totals>
}

type RouteHandler = (req: unknown, res: unknown) => Promise<void>

const ENV = {
  TELEPORT_DB_CONNECTION_STRING: 'postgresql://u:p@localhost:5432/db',
  NEXTAUTH_SECRET: 'app-secret',
  NEXTAUTH_URL: 'https://shop.test',
  VERCEL: undefined,
  TELEPORT_CRON_ALLOW_UNSIGNED: undefined,
  TELEPORT_CRON_SECRET: undefined,
}

const silenced = async <T>(run: () => Promise<T>): Promise<T> => {
  const sink = console as unknown as { warn: typeof console.warn; error: typeof console.warn }
  const saved = { warn: sink.warn, error: sink.error }
  sink.warn = () => undefined
  sink.error = () => undefined
  try {
    return await run()
  } finally {
    sink.warn = saved.warn
    sink.error = saved.error
  }
}

/** Runs `run` with every fetch answered: echo.test/fails is down, the rest answer 200. */
const withEcho = <T>(run: (calls: FetchCall[]) => Promise<T>, env: Row = {}) =>
  withEnv({ ...ENV, ...env } as Record<string, string | undefined>, () =>
    withFetch((call) => {
      if (call.url === ECHO + '/fails') {
        throw new Error('network down')
      }
      return { status: 200, body: { ok: true } }
    }, run)
  )

const ago = (ms: number) => new Date(Date.now() - ms)

const automationRow = (workflowId: string, eventType: string, enabled = true): AutomationRow => ({
  workflow_id: workflowId,
  event_type: eventType,
  enabled,
  enabled_at: ago(DAY_MS),
  created_at: ago(DAY_MS),
})

const eventRow = (values: Partial<EventRow> & { id: string; event_type: string }): EventRow => ({
  dedupe_key: values.id,
  order_id: null,
  entity_type: null,
  entity_id: null,
  payload: null,
  actor: null,
  actor_type: 'system',
  status: 'recorded',
  attempts: 0,
  created_at: ago(1000),
  ...values,
})

const seedOrderPaid = (db: FakeDatabase): EventRow => {
  db.automations.push(
    automationRow('wf-paid-ok', 'order-paid'),
    automationRow('wf-paid-fail', 'order-paid'),
    automationRow('wf-paid-off', 'order-paid', false)
  )
  db.orders.push({
    id: 'ord-1',
    order_number: 'ORD-1042',
    status: 'paid',
    payment_status: 'paid',
    total_amount: '53.20',
    tax_amount: '8',
    shipping_amount: '10',
    discount_amount: '4.8',
    currency: 'USD',
    billing_email: 'ava@example.com',
    billing_name: 'Ava Thompson',
    fulfillment_method: 'delivery',
    payment_method: 'online',
    payment_provider: 'stripe',
    created_at: ago(MINUTE_MS),
  })
  db.orderItems.push({
    id: 'item-1',
    order_id: 'ord-1',
    product_id: 'p-1',
    product_name: 'Linen Throw Pillow',
    quantity: 2,
    unit_price: '20',
    total_price: '40',
    unit_price_paid: '18',
    total_price_paid: '36',
  })
  const event = eventRow({
    id: 'evt-paid',
    event_type: 'order-paid',
    dedupe_key: 'order-paid:ord-1',
    order_id: 'ord-1',
    entity_type: 'order',
    entity_id: 'ord-1',
    payload: JSON.stringify({ amount: 53.2, provider: 'stripe', discountDetails: [] }),
    actor: 'stripe',
  })
  db.events.push(event)
  return event
}

const seedSignup = (db: FakeDatabase): EventRow => {
  db.automations.push(automationRow('wf-signup-wait', 'user-signed-up'))
  db.users.push({
    id: 'user-1',
    email: 'noah@example.com',
    name: 'Noah',
    role: 'user',
    password: 'hash',
    created_at: ago(1000),
  })
  const event = eventRow({
    id: 'evt-signup',
    event_type: 'user-signed-up',
    entity_type: 'user',
    entity_id: 'user-1',
    actor: 'noah@example.com',
    actor_type: 'customer',
  })
  db.events.push(event)
  return event
}

// The auth route (and the bus, reading it first) keeps the configured
// NEXTAUTH_URL on globalThis once per process: each test is its own process.
afterEach(() => {
  delete (globalThis as Row).__tqConfiguredNextAuthUrl
})

const AUTOMATION_KEYS = (structure: Structure) =>
  Array.from(structure.files.keys()).filter((key) => key.startsWith('automations-'))

describe('in-app event bus — generation', () => {
  it('emits the bus, the queue worker, the registry, one handler per automation and the dispatch route', async () => {
    const structure = await generate({ ...BASE_WORKFLOWS, ...AUTOMATIONS })
    const files = sources(structure)

    for (const path of [
      'lib/automations/event-bus.js',
      'lib/automations/dispatcher.js',
      'lib/automations/registry.js',
      'lib/automations/store.js',
      'lib/automations/wait-until.js',
      'lib/automations/due-check.js',
      'lib/automations/hydrate/order.js',
      'lib/automations/hydrate/user.js',
      'lib/automations/hydrate/booking.js',
      'pages/api/automations/dispatch.js',
      'lib/automations/handlers/thank-the-customer-wf-paid.js',
      'lib/automations/handlers/welcome-two-days-later-wf-signu.js',
    ]) {
      expect(files.has(path)).toBe(true)
    }
    const handlers = Array.from(files.keys()).filter((path) =>
      path.startsWith('lib/automations/handlers/')
    )
    expect(handlers).toHaveLength(5)

    const registry = files.get('lib/automations/registry.js')!
    expect(registry).toContain('"order-paid": [')
    expect(registry).toContain('"user-signed-up": [')
    expect(registry).toContain("require('./handlers/thank-the-customer-wf-paid.js').run")

    // Never in the browser: not in the global hook, which still runs the
    // project's own global workflow.
    const globalHook = files.get('utils/workflows/global-workflows.js')!
    expect(globalHook).toContain("'storage-local-remove'")
    expect(globalHook).not.toContain('echo.test')
    expect(globalHook).not.toContain('general-wait')
    // The queue lives in Postgres, and Vercel keeps a dispatch alive with waitUntil.
    expect(structure.dependencies.pg).toBeDefined()
    expect(structure.dependencies['@vercel/functions']).toBe('^2.2.13')
    // The dispatch route reads its body raw (to check the signed digest) and
    // asks for a time limit its 50 s budget fits in.
    expect(files.get('pages/api/automations/dispatch.js')).toContain(
      'module.exports.config = { api: { bodyParser: false }, maxDuration: 60 };'
    )
  })

  it('generates nothing for a project without an automation, and adding one changes nothing else', async () => {
    const without = await generate(BASE_WORKFLOWS, TELEPORT_AUTOMATIONS, { files: FETCHERS })
    const withAutomations = await generate(
      { ...BASE_WORKFLOWS, ...AUTOMATIONS },
      TELEPORT_AUTOMATIONS,
      { files: FETCHERS }
    )

    expect(AUTOMATION_KEYS(without)).toEqual([])
    const withoutFiles = sources(without)
    expect(Array.from(withoutFiles.keys()).some((path) => path.includes('automations'))).toBe(false)
    // The data-source modules are left exactly as their plugin wrote them.
    const seeded = sources({ files: FETCHERS() } as Structure)
    for (const [path, content] of seeded) {
      expect({ path, content: withoutFiles.get(path) }).toEqual({ path, content })
    }

    const withFiles = sources(withAutomations)
    for (const [path, content] of withoutFiles) {
      // The data API only gains the wake-up after a write to the event ledger
      // (data-api-business-events.test.ts), and the activity kick.
      if (path === DATA_API_ROUTE) {
        const diff = insertedLines(content, withFiles.get(path) as string)
        expect(diff.kept).toBe(true)
        expect(diff.inserted.join('\n')).toContain('wakeAutomations(req);')
        expect(diff.inserted.join('\n')).toContain('kickDueAutomations(req);')
        continue
      }
      // A server read of the TeleportHQ database only gains the activity kick.
      if (TELEPORT_READS.indexOf(path) !== -1) {
        const diff = insertedLines(content, withFiles.get(path) as string)
        expect({ path, kept: diff.kept }).toEqual({ path, kept: true })
        expect(diff.inserted).toEqual([
          "import { kickWhenDue as __tqKickDueAutomations } from '../../lib/automations/due-check'",
          '  // Activity on the site: due automation work (a Wait, a retry) starts off this request.',
          '  __tqKickDueAutomations(req)',
        ])
        continue
      }
      expect({ path, content: withFiles.get(path) }).toEqual({ path, content })
    }
    const added = Array.from(withFiles.keys()).filter((path) => !withoutFiles.has(path))
    expect(added.every((path) => /^(lib|pages\/api)\/automations\//.test(path))).toBe(true)
    // The dispatch route verifies signed requests with the cron signing keys.
    expect(withAutomations.uidl.globals.env).toEqual({
      ...without.uidl.globals.env,
      TELEPORT_CRON_SECRET: '',
      TELEPORT_CRON_SECRET_PREVIOUS: '',
    })
    expect(withAutomations.dependencies).toEqual({
      ...without.dependencies,
      pg: expect.any(String),
      '@vercel/functions': expect.any(String),
    })
  })

  it('records the low-stock events through utils/app-events.js, which wakes the queue only with the bus', async () => {
    const LOW_STOCK = {
      ecommerceSettings: {
        stockManagement: true,
        stockManagementConfig: {
          lowStockAlerts: true,
          lowStockThreshold: 3,
          lowStockAlertConfig: { provider: 'email-resend' },
        },
      },
    }
    const withBus = sources(
      await generate({ ...BASE_WORKFLOWS, ...AUTOMATIONS }, TELEPORT_AUTOMATIONS, {
        uidl: LOW_STOCK,
      })
    )
    expect(withBus.get(DATA_API_ROUTE)).toContain(
      "var appEvents = require('../../../utils/app-events');"
    )
    expect(withBus.get(DATA_API_ROUTE)).toContain(
      'recordLowStockEvents(req, rows, extractThresholdFromQuery(query));'
    )
    expect(withBus.get('utils/app-events.js')).toContain(
      "require('../lib/automations/event-bus').scheduleDispatch(req);"
    )

    // Without the bus the data API records nothing and has no app-events module.
    const withoutBus = sources(
      await generate(BASE_WORKFLOWS, TELEPORT_AUTOMATIONS, { uidl: LOW_STOCK })
    )
    expect(withoutBus.has('utils/app-events.js')).toBe(false)
    expect(withoutBus.get(DATA_API_ROUTE)).not.toContain('app-events')
  })

  it('declares the cron signing keys for a project whose only signed route is the dispatch route', async () => {
    const automationsOnly = await generate(AUTOMATIONS)
    expect(automationsOnly.uidl.globals.env).toMatchObject({
      TELEPORT_CRON_SECRET: '',
      TELEPORT_CRON_SECRET_PREVIOUS: '',
    })
  })

  describe('runs on the TeleportHQ database only', () => {
    const quietly = async <T>(
      run: () => Promise<T>
    ): Promise<{ result: T; warnings: string[] }> => {
      const warnings: string[] = []
      const saved = console.warn
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(' '))
      }
      try {
        return { result: await run(), warnings }
      } finally {
        console.warn = saved
      }
    }
    const ROUTE = 'pages/api/automations/dispatch.js'
    const REASON =
      'Automations are not set up on this site: no TeleportHQ database holds the automation tables'

    it('the TeleportHQ database: the bus on TELEPORT_DB_*, the real dispatch route', async () => {
      const structure = await generate(AUTOMATIONS, TELEPORT_AUTOMATIONS)
      const files = sources(structure)
      expect(files.get('lib/automations/store.js')).toContain(
        'process.env.TELEPORT_DB_CONNECTION_STRING'
      )
      expect(files.get('lib/automations/store.js')).not.toContain('DATABASE_URL')
      expect(files.get(ROUTE)).toContain('verifyCronRequest(req, rawBody)')
      expect(Object.keys(structure.uidl.globals.env).sort()).toEqual([
        'NEXTAUTH_SECRET',
        'TELEPORT_CRON_SECRET',
        'TELEPORT_CRON_SECRET_PREVIOUS',
      ])
    })

    it('anything else: no bus, one build warning, a dispatch route that says why, nothing else changes', async () => {
      const without = await generate(BASE_WORKFLOWS, null, { files: FETCHERS })
      const withoutFiles = sources(without)
      for (const automations of [null, { dataSourceId: 'ds-own', dataSourceType: 'postgresql' }]) {
        const { result: refused, warnings } = await quietly(() =>
          generate({ ...BASE_WORKFLOWS, ...AUTOMATIONS }, automations, { files: FETCHERS })
        )
        expect(AUTOMATION_KEYS(refused)).toEqual(['automations-dispatch-route'])
        expect(warnings.filter((line) => line.includes('no TeleportHQ database'))).toHaveLength(1)
        const refusedFiles = sources(refused)
        expect(
          Array.from(refusedFiles.keys()).filter((path) => path.includes('automations'))
        ).toEqual([ROUTE])
        expect(Array.from(refusedFiles.keys()).sort()).toEqual(
          [...Array.from(withoutFiles.keys()), ROUTE].sort()
        )
        for (const [path, content] of withoutFiles) {
          expect({ path, content: refusedFiles.get(path) }).toEqual({ path, content })
        }
        expect(refused.uidl.globals.env).toEqual(without.uidl.globals.env)
        expect(refused.dependencies).toEqual(without.dependencies)

        // Whatever is sent, the route answers the reason (the editor's test
        // proxy shows it), never a missing page.
        const handler = createApp(refusedFiles, new FakeDatabase())(ROUTE) as RouteHandler
        for (const method of ['GET', 'POST']) {
          const reply = { status: 0, body: null as unknown }
          await handler(
            { method, url: '/api/automations/dispatch', headers: {} },
            {
              status(code: number) {
                reply.status = code
                return {
                  json(payload: unknown) {
                    reply.body = payload
                  },
                }
              },
            }
          )
          expect(reply).toEqual({ status: 503, body: { error: REASON } })
        }
      }
    })
  })

  it('keeps the queue tables out of every browser read', () => {
    for (const table of [
      'teleport_automations',
      'teleport_event_deliveries',
      'teleport_automation_waits',
    ]) {
      expect(PROTECTED_TABLES).toContain(table)
    }
  })
})

describe('in-app event bus — dispatcher', () => {
  let files: Map<string, string>

  beforeAll(async () => {
    files = sources(await generate({ ...BASE_WORKFLOWS, ...AUTOMATIONS }))
  })

  const bus = (db: FakeDatabase) => createApp(files, db)('lib/automations/event-bus.js') as Bus
  const dispatchOnce = (db: FakeDatabase, options: Row = {}) =>
    withEcho(async (calls) => ({
      result: await silenced(() => bus(db).dispatch(options)),
      calls,
    }))

  it('claims due events with SKIP LOCKED, runs every enabled automation and records each outcome', async () => {
    const db = new FakeDatabase()
    const event = seedOrderPaid(db)

    const { result, calls } = await dispatchOnce(db)

    const claim = db.claimStatement()
    expect(claim).toContain('FOR UPDATE SKIP LOCKED')
    expect(claim).toContain('LIMIT 20')
    expect(claim).toContain('e.attempts < 5')
    expect(claim).toContain("(e.status = 'recorded' AND e.created_at > now() - interval '3 days')")
    expect(claim).toContain("OR e.status = 'failed'")
    expect(claim).toContain(
      'GREATEST(COALESCE(e.claimed_at, e.created_at), COALESCE((SELECT max(d.started_at) FROM teleport_event_deliveries d WHERE d.event_id = e.id), e.created_at)) ' +
        "< now() - interval '15 minutes'"
    )
    expect(claim).toContain('a.workflow_id = ANY($2::text[]) AND a.enabled')
    expect(claim).toContain("ORDER BY CASE WHEN e.status = 'recorded' THEN 0 ELSE 1 END")
    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 1, resumed: 0 })

    // The handler read the hydrated order: the customer and the number come
    // from teleport_orders, not from the payload, whose other keys are not
    // blocks of the event and are dropped.
    const thanks = calls.filter((call) => call.url === ECHO + '/thanks')
    expect(thanks.map((call) => call.json)).toEqual([
      { email: 'ava@example.com', number: 'ORD-1042', test: false },
    ])
    // Switched off: never run, no delivery row.
    expect(calls.some((call) => call.url === ECHO + '/off')).toBe(false)

    expect(db.delivery('wf-paid-ok')).toMatchObject({ status: 'delivered', error: null })
    expect(db.delivery('wf-paid-fail')).toMatchObject({ status: 'failed' })
    expect(db.delivery('wf-paid-fail')!.error).toContain('network down')
    expect(db.delivery('wf-paid-off')).toBeUndefined()
    // Settled from its delivery rows; one attempt, counted when a handler started.
    expect(db.events.find((e) => e.id === event.id)).toMatchObject({
      status: 'failed',
      attempts: 1,
    })
  })

  it('reads the order block with its v1 meanings', async () => {
    const db = new FakeDatabase()
    seedOrderPaid(db)
    const app = createApp(files, db)
    const hydrateOrder = (
      app('lib/automations/hydrate/order.js') as {
        hydrate: (client: unknown, row: Row, payload: Row, context: Row) => Promise<Row>
      }
    ).hydrate
    const client = { query: async (sql: string, values: unknown[]) => db.query(sql, values) }

    const blocks = await withEnv(ENV, () =>
      hydrateOrder(client, db.events[0] as never, {}, { baseUrl: 'https://shop.test' })
    )

    expect(blocks.order).toMatchObject({
      number: 'ORD-1042',
      // Checkout records a provider payment as 'online': the provider is the method.
      paymentMethod: 'stripe',
      // The lines at their shop prices (total_price), not what was paid.
      subtotal: 40,
      itemCount: 2,
      total: 53.2,
      pageUrl: 'https://shop.test/orders/ORD-1042',
    })
    expect((blocks.order as Row).items).toEqual([
      expect.objectContaining({ unitPrice: 18, total: 36 }),
    ])
  })

  it('never runs an (event, automation) pair twice: a delivered or running pair is a no-op', async () => {
    const db = new FakeDatabase()
    seedOrderPaid(db)

    const first = await dispatchOnce(db)
    // The retry: the event failed, so it is claimed again.
    const second = await dispatchOnce(db)
    expect(second.result).toEqual({ claimed: 1, delivered: 0, failed: 1, resumed: 0 })

    const calls = [...first.calls, ...second.calls]
    expect(calls.filter((call) => call.url === ECHO + '/thanks')).toHaveLength(1)
    expect(calls.filter((call) => call.url === ECHO + '/fails')).toHaveLength(2)
    expect(db.delivery('wf-paid-fail')!.attempts).toBe(2)
    expect(db.events[0]).toMatchObject({ status: 'failed', attempts: 2 })

    // Another dispatcher is running the pair right now: this one leaves it.
    const busy = new FakeDatabase()
    seedOrderPaid(busy)
    busy.deliveries.push({
      id: 900,
      event_id: 'evt-paid',
      workflow_id: 'wf-paid-ok',
      status: 'running',
      error: null,
      attempts: 1,
      started_at: new Date(),
      finished_at: null,
    })
    const { calls: busyCalls } = await dispatchOnce(busy)
    expect(busyCalls.some((call) => call.url === ECHO + '/thanks')).toBe(false)
    // Still running elsewhere: the event stays claimed, not settled.
    expect(busy.events[0].status).toBe('pending')
  })

  it('leaves a handler that outlives its timeout running, and never starts it again until its claim is stale', async () => {
    const db = new FakeDatabase()
    db.automations.push(automationRow('wf-booking-slow', 'booking-created'))
    db.bookings.push({ id: 'b-1', reference: 'BK-1', customer_email: 'liam@example.com' })
    db.events.push(
      eventRow({
        id: 'evt-booking',
        event_type: 'booking-created',
        entity_type: 'booking',
        entity_id: 'b-1',
      })
    )
    const held: Array<() => void> = []
    const scope = globalThis as Record<string, unknown>
    const previousFetch = scope.fetch
    scope.fetch = () =>
      new Promise((resolve) => {
        held.push(() =>
          resolve({
            ok: true,
            status: 200,
            headers: new Map([['content-type', 'application/json']]),
            json: async () => ({}),
            text: async () => '{}',
          })
        )
      })
    const app = createApp(files, db)
    const run = (options: Row) =>
      (app('lib/automations/event-bus.js') as Bus).dispatch({ handlerTimeoutMs: 20, ...options })
    const settle = () => new Promise((resolve) => setTimeout(resolve, 10))
    try {
      await withEnv(ENV, () =>
        silenced(async () => {
          expect(await run({})).toEqual({ claimed: 1, delivered: 0, failed: 0, resumed: 0 })
          expect(held).toHaveLength(1)
          expect(db.delivery('wf-booking-slow')).toMatchObject({ status: 'running', error: null })
          expect(db.events[0]).toMatchObject({ status: 'pending', attempts: 1 })

          // The next kick: the claim is fresh, so nothing starts the handler again.
          expect(await run({})).toEqual({ claimed: 0, delivered: 0, failed: 0, resumed: 0 })
          expect(held).toHaveLength(1)

          // Fifteen minutes on, the run never reported back: it is taken over.
          db.events[0].claimed_at = ago(STALE_MS + MINUTE_MS)
          db.delivery('wf-booking-slow')!.started_at = ago(STALE_MS + MINUTE_MS)
          await run({})
          expect(held).toHaveLength(2)
          expect(db.delivery('wf-booking-slow')!.attempts).toBe(2)

          // The first run ends at last: its claim is gone, so it writes nothing.
          held[0]()
          await settle()
          expect(db.delivery('wf-booking-slow')!.status).toBe('running')
          // The second one ends: recorded as delivered.
          held[1]()
          await settle()
          expect(db.delivery('wf-booking-slow')!.status).toBe('delivered')
        })
      )
    } finally {
      scope.fetch = previousFetch
    }
  })

  it('starts nothing once its time budget is spent, and hands the claims back untouched', async () => {
    const db = new FakeDatabase()
    seedOrderPaid(db)
    const { result, calls } = await dispatchOnce(db, { deadlineMs: -1 })
    expect(result).toEqual({ claimed: 0, delivered: 0, failed: 0, resumed: 0 })
    expect(calls).toEqual([])
    expect(db.deliveries).toEqual([])
    expect(db.events[0]).toMatchObject({ status: 'recorded', attempts: 0 })
  })

  it('retries a failed event whatever its age, and a new one only within the window', async () => {
    const db = new FakeDatabase()
    seedOrderPaid(db)
    db.events[0].status = 'failed'
    db.events[0].attempts = 1
    db.events[0].created_at = ago(5 * DAY_MS)
    db.automations.forEach((a) => {
      a.enabled_at = ago(10 * DAY_MS)
    })
    db.events.push(
      eventRow({ id: 'evt-stale', event_type: 'order-paid', created_at: ago(4 * DAY_MS) })
    )
    const { result } = await dispatchOnce(db)
    expect(result.claimed).toBe(1)
    expect(db.events.find((e) => e.id === 'evt-stale')!.status).toBe('recorded')
    expect(db.events[0].attempts).toBe(2)
  })

  it('fails the event, and counts the attempt, when its record cannot be read — never delivers it without', async () => {
    const db = new FakeDatabase()
    seedOrderPaid(db)
    db.ordersError = Object.assign(new Error('connection terminated'), { code: '08006' })
    const { result, calls } = await dispatchOnce(db)
    expect(result.delivered).toBe(0)
    expect(calls).toEqual([])
    expect(db.events[0]).toMatchObject({ status: 'failed', attempts: 1 })

    // A table the project does not have reads as no record: the event is
    // refused, never delivered from what the row recorded.
    const missing = new FakeDatabase()
    seedOrderPaid(missing)
    missing.ordersError = Object.assign(new Error('relation "teleport_orders" does not exist'), {
      code: '42P01',
    })
    const refused = await dispatchOnce(missing)
    expect(refused.result.delivered).toBe(0)
    expect(refused.calls).toEqual([])
    expect(missing.delivery('wf-paid-ok')).toMatchObject({
      status: 'failed',
      error: 'No such order',
    })
  })

  it('passes over an event another dispatcher holds, one recorded before the automation was switched on, and automations this build does not have', async () => {
    const db = new FakeDatabase()
    const event = seedOrderPaid(db)
    event.locked = true
    db.events.push({
      ...event,
      id: 'evt-old',
      dedupe_key: 'old',
      locked: false,
      created_at: ago(2 * DAY_MS),
    })
    // On in the table, but not in this build's registry.
    db.automations.push(automationRow('wf-ghost', 'user-signed-up'))
    db.events.push(eventRow({ id: 'evt-ghost', event_type: 'user-signed-up' }))

    const { result } = await dispatchOnce(db)

    expect(result.claimed).toBe(0)
    expect(db.deliveries).toEqual([])
    // Recorded before the automation was switched on: left as it was.
    expect(db.events.find((e) => e.id === 'evt-old')!.status).toBe('recorded')
  })

  it('leaves an event recorded when every automation of it was switched off after the claim', async () => {
    const db = new FakeDatabase()
    seedOrderPaid(db)
    db.afterClaim = () => {
      db.automations.forEach((a) => {
        a.enabled = false
      })
    }
    const { result, calls } = await dispatchOnce(db)
    expect(result).toEqual({ claimed: 1, delivered: 0, failed: 0, resumed: 0 })
    expect(calls).toEqual([])
    expect(db.deliveries).toEqual([])
    // Not delivered: nothing ran for it.
    expect(db.events[0]).toMatchObject({ status: 'recorded', attempts: 0 })

    // Nothing is read for it either: a record missing meanwhile neither
    // fails the event nor counts an attempt.
    const gone = new FakeDatabase()
    seedOrderPaid(gone)
    gone.orders = []
    gone.afterClaim = () => {
      gone.automations.forEach((a) => {
        a.enabled = false
      })
    }
    await dispatchOnce(gone)
    expect(gone.deliveries).toEqual([])
    expect(gone.events[0]).toMatchObject({ status: 'recorded', attempts: 0 })
    expect(gone.statements.some((text) => text.includes('FROM teleport_orders'))).toBe(false)
  })

  it('parks a run at a Wait, and resumes it at the next node once it is due', async () => {
    const db = new FakeDatabase()
    seedSignup(db)

    const first = await dispatchOnce(db)
    expect(first.result).toEqual({ claimed: 1, delivered: 1, failed: 0, resumed: 0 })
    expect(first.calls.map((call) => call.url)).toEqual([ECHO + '/before'])
    expect(first.calls[0].json).toEqual({ email: 'noah@example.com' })
    // Not finished: the delivery waits with it, and the event stays open.
    expect(db.delivery('wf-signup-wait')).toMatchObject({ status: 'waiting', attempts: 1 })
    expect(db.events[0]).toMatchObject({ status: 'pending', attempts: 1 })

    expect(db.waits).toHaveLength(1)
    const wait = db.waits[0]
    expect(wait).toMatchObject({
      event_id: 'evt-signup',
      workflow_id: 'wf-signup-wait',
      resume_node_id: 'after',
      status: 'waiting',
    })
    const due = wait.run_at.getTime() - NOW
    expect(due).toBeGreaterThan(2 * DAY_MS - MINUTE_MS)
    expect(due).toBeLessThan(2 * DAY_MS + MINUTE_MS)
    const saved = JSON.parse(wait.context!)
    expect(saved.wait).toEqual({ until: wait.run_at.toISOString() })
    expect(saved.before).toBeDefined()
    // Nothing of the run's credentials is stored with it.
    expect(saved.__internalHeaders).toBeUndefined()
    expect(saved.__baseUrl).toBeUndefined()
    // The account's password never reaches the event.
    expect(JSON.stringify(saved)).not.toContain('hash')

    // Not due yet: nothing resumes.
    expect((await dispatchOnce(db)).result.resumed).toBe(0)

    wait.run_at = ago(1000)
    const second = await dispatchOnce(db)
    expect(second.result).toEqual({ claimed: 0, delivered: 0, failed: 0, resumed: 1 })
    expect(second.calls.map((call) => call.url)).toEqual([ECHO + '/after'])
    expect(second.calls[0].json).toEqual({
      email: 'noah@example.com',
      waitedUntil: saved.wait.until,
    })
    expect(wait.status).toBe('done')
    // The delivery takes the resumed run's outcome; the event settles.
    expect(db.delivery('wf-signup-wait')).toMatchObject({ status: 'delivered', attempts: 1 })
    // The Wait and its delivery in one statement, never two a crash could split.
    const resumeWrites = db.statements.filter(
      (text) =>
        text.startsWith('WITH w AS (UPDATE teleport_automation_waits') ||
        /^UPDATE teleport_automation_waits SET status = \$|^UPDATE teleport_event_deliveries SET status = \$3/.test(
          text
        )
    )
    expect(resumeWrites).toHaveLength(1)
    expect(resumeWrites[0]).toContain(
      'AND run_at = $3 RETURNING id) UPDATE teleport_event_deliveries SET status = $4'
    )
    expect(resumeWrites[0]).toContain("AND status = 'waiting' AND EXISTS (SELECT 1 FROM w)")
    expect(db.events[0]).toMatchObject({ status: 'delivered', attempts: 1 })
  })

  it('records a failure after the Wait on the delivery, so Run again and the retries see it', async () => {
    const db = new FakeDatabase()
    seedSignup(db)
    await dispatchOnce(db)
    db.waits[0].run_at = ago(1000)
    const resumed = await withEnv(ENV, () =>
      withFetch(
        (call) => {
          if (call.url === ECHO + '/after') {
            throw new Error('mail provider down')
          }
          return { status: 200, body: {} }
        },
        () => silenced(() => bus(db).dispatch({}))
      )
    )
    expect(resumed.resumed).toBe(0)
    expect(db.waits[0].status).toBe('failed')
    const delivery = db.delivery('wf-signup-wait')!
    expect(delivery).toMatchObject({ status: 'failed', attempts: 1 })
    expect(delivery.error).toContain('mail provider down')
    // The resumed part only: the History's duration starts at the resume.
    expect(delivery.started_at!.getTime()).toBeGreaterThan(Date.now() - 60 * 1000)
    expect(db.events[0]).toMatchObject({ status: 'failed', attempts: 1 })
  })

  it('never takes over an event whose run is parked at a Wait, however long it waits', async () => {
    const db = new FakeDatabase()
    seedSignup(db)
    await dispatchOnce(db)
    // Days later: the claim and the run's start are long stale.
    db.events[0].claimed_at = ago(2 * DAY_MS)
    db.delivery('wf-signup-wait')!.started_at = ago(2 * DAY_MS)
    const { result, calls } = await dispatchOnce(db)
    expect(result.claimed).toBe(0)
    expect(calls).toEqual([])
    expect(db.delivery('wf-signup-wait')!.status).toBe('waiting')
    expect(db.events[0].status).toBe('pending')
  })

  it('takes over a resume left running past the stale window', async () => {
    const db = new FakeDatabase()
    seedSignup(db)
    await dispatchOnce(db)
    const wait = db.waits[0]
    wait.status = 'resuming'
    wait.run_at = ago(5 * MINUTE_MS)
    expect((await dispatchOnce(db)).result.resumed).toBe(0)
    wait.run_at = ago(STALE_MS + MINUTE_MS)
    expect((await dispatchOnce(db)).result.resumed).toBe(1)
    expect(wait.status).toBe('done')
  })
})

describe('in-app event bus — Waits', () => {
  const wait = (id: string, stepNumber: number) => ({
    id,
    type: 'general-wait',
    config: { amount: 1, unit: 'days' },
    stepNumber,
    label: 'Wait a day',
  })
  const chain = (nodes: Row[]) =>
    nodes.map((node, i) => ({
      id: 'e' + i,
      source: i === 0 ? 't' : String(nodes[i - 1].id),
      target: String(node.id),
    }))
  const welcomeMail = {
    id: 'mail',
    type: 'email-resend',
    config: {
      apiKey: 'k',
      from: 'shop@example.com',
      to: ref('t', ['user', 'email']),
      subject: 'Welcome',
      body: '<p>Welcome</p>',
    },
    stepNumber: 1,
    label: 'Welcome',
  }
  const afterWait = post('after', '/after', 3, {
    email: ref('t', ['user', 'email']),
    waitedUntil: ref('wait', ['until']),
  })
  const WAITS: Record<string, Row> = {
    'wf-mail-wait': {
      id: 'wf-mail-wait',
      name: 'Welcome, then follow up',
      trigger: trigger('user-signed-up'),
      nodes: [welcomeMail, wait('wait', 2), afterWait],
      edges: chain([welcomeMail, wait('wait', 2), afterWait]),
    },
    'wf-trailing': {
      id: 'wf-trailing',
      name: 'Welcome, then wait',
      trigger: trigger('booking-created'),
      nodes: [post('hello', '/hello', 1), wait('last', 2)],
      edges: chain([post('hello', '/hello', 1), wait('last', 2)]),
    },
    'wf-note': {
      id: 'wf-note',
      name: 'Note the signup',
      trigger: trigger('user-signed-up'),
      nodes: [post('note', '/note', 1)],
      edges: chain([post('note', '/note', 1)]),
    },
  }
  let files: Map<string, string>

  beforeAll(async () => {
    files = sources(await generate(WAITS))
  })

  /** One dispatch, every fetch answered by `answer` (200 when it answers nothing). */
  const dispatchWith = (db: FakeDatabase, answer: (url: string) => boolean = () => true) =>
    withEnv(ENV, () =>
      withFetch(
        (call) => {
          if (!answer(call.url)) {
            throw new Error('provider down')
          }
          return { status: 200, body: { ok: true } }
        },
        async (calls) => ({
          result: await silenced(() =>
            (createApp(files, db)('lib/automations/event-bus.js') as Bus).dispatch({})
          ),
          calls,
        })
      )
    )

  const seedSignupFor = (db: FakeDatabase, workflowIds: string[]) => {
    workflowIds.forEach((id) => db.automations.push(automationRow(id, 'user-signed-up')))
    db.users.push({ id: 'user-1', email: 'noah@example.com', name: 'Noah', created_at: ago(1000) })
    db.events.push(
      eventRow({
        id: 'evt-signup',
        event_type: 'user-signed-up',
        entity_type: 'user',
        entity_id: 'user-1',
        actor: 'noah@example.com',
        actor_type: 'customer',
      })
    )
  }

  it('retries a run that failed after its Wait from the step after it: what ran before is never repeated', async () => {
    const db = new FakeDatabase()
    seedSignupFor(db, ['wf-mail-wait'])

    await dispatchWith(db)
    expect(db.mailSent).toHaveLength(1)
    expect(db.waits).toHaveLength(1)
    const parked = db.waits[0]
    const { wait: waited } = JSON.parse(parked.context!)

    // Due, and the step after the Wait fails.
    parked.run_at = ago(1000)
    await dispatchWith(db, (url) => url !== ECHO + '/after')
    expect(parked.status).toBe('failed')
    expect(db.delivery('wf-mail-wait')).toMatchObject({ status: 'failed', attempts: 1 })
    expect(db.events[0]).toMatchObject({ status: 'failed', attempts: 1 })

    // The retry resumes after the Wait, with what the run had stored.
    const retry = await dispatchWith(db)
    expect(retry.result).toEqual({ claimed: 1, delivered: 1, failed: 0, resumed: 0 })
    expect(retry.calls.map((call) => [call.url, call.json])).toEqual([
      [ECHO + '/after', { email: 'noah@example.com', waitedUntil: waited.until }],
    ])
    // The welcome email before the Wait went out once.
    expect(db.mailSent).toHaveLength(1)
    expect(db.waits).toHaveLength(1)
    expect(parked.status).toBe('done')
    expect(db.delivery('wf-mail-wait')).toMatchObject({ status: 'delivered', attempts: 2 })
    expect(db.events[0]).toMatchObject({ status: 'delivered', attempts: 2 })
  })

  it('keeps resuming a retry from the same Wait while it fails, and starts a first failure over', async () => {
    const db = new FakeDatabase()
    seedSignupFor(db, ['wf-mail-wait'])
    await dispatchWith(db)
    db.waits[0].run_at = ago(1000)
    const down = (url: string) => url !== ECHO + '/after'
    await dispatchWith(db, down)
    const again = await dispatchWith(db, down)
    expect(again.calls.map((call) => call.url)).toEqual([ECHO + '/after'])
    expect(db.waits[0].status).toBe('failed')
    expect(db.mailSent).toHaveLength(1)
    expect(db.delivery('wf-mail-wait')).toMatchObject({ status: 'failed', attempts: 2 })

    // A run that failed before reaching any Wait is run again from its start.
    const early = new FakeDatabase()
    seedSignupFor(early, ['wf-note'])
    await dispatchWith(early, (url) => url !== ECHO + '/note')
    expect(early.events[0].status).toBe('failed')
    const rerun = await dispatchWith(early)
    expect(rerun.calls.map((call) => call.url)).toEqual([ECHO + '/note'])
    expect(early.delivery('wf-note')).toMatchObject({ status: 'delivered', attempts: 2 })
  })

  /** Every fetch answered at once, except /after's, which waits for its release. */
  const holdAfter = () => {
    const held: Array<() => void> = []
    const answer = {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({}),
      text: async () => '{}',
    }
    const fetch = (url: string) =>
      url === ECHO + '/after'
        ? new Promise((resolve) => held.push(() => resolve(answer)))
        : Promise.resolve(answer)
    return { held, fetch }
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

  /**
   * A dispatch whose handlers are waited for 20 ms, every fetch answered by
   * `fetch`, then `afterwards` (in the same environment: a late run writes
   * its outcome on the database the app is configured with).
   */
  const slowDispatch = async (
    db: FakeDatabase,
    fetch: unknown,
    afterwards: () => Promise<void>
  ) => {
    const scope = globalThis as Record<string, unknown>
    const previous = scope.fetch
    scope.fetch = fetch
    try {
      await withEnv(ENV, async () => {
        await silenced(() =>
          (createApp(files, db)('lib/automations/event-bus.js') as Bus).dispatch({
            handlerTimeoutMs: 20,
          })
        )
        await silenced(afterwards)
      })
    } finally {
      scope.fetch = previous
    }
  }

  /** A run of wf-mail-wait whose part after the Wait failed once. */
  const failedAfterWait = async () => {
    const db = new FakeDatabase()
    seedSignupFor(db, ['wf-mail-wait'])
    await dispatchWith(db)
    db.waits[0].run_at = ago(1000)
    await dispatchWith(db, (url) => url !== ECHO + '/after')
    expect(db.waits[0].status).toBe('failed')
    return db
  }

  it('settles the Wait of a late retry only when that retry still owns its delivery', async () => {
    for (const takenOver of [true, false]) {
      const db = await failedAfterWait()
      const slow = holdAfter()
      const delivery = () => db.delivery('wf-mail-wait')!
      // The retry resumes after the Wait and outlives the dispatcher's patience.
      await slowDispatch(db, slow.fetch, async () => {
        expect(slow.held).toHaveLength(1)
        expect(delivery()).toMatchObject({ status: 'running', attempts: 2 })
        if (takenOver) {
          // Another dispatcher took the stale run over: the delivery is its.
          delivery().attempts = 3
        }
        slow.held[0]()
        await settle()
      })
      expect({ takenOver, wait: db.waits[0].status, delivery: delivery().status }).toEqual(
        takenOver
          ? { takenOver, wait: 'failed', delivery: 'running' }
          : { takenOver, wait: 'done', delivery: 'delivered' }
      )
    }
  })

  it("records a late resume's outcome only while its claim still holds the Wait", async () => {
    for (const takenOver of [true, false]) {
      const db = new FakeDatabase()
      seedSignupFor(db, ['wf-mail-wait'])
      await dispatchWith(db)
      const parked = db.waits[0]
      parked.run_at = ago(1000)
      const slow = holdAfter()
      await slowDispatch(db, slow.fetch, async () => {
        expect(slow.held).toHaveLength(1)
        expect(parked.status).toBe('resuming')
        if (takenOver) {
          // Stale, and claimed again by another dispatcher: a new run_at token.
          parked.run_at = new Date(parked.run_at.getTime() + 1000)
        }
        slow.held[0]()
        await settle()
      })
      const delivery = db.delivery('wf-mail-wait')!
      expect({ takenOver, wait: parked.status, delivery: delivery.status }).toEqual(
        takenOver
          ? { takenOver, wait: 'resuming', delivery: 'waiting' }
          : { takenOver, wait: 'done', delivery: 'delivered' }
      )
    }
  })

  it('ends a run whose last step is a Wait: nothing is parked, the event is delivered', async () => {
    const db = new FakeDatabase()
    db.automations.push(automationRow('wf-trailing', 'booking-created'))
    db.bookings.push({ id: 'bk-1', reference: 'BK-1', status: 'pending', customer_email: 'a@b.c' })
    db.events.push(
      eventRow({
        id: 'evt-booking',
        event_type: 'booking-created',
        entity_type: 'booking',
        entity_id: 'bk-1',
      })
    )
    const { result, calls } = await dispatchWith(db)
    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0, resumed: 0 })
    expect(calls.map((call) => call.url)).toEqual([ECHO + '/hello'])
    expect(db.waits).toEqual([])
    expect(db.delivery('wf-trailing')).toMatchObject({ status: 'delivered' })
    expect(db.events[0]).toMatchObject({ status: 'delivered' })
  })

  it('lets a run parked by an automation that is now off no longer hold back the retry of another', async () => {
    const db = new FakeDatabase()
    seedSignupFor(db, ['wf-mail-wait', 'wf-note'])
    // The note fails; the welcome parks at its Wait.
    await dispatchWith(db, (url) => url !== ECHO + '/note')
    expect(db.delivery('wf-mail-wait')!.status).toBe('waiting')
    expect(db.delivery('wf-note')!.status).toBe('failed')
    expect(db.events[0].status).toBe('pending')

    // Long after, with the welcome automation still on, its parked run holds the event.
    const longAgo = ago(STALE_MS + MINUTE_MS)
    db.events[0].claimed_at = longAgo
    db.deliveries.forEach((d) => {
      d.started_at = longAgo
    })
    expect((await dispatchWith(db)).result.claimed).toBe(0)

    // Switched off: its run stays parked, and the note is retried.
    db.automations.find((a) => a.workflow_id === 'wf-mail-wait')!.enabled = false
    const retried = await dispatchWith(db)
    expect(db.claimStatement()).toContain(
      "d.status = 'waiting' AND d.workflow_id = ANY($2::text[]) AND EXISTS (SELECT 1 FROM teleport_automations a WHERE a.workflow_id = d.workflow_id AND a.enabled)"
    )
    expect(retried.result).toEqual({ claimed: 1, delivered: 1, failed: 0, resumed: 0 })
    expect(retried.calls.map((call) => call.url)).toEqual([ECHO + '/note'])
    expect(db.delivery('wf-note')).toMatchObject({ status: 'delivered', attempts: 2 })
    expect(db.delivery('wf-mail-wait')!.status).toBe('waiting')
    expect(db.waits[0].status).toBe('waiting')
    expect(db.events[0].status).toBe('delivered')
  })
})

describe('in-app event bus — claims that outlive their run', () => {
  let files: Map<string, string>

  beforeAll(async () => {
    files = sources(await generate({ ...BASE_WORKFLOWS, ...AUTOMATIONS }))
  })

  const okResponse = () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    json: async () => ({}),
    text: async () => '{}',
  })

  /** Every fetch waits until released, then answers 200. */
  const holdFetches = () => {
    const held: Array<() => void> = []
    const urls: string[] = []
    const scope = globalThis as Record<string, unknown>
    const previous = scope.fetch
    scope.fetch = (url: string) => {
      urls.push(url)
      return new Promise((resolve) => {
        held.push(() => resolve(okResponse()))
      })
    }
    return { held, urls, restore: () => (scope.fetch = previous) }
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

  const seedBooking = (db: FakeDatabase): EventRow => {
    db.automations.push(automationRow('wf-booking-slow', 'booking-created'))
    db.bookings.push({
      id: 'b-1',
      reference: 'BK-1',
      status: 'confirmed',
      customer_email: 'liam@example.com',
      starts_at: ago(-DAY_MS),
      ends_at: ago(-DAY_MS - 60 * MINUTE_MS),
    })
    const event = eventRow({
      id: 'evt-booking',
      event_type: 'booking-created',
      entity_type: 'booking',
      entity_id: 'b-1',
    })
    db.events.push(event)
    return event
  }

  it('settles an event whose last attempt never reported back, starting no handler', async () => {
    const db = new FakeDatabase()
    const event = seedBooking(db)
    event.status = 'pending'
    event.attempts = 5
    event.claimed_at = ago(5 * MINUTE_MS)
    db.deliveries.push({
      id: 700,
      event_id: event.id,
      workflow_id: 'wf-booking-slow',
      status: 'running',
      error: null,
      attempts: 5,
      started_at: ago(5 * MINUTE_MS),
      finished_at: null,
    })
    const dispatch = () =>
      withEcho(async (recorded) => ({
        result: await silenced(() =>
          (createApp(files, db)('lib/automations/event-bus.js') as Bus).dispatch({})
        ),
        calls: recorded,
      }))

    // Inside the stale window: left alone.
    await dispatch()
    expect(event.status).toBe('pending')
    expect(db.delivery('wf-booking-slow')!.status).toBe('running')

    event.claimed_at = ago(STALE_MS + MINUTE_MS)
    db.delivery('wf-booking-slow')!.started_at = ago(STALE_MS + MINUTE_MS)
    const { result, calls } = await dispatch()
    expect(calls).toEqual([])
    expect(result).toEqual({ claimed: 0, delivered: 0, failed: 0, resumed: 0 })
    expect(db.delivery('wf-booking-slow')).toMatchObject({ status: 'failed', error: 'Timed out' })
    expect(event).toMatchObject({ status: 'failed', attempts: 5 })
  })

  const exhausted = (db: FakeDatabase, deliveryStatus: string) => {
    const event = seedBooking(db)
    event.status = 'pending'
    event.attempts = 5
    event.claimed_at = ago(STALE_MS + MINUTE_MS)
    db.deliveries.push({
      id: 701,
      event_id: event.id,
      workflow_id: 'wf-booking-slow',
      status: deliveryStatus,
      error: null,
      attempts: 5,
      started_at: ago(STALE_MS + MINUTE_MS),
      finished_at: deliveryStatus === 'running' ? null : ago(STALE_MS),
    })
    return event
  }
  const dispatchWith = (db: FakeDatabase, options: Row = {}) =>
    withEcho(async (calls) => ({
      result: await silenced(() =>
        (createApp(files, db)('lib/automations/event-bus.js') as Bus).dispatch(options)
      ),
      calls,
    }))

  it('settles an exhausted event from its delivery rows: a 5th attempt that finished late ends delivered', async () => {
    const db = new FakeDatabase()
    const event = exhausted(db, 'delivered')
    const { calls } = await dispatchWith(db)
    expect(calls).toEqual([])
    expect(db.delivery('wf-booking-slow')!.status).toBe('delivered')
    expect(event).toMatchObject({ status: 'delivered', attempts: 5 })
  })

  it('times out the runs of an exhausted event even out of time, so no final event keeps a running row', async () => {
    const db = new FakeDatabase()
    const event = exhausted(db, 'running')
    const { calls } = await dispatchWith(db, { deadlineMs: -1 })
    expect(calls).toEqual([])
    expect(db.delivery('wf-booking-slow')).toMatchObject({ status: 'failed', error: 'Timed out' })
    expect(event.status).toBe('failed')
    expect(db.deliveries.filter((d) => d.status === 'running')).toEqual([])
  })

  it('lets a dispatcher that ran out of time hand back only the Waits it still holds', async () => {
    const db = new FakeDatabase()
    seedSignup(db)
    db.events[0].status = 'delivered'
    for (const id of [1, 2]) {
      db.waits.push({
        id,
        event_id: 'evt-signup',
        workflow_id: 'wf-signup-wait',
        resume_node_id: 'after',
        context: JSON.stringify({ wait: { until: ago(MINUTE_MS).toISOString() } }),
        run_at: ago(MINUTE_MS),
        status: 'waiting',
        created_at: ago(DAY_MS),
      })
    }
    const fetches = holdFetches()
    const first = createApp(files, db)('lib/automations/event-bus.js') as Bus
    const second = createApp(files, db)('lib/automations/event-bus.js') as Bus
    try {
      await withEnv(ENV, () =>
        silenced(async () => {
          // The first dispatcher claims both Waits and freezes on the first resume.
          const frozen = first.dispatch({ deadlineMs: 30, handlerTimeoutMs: 60000 })
          await settle()
          expect(db.waits.map((w) => w.status)).toEqual(['resuming', 'resuming'])
          expect(fetches.urls).toHaveLength(1)

          // Long enough later, a second dispatcher takes the other Wait over.
          const other = db.waits[1]
          other.run_at = ago(STALE_MS + MINUTE_MS)
          await second.dispatch({ handlerTimeoutMs: 20 })
          expect(fetches.urls).toHaveLength(2)
          const takeover = other.run_at

          // The first wakes past its budget and hands back what it did not
          // start: that Wait is no longer its own, so it writes nothing.
          await new Promise((resolve) => setTimeout(resolve, 40))
          fetches.held[0]()
          await frozen
          expect(db.waits[0].status).toBe('done')
          expect(other).toMatchObject({ status: 'resuming', run_at: takeover })

          fetches.held[1]()
          await settle()
          expect(other.status).toBe('done')
        })
      )
    } finally {
      fetches.restore()
    }
  })

  it('takes an event over within one stale window: not while one of its deliveries started recently', async () => {
    const db = new FakeDatabase()
    const event = seedOrderPaid(db)
    event.status = 'pending'
    event.attempts = 1
    event.claimed_at = ago(STALE_MS + 5 * MINUTE_MS)
    db.deliveries.push({
      id: 800,
      event_id: event.id,
      workflow_id: 'wf-paid-ok',
      status: 'running',
      error: null,
      attempts: 1,
      started_at: ago(5 * MINUTE_MS),
      finished_at: null,
    })
    const dispatch = () =>
      withEcho(async (recorded) => ({
        result: await silenced(() =>
          (createApp(files, db)('lib/automations/event-bus.js') as Bus).dispatch({})
        ),
        calls: recorded,
      }))

    // Its claim is stale, but a delivery started five minutes ago.
    expect((await dispatch()).result.claimed).toBe(0)

    // Once that start is stale too, one takeover runs everything again.
    db.delivery('wf-paid-ok')!.started_at = ago(STALE_MS + MINUTE_MS)
    const { result, calls } = await dispatch()
    expect(result.claimed).toBe(1)
    expect(calls.filter((call) => call.url === ECHO + '/thanks')).toHaveLength(1)
    expect(db.delivery('wf-paid-ok')).toMatchObject({ status: 'delivered', attempts: 2 })
  })

  it('lets a run that froze and woke after a takeover write nothing over it', async () => {
    const db = new FakeDatabase()
    const event = seedBooking(db)
    event.created_at = ago(2000)
    // A second event the first dispatcher claimed and never reached.
    const later = seedSignup(db)
    const fetches = holdFetches()
    // Two processes sharing one database.
    const first = createApp(files, db)('lib/automations/event-bus.js') as Bus
    const second = createApp(files, db)('lib/automations/event-bus.js') as Bus
    try {
      await withEnv(ENV, () =>
        silenced(async () => {
          // The first dispatcher claims both and waits for its first handler (it froze there).
          const frozen = first.dispatch({ deadlineMs: 30, handlerTimeoutMs: 60000 })
          await settle()
          expect(fetches.urls).toHaveLength(1)
          expect(later.status).toBe('pending')
          const firstClaim = event.claimed_at

          // Long enough later, a second dispatcher takes both over.
          for (const stale of [event, later]) {
            stale.claimed_at = ago(STALE_MS + MINUTE_MS)
          }
          db.delivery('wf-booking-slow')!.started_at = ago(STALE_MS + MINUTE_MS)
          await second.dispatch({ handlerTimeoutMs: 20 })
          expect(fetches.urls).toHaveLength(3)
          expect(event.claimed_at).not.toBe(firstClaim)
          expect(db.delivery('wf-booking-slow')).toMatchObject({ status: 'running', attempts: 2 })
          const takeover = { event: event.claimed_at, later: later.claimed_at }

          // The first run wakes: its claims are gone, it writes nothing — not
          // the delivery, not the event, not the hand-back of the event it
          // never reached.
          fetches.held[0]()
          await frozen
          expect(db.delivery('wf-booking-slow')).toMatchObject({ status: 'running', attempts: 2 })
          expect(event).toMatchObject({ status: 'pending', claimed_at: takeover.event })
          expect(later).toMatchObject({ status: 'pending', claimed_at: takeover.later })

          // The runs of the takeover end: recorded.
          fetches.held.slice(1).forEach((release) => release())
          await settle()
          expect(db.delivery('wf-booking-slow')!.status).toBe('delivered')
        })
      )
    } finally {
      fetches.restore()
    }
  })

  it('starts nothing for a call that joins once the time budget is spent: the next kick takes it', async () => {
    const db = new FakeDatabase()
    seedBooking(db)
    const fetches = holdFetches()
    const app = createApp(files, db)('lib/automations/event-bus.js') as Bus
    try {
      await withEnv(ENV, () =>
        silenced(async () => {
          const running = app.dispatch({ deadlineMs: 30, handlerTimeoutMs: 60000 })
          await settle()
          // Joins the dispatch already running: the same promise, no new claim yet.
          const joined = app.dispatch({})
          expect(joined).toBe(running)
          await new Promise((resolve) => setTimeout(resolve, 40))
          fetches.held[0]()
          await running
          await settle()
          const claims = db.statements.filter(
            (text) => text.includes('FROM teleport_events e') && text.includes('SKIP LOCKED')
          )
          expect(claims).toHaveLength(1)
        })
      )
    } finally {
      fetches.restore()
    }
  })

  it('fails a Wait inside a loop the same way in a test as in a live run', async () => {
    const loopFiles = sources(
      await generate({
        'wf-loop-wait': {
          id: 'wf-loop-wait',
          name: 'Wait in a loop',
          trigger: trigger('form-submitted'),
          nodes: [
            {
              id: 'loop',
              type: 'general-loop',
              config: { collection: [1, 2] },
              stepNumber: 1,
              label: 'Each',
            },
            {
              id: 'wait',
              type: 'general-wait',
              config: { amount: 1, unit: 'hours' },
              stepNumber: 2,
              label: 'Wait',
            },
          ],
          edges: [
            { id: 'e1', source: 't', target: 'loop' },
            { id: 'e2', source: 'loop', target: 'wait', sourceHandle: 'loop' },
          ],
        },
      })
    )
    const db = new FakeDatabase()
    db.automations.push(automationRow('wf-loop-wait', 'form-submitted'))
    db.events.push(eventRow({ id: 'evt-form', event_type: 'form-submitted' }))
    const bus = () =>
      createApp(loopFiles, db)('lib/automations/event-bus.js') as Bus & {
        runTestEvent(input: Row, req?: Row): Promise<Totals>
      }

    await withEcho(() => silenced(() => bus().dispatch({})))
    const live = db.delivery('wf-loop-wait')!
    expect(live.status).toBe('failed')
    expect(live.error).toBe('A Wait cannot run inside a loop')

    const tested = await withEcho(() =>
      silenced(() =>
        bus().runTestEvent({
          workflowId: 'wf-loop-wait',
          event: { event: { type: 'form-submitted' }, form: { id: 'f-1', name: 'Contact' } },
        })
      )
    )
    expect(tested).toEqual({ claimed: 1, delivered: 0, failed: 1, resumed: 0 })
    const testRun = db.deliveries.find((d) => d.status === 'test')!
    expect(testRun.error).toBe('A Wait cannot run inside a loop')
    expect(db.waits).toEqual([])
  })
})

describe('in-app event bus — acts only on what the database stands behind', () => {
  // A row of the ledger can be written by a caller (the shared writer's
  // segment is reachable from a browser); the record it names cannot.
  const ATTACKER = 'attacker@evil.test'
  const greet = (id: string, eventType: string, emailPath: string[]): Row => ({
    id,
    name: 'Greet ' + eventType,
    trigger: trigger(eventType),
    nodes: [
      post('greet', '/greet/' + eventType, 1, {
        email: ref('t', emailPath),
        actor: ref('t', ['actor', 'email']),
      }),
    ],
    edges: [{ id: 'e1', source: 't', target: 'greet' }],
  })
  const GREETERS: Record<string, Row> = {
    'wf-review': greet('wf-review', 'review-submitted', ['review', 'authorEmail']),
    'wf-news': greet('wf-news', 'newsletter-subscribed', ['subscriber', 'email']),
    'wf-wl': greet('wf-wl', 'waitlist-joined', ['waitlist', 'entry', 'email']),
    'wf-form': greet('wf-form', 'form-submitted', ['form', 'fields', 'email']),
    'wf-bye': {
      id: 'wf-bye',
      name: 'Say goodbye',
      trigger: trigger('user-deleted'),
      nodes: [
        post('bye', '/bye', 1, {
          id: ref('t', ['user', 'id']),
          email: ref('t', ['user', 'email']),
          name: ref('t', ['user', 'name']),
          actor: ref('t', ['actor', 'email']),
        }),
      ],
      edges: [{ id: 'e1', source: 't', target: 'bye' }],
    },
    'wf-low': {
      id: 'wf-low',
      name: 'Restock',
      trigger: trigger('product-low-stock'),
      nodes: [
        post('low', '/low', 1, {
          name: ref('t', ['product', 'name']),
          stock: ref('t', ['product', 'stock']),
          threshold: ref('t', ['product', 'threshold']),
          sku: ref('t', ['product', 'sku']),
        }),
      ],
      edges: [{ id: 'e1', source: 't', target: 'low' }],
    },
    'wf-source': {
      id: 'wf-source',
      name: 'Where they came from',
      trigger: trigger('user-signed-up'),
      nodes: [post('source', '/source', 1, { source: ref('t', ['user', 'source']) })],
      edges: [{ id: 'e1', source: 't', target: 'source' }],
    },
  }
  let files: Map<string, string>
  let orderFiles: Map<string, string>

  beforeAll(async () => {
    files = sources(await generate(GREETERS))
    orderFiles = sources(await generate({ ...BASE_WORKFLOWS, ...AUTOMATIONS }))
  })

  const dispatchIn = (target: Map<string, string>, db: FakeDatabase) =>
    withEcho(async (calls) => ({
      result: await silenced(() =>
        (createApp(target, db)('lib/automations/event-bus.js') as Bus).dispatch({})
      ),
      calls,
    }))

  it('lays the record over what the row recorded, and takes the actor from the record', async () => {
    const db = new FakeDatabase()
    const event = seedOrderPaid(db)
    event.actor = ATTACKER
    event.actor_type = 'customer'
    event.payload = JSON.stringify({
      order: { customer: { email: ATTACKER, name: 'Mallory' }, giftMessage: 'kept' },
    })

    const { calls } = await dispatchIn(orderFiles, db)

    const thanks = calls.find((call) => call.url === ECHO + '/thanks')!
    expect(thanks.json).toEqual({
      email: 'ava@example.com',
      number: 'ORD-1042',
      test: false,
      giftMessage: 'kept',
    })
    const warehouse = calls.find((call) => call.url === ECHO + '/fails')!
    expect(warehouse.json).toEqual({ actor: 'ava@example.com', email: 'ava@example.com' })
    expect(JSON.stringify(calls.map((call) => call.json))).not.toContain(ATTACKER)
  })

  it('refuses an order event whose order is not there: no automation runs, each delivery says why', async () => {
    const db = new FakeDatabase()
    const event = seedOrderPaid(db)
    event.order_id = 'ord-forged'
    event.entity_id = 'ord-forged'
    event.payload = JSON.stringify({ order: { number: 'ORD-9', customer: { email: ATTACKER } } })

    const { result, calls } = await dispatchIn(orderFiles, db)

    expect(calls).toEqual([])
    expect(result).toEqual({ claimed: 1, delivered: 0, failed: 2, resumed: 0 })
    expect(db.deliveries.map((d) => [d.workflow_id, d.status, d.error, d.attempts])).toEqual([
      ['wf-paid-ok', 'failed', 'No such order', 0],
      ['wf-paid-fail', 'failed', 'No such order', 0],
    ])
    // Failed and counted, so a forged row is given up after five tries.
    expect(event).toMatchObject({ status: 'failed', attempts: 1 })
  })

  const seedGreeters = (db: FakeDatabase) => {
    for (const [workflowId, eventType] of [
      ['wf-review', 'review-submitted'],
      ['wf-news', 'newsletter-subscribed'],
      ['wf-wl', 'waitlist-joined'],
      ['wf-form', 'form-submitted'],
    ]) {
      db.automations.push(automationRow(workflowId, eventType))
    }
    db.reviews.push({
      id: 'rev-1',
      product_id: 'p-1',
      rating: 5,
      reviewer_email: 'mia@example.com',
    })
    db.users.push({
      id: 'user-9',
      email: 'zoe@example.com',
      source: 'newsletter',
      marketing_consent: true,
    })
    db.waitlists.push({ id: 'wl-1', kind: 'stock', target_id: 'p-1', target_url: '/products/p-1' })
    db.waitlistEntries.push({
      id: 'we-1',
      waitlist_id: 'wl-1',
      email: 'noor@example.com',
      status: 'confirmed',
      position: 3,
    })
  }

  const forgedPayloads: Record<string, Row> = {
    review: { review: { authorEmail: ATTACKER } },
    subscriber: { subscriber: { email: ATTACKER } },
    waitlist: { waitlist: { entry: { email: ATTACKER } } },
  }

  it('checks every kind of record before an automation runs: a review, a subscriber, a waitlist entry', async () => {
    const real = new FakeDatabase()
    seedGreeters(real)
    real.events.push(
      eventRow({
        id: 'e-rev',
        event_type: 'review-submitted',
        entity_type: 'review',
        entity_id: 'rev-1',
        payload: JSON.stringify(forgedPayloads.review),
        actor: ATTACKER,
      }),
      eventRow({
        id: 'e-news',
        event_type: 'newsletter-subscribed',
        entity_type: 'subscriber',
        entity_id: 'user-9',
        payload: JSON.stringify(forgedPayloads.subscriber),
        actor: ATTACKER,
      }),
      eventRow({
        id: 'e-wl',
        event_type: 'waitlist-joined',
        entity_type: 'waitlist',
        entity_id: 'we-1',
        payload: JSON.stringify(forgedPayloads.waitlist),
        actor: ATTACKER,
      })
    )
    const ran = await dispatchIn(files, real)
    expect(ran.result.delivered).toBe(3)
    const sent = Object.fromEntries(
      ran.calls.map((call) => [call.url.replace(ECHO + '/greet/', ''), call.json])
    )
    expect(sent).toEqual({
      'review-submitted': { email: 'mia@example.com', actor: 'mia@example.com' },
      'newsletter-subscribed': { email: 'zoe@example.com', actor: 'zoe@example.com' },
      'waitlist-joined': { email: 'noor@example.com', actor: 'noor@example.com' },
    })

    // The same events naming records that are not there.
    const forged = new FakeDatabase()
    seedGreeters(forged)
    forged.events.push(
      eventRow({
        id: 'f-rev',
        event_type: 'review-submitted',
        entity_type: 'review',
        entity_id: 'rev-x',
        payload: JSON.stringify(forgedPayloads.review),
        actor: ATTACKER,
      }),
      eventRow({
        id: 'f-news',
        event_type: 'newsletter-subscribed',
        entity_type: 'subscriber',
        entity_id: 'user-x',
        payload: JSON.stringify(forgedPayloads.subscriber),
        actor: ATTACKER,
      }),
      eventRow({
        id: 'f-wl',
        event_type: 'waitlist-joined',
        entity_type: 'waitlist',
        entity_id: 'we-x',
        payload: JSON.stringify(forgedPayloads.waitlist),
        actor: ATTACKER,
      })
    )
    const refused = await dispatchIn(files, forged)
    expect(refused.calls).toEqual([])
    expect(forged.deliveries.map((d) => [d.workflow_id, d.error]).sort()).toEqual([
      ['wf-news', 'No such subscriber'],
      ['wf-review', 'No such review'],
      ['wf-wl', 'No such waitlist entry'],
    ])
    expect(forged.events.map((e) => e.status)).toEqual(['failed', 'failed', 'failed'])
  })

  it('finds a newsletter subscriber by the address when the row names no id', async () => {
    const db = new FakeDatabase()
    seedGreeters(db)
    db.events.push(
      eventRow({
        id: 'e-news',
        event_type: 'newsletter-subscribed',
        entity_type: 'subscriber',
        payload: JSON.stringify({ subscriber: { email: 'ZOE@example.com' } }),
      })
    )
    const { calls } = await dispatchIn(files, db)
    expect(calls.map((call) => call.json)).toEqual([
      { email: 'zoe@example.com', actor: 'zoe@example.com' },
    ])
  })

  it('runs a form submission from what it recorded: a submission has no row of its own', async () => {
    const db = new FakeDatabase()
    seedGreeters(db)
    db.events.push(
      eventRow({
        id: 'e-form',
        event_type: 'form-submitted',
        entity_type: 'form',
        entity_id: 'form-node-1',
        payload: JSON.stringify({
          form: { id: 'form-node-1', name: 'Contact', fields: { email: 'sam@example.com' } },
        }),
        actor: 'sam@example.com',
      })
    )
    const { calls } = await dispatchIn(files, db)
    expect(calls.map((call) => call.json)).toEqual([
      { email: 'sam@example.com', actor: 'sam@example.com' },
    ])
  })

  it('runs a deleted account from the snapshot its deletion recorded, and nothing else', async () => {
    const snapshot = {
      id: 'user-7',
      email: 'liam@example.com',
      name: 'Liam',
      role: 'user',
      source: null,
      createdAt: '2026-01-02T03:04:05.000Z',
    }
    const deleted = (id: string, user: Row) =>
      eventRow({
        id,
        event_type: 'user-deleted',
        dedupe_key: 'user-deleted:' + id,
        entity_type: 'user',
        entity_id: 'user-7',
        payload: JSON.stringify({ user }),
        actor: String(user.email),
        actor_type: 'customer',
      })
    const db = new FakeDatabase()
    db.automations.push(automationRow('wf-bye', 'user-deleted'))
    // The row is gone: the route deleted it before recording the event.
    db.events.push(deleted('evt-bye', snapshot))
    const { result, calls } = await dispatchIn(files, db)
    expect(result.delivered).toBe(1)
    expect(calls.map((call) => call.json)).toEqual([
      { id: 'user-7', email: 'liam@example.com', name: 'Liam', actor: 'liam@example.com' },
    ])

    // A snapshot of another account than the event names is no record.
    const forged = new FakeDatabase()
    forged.automations.push(automationRow('wf-bye', 'user-deleted'))
    forged.events.push(deleted('evt-forged', { ...snapshot, id: 'user-8' }))
    const refused = await dispatchIn(files, forged)
    expect(refused.calls).toEqual([])
    expect(forged.delivery('wf-bye')).toMatchObject({ status: 'failed', error: 'No such user' })

    // Any other account event still needs its row.
    const signup = new FakeDatabase()
    signup.automations.push(automationRow('wf-source', 'user-signed-up'))
    signup.events.push({ ...deleted('evt-signup', snapshot), event_type: 'user-signed-up' })
    expect((await dispatchIn(files, signup)).calls).toEqual([])
    expect(signup.delivery('wf-source')).toMatchObject({ status: 'failed', error: 'No such user' })
  })

  it('keeps what the writer recorded where the record has nothing: the low-stock level, the signup source', async () => {
    const db = new FakeDatabase()
    db.automations.push(
      automationRow('wf-low', 'product-low-stock'),
      automationRow('wf-source', 'user-signed-up')
    )
    db.products.push({ id: 'p-1', name: 'Beeswax Candle', sku: null, quantity: 2 })
    db.users.push({ id: 'user-1', email: 'noah@example.com', name: 'Noah', created_at: ago(1000) })
    db.events.push(
      eventRow({
        id: 'evt-low',
        event_type: 'product-low-stock',
        entity_type: 'product',
        entity_id: 'p-1',
        // As the data API records it.
        payload: JSON.stringify({
          product: { id: 'p-1', name: 'Old name', stock: 3, threshold: 5, sku: 'BWC-01' },
        }),
      }),
      eventRow({
        id: 'evt-joined',
        event_type: 'user-signed-up',
        entity_type: 'user',
        entity_id: 'user-1',
        // As the signup route records it.
        payload: JSON.stringify({
          user: { id: 'user-1', email: 'noah@example.com', source: 'signup' },
        }),
      })
    )
    const { calls } = await dispatchIn(files, db)
    const sent = Object.fromEntries(
      calls.map((call) => [call.url.replace(ECHO + '/', ''), call.json])
    )
    expect(sent).toEqual({
      // The record's name and stock win; its empty sku does not erase the recorded one.
      low: { name: 'Beeswax Candle', stock: 2, threshold: 5, sku: 'BWC-01' },
      source: { source: 'signup' },
    })
  })

  it('ends a parked run whose record is gone instead of resuming it', async () => {
    const db = new FakeDatabase()
    seedSignup(db)
    await dispatchIn(orderFiles, db)
    expect(db.waits).toHaveLength(1)
    db.users = []
    db.waits[0].run_at = ago(1000)
    const { result, calls } = await dispatchIn(orderFiles, db)
    expect(result.resumed).toBe(0)
    expect(calls).toEqual([])
    expect(db.waits[0].status).toBe('failed')
  })
})

describe('in-app event bus — the mail automations send', () => {
  it("files it under the automation and the event's order, so the order's email trail lists it", async () => {
    const files = sources(
      await generate({
        'wf-mail': {
          id: 'wf-mail',
          name: 'Thank by email',
          trigger: trigger('order-paid'),
          nodes: [
            {
              id: 'mail',
              type: 'email-resend',
              config: {
                apiKey: 'k',
                from: 'shop@example.com',
                to: ref('t', ['order', 'customer', 'email']),
                subject: 'Thank you',
                body: '<p>Thank you</p>',
              },
              stepNumber: 1,
              label: 'Thank',
            },
          ],
          edges: [{ id: 'e1', source: 't', target: 'mail' }],
        },
      })
    )
    expect(files.get('utils/email/sent-email-log.js')).toContain(
      'function __attribute(entry, context)'
    )

    const ORDER_ID = '5f0c2b1e-8a3d-4c7b-9e2f-1a2b3c4d5e6f'
    const db = new FakeDatabase()
    seedOrderPaid(db)
    db.automations = [automationRow('wf-mail', 'order-paid')]
    db.orders[0].id = ORDER_ID
    db.orderItems[0].order_id = ORDER_ID
    db.events[0].order_id = ORDER_ID
    db.events[0].entity_id = ORDER_ID

    const result = await withEcho(() =>
      silenced(() => (createApp(files, db)('lib/automations/event-bus.js') as Bus).dispatch({}))
    )

    expect(result.delivered).toBe(1)
    expect(db.mailSent.map((mail) => mail.to)).toEqual([['ava@example.com']])
    expect(db.sentEmails).toHaveLength(1)
    expect(db.sentEmails[0]).toMatchObject({
      recipient_email: 'ava@example.com',
      order_id: ORDER_ID,
      source: 'automation',
      source_ref: 'wf-mail',
      status: 'sent',
    })
  })

  it('leaves the sent-email module untouched in a project without automations', async () => {
    const mailer = (id: string, eventType: string) => ({
      id,
      name: 'Mail',
      trigger: { type: eventType, nodeId: 't', scope: 'page', config: { allPages: true } },
      nodes: [
        {
          id: 'mail',
          type: 'email-resend',
          config: { apiKey: 'k', from: 'a@b.c', to: 'c@d.e', subject: 's', body: 'b' },
          stepNumber: 1,
          label: 'Mail',
        },
      ],
      edges: [{ id: 'e1', source: 't', target: 'mail' }],
    })
    const files = sources(
      await generate({ 'wf-page-mail': mailer('wf-page-mail', 'event-page-loaded') })
    )
    expect(files.get('utils/email/sent-email-log.js')).not.toContain('__attribute')
  })
})

describe('in-app event bus — a run that sent nothing', () => {
  const mail = (id: string, to: unknown, label: string, stepNumber: number, extra: Row = {}) => ({
    id,
    type: 'email-resend',
    config: {
      apiKey: 'k',
      from: 'shop@example.com',
      to,
      subject: 'Order paid',
      body: '<p>Order paid</p>',
      ...extra,
    },
    stepNumber,
    label,
  })
  const gate = (stepNumber: number, left: unknown, rightValue: string) => ({
    id: 'gate',
    type: 'general-if-statement',
    config: { leftValue: left, operator: 'equals', rightValue },
    stepNumber,
    label: 'Check',
  })
  const OWNER = 'owner@shop.test'
  const orderNumber = ref('t', ['order', 'number'])
  const userEmail = ref('t', ['user', 'email'])
  const onPaid = (id: string, nodes: Row[], edges: Row[]) => ({
    id,
    name: id,
    trigger: trigger('order-paid'),
    nodes,
    edges,
  })
  const toGate = { id: 'e1', source: 't', target: 'gate' }
  const whenTrue = { id: 'e2', source: 'gate', target: 'send', sourceHandle: 'true' }
  const guarded = (id: string, rightValue: string) =>
    onPaid(
      id,
      [gate(1, orderNumber, rightValue), mail('send', OWNER, 'Send Email to Owner', 2)],
      [toGate, whenTrue]
    )
  const afterPost = { id: 'e0', source: 't', target: 'hold' }
  const holdToGate = { id: 'e1', source: 'hold', target: 'gate' }
  const parks = {
    id: 'wait',
    type: 'general-wait',
    config: { amount: 1, unit: 'days' },
    label: 'Wait a day',
  }
  const WORKFLOWS: Record<string, Row> = {
    'wf-skipped': guarded('wf-skipped', 'NOT-THIS-ORDER'),
    'wf-sent': guarded('wf-sent', 'ORD-1042'),
    'wf-no-recipient': onPaid(
      'wf-no-recipient',
      [mail('send', ref('t', ['order', 'nobody']), 'Send', 1)],
      [{ id: 'e1', source: 't', target: 'send' }]
    ),
    'wf-failed-and-went-on': onPaid(
      'wf-failed-and-went-on',
      [mail('send', ref('t', ['order', 'nobody']), 'Send', 1, { continueOnError: true })],
      [{ id: 'e1', source: 't', target: 'send' }]
    ),
    'wf-one-of-two': onPaid(
      'wf-one-of-two',
      [
        gate(1, orderNumber, 'NOT-THIS-ORDER'),
        mail('send', OWNER, 'Skipped', 2),
        mail('other', OWNER, 'Sent', 3),
      ],
      [toGate, whenTrue, { id: 'e3', source: 'gate', target: 'other', sourceHandle: 'false' }]
    ),
    'wf-slow-skipped': onPaid(
      'wf-slow-skipped',
      [
        post('hold', '/hold', 1),
        gate(2, orderNumber, 'NOT-THIS-ORDER'),
        mail('send', OWNER, 'Send Email to Owner', 3),
      ],
      [afterPost, holdToGate, whenTrue]
    ),
    'wf-wait-then-skipped': {
      id: 'wf-wait-then-skipped',
      name: 'wf-wait-then-skipped',
      trigger: trigger('user-signed-up'),
      nodes: [
        { ...parks, stepNumber: 1 },
        post('hold', '/hold', 2),
        gate(3, userEmail, 'nobody@example.com'),
        mail('send', OWNER, 'Send Email to Owner', 4),
      ],
      edges: [
        { id: 'e0', source: 't', target: 'wait' },
        { id: 'e1', source: 'wait', target: 'hold' },
        holdToGate,
        whenTrue,
      ],
    },
    'wf-mail-then-wait': {
      id: 'wf-mail-then-wait',
      name: 'wf-mail-then-wait',
      trigger: trigger('user-signed-up'),
      nodes: [
        mail('send', OWNER, 'Welcome', 1),
        { ...parks, stepNumber: 2 },
        post('after', '/after', 3),
      ],
      edges: [
        { id: 'e0', source: 't', target: 'send' },
        { id: 'e1', source: 'send', target: 'wait' },
        { id: 'e2', source: 'wait', target: 'after' },
      ],
    },
  }
  const NOTE = JSON.stringify({ sentNothing: ['Send Email to Owner'] })
  let files: Map<string, string>

  beforeAll(async () => {
    files = sources(await generate(WORKFLOWS))
  })

  const paidOrder = (workflowId: string) => {
    const db = new FakeDatabase()
    seedOrderPaid(db)
    db.automations = [automationRow(workflowId, 'order-paid')]
    return db
  }
  const signup = (workflowId: string) => {
    const db = new FakeDatabase()
    db.users.push({ id: 'user-1', email: 'noah@example.com', name: 'Noah', created_at: ago(1000) })
    db.automations = [automationRow(workflowId, 'user-signed-up')]
    db.events.push(
      eventRow({
        id: 'evt-signup',
        event_type: 'user-signed-up',
        entity_type: 'user',
        entity_id: 'user-1',
        actor: 'noah@example.com',
        actor_type: 'customer',
      })
    )
    return db
  }
  const dispatch = (db: FakeDatabase) =>
    withEcho(() =>
      silenced(() => (createApp(files, db)('lib/automations/event-bus.js') as Bus).dispatch({}))
    )
  /** A dispatch waiting 20 ms for a handler held at its first fetch, released afterwards. */
  const dispatchHeldOpen = async (db: FakeDatabase) => {
    const held: Array<() => void> = []
    const scope = globalThis as Record<string, unknown>
    const previousFetch = scope.fetch
    scope.fetch = () =>
      new Promise((resolve) => {
        held.push(() =>
          resolve({
            ok: true,
            status: 200,
            headers: new Map([['content-type', 'application/json']]),
            json: async () => ({}),
            text: async () => '{}',
          })
        )
      })
    try {
      await withEnv(ENV, () =>
        silenced(async () => {
          await (createApp(files, db)('lib/automations/event-bus.js') as Bus).dispatch({
            handlerTimeoutMs: 20,
          })
          expect(held).toHaveLength(1)
          held[0]()
          await new Promise((resolve) => setTimeout(resolve, 10))
        })
      )
    } finally {
      scope.fetch = previousFetch
    }
  }

  it('records the send steps a condition skipped, and the run stays delivered', async () => {
    const db = paidOrder('wf-skipped')

    const result = await dispatch(db)

    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0, resumed: 0 })
    expect(db.mailSent).toEqual([])
    expect(db.delivery('wf-skipped')).toMatchObject({ status: 'delivered', error: NOTE })
    expect(db.events[0]).toMatchObject({ status: 'delivered', attempts: 1 })
  })

  it('records nothing when a send step sent, or when the automation has none', async () => {
    const sent = paidOrder('wf-sent')
    await dispatch(sent)
    expect(sent.mailSent).toHaveLength(1)
    expect(sent.delivery('wf-sent')).toMatchObject({ status: 'delivered', error: null })

    const oneOfTwo = paidOrder('wf-one-of-two')
    await dispatch(oneOfTwo)
    expect(oneOfTwo.mailSent).toHaveLength(1)
    expect(oneOfTwo.delivery('wf-one-of-two')).toMatchObject({ status: 'delivered', error: null })
  })

  it('counts a send that failed and went on as unsent', async () => {
    const db = paidOrder('wf-failed-and-went-on')
    await dispatch(db)
    expect(db.delivery('wf-failed-and-went-on')).toMatchObject({
      status: 'delivered',
      error: JSON.stringify({ sentNothing: ['Send'] }),
    })
  })

  it('leaves a send that stops the run failing as before, with its own error', async () => {
    const db = paidOrder('wf-no-recipient')
    const result = await dispatch(db)
    expect(result).toEqual({ claimed: 1, delivered: 0, failed: 1, resumed: 0 })
    expect(db.mailSent).toEqual([])
    expect(db.delivery('wf-no-recipient')).toMatchObject({
      status: 'failed',
      error: 'No recipient',
    })
  })

  it('records it for a run that ends after the dispatcher stopped waiting', async () => {
    const db = paidOrder('wf-slow-skipped')
    await dispatchHeldOpen(db)
    expect(db.delivery('wf-slow-skipped')).toMatchObject({ status: 'delivered', error: NOTE })
  })

  it('records it for a run resumed after its Wait', async () => {
    const db = signup('wf-wait-then-skipped')
    await dispatch(db)
    expect(db.delivery('wf-wait-then-skipped')).toMatchObject({ status: 'waiting', error: null })

    db.waits[0].run_at = ago(1000)
    await dispatch(db)

    expect(db.delivery('wf-wait-then-skipped')).toMatchObject({
      status: 'delivered',
      error: NOTE,
    })
  })

  it('records it for a resume that ends after the dispatcher stopped waiting', async () => {
    const db = signup('wf-wait-then-skipped')
    await dispatch(db)
    db.waits[0].run_at = ago(1000)
    await dispatchHeldOpen(db)
    expect(db.delivery('wf-wait-then-skipped')).toMatchObject({
      status: 'delivered',
      error: NOTE,
    })
  })

  it('counts a mail sent before the Wait when the run resumes after it', async () => {
    const db = signup('wf-mail-then-wait')
    await dispatch(db)
    db.waits[0].run_at = ago(1000)
    await dispatch(db)
    expect(db.mailSent).toHaveLength(1)
    expect(db.delivery('wf-mail-then-wait')).toMatchObject({ status: 'delivered', error: null })
  })

  it('records it for a test event, whose row stays a test', async () => {
    const db = paidOrder('wf-skipped')
    db.events = []

    const result = await withEcho(() =>
      silenced(() => {
        const { runTest } = createApp(files, db)('lib/automations/dispatcher.js') as {
          runTest(input: Row, options: Row): Promise<Totals>
        }
        return runTest(
          {
            workflowId: 'wf-skipped',
            event: { order: { number: 'ORD-TEST', customer: { email: 'test@example.com' } } },
          },
          {}
        )
      })
    )

    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0, resumed: 0 })
    expect(db.delivery('wf-skipped')).toMatchObject({ status: 'test', error: NOTE })
  })

  describe('which steps a run can report', () => {
    const sendStepsOf = async (workflow: Row): Promise<Row[]> => {
      const { generateHandlerFunction } = await import('../src/api-route-generator')
      const source = generateHandlerFunction(JSON.parse(JSON.stringify(workflow)))
      return JSON.parse(/var SEND_STEPS = (.*);/.exec(source)![1])
    }
    const sms = {
      id: 'text',
      type: 'sms-twilio',
      config: { to: '+15550142', message: 'Paid' },
      stepNumber: 3,
      label: 'Text the owner',
    }
    const email = mail('send', OWNER, 'Send Email to Owner', 2)
    const steps = [
      { id: 'send', label: 'Send Email to Owner' },
      { id: 'text', label: 'Text the owner' },
    ]

    it('lists the email and SMS steps, and nothing else', async () => {
      expect(await sendStepsOf(onPaid('w', [post('p', '/p', 1), email, sms], []))).toEqual(steps)
      expect(await sendStepsOf(onPaid('w', [post('p', '/p', 1)], []))).toEqual([])
    })

    it('leaves out the steps of the error branch, which a run that ends well never reaches', async () => {
      const onError = mail('alarm', OWNER, 'Tell me it broke', 4)
      const workflow = {
        ...onPaid(
          'w',
          [
            email,
            { id: 'err', type: 'event-workflow-error', config: {}, stepNumber: 3, label: 'Error' },
            onError,
          ],
          [{ id: 'e1', source: 'err', target: 'alarm' }]
        ),
        errorHandler: { nodeId: 'err' },
      }
      expect(await sendStepsOf(workflow)).toEqual([{ id: 'send', label: 'Send Email to Owner' }])
    })

    it('reports nothing when a step it cannot see may have sent', async () => {
      const customNode = {
        id: 'custom',
        type: 'general-custom-node',
        config: {},
        stepNumber: 1,
        label: 'Custom',
      }
      const parallel = (config: Row) => ({
        id: 'both',
        type: 'general-parallel',
        config,
        stepNumber: 1,
        label: 'Both',
      })
      expect(await sendStepsOf(onPaid('w', [customNode, email], []))).toEqual([])
      expect(await sendStepsOf(onPaid('w', [parallel({ waitForAll: false }), email], []))).toEqual(
        []
      )
      expect(await sendStepsOf(onPaid('w', [parallel({ waitForAll: true }), email], []))).toEqual([
        { id: 'send', label: 'Send Email to Owner' },
      ])
      expect(await sendStepsOf(onPaid('w', [parallel({}), email], []))).toEqual([
        { id: 'send', label: 'Send Email to Owner' },
      ])
    })
  })
})

describe('in-app event bus — emitting and the dispatch route', () => {
  let files: Map<string, string>

  beforeAll(async () => {
    files = sources(await generate({ ...BASE_WORKFLOWS, ...AUTOMATIONS }))
  })

  const signup = {
    type: 'user-signed-up',
    entityType: 'user',
    entityId: 'user-1',
    payload: { source: 'signup' },
    actor: 'noah@example.com',
    actorType: 'customer',
    dedupeKey: 'user-signed-up:user-1',
  }

  it('records an event once per dedupe key and kicks the dispatch route off the request path', async () => {
    const db = new FakeDatabase()
    const app = createApp(files, db)
    const emitted = await withEnv(ENV, () =>
      withFetch(
        () => ({ status: 200, body: {} }),
        async (calls) => {
          const busModule = app('lib/automations/event-bus.js') as Bus
          // The origin comes from the request being served, never from the caller.
          const req = { headers: { host: 'shop.test', 'x-forwarded-proto': 'https' } }
          const first = await busModule.emitBusinessEvent(
            { ...signup, baseUrl: 'https://evil.test' },
            req
          )
          const again = await busModule.emitBusinessEvent(signup, req)
          return { first, again, calls }
        }
      )
    )

    expect(emitted.first.recorded).toBe(true)
    expect(emitted.again.recorded).toBe(false)
    expect(db.events).toHaveLength(1)
    const insert = db.statements.find((text) => text.startsWith('INSERT INTO teleport_events'))!
    expect(insert).toContain('ON CONFLICT (dedupe_key) DO NOTHING RETURNING id')
    // One kick, for the row that was inserted.
    expect(emitted.calls).toHaveLength(1)
    expect(emitted.calls[0].url).toBe('https://shop.test/api/automations/dispatch')
    expect(emitted.calls[0].method).toBe('POST')
    expect(emitted.calls[0].headers['x-internal-data-secret']).toBe('app-secret')
  })

  const scheduleWith = async (env: Row) => {
    const db = new FakeDatabase()
    const scope = globalThis as Record<string, unknown>
    const held: Array<Promise<unknown>> = []
    scope.__tqWaitUntil = (promise: Promise<unknown>) => {
      held.push(promise)
    }
    try {
      return await withEnv({ ...ENV, ...env } as Record<string, string | undefined>, () =>
        withFetch(
          () => ({ status: 200, body: {} }),
          async (calls) => {
            const busModule = createApp(files, db)('lib/automations/event-bus.js') as Bus
            const mode = busModule.scheduleDispatch()
            await Promise.all(held)
            return { mode, calls, held, db }
          }
        )
      )
    } finally {
      delete scope.__tqWaitUntil
    }
  }

  it("dispatches in Vercel's waitUntil there, and calls its own route everywhere else", async () => {
    const onVercel = await scheduleWith({ VERCEL: '1' })
    expect(onVercel.mode).toBe('wait-until')
    expect(onVercel.held).toHaveLength(1)
    expect(onVercel.calls).toEqual([])
    expect(onVercel.db.claimStatement()).toContain('SKIP LOCKED')

    // A waitUntil that is not the host's keeps nothing alive.
    const elsewhere = await scheduleWith({})
    expect(elsewhere.mode).toBe('fetch')
    expect(elsewhere.held).toEqual([])
    expect(elsewhere.calls.map((call) => call.url)).toEqual([
      'https://shop.test/api/automations/dispatch',
    ])
  })

  // Signed as the services-worker signs a test (the cron scheme, task 10a R3):
  // HMAC over v1:<ts>:<project>:<cron>:<execution>:<path>[:<body sha256>].
  const CRON_KEY = 'c'.repeat(64)
  // Every request the worker signs names an execution of its own.
  let executions = 0
  const signedHeaders = (
    rawBody: string,
    withDigest: boolean,
    executionId = `exec-${++executions}`
  ): Record<string, string> => {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const digest = createHash('sha256').update(rawBody).digest('hex')
    const signed = [
      'v1',
      timestamp,
      'project-1',
      'automations-test',
      executionId,
      '/api/automations/dispatch',
      ...(withDigest ? [digest] : []),
    ].join(':')
    return {
      'x-teleport-cron-id': 'automations-test',
      'x-teleport-project-id': 'project-1',
      'x-teleport-cron-execution-id': executionId,
      'x-teleport-cron-timestamp': timestamp,
      ...(withDigest ? { 'x-teleport-body-sha256': digest } : {}),
      'x-teleport-cron-signature':
        'v1=' + createHmac('sha256', CRON_KEY).update(signed).digest('hex'),
    }
  }

  type Caller = 'app' | 'wrong-secret' | 'signed' | 'signed-without-digest' | 'tampered'

  const callRoute = async (db: FakeDatabase, caller: Caller, body: unknown) => {
    const rawBody = JSON.stringify(body)
    const headers: Record<string, string> =
      caller === 'app'
        ? { 'x-internal-data-secret': 'app-secret' }
        : caller === 'wrong-secret'
        ? { 'x-internal-data-secret': 'wrong' }
        : signedHeaders(rawBody, caller !== 'signed-without-digest')
    // What arrives differs from what was signed.
    const sent = caller === 'tampered' ? rawBody.replace('wf-paid-ok', 'wf-paid-fail') : rawBody
    const reply = { status: 0, body: null as unknown }
    const res = {
      setHeader: () => undefined,
      status(code: number) {
        reply.status = code
        return {
          json(payload: unknown) {
            reply.body = payload
          },
        }
      },
    }
    // The route reads its body raw (bodyParser: false): a Buffer, as Next hands it.
    const req = {
      method: 'POST',
      url: '/api/automations/dispatch',
      headers: {
        host: 'shop.test',
        'x-forwarded-proto': 'https',
        'content-type': 'application/json',
        ...headers,
      },
      body: Buffer.from(sent),
    }
    const calls = await withEcho(
      async (recorded) => {
        const handler = createApp(files, db)('pages/api/automations/dispatch.js') as RouteHandler
        await silenced(() => handler(req, res))
        return recorded
      },
      { TELEPORT_CRON_SECRET: CRON_KEY }
    )
    return { reply, calls }
  }

  it("presents the deployment's protection bypass on its own calls when one is set", async () => {
    const walled = await scheduleWith({ VERCEL_AUTOMATION_BYPASS_SECRET: 'bypass-1' })
    expect(walled.calls).toHaveLength(1)
    expect(walled.calls[0].headers['x-vercel-protection-bypass']).toBe('bypass-1')
    expect(walled.calls[0].headers['x-vercel-set-bypass-cookie']).toBe('false')
    expect(walled.calls[0].headers['x-internal-data-secret']).toBe('app-secret')

    const open = await scheduleWith({ VERCEL_AUTOMATION_BYPASS_SECRET: undefined })
    expect(open.calls).toHaveLength(1)
    expect(open.calls[0].headers).not.toHaveProperty('x-vercel-protection-bypass')
  })

  // A request sent exactly as it was captured: the same headers, the same body.
  const resend = async (
    db: FakeDatabase,
    headers: Record<string, string>,
    rawBody: string,
    logging: typeof silenced = silenced
  ) => {
    const reply = { status: 0, body: null as unknown }
    const res = {
      setHeader: () => undefined,
      status(code: number) {
        reply.status = code
        return {
          json(payload: unknown) {
            reply.body = payload
          },
        }
      },
    }
    const req = {
      method: 'POST',
      url: '/api/automations/dispatch',
      headers: {
        host: 'shop.test',
        'x-forwarded-proto': 'https',
        'content-type': 'application/json',
        ...headers,
      },
      body: Buffer.from(rawBody),
    }
    const calls = await withEcho(
      async (recorded) => {
        const handler = createApp(files, db)('pages/api/automations/dispatch.js') as RouteHandler
        await logging(() => handler(req, res))
        return recorded
      },
      { TELEPORT_CRON_SECRET: CRON_KEY }
    )
    return { reply, calls }
  }

  it('takes a signed request once: the same request again is refused before anything runs', async () => {
    const db = new FakeDatabase()
    seedOrderPaid(db)
    db.events = []
    const rawBody = JSON.stringify({ test: true, workflowId: 'wf-paid-ok', event: ORDER_EXAMPLE })
    const captured = signedHeaders(rawBody, true)

    const first = await resend(db, captured, rawBody)
    expect(first.reply.status).toBe(200)
    expect(db.deliveries.map((d) => d.workflow_id)).toEqual(['wf-paid-ok'])

    const again = await resend(db, captured, rawBody)
    expect(again.reply).toEqual({
      status: 409,
      body: { error: 'This request was already received' },
    })
    expect(again.calls).toEqual([])
    expect(db.events).toHaveLength(1)
    expect(db.deliveries).toHaveLength(1)
    // Kept as a digest: nothing the request sent is stored as it was sent.
    expect(Array.from(db.signedRequests.keys())).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/)])

    // A signed run of the queue is taken once too.
    const kick = signedHeaders('{}', false)
    expect((await resend(db, kick, '{}')).reply.status).toBe(200)
    expect((await resend(db, kick, '{}')).reply.status).toBe(409)
    // The app's own calls name no execution: never remembered, never refused.
    for (let i = 0; i < 2; i++) {
      expect((await callRoute(db, 'app', {})).reply.status).toBe(200)
    }
    expect(db.signedRequests.size).toBe(2)
  })

  it('remembers a signed request while its signature can verify, and refuses one it cannot check', async () => {
    const db = new FakeDatabase()
    const nowSeconds = Math.floor(Date.now() / 1000)
    db.signedRequests.set('over', nowSeconds - 1)
    expect((await resend(db, signedHeaders('{}', false), '{}')).reply.status).toBe(200)
    expect(db.signedRequests.has('over')).toBe(false)
    const [expiresAt] = Array.from(db.signedRequests.values())
    // The signature accepts a timestamp up to 300 s off either way.
    expect(expiresAt - nowSeconds).toBeGreaterThanOrEqual(600)

    const down = new FakeDatabase()
    seedOrderPaid(down)
    down.signedRequestsDown = true
    const refused = await resend(down, signedHeaders('{}', false), '{}')
    expect(refused.reply).toEqual({
      status: 503,
      body: { error: 'The request could not be checked. Try again.' },
    })
    expect(refused.calls).toEqual([])
    expect(down.deliveries).toEqual([])
  })

  const asksToCreate = (db: FakeDatabase) =>
    db.statements.filter((statement) => /\bCREATE\b|pg_advisory_xact_lock/.test(statement))

  it('takes a signed request in the table the editor made, never asking to create it', async () => {
    const db = new FakeDatabase()
    seedOrderPaid(db)

    const { reply } = await resend(db, signedHeaders('{}', false), '{}')

    expect(reply.status).toBe(200)
    expect(db.signedRequests.size).toBe(1)
    expect(asksToCreate(db)).toEqual([])
  })

  it('creates the table only when it is really missing, then takes the request in it', async () => {
    const db = new FakeDatabase()
    seedOrderPaid(db)
    db.signedRequestsMissing = true
    db.mayCreateTables = true
    const headers = signedHeaders('{}', false)

    expect((await resend(db, headers, '{}')).reply.status).toBe(200)
    expect(asksToCreate(db)).toEqual([
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'CREATE TABLE IF NOT EXISTS teleport_automation_requests (request_key TEXT PRIMARY KEY, expires_at BIGINT NOT NULL)',
      'CREATE INDEX IF NOT EXISTS teleport_automation_requests_expires_at ON teleport_automation_requests (expires_at)',
    ])
    expect(db.signedRequests.size).toBe(1)

    // Replays are still refused, and the table is not asked for again.
    db.statements.length = 0
    expect((await resend(db, headers, '{}')).reply.status).toBe(409)
    expect(asksToCreate(db)).toEqual([])
  })

  it('refuses a request when its table is missing and cannot be made, naming the table in the log', async () => {
    const db = new FakeDatabase()
    seedOrderPaid(db)
    db.signedRequestsMissing = true
    const logged: unknown[][] = []
    const capturingErrors = async <T>(run: () => Promise<T>): Promise<T> => {
      const sink = jest.spyOn(console, 'error').mockImplementation((...args) => {
        logged.push(args)
      })
      try {
        return await run()
      } finally {
        sink.mockRestore()
      }
    }

    const { reply } = await resend(db, signedHeaders('{}', false), '{}', capturingErrors)

    expect(reply).toEqual({
      status: 503,
      body: { error: 'The request could not be checked. Try again.' },
    })
    expect(db.deliveries).toEqual([])
    expect(db.signedRequests.size).toBe(0)
    expect(db.statements).toContain('ROLLBACK')
    const said = logged.map((args) => args.map(String).join(' ')).join('\n')
    expect(said).toContain('teleport_automation_requests')
    expect(said).toContain('permission denied for schema public')
  })

  it('refuses a caller without the app secret or a cron signature', async () => {
    const db = new FakeDatabase()
    seedOrderPaid(db)
    const { reply, calls } = await callRoute(db, 'wrong-secret', {})
    expect(reply).toEqual({ status: 401, body: { error: 'Unauthorized' } })
    expect(calls).toEqual([])
    expect(db.statements).toEqual([])
  })

  // A request as Node hands it to the route: a stream, read only when listened to.
  const streamed = (headers: Record<string, string>, chunks: Buffer[]) => {
    const read = { started: false }
    const req = {
      method: 'POST',
      url: '/api/automations/dispatch',
      headers: { host: 'shop.test', ...headers },
      on(name: string, listener: (value?: unknown) => void) {
        read.started = true
        if (name === 'data') {
          setImmediate(() => chunks.forEach((chunk) => listener(chunk)))
        }
        if (name === 'end') {
          setImmediate(() => setImmediate(() => listener()))
        }
        return req
      },
    }
    return { req, read }
  }

  const answer = async (db: FakeDatabase, req: unknown, env: Row = {}) => {
    const reply = { status: 0, body: null as unknown }
    const res = {
      setHeader: () => undefined,
      status(code: number) {
        reply.status = code
        return {
          json(payload: unknown) {
            reply.body = payload
          },
        }
      },
    }
    await withEcho(async () => {
      const handler = createApp(files, db)('pages/api/automations/dispatch.js') as RouteHandler
      await silenced(() => handler(req, res))
    }, env)
    return reply
  }

  it('refuses a caller that presents no credentials before reading anything it sent', async () => {
    const db = new FakeDatabase()
    seedOrderPaid(db)
    const { req, read } = streamed({}, [Buffer.from('{}')])
    expect(await answer(db, req)).toEqual({ status: 401, body: { error: 'Unauthorized' } })
    expect(read.started).toBe(false)
    expect(db.statements).toEqual([])

    // A local run that allows unsigned calls still runs.
    const local = streamed({}, [Buffer.from('{}')])
    const ran = await answer(db, local.req, { TELEPORT_CRON_ALLOW_UNSIGNED: 'true' })
    expect(ran.status).toBe(200)
  })

  it('refuses a body larger than 64 KB, without reading past it', async () => {
    const app = { 'x-internal-data-secret': 'app-secret' }
    const db = new FakeDatabase()
    seedOrderPaid(db)
    const tooLarge = { status: 413, body: { error: 'The request body is too large' } }

    // Announced: refused before a byte is read.
    const announced = streamed({ ...app, 'content-length': String(70 * 1024) }, [])
    expect(await answer(db, announced.req)).toEqual(tooLarge)
    expect(announced.read.started).toBe(false)

    // Streamed in pieces.
    const pieces = streamed(app, [Buffer.alloc(40 * 1024, 32), Buffer.alloc(40 * 1024, 32)])
    expect(await answer(db, pieces.req)).toEqual(tooLarge)

    // Handed over whole.
    const whole = { ...streamed(app, []).req, body: Buffer.alloc(65 * 1024, 32) }
    expect(await answer(db, whole)).toEqual(tooLarge)
    expect(db.statements).toEqual([])

    // 64 KB is still a body.
    const fits = { ...streamed(app, []).req, body: Buffer.alloc(64 * 1024, 32) }
    expect((await answer(db, fits)).status).toBe(200)
  })

  it("calls the app's own routes on its own address, never on a host a caller picked", async () => {
    const store = createApp(files, new FakeDatabase())('lib/automations/store.js') as {
      appBaseUrl(req?: Row): string
    }
    const from = (host: string) => ({ headers: { host } })
    const scope = globalThis as Row
    // Every generation writes NEXTAUTH_URL=http://localhost:3000, and the
    // deploy keeps it: that is no address.
    const GENERATED = 'http://localhost:3000'
    const VERCEL = { VERCEL: '1', VERCEL_URL: 'shop-abc123.vercel.app' }
    // [env, request, the auth route's snapshot of NEXTAUTH_URL, origin]
    const cases: Array<[Row, Row | undefined, string | undefined, string]> = [
      // On Vercel: the origin the request reached.
      [{ ...VERCEL, NEXTAUTH_URL: GENERATED }, from('shop.com'), undefined, 'https://shop.com'],
      [VERCEL, from('shop.com'), undefined, 'https://shop.com'],
      // No request (a page render, a handler): the production domain, else the deployment.
      [
        { ...VERCEL, NEXTAUTH_URL: GENERATED, VERCEL_PROJECT_PRODUCTION_URL: 'shop.com' },
        undefined,
        undefined,
        'https://shop.com',
      ],
      [
        { ...VERCEL, NEXTAUTH_URL: GENERATED },
        { headers: {} },
        undefined,
        'https://shop-abc123.vercel.app',
      ],
      // A real NEXTAUTH_URL wins over any header, on Vercel or not.
      [
        { ...VERCEL, NEXTAUTH_URL: 'https://shop.test' },
        from('evil.test'),
        undefined,
        'https://shop.test',
      ],
      [{ NEXTAUTH_URL: 'https://shop.test' }, from('evil.test'), undefined, 'https://shop.test'],
      [
        { NEXTAUTH_URL: 'https://shop.test' },
        from('localhost:4000'),
        undefined,
        'https://shop.test',
      ],
      // Anywhere else a public Host is the caller's word: never used.
      [{}, from('shop.com'), undefined, 'http://localhost:3000'],
      [{ PORT: '8080' }, from('shop.com'), undefined, 'http://localhost:8080'],
      [
        { NEXTAUTH_URL: 'teleporthq.secrets.NEXTAUTH_URL' },
        from('shop.com'),
        undefined,
        'http://localhost:3000',
      ],
      [{}, undefined, undefined, 'http://localhost:3000'],
      // The auth route rewrote NEXTAUTH_URL from X-Forwarded-Host: its snapshot is read.
      [
        { NEXTAUTH_URL: 'https://evil.example' },
        from('shop.com'),
        GENERATED,
        'http://localhost:3000',
      ],
      [{ NEXTAUTH_URL: 'https://evil.example' }, from('shop.com'), '', 'http://localhost:3000'],
      [
        { NEXTAUTH_URL: 'https://evil.example' },
        from('evil.example'),
        'https://shop.test',
        'https://shop.test',
      ],
      // A local server keeps its own loopback address.
      [{}, from('localhost:4000'), undefined, 'http://localhost:4000'],
      [{ NEXTAUTH_URL: GENERATED }, from('127.0.0.1:4000'), undefined, 'http://127.0.0.1:4000'],
    ]
    for (const [env, req, snapshot, expected] of cases) {
      delete scope.__tqConfiguredNextAuthUrl
      if (snapshot !== undefined) {
        scope.__tqConfiguredNextAuthUrl = snapshot
      }
      const origin = await withEnv(
        {
          NEXTAUTH_URL: undefined,
          VERCEL_URL: undefined,
          VERCEL_PROJECT_PRODUCTION_URL: undefined,
          VERCEL: undefined,
          PORT: undefined,
          ...env,
        } as Record<string, string | undefined>,
        async () => store.appBaseUrl(req)
      )
      const host = req && (req.headers as Row).host
      expect({ env, host, snapshot, origin }).toEqual({ env, host, snapshot, origin: expected })
    }

    // Read first by the bus, the configured value is kept the way the auth
    // route keeps it: a later rewrite of process.env changes nothing.
    delete scope.__tqConfiguredNextAuthUrl
    const kept = await withEnv(
      { NEXTAUTH_URL: 'https://shop.test', VERCEL: undefined },
      async () => {
        const first = store.appBaseUrl(from('shop.com'))
        process.env.NEXTAUTH_URL = 'https://evil.example'
        return [first, store.appBaseUrl(from('evil.example'))]
      }
    )
    expect(kept).toEqual(['https://shop.test', 'https://shop.test'])
  })

  it('never posts the app secret to a host the auth route took from a request', async () => {
    const scope = globalThis as Row
    // What /api/auth leaves behind off Vercel: the configured value kept, the
    // live one rewritten from X-Forwarded-Host.
    scope.__tqConfiguredNextAuthUrl = 'http://localhost:3000'
    const db = new FakeDatabase()
    const calls = await withEnv({ ...ENV, NEXTAUTH_URL: 'https://evil.example' }, () =>
      withFetch(
        () => ({ status: 200, body: {} }),
        async (recorded) => {
          const busModule = createApp(files, db)('lib/automations/event-bus.js') as Bus
          await busModule.emitBusinessEvent(signup, {
            headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' },
          })
          return recorded
        }
      )
    )
    expect(calls.map((call) => [call.url, call.headers['x-internal-data-secret']])).toEqual([
      ['http://localhost:3000/api/automations/dispatch', 'app-secret'],
    ])
  })

  it('runs the queue for the app itself, and for a signed request without a body digest', async () => {
    const db = new FakeDatabase()
    seedOrderPaid(db)
    const { reply } = await callRoute(db, 'app', {})
    expect(reply).toEqual({
      status: 200,
      body: { claimed: 1, delivered: 1, failed: 1, resumed: 0 },
    })
    // A plain scheduled kick keeps today's signed string.
    const kicked = new FakeDatabase()
    seedOrderPaid(kicked)
    expect((await callRoute(kicked, 'signed-without-digest', {})).reply.status).toBe(200)
  })

  const ORDER_EXAMPLE = {
    event: { id: 'placeholder', type: 'order-paid', version: 1, occurredAt: '', test: true },
    actor: { type: 'system', email: null },
    order: { id: 'ord-x', number: 'ORD-TEST', customer: { email: 'test@example.com' } },
    extra: { not: 'a block of order-paid' },
  }

  it('runs a test of ONE automation once, with the catalog blocks only, and never queues it', async () => {
    const db = new FakeDatabase()
    seedOrderPaid(db)
    db.events = []
    // Switched off: a test still runs it.
    db.automations.find((a) => a.workflow_id === 'wf-paid-ok')!.enabled = false

    const { reply, calls } = await callRoute(db, 'signed', {
      test: true,
      workflowId: 'wf-paid-ok',
      event: ORDER_EXAMPLE,
    })

    expect(reply).toEqual({
      status: 200,
      body: { claimed: 1, delivered: 1, failed: 0, resumed: 0 },
    })
    expect(calls.map((call) => [call.url, call.json])).toEqual([
      [ECHO + '/thanks', { email: 'test@example.com', number: 'ORD-TEST', test: true }],
    ])
    expect(db.events).toHaveLength(1)
    expect(db.events[0].status).toBe('test')
    expect(db.events[0].id).not.toBe('placeholder')
    expect(db.deliveries.map((d) => [d.workflow_id, d.status, d.error])).toEqual([
      ['wf-paid-ok', 'test', null],
    ])

    // Nothing is left to claim.
    const again = await withEcho(() =>
      silenced(() => (createApp(files, db)('lib/automations/event-bus.js') as Bus).dispatch({}))
    )
    expect(again.claimed).toBe(0)
  })

  it('takes a test only from a request whose signature covers its body', async () => {
    const body = { test: true, workflowId: 'wf-paid-ok', event: ORDER_EXAMPLE }

    // Changed on the way: the signature no longer holds.
    const tampered = new FakeDatabase()
    seedOrderPaid(tampered)
    const refused = await callRoute(tampered, 'tampered', body)
    expect(refused.reply).toEqual({ status: 401, body: { error: 'Unauthorized' } })
    expect(refused.calls).toEqual([])
    expect(tampered.statements).toEqual([])

    // Authenticated, but nothing vouches for the body.
    for (const caller of ['app', 'signed-without-digest'] as const) {
      const unsignedDb = new FakeDatabase()
      seedOrderPaid(unsignedDb)
      const unsigned = await callRoute(unsignedDb, caller, body)
      expect(unsigned.reply).toEqual({ status: 400, body: { error: 'Unsigned body' } })
      expect(unsigned.calls).toEqual([])
    }

    // The body as signed: it runs.
    const db = new FakeDatabase()
    seedOrderPaid(db)
    const ran = await callRoute(db, 'signed', body)
    expect(ran.reply.status).toBe(200)
    expect(ran.calls.map((call) => call.url)).toEqual([ECHO + '/thanks'])
  })

  it('names what a test body lacks, so a sender without workflowId cannot fail silently', async () => {
    const db = new FakeDatabase()
    seedOrderPaid(db)
    const { reply, calls } = await callRoute(db, 'signed', { test: true, event: ORDER_EXAMPLE })
    expect(reply).toEqual({
      status: 400,
      body: { error: 'A test names the automation to run: workflowId is missing' },
    })
    expect(calls).toEqual([])
    const noEvent = await callRoute(db, 'signed', { test: true, workflowId: 'wf-paid-ok' })
    expect(noEvent.reply).toEqual({
      status: 400,
      body: { error: 'A test carries the event to send: event is missing' },
    })
  })

  it('stops a test at a Wait and reports how long it would have waited, parking nothing', async () => {
    const db = new FakeDatabase()
    seedSignup(db)
    db.events = []
    const { reply, calls } = await callRoute(db, 'signed', {
      test: true,
      workflowId: 'wf-signup-wait',
      event: {
        event: { id: 'x', type: 'user-signed-up', version: 1, occurredAt: '', test: true },
        actor: { type: 'customer', email: 'test@example.com' },
        user: { id: 'u-x', email: 'test@example.com' },
      },
    })
    expect(reply).toEqual({
      status: 200,
      body: {
        claimed: 1,
        delivered: 1,
        failed: 0,
        resumed: 0,
        wouldWait: { amount: 2, unit: 'days' },
      },
    })
    expect(calls.map((call) => call.url)).toEqual([ECHO + '/before'])
    expect(db.waits).toEqual([])
    expect(JSON.parse(db.deliveries[0].error!)).toEqual({ wouldWait: { amount: 2, unit: 'days' } })
  })

  it('refuses a test of an automation the site does not have, or of another event', async () => {
    const db = new FakeDatabase()
    const unknown = await callRoute(db, 'signed', {
      test: true,
      workflowId: 'wf-nope',
      event: ORDER_EXAMPLE,
    })
    expect(unknown.reply.status).toBe(404)
    const other = await callRoute(db, 'signed', {
      test: true,
      workflowId: 'wf-signup-wait',
      event: ORDER_EXAMPLE,
    })
    expect(other.reply.status).toBe(400)
    expect(db.events).toEqual([])
  })
})

describe('in-app event bus — Slack messages', () => {
  // A Slack message is mrkdwn: `<…>` there is a link or a mention. What a
  // customer typed reaches it as a value of the event.
  const chip = (path: string[], label: string) =>
    `<span class="context-value-inline" data-ctx-node-id="t" data-ctx-path='${JSON.stringify([
      't',
      ...path,
    ])}' data-ctx-label="${label}" contenteditable="false" draggable="false">${label}</span>`
  const slackStep = (id: string, text: unknown, stepNumber: number) => ({
    id,
    type: 'integration-slack',
    config: { action: 'send-message', token: 'xoxb-test', channel: 'C1', text },
    stepNumber,
    label: 'Post to Slack',
  })
  const SLACK_AUTOMATION: Record<string, Row> = {
    'wf-slack': {
      id: 'wf-slack',
      name: 'Tell me on Slack',
      trigger: trigger('order-paid'),
      nodes: [
        // As the recipe writes it: the owner's own words and link, the values as chips.
        slackStep(
          'chips',
          `New order from ${chip(['order', 'customer', 'name'], 'Customer name')}: ${chip(
            ['order', 'notes'],
            'Order notes'
          )} <https://shop.test/admin|Open the admin>`,
          1
        ),
        // The whole message bound to one value.
        slackStep('whole', ref('t', ['order', 'notes']), 2),
      ],
      edges: [
        { id: 'e1', source: 't', target: 'chips' },
        { id: 'e2', source: 'chips', target: 'whole' },
      ],
    },
  }

  it('escapes every event value it posts, and keeps the owner’s own links', async () => {
    const files = sources(await generate({ ...BASE_WORKFLOWS, ...SLACK_AUTOMATION }))
    const db = new FakeDatabase()
    const posted = await withEnv(ENV, () =>
      withFetch(
        () => ({ status: 200, body: { ok: true, ts: '1.0' } }),
        async (calls) => {
          const registry = createApp(files, db)('lib/automations/registry.js') as Record<
            string,
            Array<{ workflowId: string; run: (event: Row, context: Row) => Promise<unknown> }>
          >
          const entry = registry['order-paid'].find((e) => e.workflowId === 'wf-slack')!
          await silenced(() =>
            entry.run(
              {
                event: { id: 'evt-1', type: 'order-paid', version: 1, occurredAt: '' },
                actor: { type: 'customer', email: 'ava@example.com' },
                order: {
                  id: 'ord-1',
                  customer: { name: `Ava "O'Brien" <!channel>`, email: 'ava@example.com' },
                  notes: '<https://evil.test|Claim your refund> & more',
                },
              },
              { __baseUrl: 'https://shop.test' }
            )
          )
          return calls
            .filter((call) => call.url === 'https://slack.com/api/chat.postMessage')
            .map((call) => call.json.text)
        }
      )
    )

    expect(posted).toEqual([
      `New order from Ava "O'Brien" &lt;!channel&gt;: &lt;https://evil.test|Claim your refund&gt; &amp; more <https://shop.test/admin|Open the admin>`,
      '&lt;https://evil.test|Claim your refund&gt; &amp; more',
    ])
  })

  it('leaves the handler of an automation without a bound Slack message as it was', async () => {
    const { generateAutomationHandlerModule } = await import(
      '../src/automations/handler-module-generator'
    )
    const { generateHandlerFunction } = await import('../src/api-route-generator')
    const workflow = JSON.parse(JSON.stringify(AUTOMATIONS['wf-paid-ok']))
    expect(generateAutomationHandlerModule(workflow)).toBe(generateHandlerFunction(workflow))
    const chipsOnly = JSON.parse(JSON.stringify(SLACK_AUTOMATION['wf-slack']))
    chipsOnly.nodes = chipsOnly.nodes.slice(0, 1)
    expect(generateAutomationHandlerModule(chipsOnly)).toBe(generateHandlerFunction(chipsOnly))
  })
})

describe('in-app event bus — the activity kick', () => {
  let files: Map<string, string>

  beforeAll(async () => {
    files = sources(
      await generate({ ...BASE_WORKFLOWS, ...AUTOMATIONS }, TELEPORT_AUTOMATIONS, {
        files: FETCHERS,
      })
    )
  })

  interface DueCheck {
    kickWhenDue(req?: Row): Promise<boolean> | null
  }

  const seedDueWait = (db: FakeDatabase) => {
    seedSignup(db)
    db.waits.push({
      id: 900,
      event_id: 'evt-signup',
      workflow_id: 'wf-signup-wait',
      resume_node_id: 'after',
      context: JSON.stringify({ wait: { until: ago(MINUTE_MS).toISOString() } }),
      run_at: ago(MINUTE_MS),
      status: 'waiting',
      created_at: ago(DAY_MS),
    })
  }

  const DISPATCH = 'https://shop.test/api/automations/dispatch'

  it('checks for due work at most once a minute per process, and wakes the queue only for some', async () => {
    const db = new FakeDatabase()
    seedDueWait(db)
    let now = Date.now()
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const run = await withEnv(ENV, () =>
        withFetch(
          () => ({ status: 200, body: {} }),
          async (calls) => {
            const check = createApp(files, db)('lib/automations/due-check.js') as DueCheck
            const req = { headers: { host: 'shop.test' } }
            const first = await check.kickWhenDue(req)
            const afterFirst = calls.length
            // Within the minute: no query, no kick.
            const statements = db.statements.length
            const second = check.kickWhenDue(req)
            const quiet = db.statements.length === statements
            now += 61 * 1000
            const third = await check.kickWhenDue(req)
            return { first, afterFirst, second, quiet, third, calls }
          }
        )
      )
      expect(run.first).toBe(true)
      expect(run.afterFirst).toBe(1)
      expect(run.second).toBeNull()
      expect(run.quiet).toBe(true)
      expect(run.third).toBe(true)
      expect(run.calls.map((call) => [call.url, call.headers['x-internal-data-secret']])).toEqual([
        [DISPATCH, 'app-secret'],
        [DISPATCH, 'app-secret'],
      ])
    } finally {
      clock.mockRestore()
    }
  })

  it('wakes nothing when nothing is due, and never runs while the site is being built', async () => {
    const idle = new FakeDatabase()
    seedSignup(idle)
    idle.events[0].status = 'delivered'
    const quiet = await withEnv(ENV, () =>
      withFetch(
        () => ({ status: 200, body: {} }),
        async (calls) => {
          const check = createApp(files, idle)('lib/automations/due-check.js') as DueCheck
          return { kicked: await check.kickWhenDue(), calls }
        }
      )
    )
    expect(quiet.kicked).toBe(false)
    expect(quiet.calls).toEqual([])
    const due = idle.statements.find((text) => text.startsWith('SELECT (EXISTS'))!
    expect(due).toContain("w.status = 'waiting' AND w.run_at <= now()")
    expect(due).toContain("(e.status = 'failed' OR (e.status = 'pending' AND (GREATEST(")

    // A retry due counts as much as a Wait.
    const failed = new FakeDatabase()
    seedSignup(failed)
    failed.events[0].status = 'failed'
    failed.events[0].attempts = 1
    const retry = await withEnv(ENV, () =>
      withFetch(
        () => ({ status: 200, body: {} }),
        async (calls) => ({
          kicked: await (
            createApp(files, failed)('lib/automations/due-check.js') as DueCheck
          ).kickWhenDue(),
          calls,
        })
      )
    )
    expect(retry.kicked).toBe(true)
    expect(retry.calls.map((call) => call.url)).toEqual([DISPATCH])

    const building = new FakeDatabase()
    seedDueWait(building)
    const built = await withEnv({ ...ENV, NEXT_PHASE: 'phase-production-build' }, () =>
      withFetch(
        () => ({ status: 200, body: {} }),
        async () =>
          (createApp(files, building)('lib/automations/due-check.js') as DueCheck).kickWhenDue()
      )
    )
    expect(built).toBeNull()
    expect(building.statements).toEqual([])
  })

  it('wakes the queue for what a stopped dispatcher left: a stale pending event, a stale resume', async () => {
    const kicked = async (database: FakeDatabase) =>
      withEnv(ENV, () =>
        withFetch(
          () => ({ status: 200, body: {} }),
          async (calls) => {
            const check = createApp(files, database)('lib/automations/due-check.js') as DueCheck
            return { kicked: await check.kickWhenDue(), calls: calls.length }
          }
        )
      )
    const pending = (claimedAgo: number) => {
      const pendingDb = new FakeDatabase()
      seedSignup(pendingDb)
      Object.assign(pendingDb.events[0], {
        status: 'pending',
        attempts: 1,
        created_at: ago(claimedAgo + MINUTE_MS),
        claimed_at: ago(claimedAgo),
      })
      return pendingDb
    }
    expect(await kicked(pending(STALE_MS + MINUTE_MS))).toEqual({ kicked: true, calls: 1 })
    // Claimed a minute ago: another dispatcher is still on it.
    expect(await kicked(pending(MINUTE_MS))).toEqual({ kicked: false, calls: 0 })

    const resuming = (claimedAgo: number) => {
      const resumingDb = new FakeDatabase()
      seedDueWait(resumingDb)
      resumingDb.events[0].status = 'delivered'
      Object.assign(resumingDb.waits[0], { status: 'resuming', run_at: ago(claimedAgo) })
      return resumingDb
    }
    expect(await kicked(resuming(STALE_MS + MINUTE_MS))).toEqual({ kicked: true, calls: 1 })
    expect(await kicked(resuming(MINUTE_MS))).toEqual({ kicked: false, calls: 0 })

    // The very fragments the dispatcher claims with.
    const db = resuming(MINUTE_MS)
    await kicked(db)
    const due = db.statements.find((text) => text.startsWith('SELECT (EXISTS'))!
    const claims = sources(await generate(AUTOMATIONS)).get('lib/automations/dispatcher.js')!
    expect(due).toContain(
      "OR (w.status = 'resuming' AND w.run_at < now() - interval '15 minutes'))"
    )
    const stale =
      "(GREATEST(COALESCE(e.claimed_at, e.created_at), COALESCE((SELECT max(d.started_at) FROM teleport_event_deliveries d WHERE d.event_id = e.id), e.created_at)) < now() - interval '15 minutes' AND NOT EXISTS (SELECT 1 FROM teleport_event_deliveries d WHERE d.event_id = e.id AND d.status = 'waiting' AND d.workflow_id = ANY("
    expect(due).toContain(stale)
    expect(claims).toContain(stale)
  })

  it("is kept alive by Vercel's waitUntil there, off the request either way", async () => {
    const db = new FakeDatabase()
    seedDueWait(db)
    const scope = globalThis as Record<string, unknown>
    const held: Array<Promise<unknown>> = []
    scope.__tqWaitUntil = (promise: Promise<unknown>) => {
      held.push(promise)
    }
    try {
      await withEnv({ ...ENV, VERCEL: '1' }, () =>
        withFetch(
          () => ({ status: 200, body: {} }),
          async () => {
            const check = createApp(files, db)('lib/automations/due-check.js') as DueCheck
            const pending = check.kickWhenDue()
            // Handed to the platform before the request goes on.
            expect(held).toHaveLength(1)
            await pending
            await Promise.all(held)
          }
        )
      )
    } finally {
      delete scope.__tqWaitUntil
    }
    // The check, then the queue itself in the same waitUntil.
    expect(held.length).toBeGreaterThanOrEqual(2)
    expect(db.waits.find((w) => w.id === 900)!.status).toBe('done')
  })

  it('starts from every server read of the TeleportHQ database and from the data API, nowhere else', () => {
    for (const path of TELEPORT_READS) {
      const source = files.get(path)!
      expect(
        source.startsWith(
          "import { kickWhenDue as __tqKickDueAutomations } from '../../lib/automations/due-check'\n"
        )
      ).toBe(true)
      expect(source).toContain(
        'async function handler(req, res) {\n  // Activity on the site: due automation work (a Wait, a retry) starts off this request.\n  __tqKickDueAutomations(req)\n'
      )
    }
    for (const path of [REEXPORT_ROUTE, OWN_ITEMS_MODULE]) {
      expect(files.get(path)).not.toContain('due-check')
    }
    expect(files.get(DATA_API_ROUTE)).toContain(
      "require('../../../lib/automations/due-check').kickWhenDue(req);"
    )
  })
})
