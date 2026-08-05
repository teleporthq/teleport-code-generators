/**
 * SECURITY NET — parameterize interpolated context/state values in raw-SQL nodes.
 *
 * Runs at GENERATION time (in the workflows plugin's `runBefore`), BEFORE any
 * node config is emitted or redacted. For every raw-SQL-bearing node config it
 * rewrites each `{{ … }}` VALUE interpolation into a positional `$N` placeholder
 * and moves the bound value into the sibling `params` / `rawQueryUserPartParams`
 * array:
 *   - a `{{ name }}` matching a `queryVariables` entry binds that entry's value
 *     (a `workflowContext` ref, resolved to the node output at runtime, or a
 *     literal string);
 *   - any other `{{ … }}` token (e.g. `{{state.X}}`) keeps its `{{ … }}` text in
 *     the params entry so the runtime executor resolves it to a concrete value.
 * Either way the value binds via `client.query(sql, params)`, never as inline
 * SQL text — SQL injection is impossible for the value class. Identifier-position
 * tokens (and context refs inside a string literal) cannot be bound, so they are
 * left in the query and reported as residuals; the workflow FAILS LOUDLY.
 *
 * PAIRED with the GUI source-of-truth
 * `teleport-gui/packages/workflow-schema/src/validation/raw-sql-param-binding.ts`
 * and the worker's
 * `teleport-services-worker/.../ai-generation/utils/workflows/raw-sql-param-binding.ts`.
 * Keep all three in sync.
 */

interface WorkflowContextRef {
  type: 'workflowContext'
  nodeId: string
  path: string[]
}

type RawSqlBoundParam = string | WorkflowContextRef

interface RawQueryContextVariable {
  name: string
  value: RawSqlBoundParam
}

const TEMPLATE_TOKEN_RE = /\{\{[\s\S]*?\}\}/g

const SENTINEL = '\x01'
const SENTINEL_MARKER = 'TQP'
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const LEADING_SENTINEL_RE = new RegExp(
  `^${escapeRegExp(SENTINEL)}${SENTINEL_MARKER}(\\d+)${escapeRegExp(SENTINEL)}`
)
const SENTINEL_EXPAND_RE = new RegExp(
  `${escapeRegExp(SENTINEL)}${SENTINEL_MARKER}(\\d+)${escapeRegExp(SENTINEL)}`,
  'g'
)

const VALUE_OPERATOR_CHARS = '=<>(,+-*/%|~'
// CASE/WHEN/THEN/ELSE are value positions: the sanctioned sort idiom the
// raw-sql node spec itself prescribes ("ORDER BY CASE {{ sortKey }} WHEN
// 'name' THEN name …" / "CASE WHEN {{ sortKey }} = 'x' THEN col") puts the
// bound token right after them. Round-7 run 3d75cfa9 refused three {{sortKey}}
// tokens in exactly that shape — the model had followed the spec verbatim and
// every sortable list's workflow was dropped. A bound parameter in these
// positions is valid SQL; a model that MEANT a dynamic identifier there gets a
// harmless value comparison, never SQL text.
const VALUE_KEYWORDS: ReadonlySet<string> = new Set([
  'LIKE',
  'ILIKE',
  'IN',
  'VALUES',
  'LIMIT',
  'OFFSET',
  'AND',
  'OR',
  'BETWEEN',
  // A token directly after CASE/WHEN/THEN/ELSE is a VALUE being compared or
  // produced — never an identifier — so it binds as `$N` like any other value.
  //
  // Run d27cd823: the Dashboard's date-range filter wrote
  //   CASE WHEN {{ dateRange }} = 'today' THEN … WHEN {{ dateRange }} = '7d' THEN … END
  // Without `WHEN` here, `isValueContext` said "not a value", the token stayed
  // literal, and the whole workflow was REJECTED as un-parameterisable — three
  // Dashboard filter workflows were dropped and the quick date filters shipped
  // dead. Binding them is also the SAFER outcome: a bound parameter can never be
  // interpreted as an identifier, which is exactly what the guard protects against.
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
])

// `FROM` normally introduces a table name, so it is deliberately absent from
// VALUE_KEYWORDS — but inside `TRIM([BOTH|LEADING|TRAILING] [chars] FROM expr)`
// the word after FROM is the VALUE being trimmed, not an identifier. The alerts
// filter fixture wrote `TRIM(BOTH FROM {{statusFilterSegment}})` and the whole
// project generation was refused. Matching the trim-function prefix keeps
// `SELECT * FROM {{table}}` rejected while binding the trim operand.
const TRIM_FROM_VALUE_RE = /\bTRIM\s*\(\s*(?:(?:BOTH|LEADING|TRAILING)\b[^()]*?)?FROM$/i

function isValueContext(prefix: string): boolean {
  const trimmed = prefix.replace(/\s+$/, '')
  if (trimmed.length === 0) {
    return false
  }
  const last = trimmed[trimmed.length - 1]
  if (VALUE_OPERATOR_CHARS.indexOf(last) !== -1) {
    return true
  }
  const wordMatch = /([A-Za-z_]+)$/.exec(trimmed)
  if (wordMatch && VALUE_KEYWORDS.has(wordMatch[1].toUpperCase())) {
    return true
  }
  if (wordMatch && wordMatch[1].toUpperCase() === 'FROM' && TRIM_FROM_VALUE_RE.test(trimmed)) {
    return true
  }
  return false
}

function maxExistingPlaceholder(query: string): number {
  let max = 0
  const re = /\$(\d+)/g
  let m: RegExpExecArray | null = re.exec(query)
  while (m !== null) {
    const n = parseInt(m[1], 10)
    if (n > max) {
      max = n
    }
    m = re.exec(query)
  }
  return max
}

function tokenName(token: string): string {
  return token
    .replace(/^\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .trim()
}

function indexVariables(
  variables: readonly RawQueryContextVariable[] | undefined
): Map<string, RawSqlBoundParam> {
  const map = new Map<string, RawSqlBoundParam>()
  if (!Array.isArray(variables)) {
    return map
  }
  for (const v of variables) {
    if (v && typeof v.name === 'string' && v.name.length > 0) {
      map.set(v.name, v.value)
    }
  }
  return map
}

function isContextRef(value: unknown): value is WorkflowContextRef {
  return (
    !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'workflowContext'
  )
}

export interface ParameterizeResult {
  query: string
  params: RawSqlBoundParam[]
  residuals: string[]
  changed: boolean
}

export function parameterizeRawSqlInterpolations(
  rawQuery: string,
  variables: readonly RawQueryContextVariable[] = [],
  startIndex = 0
): ParameterizeResult {
  if (typeof rawQuery !== 'string' || rawQuery.indexOf('{{') === -1) {
    return { query: rawQuery, params: [], residuals: [], changed: false }
  }

  const varMap = indexVariables(variables)
  const paramFor = (token: string): RawSqlBoundParam => {
    const match = varMap.get(tokenName(token))
    return match !== undefined ? match : token
  }

  const tokens: string[] = []
  const sentinelized = rawQuery.replace(TEMPLATE_TOKEN_RE, (match) => {
    const idx = tokens.length
    tokens.push(match)
    return `${SENTINEL}TQP${idx}${SENTINEL}`
  })

  const expand = (s: string): string =>
    s.replace(SENTINEL_EXPAND_RE, (_full, d: string) => tokens[parseInt(d, 10)])

  const params: RawSqlBoundParam[] = []
  let out = ''
  let i = 0
  let paramN = Math.max(startIndex, maxExistingPlaceholder(rawQuery))
  const n = sentinelized.length

  while (i < n) {
    const ch = sentinelized[i]

    if (ch === "'") {
      let j = i + 1
      let body = ''
      let closed = false
      while (j < n) {
        if (sentinelized[j] === "'" && sentinelized[j + 1] === "'") {
          body += "''"
          j += 2
          continue
        }
        if (sentinelized[j] === "'") {
          j++
          closed = true
          break
        }
        body += sentinelized[j]
        j++
      }
      const bodyTokens = expand(body).match(TEMPLATE_TOKEN_RE) ?? []
      const hasRefToken = bodyTokens.some((t) => isContextRef(paramFor(t)))
      if (closed && body.indexOf(SENTINEL) !== -1 && !hasRefToken) {
        paramN++
        params.push(expand(body).replace(/''/g, "'"))
        out += '$' + paramN
      } else {
        out += "'" + expand(body) + (closed ? "'" : '')
      }
      i = j
      continue
    }

    if (ch === SENTINEL) {
      const m = LEADING_SENTINEL_RE.exec(sentinelized.slice(i))
      if (m) {
        const token = tokens[parseInt(m[1], 10)]
        if (isValueContext(out)) {
          paramN++
          params.push(paramFor(token))
          out += '$' + paramN
        } else {
          out += token
        }
        i += m[0].length
        continue
      }
    }

    out += ch
    i++
  }

  out = expand(out)
  const residuals = out.match(TEMPLATE_TOKEN_RE) ?? []

  return {
    query: out,
    params,
    residuals,
    changed: params.length > 0 || residuals.length > 0,
  }
}

export class WorkflowSqlInterpolationError extends Error {
  residualsByNode: Array<{ nodeId: string; field: string; residuals: string[] }>

  constructor(residualsByNode: Array<{ nodeId: string; field: string; residuals: string[] }>) {
    const detail = residualsByNode
      .map((r) => `${r.nodeId}.${r.field}: ${r.residuals.join(', ')}`)
      .join('; ')
    super(
      `Raw-SQL node interpolates a value that cannot be safely parameterized ` +
        `(a dynamic identifier — table/column name — or a context ref inside a ` +
        `string literal): ${detail}. Refusing to ship injectable SQL.`
    )
    // Restore the prototype chain — `extends Error` loses it when this module is
    // downlevelled to ES5, which would break `instanceof` checks.
    Object.setPrototypeOf(this, WorkflowSqlInterpolationError.prototype)
    this.name = 'WorkflowSqlInterpolationError'
    this.residualsByNode = residualsByNode
  }
}

interface RawSqlField {
  nodeType: string
  queryField: string
  variablesField: string
  paramsField: string
}

const RAW_SQL_FIELDS: readonly RawSqlField[] = [
  {
    nodeType: 'data-raw-query',
    queryField: 'query',
    variablesField: 'queryVariables',
    paramsField: 'params',
  },
  {
    nodeType: 'data-select',
    queryField: 'rawQueryUserPart',
    variablesField: 'rawQueryUserPartVariables',
    paramsField: 'rawQueryUserPartParams',
  },
  {
    nodeType: 'data-count',
    queryField: 'rawQueryUserPart',
    variablesField: 'rawQueryUserPartVariables',
    paramsField: 'rawQueryUserPartParams',
  },
]

interface MinimalWorkflowNode {
  id?: string
  type?: string
  data?: { nodeType?: string; config?: Record<string, unknown> }
  config?: Record<string, unknown>
}

function nodeConfigOf(node: MinimalWorkflowNode): Record<string, unknown> | undefined {
  return node.data?.config ?? node.config
}

function nodeTypeOf(node: MinimalWorkflowNode): string | undefined {
  return node.data?.nodeType ?? node.type
}

/**
 * Convert every raw-SQL node's `{{ name }}` interpolations in one workflow into
 * bound `$N` params, in place. All-or-nothing: mutates only when EVERY raw-SQL
 * node is safe; otherwise throws {@link WorkflowSqlInterpolationError} and leaves
 * the workflow untouched. `nodes` may be an array or an id-keyed record.
 */
export function parameterizeWorkflowRawSqlInterpolations(workflow: {
  nodes?: MinimalWorkflowNode[] | Record<string, MinimalWorkflowNode>
}): void {
  const rawNodes = workflow?.nodes
  const nodes: MinimalWorkflowNode[] = Array.isArray(rawNodes)
    ? rawNodes
    : rawNodes && typeof rawNodes === 'object'
    ? (Object.values(rawNodes) as MinimalWorkflowNode[])
    : []

  const pendingWrites: Array<{
    config: Record<string, unknown>
    queryField: string
    variablesField: string
    paramsField: string
    newQuery: string
    newParams: RawSqlBoundParam[]
  }> = []
  const residualsByNode: Array<{ nodeId: string; field: string; residuals: string[] }> = []

  for (const node of nodes) {
    const nodeType = nodeTypeOf(node)
    const spec = RAW_SQL_FIELDS.find((f) => f.nodeType === nodeType)
    if (!spec) {
      continue
    }
    const config = nodeConfigOf(node)
    if (!config) {
      continue
    }
    const rawQuery = config[spec.queryField]
    if (typeof rawQuery !== 'string' || rawQuery.indexOf('{{') === -1) {
      continue
    }

    const variables = Array.isArray(config[spec.variablesField])
      ? (config[spec.variablesField] as RawQueryContextVariable[])
      : []
    const existingParams = Array.isArray(config[spec.paramsField])
      ? (config[spec.paramsField] as RawSqlBoundParam[])
      : []
    const result = parameterizeRawSqlInterpolations(rawQuery, variables, existingParams.length)

    if (result.residuals.length > 0) {
      residualsByNode.push({
        nodeId: node.id ?? 'node',
        field: spec.queryField,
        residuals: result.residuals,
      })
      continue
    }
    if (result.params.length === 0) {
      // Nothing to bind — still drop an empty variables field for tidiness.
      pendingWrites.push({
        config,
        queryField: spec.queryField,
        variablesField: spec.variablesField,
        paramsField: spec.paramsField,
        newQuery: rawQuery,
        newParams: existingParams,
      })
      continue
    }

    pendingWrites.push({
      config,
      queryField: spec.queryField,
      variablesField: spec.variablesField,
      paramsField: spec.paramsField,
      newQuery: result.query,
      newParams: [...existingParams, ...result.params],
    })
  }

  if (residualsByNode.length > 0) {
    throw new WorkflowSqlInterpolationError(residualsByNode)
  }

  for (const w of pendingWrites) {
    w.config[w.queryField] = w.newQuery
    if (w.newParams.length > 0) {
      w.config[w.paramsField] = w.newParams
    }
    delete w.config[w.variablesField]
  }
}

/**
 * Runs the parameterization net across every workflow and custom node in a UIDL
 * `workflows` block, in place. Throws {@link WorkflowSqlInterpolationError} if any
 * raw-SQL node cannot be fully parameterized.
 */
export function parameterizeAllWorkflowRawSql(
  workflows:
    | { workflows?: Record<string, unknown>; customNodes?: Record<string, unknown> }
    | undefined
): void {
  if (!workflows) {
    return
  }
  const groups = [workflows.workflows, workflows.customNodes]
  for (const group of groups) {
    if (!group || typeof group !== 'object') {
      continue
    }
    for (const wf of Object.values(group)) {
      parameterizeWorkflowRawSqlInterpolations(
        wf as { nodes?: MinimalWorkflowNode[] | Record<string, MinimalWorkflowNode> }
      )
    }
  }
}
