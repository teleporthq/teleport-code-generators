import { SessionCookieResolver, TableAccess } from '@teleporthq/teleport-shared'

/**
 * The money-table guard for a generated per-table read route
 * (`/api/teleport-<table>-<source>` and its `-count` twin).
 *
 * Every table a page binds gets such a route, and the route serves the whole
 * table — plus any single SELECT through `?rawQuery=` — to whoever asks. For a
 * catalogue that is the product; for gift cards and voucher codes it is theft.
 * The guard refuses a protected table (see `TableAccess.PROTECTED_TABLES`)
 * unless the caller is a server segment presenting the app secret or a
 * signed-in member of a trusted role — the generated admin, whose list pages
 * are the one browser reader these tables have.
 */

/** Declares the session resolver and the `__ta*` guard once per module. */
export const generateTableAccessPreamble = (trustedReaderRoles: ReadonlyArray<string>): string => {
  return `${SessionCookieResolver.generateCommonJsSessionTokenResolverCode()}
${TableAccess.generateTableAccessHelperCode({ trustedReaderRoles })}`
}

/**
 * The early return at the top of a handler, before the client connects:
 * `tableName` is the module's table, `rawQueryExpr` the request's raw statement
 * (or `null` where the handler accepts none).
 */
export const generateReadGuardCall = (tableName: string, rawQueryExpr: string | null): string => {
  return `  const __access = await __taGuardRead(req, ${JSON.stringify(tableName)}, ${
    rawQueryExpr || 'null'
  })
  if (__access) {
    return res.status(__access.status).json({ success: false, error: __access.message, timestamp: Date.now() })
  }
`
}
