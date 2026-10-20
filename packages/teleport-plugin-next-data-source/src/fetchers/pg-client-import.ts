/**
 * The `pg` import of a generated Postgres fetcher.
 *
 * A Postgres DATE is a calendar day, not an instant. node-pg reads it as
 * midnight in the server's time zone, so a server east of UTC sends
 * `2026-10-09` as `2026-10-08T21:00:00.000Z`: a list shows the day before, and
 * a form that loads the row saves that day back. The day is kept as its own
 * text (`YYYY-MM-DD`), which every reader of the value already understands.
 * A stand-in driver without `types` leaves the parsers alone.
 */
export const PG_CLIENT_IMPORT = `import { Client, types as pgTypes } from 'pg'

// A DATE stays the day it names, whatever the server's time zone.
if (pgTypes && typeof pgTypes.setTypeParser === 'function') {
  pgTypes.setTypeParser(1082, (value) => value)
}`
