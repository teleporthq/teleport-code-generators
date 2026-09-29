/**
 * The SQL an `array_overlap` filter compiles to: "the row's list shares any
 * value with these".
 *
 * A list column is TEXT in the platform tables, and holds whatever wrote it:
 *
 *   - a JSON array — `["react","css"]` — which is what the editor writes;
 *   - a comma-separated list — `react, css` — which is what a person types
 *     into the generated admin's plain text field;
 *   - a PostgreSQL array literal — `{react,css}` — from a native array column.
 *
 * Casting every cell to `jsonb` (what this used to do) threw on the second
 * kind, and one hand-typed row failed the WHOLE listing query — every visitor
 * saw an empty blog. Each form is now read as the text array it means, and a
 * blank cell as no list at all (it matches nothing, fails nothing).
 *
 * Emitted as plain source with no backtick, no `${` and no backslash, because
 * the fetchers interpolate it into their own template literals.
 */
export const generateArrayOverlapSqlCode = (): string => `
function listColumnSql(column) {
  var cell = "BTRIM(COALESCE(" + column + "::text, ''))"
  return (
    '(CASE' +
    " WHEN " + cell + " LIKE '[%' THEN ARRAY(SELECT jsonb_array_elements_text(" + cell + '::jsonb))' +
    " WHEN " + cell + " LIKE '{%' THEN " + cell + '::text[]' +
    " ELSE regexp_split_to_array(NULLIF(" + cell + ", ''), '[[:space:]]*,[[:space:]]*')" +
    ' END)'
  )
}

// Any of the columns (a translatable list and its per-language copies) sharing
// a value with the parameter.
function arrayOverlapSql(columns, param) {
  var clauses = []
  for (var i = 0; i < columns.length; i++) {
    clauses.push(listColumnSql(columns[i]) + ' && ' + param + '::text[]')
  }
  return clauses.length === 1 ? clauses[0] : '(' + clauses.join(' OR ') + ')'
}
`
