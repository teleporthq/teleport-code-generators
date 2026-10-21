/* tslint:disable:function-constructor */
import { generateDataAccessCode, getRecordMappingCode } from '../src/invoice/data-access-code'
import type { UIDLInvoiceSettings } from '@teleporthq/teleport-types'

/**
 * `replaceInvoice` / `linkOrderToInvoice` — the data half of an invoice
 * regeneration, run as EMITTED code against a recording pg stub.
 */

const SETTINGS = {
  tables: { invoicesTable: 'teleport_invoices', invoiceItemsTable: 'teleport_invoice_items' },
} as unknown as UIDLInvoiceSettings

type Row = Record<string, unknown>

interface DataAccess {
  replaceInvoice: (id: string, invoiceData: Row, items: Row[]) => Promise<Row>
  linkOrderToInvoice: (
    orderId: string,
    invoiceId: string,
    invoiceNumber: string,
    pdfUrl: string
  ) => Promise<boolean>
  recordOrderEvent: (event: Row) => Promise<void>
  storeInvoicePdf: (id: string, pdf: Buffer, pdfUrl: string) => Promise<Row>
}

interface Statement {
  via: 'pool' | 'client'
  sql: string
  values: unknown[]
}

/**
 * Loads the emitted Postgres data access over a pg stub that records every
 * statement. `respond` decides each statement's result, or throws for it.
 */
function loadPostgres(respond: (sql: string, values: unknown[]) => Row = () => ({ rowCount: 1 })) {
  const statements: Statement[] = []
  let released = 0
  const record =
    (via: Statement['via']) =>
    async (sql: string, values: unknown[] = []) => {
      statements.push({ via, sql, values })
      return { rows: [{}], ...respond(sql, values) }
    }
  const pgStub = {
    Pool: class {
      query = record('pool')
      connect = async () => ({
        query: record('client'),
        release: () => {
          released += 1
        },
      })
    },
  }
  const code = `${generateDataAccessCode(SETTINGS, 'postgresql', null)}\n${getRecordMappingCode(
    'postgresql'
  )}`
  const moduleObject = { exports: {} as unknown }
  const dataAccess = new Function(
    'require',
    'module',
    'exports',
    `${code}; return module.exports;`
  )(
    (id: string) => (id === 'pg' ? pgStub : require(id)),
    moduleObject,
    moduleObject.exports
  ) as DataAccess
  return { dataAccess, statements, released: () => released }
}

const INVOICE_DATA: Row = {
  id: 'inv-1',
  invoiceNumber: 'INV-0004',
  status: 'issued',
  total: 105,
  shippingAmount: 15,
  giftCardAmount: 20,
  amountDue: 85,
  orderId: 'order-1',
  pdfUrl: '/api/invoices/inv-1/pdf',
}
const ITEMS: Row[] = [{ name: 'Lamp', quantity: 2, unitPrice: 50, totalPrice: 100 }]

describe('invoice data-access — replaceInvoice', () => {
  it('rewrites the row, then swaps its lines, in one transaction', async () => {
    const { dataAccess, statements, released } = loadPostgres()
    await dataAccess.replaceInvoice('inv-1', INVOICE_DATA, ITEMS)

    const sql = statements.map((statement) => statement.sql.split(' ').slice(0, 3).join(' '))
    expect(statements.every((statement) => statement.via === 'client')).toBe(true)
    expect(sql).toEqual([
      'BEGIN',
      'UPDATE teleport_invoices SET',
      'DELETE FROM teleport_invoice_items',
      'INSERT INTO teleport_invoice_items',
      'COMMIT',
    ])
    expect(released()).toBe(1)
  })

  it('keeps the row identity, the refunds and the columns the assembly never fills', async () => {
    const { dataAccess, statements } = loadPostgres()
    await dataAccess.replaceInvoice('inv-1', INVOICE_DATA, ITEMS)

    const update = statements.find((statement) => statement.sql.startsWith('UPDATE'))!
    for (const kept of [
      '"id"',
      '"created_at"',
      '"refunded_amount"',
      '"payment_provider_invoice_id"',
      '"metadata"',
    ]) {
      expect(update.sql).not.toContain(kept)
    }
    expect(update.sql).toContain('"invoice_number" = $')
    expect(update.sql).toContain('"amount_due" = $')
    expect(update.values[update.values.length - 1]).toBe('inv-1')

    const deletion = statements.find((statement) => statement.sql.startsWith('DELETE'))!
    expect(deletion.values).toEqual(['inv-1'])
  })

  it('rolls back and reports an invoice that disappeared', async () => {
    const { dataAccess, statements, released } = loadPostgres((sql) =>
      sql.startsWith('UPDATE') ? { rowCount: 0 } : { rowCount: 1 }
    )
    await expect(dataAccess.replaceInvoice('inv-1', INVOICE_DATA, ITEMS)).rejects.toThrow(
      'Invoice inv-1 no longer exists'
    )
    expect(statements.map((statement) => statement.sql)).toContain('ROLLBACK')
    expect(statements.some((statement) => statement.sql.startsWith('DELETE'))).toBe(false)
    expect(released()).toBe(1)
  })

  it('retries without a column an older table lacks, in a fresh transaction', async () => {
    let failedOnce = false
    const { dataAccess, statements, released } = loadPostgres((sql) => {
      if (sql.startsWith('UPDATE') && !failedOnce) {
        failedOnce = true
        throw new Error('column "gift_card_amount" of relation "teleport_invoices" does not exist')
      }
      return { rowCount: 1 }
    })
    await dataAccess.replaceInvoice('inv-1', INVOICE_DATA, ITEMS)

    const updates = statements.filter((statement) => statement.sql.startsWith('UPDATE'))
    expect(updates).toHaveLength(2)
    expect(updates[1].sql).not.toContain('"gift_card_amount"')
    expect(statements.map((statement) => statement.sql)).toEqual(
      expect.arrayContaining(['BEGIN', 'ROLLBACK', 'COMMIT'])
    )
    expect(released()).toBe(2)
  })

  it('tells the regeneration that gave the invoice its first PDF, by writing only a row without one', async () => {
    const { dataAccess, statements } = loadPostgres()
    expect(await dataAccess.replaceInvoice('inv-1', INVOICE_DATA, ITEMS)).toEqual({
      firstPdf: true,
    })

    const updates = statements.filter((statement) => statement.sql.startsWith('UPDATE'))
    expect(updates).toHaveLength(1)
    expect(updates[0].sql).toMatch(/ WHERE id = \$\d+ AND pdf_size_bytes IS NULL$/)
  })

  it('rewrites an invoice that already had a PDF all the same, and says it was not the first', async () => {
    const { dataAccess, statements } = loadPostgres((sql) =>
      sql.endsWith('AND pdf_size_bytes IS NULL') ? { rowCount: 0 } : { rowCount: 1 }
    )
    expect(await dataAccess.replaceInvoice('inv-1', INVOICE_DATA, ITEMS)).toEqual({
      firstPdf: false,
    })

    const updates = statements.filter((statement) => statement.sql.startsWith('UPDATE'))
    expect(updates).toHaveLength(2)
    expect(updates[1].sql).toMatch(/ WHERE id = \$\d+$/)
    expect(updates[1].values).toEqual(updates[0].values)
    expect(statements.map((statement) => statement.sql)).toContain('COMMIT')
  })
})

/** The emitted MySQL data access over a mysql2 stub; `affected` answers each UPDATE. */
function loadMysql(affected: (sql: string) => number) {
  const statements: string[] = []
  const connection = {
    beginTransaction: async () => statements.push('BEGIN'),
    commit: async () => statements.push('COMMIT'),
    rollback: async () => statements.push('ROLLBACK'),
    release: (): void => undefined,
    execute: async (sql: string) => {
      statements.push(sql)
      return [{ affectedRows: sql.startsWith('UPDATE') ? affected(sql) : 1, insertId: 1 }]
    },
  }
  const mysqlStub = {
    createPool: () => ({ getConnection: async () => connection, execute: connection.execute }),
  }
  const code = `${generateDataAccessCode(SETTINGS, 'mysql', null)}\n${getRecordMappingCode(
    'mysql'
  )}`
  const moduleObject = { exports: {} as unknown }
  const dataAccess = new Function(
    'require',
    'module',
    'exports',
    `${code}; return module.exports;`
  )(
    (id: string) => (id === 'mysql2/promise' ? mysqlStub : require(id)),
    moduleObject,
    moduleObject.exports
  ) as DataAccess
  return { dataAccess, statements }
}

describe('invoice data-access — replaceInvoice on MySQL', () => {
  it('tells the regeneration that gave the invoice its first PDF', async () => {
    const { dataAccess, statements } = loadMysql(() => 1)
    expect(await dataAccess.replaceInvoice('inv-1', INVOICE_DATA, ITEMS)).toEqual({
      firstPdf: true,
    })
    const updates = statements.filter((sql) => sql.startsWith('UPDATE'))
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatch(/ WHERE id = \? AND pdf_size_bytes IS NULL$/)
  })

  it('rewrites an invoice that already had a PDF, and says it was not the first', async () => {
    const { dataAccess, statements } = loadMysql((sql) =>
      sql.endsWith('AND pdf_size_bytes IS NULL') ? 0 : 1
    )
    expect(await dataAccess.replaceInvoice('inv-1', INVOICE_DATA, ITEMS)).toEqual({
      firstPdf: false,
    })
    expect(statements.filter((sql) => sql.startsWith('UPDATE'))).toHaveLength(2)
    expect(statements).toContain('COMMIT')
  })

  it('reports an invoice that disappeared', async () => {
    const { dataAccess, statements } = loadMysql(() => 0)
    await expect(dataAccess.replaceInvoice('inv-1', INVOICE_DATA, ITEMS)).rejects.toThrow(
      'Invoice inv-1 no longer exists'
    )
    expect(statements).toContain('ROLLBACK')
  })
})

type SupabaseResult = { data: unknown; error: { message: string } | null }

/**
 * Loads the emitted Supabase data access over an in-memory PostgREST stand-in.
 * `failOn(op, table, nth)` fails the nth (1-based) call of that operation on
 * that table.
 */
function loadSupabase(
  failOn: (op: string, table: string, nth: number) => boolean = () => false,
  storedInvoice: Row = {}
) {
  const store: Record<string, Row[]> = {
    teleport_invoices: [
      { id: 'inv-1', invoice_number: 'INV-0004', total: 90, notes: 'old', ...storedInvoice },
    ],
    teleport_invoice_items: [{ id: 'old-1', invoice_id: 'inv-1', name: 'Old lamp' }],
  }
  const counts: Record<string, number> = {}
  let nextId = 0
  const client = {
    from(table: string) {
      let op = 'select'
      let payload: unknown = null
      let single = false
      const filters: Array<(row: Row) => boolean> = []
      const execute = (): SupabaseResult => {
        const key = `${op} ${table}`
        counts[key] = (counts[key] || 0) + 1
        if (failOn(op, table, counts[key])) {
          return { data: null, error: { message: `${key} failed` } }
        }
        const matches = store[table].filter((row) => filters.every((keep) => keep(row)))
        if (op === 'insert') {
          const created = (payload as Row[]).map((row) => ({ ...row, id: `new-${++nextId}` }))
          store[table].push(...created)
          return { data: created, error: null }
        }
        if (op === 'update') {
          store[table] = store[table].map((row) =>
            matches.includes(row) ? { ...row, ...(payload as Row) } : row
          )
          return { data: matches.map((row) => ({ id: row.id })), error: null }
        }
        if (op === 'delete') {
          store[table] = store[table].filter((row) => !matches.includes(row))
          return { data: null, error: null }
        }
        // Copies, as over the wire: a later update must not reach a row already read.
        const copies = matches.map((row) => ({ ...row }))
        return { data: single ? copies[0] ?? null : copies, error: null }
      }
      const builder = {
        select: () => builder,
        insert: (records: Row[]) => {
          op = 'insert'
          payload = records
          return builder
        },
        update: (fields: Row) => {
          op = 'update'
          payload = fields
          return builder
        },
        delete: () => {
          op = 'delete'
          return builder
        },
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value)
          return builder
        },
        in: (column: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[column]))
          return builder
        },
        // `is(column, null)`: SQL NULL, which an absent column also reads as.
        is: (column: string, value: unknown) => {
          filters.push((row) => (value === null ? row[column] == null : row[column] === value))
          return builder
        },
        maybeSingle: () => {
          single = true
          return builder
        },
        then: (resolve: (result: SupabaseResult) => unknown, reject: (err: unknown) => unknown) =>
          Promise.resolve().then(execute).then(resolve, reject),
      }
      return builder
    },
  }
  const code = `${generateDataAccessCode(SETTINGS, 'supabase', null)}\n${getRecordMappingCode(
    'supabase'
  )}`
  const moduleObject = { exports: {} as unknown }
  const dataAccess = new Function(
    'require',
    'module',
    'exports',
    `${code}; return module.exports;`
  )(
    (id: string) => (id === '@supabase/supabase-js' ? { createClient: () => client } : require(id)),
    moduleObject,
    moduleObject.exports
  ) as DataAccess
  const invoice = () => store.teleport_invoices[0]
  const lineNames = () => store.teleport_invoice_items.map((row) => row.name)
  return { dataAccess, invoice, lineNames }
}

describe('invoice data-access — replaceInvoice on Supabase (no transactions)', () => {
  let consoleError: jest.SpyInstance

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('rewrites the row and swaps its lines', async () => {
    const { dataAccess, invoice, lineNames } = loadSupabase()
    await dataAccess.replaceInvoice('inv-1', INVOICE_DATA, ITEMS)
    expect(invoice()).toMatchObject({ id: 'inv-1', total: 105, amount_due: 85 })
    expect(lineNames()).toEqual(['Lamp'])
  })

  it.each([
    ['the new lines cannot be written', 'insert', 'teleport_invoice_items'],
    ['the row cannot be rewritten', 'update', 'teleport_invoices'],
    ['the old lines cannot be removed', 'delete', 'teleport_invoice_items'],
  ])('leaves the old invoice whole when %s', async (_, failingOp, failingTable) => {
    const { dataAccess, invoice, lineNames } = loadSupabase(
      (op, table, nth) => op === failingOp && table === failingTable && nth === 1
    )
    await expect(dataAccess.replaceInvoice('inv-1', INVOICE_DATA, ITEMS)).rejects.toThrow(
      `${failingOp} ${failingTable} failed`
    )
    expect(invoice()).toMatchObject({ id: 'inv-1', invoice_number: 'INV-0004', total: 90 })
    expect(lineNames()).toEqual(['Old lamp'])
  })

  it('reports an invoice that disappeared, and writes nothing', async () => {
    const { dataAccess, lineNames } = loadSupabase()
    await expect(dataAccess.replaceInvoice('inv-9', INVOICE_DATA, ITEMS)).rejects.toThrow(
      'Invoice inv-9 no longer exists'
    )
    expect(lineNames()).toEqual(['Old lamp'])
  })

  it('tells the regeneration that gave the invoice its first PDF', async () => {
    const { dataAccess, invoice } = loadSupabase()
    expect(
      await dataAccess.replaceInvoice('inv-1', { ...INVOICE_DATA, pdfSizeBytes: 2048 }, ITEMS)
    ).toEqual({ firstPdf: true })
    expect(invoice()).toMatchObject({ total: 105, pdf_size_bytes: 2048 })
  })

  it('rewrites an invoice that already had a PDF, and says it was not the first', async () => {
    const { dataAccess, invoice } = loadSupabase(() => false, { pdf_size_bytes: 1024 })
    expect(
      await dataAccess.replaceInvoice('inv-1', { ...INVOICE_DATA, pdfSizeBytes: 2048 }, ITEMS)
    ).toEqual({ firstPdf: false })
    expect(invoice()).toMatchObject({ total: 105, pdf_size_bytes: 2048 })
  })

  it('puts the invoice back without its PDF when a later step fails, so the next regeneration is the first', async () => {
    const { dataAccess, invoice } = loadSupabase(
      (op, table, nth) => op === 'delete' && table === 'teleport_invoice_items' && nth === 1
    )
    await expect(
      dataAccess.replaceInvoice('inv-1', { ...INVOICE_DATA, pdfSizeBytes: 2048 }, ITEMS)
    ).rejects.toThrow('delete teleport_invoice_items failed')
    expect(invoice().pdf_size_bytes == null).toBe(true)
    expect(
      await dataAccess.replaceInvoice('inv-1', { ...INVOICE_DATA, pdfSizeBytes: 2048 }, ITEMS)
    ).toEqual({ firstPdf: true })
  })
})

describe('invoice data-access — linkOrderToInvoice', () => {
  it('only touches an order that points at this invoice or at none', async () => {
    const { dataAccess, statements } = loadPostgres()
    const linked = await dataAccess.linkOrderToInvoice(
      'order-1',
      'inv-1',
      'INV-0004',
      'https://cdn.test/INV-0004.pdf'
    )
    expect(linked).toBe(true)
    const [statement] = statements
    expect(statement.sql).toContain('UPDATE teleport_orders SET invoice_id = $1')
    expect(statement.sql).toContain(
      'WHERE id = $4 AND (invoice_id IS NULL OR invoice_id::text = $5)'
    )
    expect(statement.values).toEqual([
      'inv-1',
      'INV-0004',
      'https://cdn.test/INV-0004.pdf',
      'order-1',
      'inv-1',
    ])
  })

  it('does nothing without an order', async () => {
    const { dataAccess, statements } = loadPostgres()
    expect(await dataAccess.linkOrderToInvoice('', 'inv-1', 'INV-0004', '')).toBe(false)
    expect(statements).toHaveLength(0)
  })
})

describe('invoice data-access — recordOrderEvent', () => {
  it("writes the order's history line once per key", async () => {
    const { dataAccess, statements } = loadPostgres()
    await dataAccess.recordOrderEvent({
      type: 'order-email-sent',
      dedupeKey: 'order-email-sent:inv-1:invoice-email',
      orderId: 'order-1',
      payload: { purpose: 'invoice-email', to: 'ana@buyer.test' },
      actor: 'Store admin',
      actorType: 'merchant',
    })

    const [statement] = statements
    expect(statement.sql).toBe(
      'INSERT INTO teleport_events (id, event_type, dedupe_key, order_id, payload, actor, actor_type, status) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (dedupe_key) DO NOTHING'
    )
    expect(statement.values.slice(1)).toEqual([
      'order-email-sent',
      'order-email-sent:inv-1:invoice-email',
      'order-1',
      '{"purpose":"invoice-email","to":"ana@buyer.test"}',
      'Store admin',
      'merchant',
      'recorded',
    ])
  })

  it('keeps the key within the column', async () => {
    const { dataAccess, statements } = loadPostgres()
    await dataAccess.recordOrderEvent({
      type: 'order-email-sent',
      dedupeKey: 'k'.repeat(300),
      actorType: 'merchant',
    })
    expect(String(statements[0].values[2])).toHaveLength(255)
    expect(statements[0].values[3]).toBeNull()
  })
})

describe('invoice data-access — every dialect exports the regeneration helpers', () => {
  it.each(['postgresql', 'mysql', 'supabase'])('%s', (dialect) => {
    const code = generateDataAccessCode(SETTINGS, dialect as never, null)
    expect(code).toContain('async function replaceInvoice(invoiceId, invoiceData, items)')
    expect(code).toContain(
      'async function linkOrderToInvoice(orderId, invoiceId, invoiceNumber, pdfUrl)'
    )
    expect(code).toContain('async function recordOrderEvent(event)')
    expect(code).toContain('replaceInvoice: replaceInvoice,')
    expect(code).toContain('linkOrderToInvoice: linkOrderToInvoice,')
    expect(code).toContain('recordOrderEvent: recordOrderEvent,')
  })
})

/**
 * `storeInvoicePdf` — the payment's PDF, written only on an invoice that has
 * none, so the invoice's first PDF (and with it its email) goes to exactly one
 * of the payment and a regeneration, as `replaceInvoice` claims it.
 */
describe('invoice data-access — storeInvoicePdf writes only the first PDF', () => {
  const PDF = Buffer.from('%PDF-1.4 INV-0004')

  it('Postgres: one statement, on a row without a PDF', async () => {
    const { dataAccess, statements } = loadPostgres()
    expect(await dataAccess.storeInvoicePdf('inv-1', PDF, '/api/invoices/inv-1/pdf')).toEqual({
      firstPdf: true,
    })
    expect(statements).toHaveLength(1)
    expect(statements[0].sql).toBe(
      'UPDATE teleport_invoices SET pdf_data = $1, pdf_size_bytes = $2, pdf_content_type = $3, ' +
        'pdf_url = $4, updated_at = $5 WHERE id = $6 AND pdf_size_bytes IS NULL'
    )
    expect(statements[0].values).toEqual([
      PDF,
      PDF.length,
      'application/pdf',
      '/api/invoices/inv-1/pdf',
      expect.any(String),
      'inv-1',
    ])
  })

  it('Postgres: an invoice that already has a PDF keeps it, and is not the first', async () => {
    const { dataAccess } = loadPostgres(() => ({ rowCount: 0 }))
    expect(await dataAccess.storeInvoicePdf('inv-1', PDF, '/api/invoices/inv-1/pdf')).toEqual({
      firstPdf: false,
    })
  })

  it('MySQL: the same condition, and the rows it changed', async () => {
    const first = loadMysql(() => 1)
    expect(await first.dataAccess.storeInvoicePdf('inv-1', PDF, '/x')).toEqual({ firstPdf: true })
    expect(first.statements).toEqual([
      'UPDATE teleport_invoices SET pdf_data = ?, pdf_size_bytes = ?, pdf_content_type = ?, ' +
        'pdf_url = ?, updated_at = ? WHERE id = ? AND pdf_size_bytes IS NULL',
    ])
    const later = loadMysql(() => 0)
    expect(await later.dataAccess.storeInvoicePdf('inv-1', PDF, '/x')).toEqual({ firstPdf: false })
  })

  it('Supabase: one filtered update', async () => {
    const first = loadSupabase()
    expect(await first.dataAccess.storeInvoicePdf('inv-1', PDF, '/x')).toEqual({ firstPdf: true })
    expect(first.invoice()).toMatchObject({
      pdf_data: PDF.toString('base64'),
      pdf_size_bytes: PDF.length,
      pdf_url: '/x',
    })

    const later = loadSupabase(() => false, { pdf_size_bytes: 1024, pdf_url: '/regenerated' })
    expect(await later.dataAccess.storeInvoicePdf('inv-1', PDF, '/x')).toEqual({ firstPdf: false })
    expect(later.invoice()).toMatchObject({ pdf_size_bytes: 1024, pdf_url: '/regenerated' })
  })
})
