import { NodeHandlerGenerator } from '../types'
import { generateAIProviderUtils, AI_PROVIDER_DEPENDENCIES } from './ai-provider-utils'
import { generateAiSqlSelectGuard } from './ai-sql-select-guard'

declare function __ai_resolveTextField(val: any): string
declare function __ai_resolveToken(token: any): string
declare function __ai_resolveProvider(config: any): string
declare function __ai_callProvider(params: any): Promise<any>
declare function __ai_parseJSON(text: any): any
declare function __aisql_validateSelectQuery(
  sql: any,
  allowedTables: any
): { valid: boolean; reason?: string }
declare function __aisql_enforceLimit(sql: any, maxRows: any): string
declare function __aisql_buildSystemPrompt(
  tableSchemas: any,
  allowedTables: any,
  maxRows: any
): string

// SECURITY: every node result in a server segment is serialized back to the
// visitor's browser, so nothing returned from this handler may contain the
// generated SQL, the table schemas, the model's free-text explanation, or a
// database error message (pg errors quote the failing statement). The whole
// generate → validate → execute flow stays inside this one handler; the result
// is only { executed, rowCount, rows } (rows come exclusively from the
// allow-listed tables) or a fixed-string failure code.
async function ai_select_database_data(config: any, context: any) {
  const optional = config.optional === true
  const fail = function (code: string) {
    if (optional) {
      return { executed: false, rows: [], rowCount: 0, skipped: true, skipReason: code }
    }
    return { error: true, message: 'AI database query failed (' + code + ')', code }
  }

  const prompt = __ai_resolveTextField(config.prompt)
  if (!prompt) {
    return fail('missing_prompt')
  }
  const dataSourceId = config.dataSourceId
  const allowedTables = Array.isArray(config.allowedTables) ? config.allowedTables : []
  if (!dataSourceId || allowedTables.length === 0) {
    return fail('missing_configuration')
  }

  let token
  try {
    token = __ai_resolveToken(config.token)
  } catch (err: any) {
    return fail('authentication_error')
  }
  const provider = __ai_resolveProvider(config)
  const model = config.model || 'gpt-4o'
  const maxRows = Math.max(1, Math.min(1000, parseInt(config.maxRows, 10) || 100))

  const systemMessage = __aisql_buildSystemPrompt(config.tableSchemas, allowedTables, maxRows)

  let sql = null
  let feedback = ''
  let providerFailed = false
  for (let attempt = 0; attempt < 2 && sql === null; attempt++) {
    let raw
    try {
      raw = await __ai_callProvider({
        provider,
        model,
        token,
        systemMessage,
        userMessage: feedback ? prompt + feedback : prompt,
        temperature: 0,
        maxTokens: 1000,
        jsonMode: true,
      })
    } catch (err: any) {
      providerFailed = true
      break
    }
    const parsed = __ai_parseJSON(raw && raw.content)
    if (!parsed || typeof parsed !== 'object') {
      feedback =
        '\n\n[system] Your previous response was not valid JSON. Reply with ONLY the JSON object described in the instructions.'
      continue
    }
    if (parsed.needsQuery === false) {
      return { executed: false, rows: [], rowCount: 0 }
    }
    const check = __aisql_validateSelectQuery(String(parsed.query || ''), allowedTables)
    if (check.valid) {
      sql = __aisql_enforceLimit(String(parsed.query), maxRows)
      break
    }
    // Server logs only — the reason may quote fragments of the rejected SQL.
    // tslint:disable-next-line:no-console
    console.error('[ai-select-database-data] rejected generated SQL: ' + check.reason)
    feedback =
      '\n\n[system] Your previous query was rejected: ' +
      check.reason +
      '. Produce a corrected single read-only SELECT that follows every rule, or set needsQuery to false.'
  }
  if (providerFailed) {
    return fail('provider_error')
  }
  if (!sql) {
    return fail('sql_rejected')
  }

  const baseUrl = (context && context.__baseUrl) || ''
  const __internalHeaders = (context && context.__internalHeaders) || {}
  try {
    const response = await fetch(baseUrl + '/api/data/' + dataSourceId + '/raw-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...__internalHeaders },
      body: JSON.stringify({ query: sql, params: [] }),
    })
    const data = await response.json()
    if (!response.ok) {
      // NEVER forward data.error — database errors quote the failing SQL.
      return fail('query_failed')
    }
    const rows = Array.isArray(data.rows) ? data.rows : []
    return { executed: true, rowCount: rows.length, rows }
  } catch (err: unknown) {
    return fail('query_failed')
  }
}

export const aiSelectDatabaseData: NodeHandlerGenerator = {
  nodeType: 'ai-select-database-data',
  executionEnv: 'server',
  dependencies: AI_PROVIDER_DEPENDENCIES,
  generateHandler(): string {
    return (
      generateAIProviderUtils() +
      '\n\n' +
      generateAiSqlSelectGuard() +
      '\n\n' +
      ai_select_database_data.toString()
    )
  },
  generateServerHandler(): string {
    return (
      generateAIProviderUtils() +
      '\n\n' +
      generateAiSqlSelectGuard() +
      '\n\n' +
      ai_select_database_data.toString()
    )
  },
}
