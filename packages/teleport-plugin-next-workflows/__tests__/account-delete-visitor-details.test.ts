import { DeleteRouteRun, runAccountDeleteRoute, sqlOf } from './_helpers/run-account-delete-route'

/**
 * Closing an account takes the visitor's details out of the site's own records
 * too: the activity log no longer names them, a download no longer says who
 * fetched it from where, a gift card they bought or received keeps working
 * under the anonymised address, and the emails the site sent them stay on
 * record without the address, the body or the values they were filled with.
 * The invoices already issued to them are the exception: an invoice must keep
 * naming its buyer. A table the site does not have is left alone.
 */

const USER_ID = 'user-1'
const USER_EMAIL = 'Ana@Example.com'
const ANONYMISED = `deleted-user-${USER_ID}@deleted.invalid`

const userRow = { id: USER_ID, email: USER_EMAIL, name: 'Ana' }

const TABLES = {
  users: ['id', 'email', 'name', 'password'],
  teleport_events: ['id', 'event_type', 'dedupe_key', 'order_id', 'payload', 'actor'],
  teleport_downloads: [
    'id',
    'order_id',
    'order_item_id',
    'product_file_id',
    'user_id',
    'ip_address',
  ],
  teleport_gift_cards: ['id', 'code', 'balance', 'recipient_email', 'purchaser_email'],
  teleport_sent_emails: ['id', 'recipient_email', 'recipients', 'body_html', 'payload', 'subject'],
}

const updatesOf = (run: DeleteRouteRun, table: string) =>
  run.statements.filter((statement) => statement.sql.indexOf('UPDATE ' + table + ' ') === 0)

describe('deleting an account removes the visitor from the site’s records', () => {
  let run: DeleteRouteRun

  beforeAll(async () => {
    run = await runAccountDeleteRoute({ userRow, tables: TABLES })
  })

  it('still deletes the account', () => {
    expect(run.status).toBe(200)
    expect(sqlOf(run)).toContain('DELETE FROM users WHERE id = $1')
  })

  it('blanks the activity log’s actor where it is their email', () => {
    expect(updatesOf(run, 'teleport_events')).toEqual([
      {
        sql: 'UPDATE teleport_events SET actor = $1 WHERE lower(actor) = lower($2)',
        params: ['', USER_EMAIL],
      },
    ])
  })

  it('clears who downloaded and from where, keeping the download counted', () => {
    expect(updatesOf(run, 'teleport_downloads')).toEqual([
      {
        sql: 'UPDATE teleport_downloads SET user_id = NULL, ip_address = NULL WHERE user_id = $1',
        params: [USER_ID],
      },
    ])
  })

  it('moves the gift cards they bought or received to the anonymised address', () => {
    expect(updatesOf(run, 'teleport_gift_cards')).toEqual([
      {
        sql: 'UPDATE teleport_gift_cards SET purchaser_email = $1 WHERE lower(purchaser_email) = lower($2)',
        params: [ANONYMISED, USER_EMAIL],
      },
      {
        sql: 'UPDATE teleport_gift_cards SET recipient_email = $1 WHERE lower(recipient_email) = lower($2)',
        params: [ANONYMISED, USER_EMAIL],
      },
    ])
  })

  it('keeps the emails sent to them on record without address, body or values', () => {
    expect(updatesOf(run, 'teleport_sent_emails')).toEqual([
      {
        sql: "UPDATE teleport_sent_emails SET recipient_email = '', recipients = NULL, body_html = '', payload = NULL WHERE lower(recipient_email) = lower($1)",
        params: [USER_EMAIL],
      },
    ])
  })

  it('does all of it inside the deletion’s transaction', () => {
    const sql = sqlOf(run)
    const begin = sql.indexOf('BEGIN')
    const commit = sql.indexOf('COMMIT')
    for (const table of Object.keys(TABLES).filter((name) => name !== 'users')) {
      const at = sql.findIndex((statement) => statement.indexOf('UPDATE ' + table + ' ') === 0)
      expect(at).toBeGreaterThan(begin)
      expect(at).toBeLessThan(commit)
    }
  })
})

describe('the invoices already issued to them', () => {
  const SHOP_TABLES = {
    users: TABLES.users,
    teleport_orders: ['id', 'user_id', 'customer_email', 'billing_email', 'invoice_pdf_url'],
    teleport_invoices: [
      'id',
      'order_id',
      'customer_name',
      'customer_address',
      'customer_city',
      'customer_country',
      'customer_vat',
      'customer_email',
      'pdf_url',
    ],
    teleport_invoice_items: ['id', 'invoice_id', 'description', 'amount'],
  }
  let run: DeleteRouteRun

  beforeAll(async () => {
    run = await runAccountDeleteRoute({ userRow, tables: SHOP_TABLES })
  })

  it('keep the buyer’s name, address, tax number and email', () => {
    expect(run.status).toBe(200)
    expect(sqlOf(run).filter((sql) => sql.indexOf('teleport_invoice') !== -1)).toEqual([])
  })

  it('while their orders still drop the account and its email', () => {
    expect(updatesOf(run, 'teleport_orders')).toEqual([
      {
        sql: 'UPDATE teleport_orders SET user_id = NULL, billing_email = $2, customer_email = $3 WHERE user_id = $1',
        params: [USER_ID, ANONYMISED, ANONYMISED],
      },
    ])
  })
})

describe('a site without those tables', () => {
  it('deletes the account and touches none of them', async () => {
    const run = await runAccountDeleteRoute({
      userRow,
      tables: { users: TABLES.users },
    })

    expect(run.status).toBe(200)
    expect(sqlOf(run).filter((sql) => sql.indexOf('UPDATE') === 0)).toEqual([])
  })

  it('leaves a table alone when it lacks the column', async () => {
    const run = await runAccountDeleteRoute({
      userRow,
      tables: { users: TABLES.users, teleport_events: ['id', 'event_type'] },
    })

    expect(updatesOf(run, 'teleport_events')).toEqual([])
  })
})

describe('the farewell email', () => {
  it('is recorded without the visitor’s address, body or values', async () => {
    const recorded: any[] = []
    const sent: any[] = []
    class Resend {
      public emails = {
        send: async (message: unknown) => {
          sent.push(message)
          return {}
        },
      }
    }
    const run = await runAccountDeleteRoute({
      userRow,
      tables: TABLES,
      env: { RESEND_KEY: 're_test' },
      options: {
        emailProvider: 'resend',
        fromEmail: 'hello@shop.test',
        emailSecretEnvName: 'RESEND_KEY',
        emailBodyHtml: '<p>Goodbye {{userName}}</p>',
      },
      modules: {
        resend: { Resend },
        '../../../utils/email/sent-email-log': {
          recordSentEmail: (entry: unknown) => recorded.push(entry),
          settleSentEmailLog: async () => undefined,
        },
      },
    })

    expect(run.status).toBe(200)
    // The visitor still gets it…
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toEqual([USER_EMAIL])
    expect(sent[0].html).toBe('<p>Goodbye Ana</p>')
    // …and the ledger keeps only that it was sent.
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      emailType: 'account-deleted',
      to: ANONYMISED,
      html: '',
      payload: null,
      status: 'sent',
    })
  })
})
