/* tslint:disable:function-constructor max-classes-per-file no-any */
import * as types from '@babel/types'
import generator from '@babel/generator'
import { generateDataSourceFetcherWithCore } from '../../src/data-source-fetchers'

/**
 * Runs what a generated page asks its data module for: the arguments its
 * `getStaticProps` hands `fetchData`, the params a provider computes in the
 * browser, and the products route both reach — so a test can check that the
 * build and the browser order one row set the same way.
 *
 * `__tests__/_helpers` is excluded from the jest test match, so this file is a
 * fixture rather than a suite.
 */

const isFetchDataCall = (node: types.Node): node is types.CallExpression =>
  node.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  node.callee.property.type === 'Identifier' &&
  node.callee.property.name === 'fetchData' &&
  node.arguments[0]?.type === 'ObjectExpression'

// The `Promise.all` entry whose result lands in `propKey`.
const prefetchOf = (content: types.Node, propKey: string): types.Node | undefined => {
  let entry: types.Node | undefined
  types.traverseFast(content, (node) => {
    if (
      !entry &&
      node.type === 'VariableDeclarator' &&
      node.id.type === 'ArrayPattern' &&
      node.init?.type === 'AwaitExpression' &&
      node.init.argument.type === 'CallExpression' &&
      node.init.argument.arguments[0]?.type === 'ArrayExpression'
    ) {
      const index = node.id.elements.findIndex(
        (element) => element?.type === 'Identifier' && element.name === propKey
      )
      if (index !== -1) {
        entry = (node.init.argument.arguments[0] as types.ArrayExpression).elements[index] as
          | types.Node
          | undefined
      }
    }
  })
  return entry
}

/**
 * What getStaticProps hands fetchData — `{ page: 1, perPage: 20, …, sorts }`,
 * then who it reads for — for the prefetch filling `propKey`, or the first one.
 */
export const buildTimeArguments = (
  staticPropsChunk: any,
  propKey?: string
): Array<Record<string, unknown>> => {
  const scope = propKey ? prefetchOf(staticPropsChunk.content, propKey) : staticPropsChunk.content
  let call: types.CallExpression | undefined
  types.traverseFast(scope as types.Node, (node) => {
    if (!call && isFetchDataCall(node)) {
      call = node
    }
  })
  const args = call!.arguments.map((arg) => generator(arg as types.Node).code)
  return new Function(`return [${args.join(', ')}]`)()
}

// The `nth` memoized `params` a provider of the component sends.
const browserParamsBody = (chunk: any, nth: number): types.Expression => {
  const bodies: types.Expression[] = []
  types.traverseFast(chunk.content, (node) => {
    if (
      node.type === 'JSXAttribute' &&
      node.name.name === 'params' &&
      node.value?.type === 'JSXExpressionContainer' &&
      node.value.expression.type === 'CallExpression'
    ) {
      const arrow = node.value.expression.arguments[0]
      if (arrow?.type === 'ArrowFunctionExpression') {
        bodies.push(arrow.body as types.Expression)
      }
    }
  })
  return bodies[nth]
}

/** The provider's params as the browser computes them for the given state, as they go on the wire. */
export const browserParams = (
  chunk: any,
  state: Record<string, unknown>,
  nth: number = 0
): Record<string, string> => {
  const names = Object.keys(state)
  const params = new Function(
    ...names,
    `return (${generator(browserParamsBody(chunk, nth)).code})`
  )(...names.map((name) => state[name]))
  // What `new URLSearchParams(params)` puts on the wire.
  return Object.fromEntries(new URLSearchParams(params))
}

/**
 * The products route as the project ships it, over a database that records
 * the statements it is sent.
 */
export const bootProductsRoute = () => {
  const dataSource = {
    id: 'ds-1',
    name: 'db',
    type: 'teleport',
    config: {
      host: 'teleporthq.secrets.TELEPORT_DB_HOST',
      port: 5432,
      user: 'teleporthq.secrets.TELEPORT_DB_USER',
      password: 'teleporthq.secrets.TELEPORT_DB_PASSWORD',
      database: 'teleporthq.secrets.TELEPORT_DB_NAME',
      selectedTables: { teleport_products: { columns: [{ name: 'id', type: 'uuid' }] } },
    },
  }
  const code = generateDataSourceFetcherWithCore(dataSource as never, 'teleport_products')
    .replace(
      "import { Client, types as pgTypes } from 'pg'",
      "const { Client, types: pgTypes } = require('pg')"
    )
    .replace(/^export \{[^}]*\}\s*$/m, '')
    .replace(/^export default \{[^}]*\}\s*$/m, '')
    .concat('\nmodule.exports = { handler: handler, fetchData: fetchData }')
  expect(code).not.toMatch(/^(export|import) /m)

  const statements: string[] = []
  class FakeClient {
    public async connect(): Promise<void> {
      return
    }
    public async end(): Promise<void> {
      return
    }
    public async query(sql: string): Promise<any> {
      statements.push(sql)
      return { rows: [], rowCount: 0 }
    }
  }
  const fakeRequire = (name: string): any => {
    if (name === 'pg') {
      return { Client: FakeClient }
    }
    if (name === 'next-auth/jwt') {
      return { getToken: async (): Promise<null> => null }
    }
    throw new Error('unexpected require: ' + name)
  }
  const moduleObj: { exports: any } = { exports: {} }
  new Function('require', 'module', 'exports', 'process', 'console', code)(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    {
      env: {
        NEXTAUTH_SECRET: 'secret',
        TELEPORT_DB_HOST: 'h',
        TELEPORT_DB_USER: 'u',
        TELEPORT_DB_PASSWORD: 'p',
        TELEPORT_DB_NAME: 'd',
      },
    },
    { error: (): void => undefined, warn: (): void => undefined, log: (): void => undefined }
  )
  const lastSelect = (): string =>
    statements.filter((sql) => /^\s*SELECT \* FROM/i.test(sql)).pop() || ''
  return {
    atBuild: async (args: Array<Record<string, unknown>>) => {
      await moduleObj.exports.fetchData(...args)
      return lastSelect()
    },
    inBrowser: async (query: Record<string, string>) => {
      const res = { status: () => res, json: () => res, setHeader: () => res }
      await moduleObj.exports.handler({ method: 'GET', query, headers: {} }, res)
      return lastSelect()
    },
  }
}

export const orderBy = (sql: string): string => (sql.match(/ ORDER BY .*? LIMIT/) || [''])[0]
export const rowWindow = (sql: string): string =>
  (sql.match(/ LIMIT \d+( OFFSET \d+)?$/) || [''])[0]
