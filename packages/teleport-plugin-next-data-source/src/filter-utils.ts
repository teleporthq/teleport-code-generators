import * as types from '@babel/types'

// Build a single filter entry: { source: '<src>', destination: <destExpr>, operand: '<op>' }
const buildFilterEntry = (
  source: string,
  destinationExpr: types.Expression,
  operand: string
): types.ObjectExpression =>
  types.objectExpression([
    types.objectProperty(types.identifier('source'), types.stringLiteral(source)),
    types.objectProperty(types.identifier('destination'), destinationExpr),
    types.objectProperty(types.identifier('operand'), types.stringLiteral(operand)),
  ])

// Predicate `(__f) => __f.destination !== '' && __f.destination !== null && __f.destination !== undefined`
// Used at runtime to drop filter conditions whose destination resolves to an
// empty value. Keeps the page generic: state-bound filters (e.g.
// `selectedCategory === ''` after picking "All Categories") and url-bound
// filters (e.g. no `?categoryFilter=` in URL → `router?.query?.categoryFilter`
// is `undefined`) both fall away cleanly instead of being sent to the API as
// `destination: ''`, which the SQL backend interprets as a literal empty
// string and returns zero rows.
const buildNonEmptyDestinationPredicate = (): types.ArrowFunctionExpression => {
  const f = types.identifier('__f')
  const dest = types.memberExpression(f, types.identifier('destination'))
  return types.arrowFunctionExpression(
    [f],
    types.logicalExpression(
      '&&',
      types.logicalExpression(
        '&&',
        types.binaryExpression('!==', dest, types.stringLiteral('')),
        types.binaryExpression('!==', dest, types.nullLiteral())
      ),
      types.binaryExpression('!==', dest, types.identifier('undefined'))
    )
  )
}

// Build the AST for:
//   JSON.stringify(
//     [ {source, destination, operand}, ... ]
//       .filter(__f => __f.destination !== '' && __f.destination !== null && __f.destination !== undefined)
//   )
//
// The `.filter(...)` step is unconditional even when every entry is a static
// (always-truthy) destination — the cost is negligible at runtime and it
// keeps the generated code uniform, so future regressions where a new filter
// type is added but its empty-value behavior is forgotten don't silently
// re-introduce empty-string filters.
export const buildFiltersStringifyCall = (
  filters: Array<{ source?: string; operand?: string; destination: unknown }>,
  buildDestinationExpression: (destination: unknown) => types.Expression
): types.CallExpression => {
  const entries = filters.map((filter) =>
    buildFilterEntry(
      filter.source || '',
      buildDestinationExpression(filter.destination),
      filter.operand || ''
    )
  )

  const filteredArray = types.callExpression(
    types.memberExpression(types.arrayExpression(entries), types.identifier('filter')),
    [buildNonEmptyDestinationPredicate()]
  )

  return types.callExpression(
    types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
    [filteredArray]
  )
}

// Convenience: push `filters: <call>` onto a paramsProps array.
export const appendFiltersParam = (
  paramsProps: types.ObjectProperty[],
  filters: Array<{ source?: string; operand?: string; destination: unknown }> | undefined,
  buildDestinationExpression: (destination: unknown) => types.Expression
): void => {
  if (!filters || filters.length === 0) {
    return
  }
  paramsProps.push(
    types.objectProperty(
      types.identifier('filters'),
      buildFiltersStringifyCall(filters, buildDestinationExpression)
    )
  )
}

// Appends each id in `stateIds` as a bare `Identifier` onto `deps`, skipping
// any id already tracked in `seen`. Mutates both `deps` and `seen`.
//
// Used by every count-fetch and params-`useMemo` builder in the pagination
// plugin to wire state-bound filter destinations into React's deps array.
// Centralising the loop here means a new dep-source (sort, future filter
// shapes) can hook into the same dedup-by-name set without re-implementing
// it at four call sites.
export const pushStateIdsAsDeps = (
  deps: types.Expression[],
  seen: Set<string>,
  stateIds: string[]
): void => {
  for (const id of stateIds) {
    if (seen.has(id)) {
      continue
    }
    seen.add(id)
    deps.push(types.identifier(id))
  }
}

// Appends each id in `propIds` as a `props.<id>` MemberExpression onto `deps`,
// skipping any already tracked in `seen` (keyed by `props.<id>` so a prop and a
// same-named state var never collide). Mutates both `deps` and `seen`.
//
// Prop-bound filter destinations resolve to `props.<id>` on the VALUE side (see
// `convertFilterDestinationToExpression` in teleport-plugin-common), so the
// useMemo/useEffect dependency MUST reference the exact same `props.<id>`
// member. Emitting a bare `<id>` identifier (as `pushStateIdsAsDeps` does for
// state) references an undeclared symbol — props are never destructured into
// the component scope — which crashed prerender with
// `ReferenceError: <id> is not defined`.
export const pushPropIdsAsDeps = (
  deps: types.Expression[],
  seen: Set<string>,
  propIds: string[]
): void => {
  for (const id of propIds) {
    const key = `props.${id}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    deps.push(types.memberExpression(types.identifier('props'), types.identifier(id)))
  }
}
