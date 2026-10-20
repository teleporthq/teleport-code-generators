/* tslint:disable:function-constructor */
import { generateDataSourceFetcherWithCore } from '../src/data-source-fetchers'

/**
 * A Postgres DATE is a calendar day. node-pg reads it as midnight in the
 * server's time zone, so a server east of UTC served `2026-10-09` as
 * `2026-10-08T21:00:00.000Z`: the list showed the day before, and an edit form
 * that loaded the row saved that day back. Every Postgres fetcher keeps the
 * day as its own text; a stand-in driver without `types` still loads.
 */

type ParserSpy = Array<{ oid: number; parse: (value: string) => unknown }>

const bootFetcher = (type: 'teleport' | 'postgresql', withTypes: boolean): ParserSpy => {
  const dataSource = {
    id: 'ds-1',
    name: 'db',
    type,
    config:
      type === 'teleport'
        ? {
            host: 'teleporthq.secrets.TELEPORT_DB_HOST',
            port: 5432,
            user: 'teleporthq.secrets.TELEPORT_DB_USER',
            password: 'teleporthq.secrets.TELEPORT_DB_PASSWORD',
            database: 'teleporthq.secrets.TELEPORT_DB_NAME',
            selectedTables: { orders: { columns: [{ name: 'id' }, { name: 'due' }] } },
          }
        : { host: 'h', port: 5432, user: 'u', password: 'p', database: 'd' },
  }
  const code = generateDataSourceFetcherWithCore(dataSource as never, 'orders', false, {})
  expect(code.startsWith("import { Client, types as pgTypes } from 'pg'")).toBe(true)
  const runnable = code
    .replace(
      "import { Client, types as pgTypes } from 'pg'",
      "const { Client, types: pgTypes } = require('pg')"
    )
    .replace(/^export default async function handler/m, 'async function handler')
    .replace(/^export \{[^}]*\}\s*$/m, '')
    .replace(/^export default \{[^}]*\}\s*$/m, '')
  const registered: ParserSpy = []
  const types = {
    setTypeParser: (oid: number, parse: (value: string) => unknown) =>
      registered.push({ oid, parse }),
  }
  new Function('require', 'module', 'exports', 'process', 'console', runnable)(
    (name: string) => {
      if (name === 'pg') {
        return withTypes ? { Client: class {}, types } : { Client: class {} }
      }
      throw new Error('unexpected require: ' + name)
    },
    { exports: {} },
    {},
    { env: {} },
    { error: () => undefined, warn: () => undefined, log: () => undefined }
  )
  return registered
}

describe.each(['teleport', 'postgresql'] as const)('%s fetcher DATE columns', (type) => {
  it('keeps a DATE as the day it names', () => {
    const registered = bootFetcher(type, true)
    const date = registered.find(({ oid }) => oid === 1082)
    expect(date).toBeDefined()
    expect(date?.parse('2026-10-09')).toBe('2026-10-09')
    expect(registered.map(({ oid }) => oid)).toEqual([1082])
  })

  it('loads with a driver that has no type registry', () => {
    expect(bootFetcher(type, false)).toEqual([])
  })
})
