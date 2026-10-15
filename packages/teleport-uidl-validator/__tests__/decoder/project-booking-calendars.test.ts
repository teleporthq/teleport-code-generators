import { projectUIDLDecoder } from '../../src/decoders/project-decoder'
import projectSample from '../../../../examples/test-samples/project-sample.json'

/**
 * ⛔ THE DECODER IS THE SCHEMA: a top-level field it does not name is dropped,
 * and the generator only ever sees the decoded UIDL. The bookings' calendar
 * feed route is emitted by NextWorkflowProjectPlugin only when this entry
 * reaches it.
 */
const decode = (extra: Record<string, unknown>) =>
  projectUIDLDecoder.runWithException({ ...projectSample, ...extra }) as unknown as Record<
    string,
    unknown
  >

const FEED_STATEMENT = 'SELECT * FROM booking_calendar_feed($1)'

describe('project decoder — booking calendars', () => {
  it('keeps the feed statement', () => {
    expect(
      decode({ bookingCalendars: { feedStatement: FEED_STATEMENT } }).bookingCalendars
    ).toEqual({ feedStatement: FEED_STATEMENT })
  })

  it('drops keys the schema does not name', () => {
    expect(
      decode({ bookingCalendars: { feedStatement: FEED_STATEMENT, links: ['a'] } }).bookingCalendars
    ).toEqual({ feedStatement: FEED_STATEMENT })
  })

  it('rejects booking calendars without a statement', () => {
    expect(() => decode({ bookingCalendars: {} })).toThrow()
    expect(() => decode({ bookingCalendars: { feedStatement: 42 } })).toThrow()
  })

  it('leaves a project without booking calendars untouched', () => {
    expect(decode({}).bookingCalendars).toBeUndefined()
  })
})
