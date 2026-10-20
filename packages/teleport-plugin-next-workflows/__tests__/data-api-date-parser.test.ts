/* tslint:disable:function-constructor */
import { generateDataAPIRoute } from '../src/data-api-route-generator'

/**
 * The data API (workflow reads and writes) keeps a Postgres DATE as the day
 * it names: node-pg's default reads it as midnight in the server's time zone,
 * which a server east of UTC serves as the day before — and a form that loads
 * the row then saves that day back.
 */

const boot = (withTypes: boolean) => {
  const registered: Array<{ oid: number; parse: (value: string) => unknown }> = []
  const types = {
    setTypeParser: (oid: number, parse: (value: string) => unknown) =>
      registered.push({ oid, parse }),
  }
  new Function('require', 'module', 'exports', 'process', 'console', generateDataAPIRoute({}))(
    (name: string) => {
      if (name === 'pg') {
        return withTypes ? { Client: class {}, types } : { Client: class {} }
      }
      if (name === 'next-auth/jwt') {
        return { getToken: async () => null }
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

describe('data API DATE columns', () => {
  it('keeps a DATE as the day it names', () => {
    const registered = boot(true)
    expect(registered.map(({ oid }) => oid)).toEqual([1082])
    expect(registered[0].parse('2026-10-09')).toBe('2026-10-09')
  })

  it('loads with a driver that has no type registry', () => {
    expect(boot(false)).toEqual([])
  })
})
