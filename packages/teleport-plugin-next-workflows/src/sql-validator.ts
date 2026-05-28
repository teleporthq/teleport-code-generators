/**
 * Generates the runtime SQL validation code that is embedded in the
 * Next.js data API route.  Every query – whether built from structured
 * parameters or supplied as a raw string – is validated **before** it
 * reaches the database.
 *
 * The generated code exposes two helpers:
 *   • validateSqlQuery(sql)        – rejects forbidden DDL / DCL statements
 *   • validateIdentifier(name)     – rejects identifiers that are not safe
 *                                     to interpolate into SQL
 */

// ---------------------------------------------------------------------------
// Forbidden-operation regex patterns
// ---------------------------------------------------------------------------
// Each entry is [regex-source (case-insensitive), human-readable label].
// The patterns operate on *cleaned* SQL (comments & string literals removed,
// whitespace collapsed).

const FORBIDDEN_PATTERNS: Array<[string, string]> = [
  // ── CREATE operations ────────────────────────────────────────────────
  [
    '\\bcreate\\s+(?:temporary\\s+|temp\\s+|unlogged\\s+|global\\s+|local\\s+)?table\\b',
    'CREATE TABLE',
  ],
  ['\\bcreate\\s+(?:unique\\s+)?index\\b', 'CREATE INDEX'],
  ['\\bcreate\\s+(?:or\\s+replace\\s+)?(?:materialized\\s+)?view\\b', 'CREATE VIEW'],
  ['\\bcreate\\s+(?:or\\s+replace\\s+)?trigger\\b', 'CREATE TRIGGER'],
  ['\\bcreate\\s+(?:or\\s+replace\\s+)?(?:aggregate\\s+)?function\\b', 'CREATE FUNCTION'],
  ['\\bcreate\\s+(?:or\\s+replace\\s+)?procedure\\b', 'CREATE PROCEDURE'],
  ['\\bcreate\\s+database\\b', 'CREATE DATABASE'],
  ['\\bcreate\\s+schema\\b', 'CREATE SCHEMA'],
  ['\\bcreate\\s+sequence\\b', 'CREATE SEQUENCE'],
  ['\\bcreate\\s+extension\\b', 'CREATE EXTENSION'],
  ['\\bcreate\\s+type\\b', 'CREATE TYPE'],
  ['\\bcreate\\s+role\\b', 'CREATE ROLE'],
  ['\\bcreate\\s+user\\b', 'CREATE USER'],

  // ── ALTER operations ─────────────────────────────────────────────────
  ['\\balter\\s+table\\b', 'ALTER TABLE'],
  ['\\balter\\s+index\\b', 'ALTER INDEX'],
  ['\\balter\\s+(?:materialized\\s+)?view\\b', 'ALTER VIEW'],
  ['\\balter\\s+database\\b', 'ALTER DATABASE'],
  ['\\balter\\s+schema\\b', 'ALTER SCHEMA'],
  ['\\balter\\s+sequence\\b', 'ALTER SEQUENCE'],
  ['\\balter\\s+extension\\b', 'ALTER EXTENSION'],
  ['\\balter\\s+type\\b', 'ALTER TYPE'],
  ['\\balter\\s+role\\b', 'ALTER ROLE'],
  ['\\balter\\s+user\\b', 'ALTER USER'],

  // ── DROP operations ──────────────────────────────────────────────────
  ['\\bdrop\\s+(?:temporary\\s+|temp\\s+)?table\\b', 'DROP TABLE'],
  ['\\bdrop\\s+index\\b', 'DROP INDEX'],
  ['\\bdrop\\s+(?:materialized\\s+)?view\\b', 'DROP VIEW'],
  ['\\bdrop\\s+trigger\\b', 'DROP TRIGGER'],
  ['\\bdrop\\s+(?:aggregate\\s+)?function\\b', 'DROP FUNCTION'],
  ['\\bdrop\\s+procedure\\b', 'DROP PROCEDURE'],
  ['\\bdrop\\s+database\\b', 'DROP DATABASE'],
  ['\\bdrop\\s+schema\\b', 'DROP SCHEMA'],
  ['\\bdrop\\s+sequence\\b', 'DROP SEQUENCE'],
  ['\\bdrop\\s+extension\\b', 'DROP EXTENSION'],
  ['\\bdrop\\s+type\\b', 'DROP TYPE'],
  ['\\bdrop\\s+role\\b', 'DROP ROLE'],
  ['\\bdrop\\s+user\\b', 'DROP USER'],

  // ── TRUNCATE ─────────────────────────────────────────────────────────
  ['\\btruncate\\b', 'TRUNCATE'],

  // ── RENAME ───────────────────────────────────────────────────────────
  ['\\brename\\s+table\\b', 'RENAME TABLE'],

  // ── Permission / DCL ─────────────────────────────────────────────────
  ['\\bgrant\\s+', 'GRANT'],
  ['\\brevoke\\s+', 'REVOKE'],

  // ── Metadata ─────────────────────────────────────────────────────────
  [
    '\\bcomment\\s+on\\s+(?:table|column|index|view|function|procedure|trigger|schema|database|sequence|type|role|extension)\\b',
    'COMMENT ON',
  ],

  // ── SELECT INTO (creates a new table from query results) ─────────────
  // Anchored to statement start to avoid matching INSERT INTO ... SELECT
  ['^select\\b[\\s\\S]*\\binto\\b', 'SELECT INTO'],

  // ── DO blocks (PL/pgSQL anonymous blocks can hide forbidden ops) ─────
  // After string-literal stripping, DO $$ ... $$ becomes DO ''
  // We must block DO blocks because their contents are invisible after
  // stripping and could contain any forbidden operation.
  ['^do\\b', 'DO (anonymous code block)'],

  // ── Dangerous session / config changes ───────────────────────────────
  ['\\bset\\s+role\\b', 'SET ROLE'],
  ['\\breset\\s+role\\b', 'RESET ROLE'],
  ['\\bset\\s+session\\s+authorization\\b', 'SET SESSION AUTHORIZATION'],

  // ── COPY (file-system access) ────────────────────────────────────────
  // Anchored to statement start to avoid false positives with column
  // names like "copy" in SELECT queries.
  ['^copy\\b', 'COPY'],

  // ── EXECUTE / PREPARE / DEALLOCATE (prepared statements / dynamic SQL)
  // Anchored to statement start to avoid false positives with identifiers.
  ['^execute\\b', 'EXECUTE'],
  ['^prepare\\b', 'PREPARE'],
  ['^deallocate\\b', 'DEALLOCATE'],

  // ── VACUUM / REINDEX (maintenance ops that can affect performance) ───
  // Anchored to statement start to avoid false positives.
  ['^vacuum\\b', 'VACUUM'],
  ['^reindex\\b', 'REINDEX'],
]

// ---------------------------------------------------------------------------
// Code generator
// ---------------------------------------------------------------------------

/**
 * Returns a JS code string containing:
 *   - stripSqlComments(sql)
 *   - stripStringLiterals(sql)
 *   - cleanSqlForValidation(sql)
 *   - validateSqlQuery(sql)          → { valid, error?, matchedOperation? }
 *   - validateIdentifier(name)       → { valid, error? }
 *   - assertQuerySafe(sql)           → throws on forbidden ops
 *   - assertIdentifierSafe(name, label) → throws on bad identifiers
 */
export function generateSqlValidatorCode(): string {
  // Build the forbidden-patterns array as a JS literal
  const patternsJS = FORBIDDEN_PATTERNS.map(
    ([src, label]) => `  [/${src}/i, ${JSON.stringify(label)}]`
  ).join(',\n')

  return `
// ═══════════════════════════════════════════════════════════════════════════
// SQL Validation – generated by teleport-plugin-next-workflows
// ═══════════════════════════════════════════════════════════════════════════

var FORBIDDEN_SQL_PATTERNS = [
${patternsJS}
];

/**
 * Remove single-line (--) and multi-line comments from SQL.
 */
function stripSqlComments(sql) {
  var result = '';
  var i = 0;
  var len = sql.length;
  while (i < len) {
    // Single-line comment
    if (sql[i] === '-' && i + 1 < len && sql[i + 1] === '-') {
      // Skip until newline
      while (i < len && sql[i] !== '\\n') i++;
      continue;
    }
    // Multi-line comment (supports nesting)
    if (sql[i] === '/' && i + 1 < len && sql[i + 1] === '*') {
      i += 2;
      var depth = 1;
      while (i < len && depth > 0) {
        if (sql[i] === '/' && i + 1 < len && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && i + 1 < len && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      result += ' ';
      continue;
    }
    result += sql[i];
    i++;
  }
  return result;
}

/**
 * Replace all string literals with empty placeholders so they
 * don't trigger false positives.
 *
 * Handles:  'single'  "double"  $$dollar$$  $tag$dollar$tag$
 */
function stripStringLiterals(sql) {
  var result = '';
  var i = 0;
  var len = sql.length;
  while (i < len) {
    // Single-quoted string
    if (sql[i] === "'") {
      i++;
      while (i < len) {
        if (sql[i] === "'" && i + 1 < len && sql[i + 1] === "'") {
          i += 2; // escaped quote
        } else if (sql[i] === "'") {
          i++;
          break;
        } else {
          i++;
        }
      }
      result += "''";
      continue;
    }
    // Dollar-quoted string (PostgreSQL)
    if (sql[i] === '$') {
      var tagStart = i;
      i++;
      // Collect optional tag name: $tag$ or just $$
      while (i < len && sql[i] !== '$' && /[a-zA-Z0-9_]/.test(sql[i])) i++;
      if (i < len && sql[i] === '$') {
        var tag = sql.substring(tagStart, i + 1); // e.g. "$$" or "$tag$"
        i++;
        var endIdx = sql.indexOf(tag, i);
        if (endIdx !== -1) {
          i = endIdx + tag.length;
          result += "''";
          continue;
        }
        // No closing tag found – treat as literal $
        result += tag;
        continue;
      }
      // Not a dollar-quote, just a dollar sign
      result += sql.substring(tagStart, i);
      continue;
    }
    // Double-quoted identifier – keep it (it's an identifier, not a string value)
    if (sql[i] === '"') {
      result += sql[i];
      i++;
      while (i < len) {
        if (sql[i] === '"' && i + 1 < len && sql[i + 1] === '"') {
          result += '""';
          i += 2;
        } else if (sql[i] === '"') {
          result += sql[i];
          i++;
          break;
        } else {
          result += sql[i];
          i++;
        }
      }
      continue;
    }
    result += sql[i];
    i++;
  }
  return result;
}

/**
 * Full pre-processing pipeline: strip comments, strip string literals,
 * collapse whitespace.
 */
function cleanSqlForValidation(sql) {
  var cleaned = stripSqlComments(sql);
  cleaned = stripStringLiterals(cleaned);
  cleaned = cleaned.replace(/[\\s]+/g, ' ').trim();
  return cleaned;
}

/**
 * Validate a full SQL string (may contain multiple statements).
 * Returns { valid: true } or { valid: false, error, matchedOperation }.
 */
function validateSqlQuery(sql) {
  if (!sql || typeof sql !== 'string') {
    return { valid: true };
  }

  var cleaned = cleanSqlForValidation(sql);
  if (!cleaned) return { valid: true };

  // Split on semicolons and check each statement
  var statements = cleaned.split(';').map(function(s) { return s.trim(); }).filter(Boolean);

  for (var si = 0; si < statements.length; si++) {
    var stmt = statements[si];
    for (var pi = 0; pi < FORBIDDEN_SQL_PATTERNS.length; pi++) {
      var pattern = FORBIDDEN_SQL_PATTERNS[pi][0];
      var label = FORBIDDEN_SQL_PATTERNS[pi][1];
      if (pattern.test(stmt)) {
        return {
          valid: false,
          error: label + ' operations are not allowed. This operation could damage the database schema or data integrity.',
          matchedOperation: label
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Validate a SQL identifier (table name, column name, sort field, etc.).
 * Only allows safe characters to prevent SQL injection through identifier
 * interpolation.
 *
 * Allowed formats:
 *   - Simple:           users, my_table, _private
 *   - Schema-qualified: public.users, my_schema.my_table
 *   - Wildcard:         * (for SELECT *)
 *   - Double-quoted:    "my-table", "public"."my-table"
 *   - Cast expressions: column::type (PostgreSQL)
 *   - Function calls:   count(*), lower(name)
 */
var SAFE_IDENTIFIER_RE = /^(?:(?:"[^"]*"|[a-zA-Z_][a-zA-Z0-9_]*)(?:\\.(?:"[^"]*"|[a-zA-Z_][a-zA-Z0-9_]*))*(?:::(?:[a-zA-Z_][a-zA-Z0-9_[\\]]*))?)$/;
var SAFE_COLUMN_EXPR_RE = /^(?:\\*|(?:"[^"]*"|[a-zA-Z_][a-zA-Z0-9_]*)(?:\\.(?:\\*|"[^"]*"|[a-zA-Z_][a-zA-Z0-9_]*))*(?:::(?:[a-zA-Z_][a-zA-Z0-9_[\\]]*))?)$/;
var SAFE_FUNCTION_CALL_RE = /^[a-zA-Z_][a-zA-Z0-9_]*\\((?:\\*|(?:"[^"]*"|[a-zA-Z_][a-zA-Z0-9_.]*)(?:,\\s*(?:"[^"]*"|[a-zA-Z_][a-zA-Z0-9_.]*))*)\\)(?:::(?:[a-zA-Z_][a-zA-Z0-9_[\\]]*))?$/;

function validateIdentifier(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Identifier is empty or not a string' };
  }

  var trimmed = name.trim();
  if (!trimmed) {
    return { valid: false, error: 'Identifier is empty' };
  }

  if (trimmed === '*') {
    return { valid: true };
  }

  if (SAFE_IDENTIFIER_RE.test(trimmed) || SAFE_COLUMN_EXPR_RE.test(trimmed) || SAFE_FUNCTION_CALL_RE.test(trimmed)) {
    return { valid: true };
  }

  return {
    valid: false,
    error: 'Invalid SQL identifier: ' + trimmed.substring(0, 50) + '. Only alphanumeric characters, underscores, dots, and double-quoted identifiers are allowed.'
  };
}

/**
 * Throws a structured error if the SQL query contains forbidden operations.
 */
function assertQuerySafe(sql) {
  var result = validateSqlQuery(sql);
  if (!result.valid) {
    var err = new Error(result.error);
    err.code = 'FORBIDDEN_SQL_OPERATION';
    err.matchedOperation = result.matchedOperation;
    err.status = 403;
    throw err;
  }
}

/**
 * Throws a structured error if the identifier is not safe for interpolation.
 * @param {string} name  The identifier to validate
 * @param {string} label A human-readable label for error messages (e.g. "table name")
 */
function assertIdentifierSafe(name, label) {
  var result = validateIdentifier(name);
  if (!result.valid) {
    var err = new Error('Invalid ' + (label || 'identifier') + ': ' + result.error);
    err.code = 'INVALID_SQL_IDENTIFIER';
    err.status = 400;
    throw err;
  }
}
`
}
