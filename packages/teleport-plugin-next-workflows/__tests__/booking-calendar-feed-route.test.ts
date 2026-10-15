import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { generateBookingCalendarFeedRoute } from '../src/booking-calendar-feed-route-generator'

// The bookings' calendar feed route is EXECUTED here with a stubbed `pg`
// client and a stubbed response, so the contract is proven on behaviour: the
// methods and keys it refuses, the one parameterised query, the calendar it
// writes (RFC 5545 escaping, 75-octet folding, all-day and timed events), a
// HEAD without a body and a 500 that never reveals the database error.

const CR_LF = String.fromCharCode(13, 10)
const LF = String.fromCharCode(10)
const CR = String.fromCharCode(13)
const BS = String.fromCharCode(92)
const FEED_STATEMENT = 'SELECT * FROM booking_calendar_feed($1)'
const KEY = 'AbCdEfGhIjKlMnOpQrSt_-12'
const FILE = `${KEY}.ics`
// The request's "now": the DTSTAMP of every event.
const NOW = Date.UTC(2026, 9, 9, 8, 15, 0)

interface PgStub {
  calls: Array<{ sql: string; params: unknown[] }>
  rows: unknown[]
  queryError: Error | null
  connectError: Error | null
  connections: number
  ended: number
}

const makePgStub = (rows: unknown[] = []): PgStub => ({
  calls: [],
  rows,
  queryError: null,
  connectError: null,
  connections: 0,
  ended: 0,
})

interface FeedResponse {
  statusCode: number
  headers: Record<string, string>
  body: string | undefined
  ended: number
}

// A Date whose "now" is NOW; every other use behaves like Date.
class FixedDate extends Date {
  constructor(...args: any[]) {
    if (args.length === 0) {
      super(NOW)
    } else {
      super(...(args as []))
    }
  }
}

const bootRoute = (pg: PgStub, errors: unknown[][] = []) => {
  class Client {
    public options: unknown
    constructor(options: unknown) {
      this.options = options
    }
    public async connect() {
      pg.connections += 1
      if (pg.connectError) {
        throw pg.connectError
      }
    }
    public async query(sql: string, params: unknown[]) {
      pg.calls.push({ sql, params })
      if (pg.queryError) {
        throw pg.queryError
      }
      return { rows: pg.rows }
    }
    public async end() {
      pg.ended += 1
    }
  }
  const fakeRequire = (name: string): any => {
    if (name === 'pg') {
      return { Client }
    }
    throw new Error(`unexpected require: ${name}`)
  }
  const moduleObj: { exports: any } = { exports: {} }
  // tslint:disable-next-line:function-constructor
  new Function(
    'require',
    'module',
    'exports',
    'process',
    'console',
    'Date',
    'Buffer',
    generateBookingCalendarFeedRoute(FEED_STATEMENT)
  )(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    { env: { TELEPORT_DB_CONNECTION_STRING: 'postgresql://user:pw@db.test/site' } },
    { error: (...args: unknown[]) => errors.push(args) },
    FixedDate,
    Buffer
  )
  const handler = moduleObj.exports as (req: unknown, res: unknown) => Promise<unknown>
  return async (req: Record<string, unknown>): Promise<FeedResponse> => {
    const response: FeedResponse = { statusCode: 200, headers: {}, body: undefined, ended: 0 }
    const res = {
      set statusCode(value: number) {
        response.statusCode = value
      },
      get statusCode() {
        return response.statusCode
      },
      setHeader: (name: string, value: string) => {
        response.headers[name] = value
      },
      end: (body?: string) => {
        response.body = body
        response.ended += 1
      },
    }
    await handler({ method: 'GET', query: { file: FILE }, ...req }, res)
    return response
  }
}

const calendarRow = (name = 'Sea view room') => ({ kind: 'calendar', calendar_name: name })

const event = (overrides: Record<string, unknown> = {}) => ({
  kind: 'event',
  uid: 'booking-1@site',
  summary: 'Reserved',
  all_day: true,
  start_value: '20261012',
  end_value: '20261015',
  ...overrides,
})

// The content lines of a feed, folded continuations joined back on.
const unfold = (body: string): string[] =>
  body.split(`${CR_LF} `).join('').split(CR_LF).slice(0, -1)

const eventBlocks = (body: string): string[][] => {
  const blocks: string[][] = []
  let current: string[] | null = null
  for (const line of unfold(body)) {
    if (line === 'BEGIN:VEVENT') {
      current = []
    } else if (line === 'END:VEVENT' && current) {
      blocks.push(current)
      current = null
    } else if (current) {
      current.push(line)
    }
  }
  return blocks
}

describe('the bookings calendar feed route — emission', () => {
  const structure = (extra: Record<string, unknown>): any => ({
    uidl: {
      name: 'Stays',
      globals: { settings: { title: 'Stays', language: 'en' }, env: {} },
      root: { name: 'Root', stateDefinitions: {}, node: { type: 'element', content: {} } },
      ...extra,
    },
    strategy: { pages: { options: {} } },
    files: new Map(),
    dependencies: {},
    devDependencies: {},
  })

  it('is not emitted without a feed statement', async () => {
    for (const extra of [
      {},
      { bookingCalendars: { feedStatement: '' } },
      { bookingCalendars: { feedStatement: '   ' } },
    ]) {
      const project = structure(extra)
      await new NextWorkflowProjectPlugin().runAfter(project)
      expect(project.files.has('bookings-ical-feed-route')).toBe(false)
      expect(project.dependencies.pg).toBeUndefined()
    }
  })

  it('is emitted at pages/api/bookings/ical/[file].js with the statement and pg', async () => {
    const project = structure({ bookingCalendars: { feedStatement: FEED_STATEMENT } })
    await new NextWorkflowProjectPlugin().runAfter(project)
    const entry = project.files.get('bookings-ical-feed-route')
    expect(entry.path).toEqual(['pages', 'api', 'bookings', 'ical'])
    expect(entry.files).toHaveLength(1)
    expect(entry.files[0].name).toBe('[file]')
    expect(entry.files[0].fileType).toBe('js')
    expect(entry.files[0].content).toContain(
      `var FEED_STATEMENT = ${JSON.stringify(FEED_STATEMENT)};`
    )
    expect(project.dependencies.pg).toBe('^8.12.0')
  })

  it('keeps the pg version the project already has', async () => {
    const project = structure({ bookingCalendars: { feedStatement: FEED_STATEMENT } })
    project.dependencies.pg = '^8.11.0'
    await new NextWorkflowProjectPlugin().runAfter(project)
    expect(project.files.has('bookings-ical-feed-route')).toBe(true)
    expect(project.dependencies.pg).toBe('^8.11.0')
  })
})

describe('the bookings calendar feed route — behaviour', () => {
  it('answers 405 with Allow to any method but GET and HEAD, without a query', async () => {
    const pg = makePgStub([calendarRow()])
    const route = bootRoute(pg)
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      const response = await route({ method })
      expect(response.statusCode).toBe(405)
      expect(response.headers.Allow).toBe('GET, HEAD')
      expect(response.body).toBe('Method not allowed')
    }
    expect(pg.calls).toHaveLength(0)
  })

  it('answers 404 to a key of the wrong shape, without a query', async () => {
    const pg = makePgStub([calendarRow()])
    const route = bootRoute(pg)
    for (const query of [
      {},
      { file: KEY },
      { file: `${KEY}.ICS` },
      { file: `${KEY}.ics.ics` },
      { file: 'short-key.ics' },
      { file: `${'a'.repeat(81)}.ics` },
      { file: `${KEY.slice(0, -1)}!.ics` },
      { file: `${KEY.slice(0, -1)}..ics` },
      { file: [FILE, FILE] },
    ]) {
      const response = await route({ query })
      expect(response.statusCode).toBe(404)
      expect(response.headers['Content-Type']).toBe('text/plain; charset=utf-8')
      expect(response.body).toBe('Not found')
    }
    expect(pg.calls).toHaveLength(0)
    // The longest and shortest keys the contract allows are accepted.
    expect((await route({ query: { file: `${'a'.repeat(80)}.ics` } })).statusCode).toBe(200)
    expect((await route({ query: { file: `${'a'.repeat(20)}.ics` } })).statusCode).toBe(200)
  })

  it('answers 404 when the key names no calendar, and closes the connection', async () => {
    const pg = makePgStub([event()])
    const response = await bootRoute(pg)({})
    expect(response.statusCode).toBe(404)
    expect(response.body).toBe('Not found')
    expect(pg.calls).toEqual([{ sql: FEED_STATEMENT, params: [KEY] }])
    expect(pg.connections).toBe(1)
    expect(pg.ended).toBe(1)
  })

  it('writes the calendar with all-day and timed events', async () => {
    const pg = makePgStub([
      calendarRow(),
      event(),
      event({
        uid: 'booking-2@site',
        summary: 'Massage',
        all_day: false,
        start_value: '20261020T090000Z',
        end_value: '20261020T103000Z',
      }),
    ])
    const response = await bootRoute(pg)({})
    expect(response.statusCode).toBe(200)
    expect(response.headers['Content-Type']).toBe('text/calendar; charset=utf-8')
    expect(response.headers['Cache-Control']).toBe('no-store')
    expect(response.headers['Content-Disposition']).toBe(`inline; filename="${FILE}"`)
    expect(response.headers['Content-Length']).toBe(
      String(Buffer.byteLength(response.body as string, 'utf8'))
    )
    expect(pg.calls).toEqual([{ sql: FEED_STATEMENT, params: [KEY] }])
    expect(pg.ended).toBe(1)
    expect(response.body).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//TeleportHQ//Bookings//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:Sea view room',
        'REFRESH-INTERVAL;VALUE=DURATION:PT30M',
        'X-PUBLISHED-TTL:PT30M',
        'BEGIN:VEVENT',
        'UID:booking-1@site',
        'DTSTAMP:20261009T081500Z',
        'DTSTART;VALUE=DATE:20261012',
        'DTEND;VALUE=DATE:20261015',
        'SUMMARY:Reserved',
        'TRANSP:OPAQUE',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:booking-2@site',
        'DTSTAMP:20261009T081500Z',
        'DTSTART:20261020T090000Z',
        'DTEND:20261020T103000Z',
        'SUMMARY:Massage',
        'TRANSP:OPAQUE',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join(CR_LF)
    )
  })

  it('writes a calendar with no events when nothing is booked', async () => {
    const response = await bootRoute(makePgStub([calendarRow('Cabin')]))({})
    expect(response.statusCode).toBe(200)
    expect(unfold(response.body as string)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TeleportHQ//Bookings//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Cabin',
      'REFRESH-INTERVAL;VALUE=DURATION:PT30M',
      'X-PUBLISHED-TTL:PT30M',
      'END:VCALENDAR',
    ])
  })

  it('reads all_day as a boolean or as Postgres writes it in text', async () => {
    const rows: unknown[] = [calendarRow()]
    for (const allDay of [true, 't', 'true', 'TRUE']) {
      rows.push(event({ uid: `day-${String(allDay)}`, all_day: allDay }))
    }
    for (const allDay of [false, 'f', 'false']) {
      rows.push(
        event({
          uid: `timed-${String(allDay)}`,
          all_day: allDay,
          start_value: '20261020T090000Z',
          end_value: '20261020T100000Z',
        })
      )
    }
    const blocks = eventBlocks((await bootRoute(makePgStub(rows))({})).body as string)
    expect(blocks).toHaveLength(7)
    for (const block of blocks.slice(0, 4)) {
      expect(block).toContain('DTSTART;VALUE=DATE:20261012')
      expect(block).toContain('DTEND;VALUE=DATE:20261015')
    }
    for (const block of blocks.slice(4)) {
      expect(block).toContain('DTSTART:20261020T090000Z')
      expect(block).toContain('DTEND:20261020T100000Z')
    }
  })

  it('leaves out an event row with a missing or invalid value', async () => {
    const response = await bootRoute(
      makePgStub([
        calendarRow(),
        event({ uid: 'kept' }),
        event({ uid: '' }),
        event({ uid: null }),
        event({ uid: 'bad-all-day', all_day: 'yes' }),
        event({ uid: 'no-all-day', all_day: null }),
        event({ uid: 'no-such-day', start_value: '20260231', end_value: '20260302' }),
        event({ uid: 'month-13', start_value: '20261301', end_value: '20261302' }),
        event({ uid: 'end-before-start', start_value: '20261015', end_value: '20261012' }),
        event({ uid: 'empty-stay', start_value: '20261012', end_value: '20261012' }),
        event({ uid: 'timed-on-all-day', start_value: '20261012T100000Z' }),
        event({ uid: 'date-object', start_value: new Date(NOW) }),
        event({ uid: 'no-end', end_value: null }),
        event({ uid: 'dashed', start_value: '2026-10-12', end_value: '2026-10-15' }),
        event({
          uid: 'hour-24',
          all_day: false,
          start_value: '20261020T240000Z',
          end_value: '20261021T010000Z',
        }),
        event({
          uid: 'not-utc',
          all_day: false,
          start_value: '20261020T090000',
          end_value: '20261020T100000',
        }),
        event({
          uid: 'date-on-timed',
          all_day: false,
          start_value: '20261020',
          end_value: '20261021',
        }),
        {
          kind: 'other',
          uid: 'other-kind',
          all_day: true,
          start_value: '20261012',
          end_value: '20261015',
        },
        null,
      ])
    )({})
    expect(response.statusCode).toBe(200)
    const blocks = eventBlocks(response.body as string)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toContain('UID:kept')
  })

  it('escapes TEXT values as RFC 5545 requires', async () => {
    const summary = `Room 1, sea view; ${BS}deluxe${BS}${LF}two${CR_LF}three${CR}four${String.fromCharCode(
      7
    )}${String.fromCharCode(9)}end`
    const response = await bootRoute(
      makePgStub([calendarRow('Rooms; A, B'), event({ summary, uid: 'a,b;c' })])
    )({})
    const lines = unfold(response.body as string)
    expect(lines).toContain(`X-WR-CALNAME:Rooms${BS}; A${BS}, B`)
    expect(lines).toContain(`UID:a${BS},b${BS};c`)
    expect(lines).toContain(
      `SUMMARY:Room 1${BS}, sea view${BS}; ${BS}${BS}deluxe${BS}${BS}${BS}ntwo${BS}nthree${BS}nfour${String.fromCharCode(
        9
      )}end`
    )
    // No raw line break survives inside a value: every CR starts a CRLF.
    const body = response.body as string
    expect(body.split(CR_LF).join('').indexOf(CR)).toBe(-1)
    expect(body.split(CR_LF).join('').indexOf(LF)).toBe(-1)
  })

  it('folds lines at 75 octets without splitting a UTF-8 character', async () => {
    const ascii = 'Long stay '.repeat(20)
    const multiByte = 'é€😀 Château à la mer '.repeat(12)
    const response = await bootRoute(
      makePgStub([
        calendarRow(multiByte),
        event({ uid: 'ascii', summary: ascii }),
        event({ uid: 'multi', summary: multiByte }),
      ])
    )({})
    const body = response.body as string
    expect(body.endsWith(CR_LF)).toBe(true)
    const physical = body.split(CR_LF).slice(0, -1)
    expect(physical.length).toBeGreaterThan(unfold(body).length)
    for (const line of physical) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75)
      // A split surrogate pair would not survive a UTF-8 round trip.
      expect(Buffer.from(line, 'utf8').toString('utf8')).toBe(line)
    }
    // A fold uses the full 75 octets when the next character fits.
    const asciiStart = physical.findIndex((line) => line.startsWith('SUMMARY:Long stay'))
    expect(Buffer.byteLength(physical[asciiStart], 'utf8')).toBe(75)
    expect(physical[asciiStart + 1].charAt(0)).toBe(' ')
    expect(Buffer.byteLength(physical[asciiStart + 1], 'utf8')).toBe(75)
    const lines = unfold(body)
    expect(lines).toContain(`SUMMARY:${ascii}`)
    expect(lines).toContain(`SUMMARY:${multiByte}`)
    expect(lines).toContain(`X-WR-CALNAME:${multiByte}`)
  })

  it('answers HEAD with the headers GET would send and no body', async () => {
    const rows = [calendarRow(), event()]
    const get = await bootRoute(makePgStub(rows))({})
    const pg = makePgStub(rows)
    const head = await bootRoute(pg)({ method: 'HEAD' })
    expect(head.statusCode).toBe(200)
    expect(head.headers).toEqual(get.headers)
    expect(head.body).toBeUndefined()
    expect(head.ended).toBe(1)
    expect(pg.calls).toHaveLength(1)

    const missing = await bootRoute(makePgStub([]))({ method: 'HEAD' })
    expect(missing.statusCode).toBe(404)
    expect(missing.body).toBeUndefined()
  })

  it('answers 500 when the database fails, logging the cause only', async () => {
    for (const failure of ['query', 'connect']) {
      const pg = makePgStub([calendarRow(), event()])
      const secret = new Error('password authentication failed for user "owner"')
      if (failure === 'query') {
        pg.queryError = secret
      } else {
        pg.connectError = secret
      }
      const errors: unknown[][] = []
      const response = await bootRoute(pg, errors)({})
      expect(response.statusCode).toBe(500)
      expect(response.headers['Content-Type']).toBe('text/plain; charset=utf-8')
      expect(response.headers['Cache-Control']).toBe('no-store')
      expect(response.headers['Content-Disposition']).toBeUndefined()
      expect(response.body).toBe('Calendar unavailable')
      expect(errors).toHaveLength(1)
      expect(errors[0].join(' ')).toContain(secret.message)
      expect(pg.ended).toBe(1)
    }
  })
})
