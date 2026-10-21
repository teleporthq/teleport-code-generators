type Row = Record<string, unknown>

interface QueryResult {
  rows: Row[]
  rowCount: number
}

interface Session {
  inTransaction: boolean
  undo: Array<() => void>
  savepoints: Map<string, number>
  held: Set<string>
}

interface Lock {
  owner: Session
  released: Promise<void>
  release: () => void
}

/** The columns a second row may not repeat, beside `id`. */
const UNIQUE_COLUMNS: Record<string, string[]> = {
  teleport_events: ['dedupe_key'],
}

const newSession = (): Session => ({
  inTransaction: false,
  undo: [],
  savepoints: new Map(),
  held: new Set(),
})

const uniqueViolation = (table: string, column: string): Error =>
  Object.assign(
    new Error(`duplicate key value violates unique constraint "${table}_${column}_key"`),
    { code: '23505' }
  )

/**
 * A Postgres stand-in for the statements the generated invoice code sends: the
 * store's tables in memory, their UNIQUE keys, transactions that roll back,
 * and row locks — a transaction's UPDATE of a row holds it until COMMIT or
 * ROLLBACK, and another UPDATE of that row waits for it and then reads the row
 * as committed, as Postgres does under READ COMMITTED. Every statement it does
 * not know fails loudly, so a change in the generated SQL fails a test instead
 * of passing it vacuously.
 *
 * `pg` is the module to hand the generated code: its `Pool` (the invoice data
 * access) and its `Client` (the sent-email ledger, the generate route's order
 * mirror) all reach these same tables.
 */
export class FakeStoreDatabase {
  readonly tables: Record<string, Row[]> = {
    teleport_invoices: [],
    teleport_invoice_items: [],
    teleport_orders: [],
    teleport_order_items: [],
    teleport_events: [],
    teleport_sent_emails: [],
  }

  readonly statements: string[] = []

  readonly pg = this.createPgModule()

  private readonly locks = new Map<string, Lock>()

  // A SERIAL primary key, for the rows inserted without an id.
  private serial = 0

  private failures: Array<{ statement: RegExp; message: string }> = []

  /** The next statement matching `statement` fails with `message`, as an outage would. */
  failNext(statement: RegExp, message: string): void {
    this.failures.push({ statement, message })
  }

  insert(table: string, row: Row): Row {
    const stored = { ...row }
    this.rows(table).push(stored)
    return stored
  }

  row(table: string, id: unknown): Row | undefined {
    return this.rows(table).find((candidate) => String(candidate.id) === String(id))
  }

  private rows(table: string): Row[] {
    if (!this.tables[table]) {
      throw new Error(`fake database: relation "${table}" does not exist`)
    }
    return this.tables[table]
  }

  private createPgModule() {
    const queryIn =
      (session: Session) =>
      (text: string, values: unknown[] = []) =>
        this.query(session, text, values)
    const endSession = (session: Session) => this.endSession(session)

    class Pool {
      query(text: string, values?: unknown[]) {
        return queryIn(newSession())(text, values)
      }

      async connect() {
        const session = newSession()
        return {
          query: queryIn(session),
          release: () => endSession(session),
        }
      }
    }

    class Client {
      private readonly session = newSession()

      async connect(): Promise<void> {
        // Nothing to open.
      }

      query(text: string, values?: unknown[]) {
        return queryIn(this.session)(text, values)
      }

      async end(): Promise<void> {
        endSession(this.session)
      }
    }

    return { Pool, Client }
  }

  private endSession(session: Session): void {
    if (session.inTransaction) {
      this.finishTransaction(session, false)
    }
  }

  private async query(session: Session, text: string, values: unknown[]): Promise<QueryResult> {
    // Every statement is a round-trip: other requests run in between.
    await new Promise((resolve) => setImmediate(resolve))
    const sql = text.replace(/\s+/g, ' ').trim()
    this.statements.push(sql)
    const failure = this.failures.find((candidate) => candidate.statement.test(sql))
    if (failure) {
      this.failures = this.failures.filter((candidate) => candidate !== failure)
      throw new Error(failure.message)
    }
    const autocommit = !session.inTransaction
    try {
      return await this.run(session, sql, values)
    } finally {
      if (autocommit && !session.inTransaction) {
        this.releaseLocks(session)
      }
    }
  }

  private async run(session: Session, sql: string, values: unknown[]): Promise<QueryResult> {
    if (sql === 'BEGIN') {
      session.inTransaction = true
      return { rows: [], rowCount: 0 }
    }
    if (sql === 'COMMIT' || sql === 'ROLLBACK') {
      this.finishTransaction(session, sql === 'COMMIT')
      return { rows: [], rowCount: 0 }
    }
    let match = /^SAVEPOINT (\w+)$/.exec(sql)
    if (match) {
      session.savepoints.set(match[1], session.undo.length)
      return { rows: [], rowCount: 0 }
    }
    match = /^RELEASE SAVEPOINT (\w+)$/.exec(sql)
    if (match) {
      session.savepoints.delete(match[1])
      return { rows: [], rowCount: 0 }
    }
    match = /^ROLLBACK TO SAVEPOINT (\w+)$/.exec(sql)
    if (match) {
      const mark = session.savepoints.get(match[1]) ?? session.undo.length
      session.undo
        .splice(mark)
        .reverse()
        .forEach((undo) => undo())
      return { rows: [], rowCount: 0 }
    }
    if (sql === 'SELECT pg_advisory_xact_lock(hashtext($1))') {
      await this.lock(session, `advisory:${String(values[0])}`)
      return { rows: [{}], rowCount: 1 }
    }

    match =
      /^SELECT \* FROM (\w+) WHERE (\w+)(?:::text)? = \$1(?: ORDER BY [\w ,]+?)?(?: LIMIT (\d+))?$/.exec(
        sql
      )
    if (match) {
      const [, table, column, limit] = match
      const found = this.rows(table)
        .filter((row) => row[column] != null && String(row[column]) === String(values[0]))
        .map((row) => ({ ...row }))
      const rows = limit ? found.slice(0, Number(limit)) : found
      return { rows, rowCount: rows.length }
    }

    match = /^SELECT MAX\(.+\) AS last_number FROM (\w+) WHERE .+$/.exec(sql)
    if (match) {
      const prefix = String(values[0])
      const issued = this.rows(match[1])
        .map((row) => String(row.invoice_number || ''))
        .filter(
          (invoiceNumber) =>
            invoiceNumber.startsWith(prefix) &&
            /^[0-9]{1,15}$/.test(invoiceNumber.slice(prefix.length))
        )
        .map((invoiceNumber) => Number(invoiceNumber.slice(prefix.length)))
      return { rows: [{ last_number: issued.length ? Math.max(...issued) : null }], rowCount: 1 }
    }

    match =
      /^UPDATE teleport_orders SET invoice_id = \$1, invoice_number = \$2, invoice_pdf_url = \$3, updated_at = NOW\(\) WHERE id = \$4 AND \(invoice_id IS NULL OR invoice_id::text = \$5\)$/.exec(
        sql
      )
    if (match) {
      return this.updateRow(session, 'teleport_orders', values[3], (order) => {
        if (order.invoice_id != null && String(order.invoice_id) !== String(values[4])) {
          return null
        }
        return { invoice_id: values[0], invoice_number: values[1], invoice_pdf_url: values[2] }
      })
    }

    match =
      /^UPDATE teleport_orders SET invoice_id = COALESCE\(invoice_id, \$1\), invoice_number = COALESCE\(invoice_number, \$2\), invoice_pdf_url = COALESCE\(NULLIF\(invoice_pdf_url, ''\), NULLIF\(\$3, ''\)\), updated_at = NOW\(\) WHERE id = \$4$/.exec(
        sql
      )
    if (match) {
      return this.updateRow(session, 'teleport_orders', values[3], (order) => ({
        invoice_id: order.invoice_id ?? values[0],
        invoice_number: order.invoice_number ?? values[1],
        invoice_pdf_url: order.invoice_pdf_url || values[2] || null,
      }))
    }

    match = /^UPDATE (\w+) SET (.+) WHERE id = \$(\d+)( AND pdf_size_bytes IS NULL)?$/.exec(sql)
    if (match) {
      const [, table, assignments, idParam, onlyWithoutPdf] = match
      const fields: Row = {}
      for (const assignment of assignments.split(', ')) {
        const column = /^"?(\w+)"? = \$(\d+)$/.exec(assignment)
        if (!column) {
          throw new Error(`fake database: unsupported assignment "${assignment}"`)
        }
        fields[column[1]] = values[Number(column[2]) - 1]
      }
      return this.updateRow(session, table, values[Number(idParam) - 1], (row) =>
        onlyWithoutPdf && row.pdf_size_bytes != null ? null : fields
      )
    }

    match = /^DELETE FROM (\w+) WHERE (\w+) = \$1$/.exec(sql)
    if (match) {
      const [, table, column] = match
      const rows = this.rows(table)
      const removed = rows.filter((row) => String(row[column]) === String(values[0]))
      this.tables[table] = rows.filter((row) => !removed.includes(row))
      this.remember(session, () => {
        this.tables[table].push(...removed)
      })
      return { rows: [], rowCount: removed.length }
    }

    match =
      /^INSERT INTO "?(\w+)"? \((.+?)\) VALUES \((.+?)\)(?: ON CONFLICT \((\w+)\) DO NOTHING)?( RETURNING \*)?$/.exec(
        sql
      )
    if (match) {
      const [, table, columnList, placeholderList, conflictColumn, returning] = match
      const columns = columnList.split(', ').map((column) => column.replace(/"/g, ''))
      const placeholders = placeholderList.split(', ')
      const row: Row = {}
      columns.forEach((column, index) => {
        const param = /^\$(\d+)$/.exec(placeholders[index])
        if (!param) {
          throw new Error(`fake database: unsupported value "${placeholders[index]}"`)
        }
        row[column] = values[Number(param[1]) - 1]
      })
      if (row.id === undefined) {
        row.id = ++this.serial
      }
      for (const column of ['id', ...(UNIQUE_COLUMNS[table] || [])]) {
        const taken = this.rows(table).some(
          (existing) => row[column] != null && String(existing[column]) === String(row[column])
        )
        if (taken) {
          if (conflictColumn === column) {
            return { rows: [], rowCount: 0 }
          }
          throw uniqueViolation(table, column)
        }
      }
      this.rows(table).push(row)
      this.remember(session, () => {
        this.tables[table] = this.tables[table].filter((existing) => existing !== row)
      })
      return { rows: returning ? [{ ...row }] : [], rowCount: 1 }
    }

    throw new Error(`fake database: unsupported statement: ${sql}`)
  }

  /**
   * One row's UPDATE: waits for the row lock, then lets `change` read the row
   * as it is now and answer the new values, or null when the row does not match.
   */
  private async updateRow(
    session: Session,
    table: string,
    id: unknown,
    change: (row: Row) => Row | null
  ): Promise<QueryResult> {
    const target = this.row(table, id)
    if (!target) {
      return { rows: [], rowCount: 0 }
    }
    await this.lock(session, `${table}:${String(id)}`)
    const fields = change(target)
    if (!fields) {
      return { rows: [], rowCount: 0 }
    }
    const before: Row = {}
    for (const column of Object.keys(fields)) {
      before[column] = target[column]
    }
    Object.assign(target, fields)
    this.remember(session, () => {
      Object.assign(target, before)
    })
    return { rows: [{ id: target.id }], rowCount: 1 }
  }

  private remember(session: Session, undo: () => void): void {
    if (session.inTransaction) {
      session.undo.push(undo)
    }
  }

  private async lock(session: Session, key: string): Promise<void> {
    for (;;) {
      const held = this.locks.get(key)
      if (!held) {
        let release: () => void = () => undefined
        const released = new Promise<void>((resolve) => {
          release = resolve
        })
        this.locks.set(key, { owner: session, released, release })
        session.held.add(key)
        return
      }
      if (held.owner === session) {
        return
      }
      await held.released
    }
  }

  private finishTransaction(session: Session, commit: boolean): void {
    if (!commit) {
      session.undo.reverse().forEach((undo) => undo())
    }
    session.undo = []
    session.savepoints.clear()
    session.inTransaction = false
    this.releaseLocks(session)
  }

  private releaseLocks(session: Session): void {
    for (const key of session.held) {
      const held = this.locks.get(key)
      if (held && held.owner === session) {
        this.locks.delete(key)
        held.release()
      }
    }
    session.held.clear()
  }
}
