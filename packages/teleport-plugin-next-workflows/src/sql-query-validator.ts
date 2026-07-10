/**
 * SQL Query Validator
 *
 * Detects forbidden SQL operations in raw queries. Only data-manipulation
 * statements (SELECT, INSERT, UPDATE, DELETE) are allowed. Any operation that
 * alters database structure, permissions, configuration, or system state is
 * rejected.
 *
 * The validator is designed to be reusable:
 *  - At design-time: validating user-entered queries in the workflow editor
 *  - At publish-time: blocking project generation when dangerous queries exist
 *  - At runtime: as a guard in the generated Next.js API routes
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SQLValidationResult {
  isValid: boolean
  violations: SQLViolation[]
}

export interface SQLViolation {
  /** Human-readable category of the violation */
  category: SQLViolationCategory
  /** The matched keyword or pattern that triggered the violation */
  matched: string
  /** Detailed explanation of why this operation is forbidden */
  message: string
}

export type SQLViolationCategory =
  | 'DDL'
  | 'DCL'
  | 'ADMINISTRATIVE'
  | 'TRANSACTION_CONTROL'
  | 'COPY_OPERATION'
  | 'SERVER_CONFIGURATION'
  | 'DANGEROUS_FUNCTION'
  | 'MULTIPLE_STATEMENTS'

// ---------------------------------------------------------------------------
// Forbidden operation patterns
// ---------------------------------------------------------------------------

/**
 * Each entry maps a human-readable label to a regex that matches
 * the forbidden pattern. The regexes operate on SQL that has already
 * been stripped of comments and string-literal contents so they will
 * never false-positive on quoted text.
 *
 * All regexes are case-insensitive and use word-boundary anchors
 * wherever possible so that identifiers like `create_date` do not
 * match.
 */

interface ForbiddenPattern {
  category: SQLViolationCategory
  label: string
  pattern: RegExp
  message: string
}

const DDL_OBJECTS = [
  'TABLE',
  'INDEX',
  'VIEW',
  'MATERIALIZED\\s+VIEW',
  'DATABASE',
  'SCHEMA',
  'SEQUENCE',
  'TYPE',
  'FUNCTION',
  'PROCEDURE',
  'TRIGGER',
  'EXTENSION',
  'ROLE',
  'USER',
  'POLICY',
  'PUBLICATION',
  'SUBSCRIPTION',
  'TABLESPACE',
  'DOMAIN',
  'AGGREGATE',
  'COLLATION',
  'CONVERSION',
  'OPERATOR',
  'RULE',
  'STATISTICS',
  'TEXT\\s+SEARCH',
  'SERVER',
  'FOREIGN\\s+DATA\\s+WRAPPER',
  'FOREIGN\\s+TABLE',
  'EVENT\\s+TRIGGER',
  'ACCESS\\s+METHOD',
].join('|')

const buildDDLPatterns = (): ForbiddenPattern[] => {
  const actions: Array<{
    verb: string
    message: (obj: string) => string
  }> = [
    {
      verb: 'CREATE',
      message: (obj) =>
        `CREATE ${obj} modifies the database schema. Raw queries must only read or manipulate data (SELECT / INSERT / UPDATE / DELETE).`,
    },
    {
      verb: 'ALTER',
      message: (obj) =>
        `ALTER ${obj} modifies the database schema. Raw queries must only read or manipulate data (SELECT / INSERT / UPDATE / DELETE).`,
    },
    {
      verb: 'DROP',
      message: (obj) =>
        `DROP ${obj} permanently removes database objects. Raw queries must only read or manipulate data (SELECT / INSERT / UPDATE / DELETE).`,
    },
  ]

  const patterns: ForbiddenPattern[] = []

  for (const action of actions) {
    patterns.push({
      category: 'DDL',
      label: `${action.verb} <object>`,
      pattern: new RegExp(
        `\\b${action.verb}\\s+(?:OR\\s+REPLACE\\s+)?(?:TEMP(?:ORARY)?\\s+)?(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?(?:UNIQUE\\s+)?(?:CONCURRENTLY\\s+)?(${DDL_OBJECTS})\\b`,
        'i'
      ),
      message: action.message('<detected object>'),
    })
  }

  return patterns
}

const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  // DDL - generated dynamically above
  ...buildDDLPatterns(),

  // TRUNCATE
  {
    category: 'DDL',
    label: 'TRUNCATE',
    pattern: /\bTRUNCATE\b/i,
    message:
      'TRUNCATE removes all rows from a table and cannot be rolled back. Use DELETE with appropriate filters instead if you need to remove data.',
  },

  // RENAME
  {
    category: 'DDL',
    label: 'RENAME',
    pattern: /\bALTER\s+\w+\s+.*?\bRENAME\b/i,
    message:
      'Renaming database objects modifies the schema. Raw queries must only read or manipulate data.',
  },

  // DCL
  {
    category: 'DCL',
    label: 'GRANT',
    pattern: /\bGRANT\b/i,
    message:
      'GRANT changes database permissions, which could compromise security. Permission management is not allowed through raw queries.',
  },
  {
    category: 'DCL',
    label: 'REVOKE',
    pattern: /\bREVOKE\b/i,
    message:
      'REVOKE changes database permissions, which could compromise security. Permission management is not allowed through raw queries.',
  },

  // Administrative
  {
    category: 'ADMINISTRATIVE',
    label: 'VACUUM',
    pattern: /\bVACUUM\b/i,
    message:
      'VACUUM is a database maintenance command that affects performance and locks. Administrative operations are not allowed through raw queries.',
  },
  {
    category: 'ADMINISTRATIVE',
    label: 'ANALYZE (standalone)',
    pattern: /(?<!\bEXPLAIN\s+)\bANALYZE\b/i,
    message:
      'ANALYZE collects statistics about table contents. Administrative operations are not allowed through raw queries.',
  },
  {
    category: 'ADMINISTRATIVE',
    label: 'CLUSTER',
    pattern: /\bCLUSTER\b/i,
    message:
      'CLUSTER physically reorders table data. Administrative operations are not allowed through raw queries.',
  },
  {
    category: 'ADMINISTRATIVE',
    label: 'REINDEX',
    pattern: /\bREINDEX\b/i,
    message:
      'REINDEX rebuilds database indexes. Administrative operations are not allowed through raw queries.',
  },
  {
    category: 'ADMINISTRATIVE',
    label: 'COMMENT ON',
    pattern: /\bCOMMENT\s+ON\b/i,
    message:
      'COMMENT ON modifies database object metadata. Administrative operations are not allowed through raw queries.',
  },
  {
    category: 'ADMINISTRATIVE',
    label: 'SECURITY LABEL',
    pattern: /\bSECURITY\s+LABEL\b/i,
    message:
      'SECURITY LABEL modifies security policies. Administrative operations are not allowed through raw queries.',
  },
  {
    category: 'ADMINISTRATIVE',
    label: 'REASSIGN OWNED',
    pattern: /\bREASSIGN\s+OWNED\b/i,
    message:
      'REASSIGN OWNED transfers ownership of database objects. Administrative operations are not allowed through raw queries.',
  },
  {
    category: 'ADMINISTRATIVE',
    label: 'DROP OWNED',
    pattern: /\bDROP\s+OWNED\b/i,
    message:
      'DROP OWNED removes all objects owned by a role. Administrative operations are not allowed through raw queries.',
  },
  {
    category: 'ADMINISTRATIVE',
    label: 'REFRESH MATERIALIZED VIEW',
    pattern: /\bREFRESH\s+MATERIALIZED\s+VIEW\b/i,
    message:
      'REFRESH MATERIALIZED VIEW rebuilds a materialized view. Administrative operations are not allowed through raw queries.',
  },

  // Transaction control
  {
    category: 'TRANSACTION_CONTROL',
    label: 'BEGIN / START TRANSACTION',
    pattern: /\b(?:BEGIN|START\s+TRANSACTION)\b/i,
    message:
      'Transaction control statements could be used to manipulate execution flow or keep connections open. They are not allowed in raw queries.',
  },
  {
    category: 'TRANSACTION_CONTROL',
    label: 'COMMIT',
    pattern: /\bCOMMIT\b/i,
    message:
      'Transaction control statements could be used to manipulate execution flow. They are not allowed in raw queries.',
  },
  {
    category: 'TRANSACTION_CONTROL',
    label: 'ROLLBACK',
    pattern: /\bROLLBACK\b/i,
    message:
      'Transaction control statements could be used to manipulate execution flow. They are not allowed in raw queries.',
  },
  {
    category: 'TRANSACTION_CONTROL',
    label: 'SAVEPOINT',
    pattern: /\bSAVEPOINT\b/i,
    message: 'Transaction control statements are not allowed in raw queries.',
  },
  {
    category: 'TRANSACTION_CONTROL',
    label: 'RELEASE SAVEPOINT',
    pattern: /\bRELEASE\s+SAVEPOINT\b/i,
    message: 'Transaction control statements are not allowed in raw queries.',
  },

  // COPY operations (file system access)
  {
    category: 'COPY_OPERATION',
    label: 'COPY',
    pattern: /\bCOPY\b/i,
    message:
      'COPY can read from or write to the server file system, which is a critical security risk. It is not allowed in raw queries.',
  },

  // Server configuration
  {
    category: 'SERVER_CONFIGURATION',
    label: 'SET (session variable)',
    pattern: /\bSET\s+(?:SESSION\s+|LOCAL\s+)?(?!CONSTRAINTS)\w/i,
    message:
      'SET modifies server session configuration, which could affect security settings or resource limits. It is not allowed in raw queries.',
  },
  {
    category: 'SERVER_CONFIGURATION',
    label: 'RESET',
    pattern: /\bRESET\s+\w/i,
    message: 'RESET modifies server configuration. It is not allowed in raw queries.',
  },
  {
    category: 'SERVER_CONFIGURATION',
    label: 'LOAD',
    pattern: /\bLOAD\s+'/i,
    message:
      'LOAD loads a shared library into the server, which is a critical security risk. It is not allowed in raw queries.',
  },
  {
    category: 'SERVER_CONFIGURATION',
    label: 'DISCARD',
    pattern: /\bDISCARD\b/i,
    message: 'DISCARD releases server-side resources. It is not allowed in raw queries.',
  },

  // PREPARE / EXECUTE / DEALLOCATE (prepared statement manipulation)
  {
    category: 'SERVER_CONFIGURATION',
    label: 'PREPARE',
    pattern: /\bPREPARE\s+\w+/i,
    message:
      'PREPARE creates server-side prepared statements which could be used to execute arbitrary queries later. It is not allowed in raw queries.',
  },
  {
    category: 'SERVER_CONFIGURATION',
    label: 'EXECUTE (prepared)',
    pattern: /\bEXECUTE\s+\w+/i,
    message: 'EXECUTE runs a previously prepared statement. It is not allowed in raw queries.',
  },
  {
    category: 'SERVER_CONFIGURATION',
    label: 'DEALLOCATE',
    pattern: /\bDEALLOCATE\b/i,
    message: 'DEALLOCATE releases prepared statements. It is not allowed in raw queries.',
  },

  // LISTEN / NOTIFY (asynchronous communication)
  {
    category: 'SERVER_CONFIGURATION',
    label: 'LISTEN',
    pattern: /\bLISTEN\b/i,
    message:
      'LISTEN registers for asynchronous notifications, which could keep connections open. It is not allowed in raw queries.',
  },
  {
    category: 'SERVER_CONFIGURATION',
    label: 'NOTIFY',
    pattern: /\bNOTIFY\b/i,
    message: 'NOTIFY sends asynchronous notifications. It is not allowed in raw queries.',
  },
  {
    category: 'SERVER_CONFIGURATION',
    label: 'UNLISTEN',
    pattern: /\bUNLISTEN\b/i,
    message:
      'UNLISTEN deregisters from asynchronous notifications. It is not allowed in raw queries.',
  },
]

// ---------------------------------------------------------------------------
// Dangerous PostgreSQL functions
// ---------------------------------------------------------------------------

interface DangerousFunction {
  name: string
  message: string
}

const DANGEROUS_FUNCTIONS: DangerousFunction[] = [
  // File system access
  {
    name: 'pg_read_file',
    message:
      'pg_read_file reads files from the server filesystem. This is a critical security risk and is not allowed.',
  },
  {
    name: 'pg_read_binary_file',
    message:
      'pg_read_binary_file reads binary files from the server filesystem. This is a critical security risk and is not allowed.',
  },
  {
    name: 'pg_stat_file',
    message:
      'pg_stat_file exposes server filesystem metadata. This is a security risk and is not allowed.',
  },
  {
    name: 'pg_ls_dir',
    message:
      'pg_ls_dir lists server directory contents. This is a critical security risk and is not allowed.',
  },
  {
    name: 'pg_ls_logdir',
    message: 'pg_ls_logdir lists the log directory. This is a security risk and is not allowed.',
  },
  {
    name: 'pg_ls_waldir',
    message: 'pg_ls_waldir lists the WAL directory. This is a security risk and is not allowed.',
  },

  // Large object operations (file I/O)
  {
    name: 'lo_import',
    message:
      'lo_import loads a file from the server filesystem into a large object. This is a security risk and is not allowed.',
  },
  {
    name: 'lo_export',
    message:
      'lo_export writes a large object to the server filesystem. This is a critical security risk and is not allowed.',
  },
  {
    name: 'lo_create',
    message:
      'lo_create creates large objects which can be used to stage data for file I/O. This is not allowed.',
  },
  {
    name: 'lo_unlink',
    message: 'lo_unlink deletes large objects. This is not allowed.',
  },

  // Process/backend control
  {
    name: 'pg_terminate_backend',
    message:
      'pg_terminate_backend kills other database connections. This could cause denial of service and is not allowed.',
  },
  {
    name: 'pg_cancel_backend',
    message:
      'pg_cancel_backend cancels queries on other connections. This could cause denial of service and is not allowed.',
  },
  {
    name: 'pg_reload_conf',
    message:
      'pg_reload_conf reloads the server configuration. This is an administrative action and is not allowed.',
  },
  {
    name: 'pg_rotate_logfile',
    message:
      'pg_rotate_logfile rotates the server log file. This is an administrative action and is not allowed.',
  },

  // Configuration manipulation
  {
    name: 'set_config',
    message:
      'set_config modifies server runtime configuration, which could alter security settings. This is not allowed.',
  },

  // Resource exhaustion
  {
    name: 'pg_sleep',
    message:
      'pg_sleep pauses execution for a specified duration. This could be used for denial-of-service attacks and is not allowed.',
  },
  {
    name: 'pg_sleep_for',
    message:
      'pg_sleep_for pauses execution. This could be used for denial-of-service attacks and is not allowed.',
  },
  {
    name: 'pg_sleep_until',
    message:
      'pg_sleep_until pauses execution. This could be used for denial-of-service attacks and is not allowed.',
  },

  // External connections
  {
    name: 'dblink',
    message:
      'dblink opens connections to external databases. This could be used to exfiltrate data or pivot to other systems and is not allowed.',
  },
  {
    name: 'dblink_connect',
    message: 'dblink_connect opens connections to external databases. This is not allowed.',
  },
  {
    name: 'dblink_exec',
    message: 'dblink_exec executes commands on external databases. This is not allowed.',
  },

  // Advisory locks (can cause deadlocks/resource exhaustion)
  {
    name: 'pg_advisory_lock',
    message:
      'pg_advisory_lock acquires advisory locks that persist for the session. This could cause resource exhaustion and is not allowed.',
  },
  {
    name: 'pg_advisory_xact_lock',
    message:
      'pg_advisory_xact_lock acquires advisory locks. This could cause resource exhaustion and is not allowed.',
  },
  {
    name: 'pg_try_advisory_lock',
    message: 'pg_try_advisory_lock attempts to acquire advisory locks. This is not allowed.',
  },

  // Query plan manipulation
  {
    name: 'pg_catalog\\.set_config',
    message:
      'pg_catalog.set_config modifies system configuration via the catalog. This is not allowed.',
  },
]

// ---------------------------------------------------------------------------
// SQL stripping (comments and string literals)
// ---------------------------------------------------------------------------

/**
 * Strips SQL comments and string literal *contents* from the input so that
 * pattern matching only operates on actual SQL keywords.
 *
 * Handles:
 *  - Single-line comments: `-- ... \n`
 *  - Block comments: `/* ... * /` (including nesting)
 *  - Single-quoted strings: `'...'` with `''` escape
 *  - Dollar-quoted strings: `$$...$$` and `$tag$...$tag$`
 *  - Double-quoted identifiers: `"..."` are preserved (they are identifiers)
 *
 * Returns the SQL with all comment content removed and string literal contents
 * replaced with empty strings (the quotes are preserved).
 */
export const stripCommentsAndStrings = (sql: string): string => {
  const result: string[] = []
  let i = 0
  const len = sql.length

  while (i < len) {
    // Single-line comment
    if (sql[i] === '-' && i + 1 < len && sql[i + 1] === '-') {
      const newlineIdx = sql.indexOf('\n', i + 2)
      if (newlineIdx === -1) {
        // Comment extends to end of string
        break
      }
      result.push(' ')
      i = newlineIdx + 1
      continue
    }

    // Block comment (supports nesting)
    if (sql[i] === '/' && i + 1 < len && sql[i + 1] === '*') {
      let depth = 1
      let j = i + 2
      while (j < len && depth > 0) {
        if (sql[j] === '/' && j + 1 < len && sql[j + 1] === '*') {
          depth++
          j += 2
        } else if (sql[j] === '*' && j + 1 < len && sql[j + 1] === '/') {
          depth--
          j += 2
        } else {
          j++
        }
      }
      result.push(' ')
      i = j
      continue
    }

    // Dollar-quoted string: $tag$...$tag$ or $$...$$
    if (sql[i] === '$') {
      const tagMatch = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/)
      if (tagMatch) {
        const openTag = tagMatch[0]
        const closeIdx = sql.indexOf(openTag, i + openTag.length)
        if (closeIdx !== -1) {
          // Replace content with empty but keep the structure recognizable as a string
          result.push("''")
          i = closeIdx + openTag.length
          continue
        }
      }
    }

    // Single-quoted string
    if (sql[i] === "'") {
      let j = i + 1
      while (j < len) {
        if (sql[j] === "'") {
          if (j + 1 < len && sql[j + 1] === "'") {
            // Escaped quote
            j += 2
          } else {
            break
          }
        } else {
          j++
        }
      }
      // Replace string content with empty
      result.push("''")
      i = j + 1
      continue
    }

    // Double-quoted identifier (preserve as-is since these are identifiers, not values)
    if (sql[i] === '"') {
      let j = i + 1
      while (j < len) {
        if (sql[j] === '"') {
          if (j + 1 < len && sql[j + 1] === '"') {
            j += 2
          } else {
            break
          }
        } else {
          j++
        }
      }
      // Replace identifier content with empty but keep quotes
      result.push('""')
      i = j + 1
      continue
    }

    result.push(sql[i])
    i++
  }

  return result.join('')
}

// ---------------------------------------------------------------------------
// Multi-statement detection
// ---------------------------------------------------------------------------

/**
 * Detects multiple SQL statements separated by semicolons.
 * Ignores semicolons inside comments and string literals (already stripped).
 * Also ignores a trailing semicolon after the last statement.
 */
export const containsMultipleStatements = (strippedSQL: string): boolean => {
  const trimmed = strippedSQL.trim().replace(/;\s*$/, '')
  return trimmed.includes(';')
}

// ---------------------------------------------------------------------------
// Core validation
// ---------------------------------------------------------------------------

/**
 * Validates a SQL query string and returns all violations found.
 *
 * @param query - The raw SQL query to validate
 * @returns Validation result with all detected violations
 */
export const validateSQLQuery = (query: string): SQLValidationResult => {
  if (!query || typeof query !== 'string') {
    return { isValid: true, violations: [] }
  }

  const stripped = stripCommentsAndStrings(query)
  const violations: SQLViolation[] = []

  // Check for multiple statements (semicolon-separated)
  if (containsMultipleStatements(stripped)) {
    violations.push({
      category: 'MULTIPLE_STATEMENTS',
      matched: ';',
      message:
        'Multiple SQL statements separated by semicolons are not allowed. Each raw query node should contain exactly one statement. Multiple statements could be used to inject harmful operations alongside a legitimate query.',
    })
  }

  // Check forbidden patterns
  for (const fp of FORBIDDEN_PATTERNS) {
    const match = stripped.match(fp.pattern)
    if (match) {
      violations.push({
        category: fp.category,
        matched: match[0].trim(),
        message: fp.message,
      })
    }
  }

  // Check dangerous functions
  for (const df of DANGEROUS_FUNCTIONS) {
    const escapedName = df.name.replace(/\./g, '\\.')
    const funcPattern = new RegExp(`\\b${escapedName}\\s*\\(`, 'i')
    const match = stripped.match(funcPattern)
    if (match) {
      violations.push({
        category: 'DANGEROUS_FUNCTION',
        matched: match[0].trim(),
        message: df.message,
      })
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
  }
}

// ---------------------------------------------------------------------------
// Raw-query parameterization safety
// ---------------------------------------------------------------------------

/**
 * Matches a single `{{ … }}` workflow-context template token anywhere in a
 * string (non-greedy to the first `}}`). A token surviving in the SQL TEXT is
 * the SQL-injection signal — the workflow executor substitutes it TEXTUALLY
 * into the query. Parameterized binds use `$1` / `$2` placeholders instead.
 */
export const RAW_QUERY_TEMPLATE_TOKEN_RE = /\{\{[\s\S]+?\}\}/

export interface RawQuerySafetyWarning {
  /** Stable id, aligned with the design-time security rule catalogue. */
  ruleId: 'sql-unparameterized-context'
  message: string
}

export interface RawQuerySafetyResult {
  /** True when no `{{ … }}` token remains in the SQL text (safe / parameterized). */
  isSafe: boolean
  /** Informational security warnings — empty for a correctly-parameterized query. */
  warnings: RawQuerySafetyWarning[]
}

/**
 * Assess whether a raw-SQL string is safely PARAMETERIZED.
 *
 * SAFE (zero warnings): the SQL text carries only positional `$N` placeholders
 * and every workflow-context/state value lives in the sibling `params`
 * (`rawQueryUserPartParams`) array, bound at runtime via
 * `client.query(sql, params)`. A bound value can never terminate a string
 * literal or alter query structure, so injection is impossible for that class.
 * A `{{ … }}` token appearing in the `params` array is the CORRECT, safe home
 * for it and is intentionally NOT inspected here — only the SQL text is scanned.
 *
 * UNSAFE (one warning): a `{{ … }}` template token still appears in the SQL
 * TEXT. The executor substitutes it textually, so an attacker-controlled value
 * (e.g. a search term containing `'`) can break out and inject SQL. Post-net
 * this should never happen — the generation-time net rewrites every value
 * interpolation into `$N` and fails loud on anything it cannot bind — but the
 * check stays as a runtime/publish-time backstop.
 *
 * @param query - The raw SQL text (e.g. `data-raw-query.query` /
 *                `data-select.rawQueryUserPart`).
 */
export const analyzeRawQueryParameterization = (query: unknown): RawQuerySafetyResult => {
  if (typeof query !== 'string' || !RAW_QUERY_TEMPLATE_TOKEN_RE.test(query)) {
    return { isSafe: true, warnings: [] }
  }
  return {
    isSafe: false,
    warnings: [
      {
        ruleId: 'sql-unparameterized-context',
        message:
          'Raw SQL interpolates a workflow context value with `{{...}}` directly into the ' +
          'query text. If that value is influenced by external input it could be used for ' +
          'SQL injection. Bind the value via the query parameter list (e.g. `$1`) instead.',
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Context value risk assessment
// ---------------------------------------------------------------------------

/**
 * Node types whose output is directly derived from external or
 * user-controlled input. When the output of these nodes is used
 * inside a raw SQL query, we cannot guarantee the query is safe
 * at design-time.
 */
const HIGH_RISK_SOURCE_NODES = new Set([
  // Direct user input
  'general-extract-form-data',
  'browser-clipboard-read',
  'url-get-query-parameter',
  'url-get-current-url',
  'element-get-input-value',

  // External / network input
  'general-http-request',
  'general-custom-js',

  // AI-generated content (unpredictable)
  'ai-custom-prompt',
  'ai-detect-language',
  'ai-generate-embedding',
  'ai-sentiment',
  'ai-summarization',
  'ai-text-classifier',
  'ai-text-transform',

  // Realtime messages from other users
  'realtime-on-channel-message',
  'realtime-on-channel-event',

  // Data that could originate from user input stored in DB
  'data-select',
  'data-raw-query',

  // Browser storage (can be manipulated via devtools)
  'storage-local-get',
  'storage-session-get',
])

/**
 * Returns true if the node type produces output that is potentially
 * user-controlled and therefore unsafe to embed in raw SQL without
 * validation.
 */
export const isHighRiskSourceNode = (nodeType: string): boolean => {
  if (HIGH_RISK_SOURCE_NODES.has(nodeType)) {
    return true
  }
  // All integration nodes return external data
  if (nodeType.startsWith('integration-')) {
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Exports for documentation / downstream consumers
// ---------------------------------------------------------------------------

/** All forbidden pattern definitions (for documentation generation) */
export const getForbiddenPatterns = (): ReadonlyArray<ForbiddenPattern> => FORBIDDEN_PATTERNS

/** All dangerous function definitions (for documentation generation) */
export const getDangerousFunctions = (): ReadonlyArray<DangerousFunction> => DANGEROUS_FUNCTIONS
