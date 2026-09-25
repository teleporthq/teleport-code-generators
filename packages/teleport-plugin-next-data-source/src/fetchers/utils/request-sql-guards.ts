/**
 * What a per-table read route takes from its query string and splices into
 * SQL: filter columns, sort columns and a row count. Values are bound as
 * parameters; these three are not, so each is checked for the one shape it
 * may have before it reaches the statement.
 */
export const generateRequestSqlGuardsCode = (): string => `
// A column name as this route accepts one from a request: plain, optionally
// quoted or table-qualified. Anything else - an expression, a sub-select - is
// SQL the caller wrote, and it would run as part of this statement.
const REQUEST_COLUMN_RE = /^"?[A-Za-z_][A-Za-z0-9_]*"?(?:\\."?[A-Za-z_][A-Za-z0-9_]*"?)?$/
function assertRequestColumn(field, label) {
  if (typeof field !== 'string' || !REQUEST_COLUMN_RE.test(field)) {
    const error = new Error('Invalid ' + label)
    error.status = 400
    throw error
  }
}

// A row count from a request, as a whole number or nothing.
function requestRowCount(value) {
  const parsed = parseInt(value, 10)
  return isNaN(parsed) || parsed < 0 ? undefined : parsed
}
`
