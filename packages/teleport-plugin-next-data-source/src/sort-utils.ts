import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { JSIdentifiers } from '@teleporthq/teleport-shared'
import {
  UIDLExpressionValue,
  UIDLStateDefinition,
  UIDLStaticValue,
} from '@teleporthq/teleport-types'

export interface DynamicSortAST {
  field: types.Expression
  order: types.Expression
  depStateIds: string[]
}

const SKIP_IDENTIFIERS = new Set([
  'undefined',
  'NaN',
  'Infinity',
  'globalThis',
  'window',
  'document',
  'console',
])

const collectIdentifiers = (
  node: types.Node | null | undefined,
  acc: Set<string>,
  skip: ReadonlySet<string> = SKIP_IDENTIFIERS
): void => {
  if (!node || typeof node !== 'object') {
    return
  }

  if (node.type === 'Identifier') {
    if (!skip.has(node.name)) {
      acc.add(node.name)
    }
    return
  }

  if (node.type === 'MemberExpression') {
    collectIdentifiers(node.object, acc, skip)
    if (node.computed) {
      collectIdentifiers(node.property, acc, skip)
    }
    return
  }

  // tslint:disable-next-line:no-any
  for (const key of Object.keys(node as any)) {
    // tslint:disable-next-line:no-any
    const child = (node as any)[key]
    if (Array.isArray(child)) {
      child.forEach((c) => collectIdentifiers(c, acc, skip))
    } else if (child && typeof child === 'object' && typeof child.type === 'string') {
      collectIdentifiers(child, acc, skip)
    }
  }
}

const toExpressionAndDeps = (
  value: UIDLStaticValue | UIDLExpressionValue
): { expr: types.Expression; deps: string[] } => {
  if (value.type === 'static') {
    return { expr: types.stringLiteral(String(value.content ?? '')), deps: [] }
  }

  const parsed = ASTUtils.getExpressionFromUIDLExpressionNode(value)
  const deps = new Set<string>()
  collectIdentifiers(parsed, deps)
  return { expr: parsed, deps: Array.from(deps) }
}

/**
 * The `{ field, order }` of a sort the UIDL FIXES — a static column and a
 * static direction (or none: ascending) — or undefined for one bound to state.
 * A fixed sort is a static sort: it rides on the server-side first-page fetch
 * and the client keeps that page, which a dynamic sort cannot let it do.
 */
export const readFixedSort = (
  sort: UIDLStaticValue | UIDLExpressionValue | undefined,
  sortDirection: UIDLStaticValue | UIDLExpressionValue | undefined
): { field: string; order: 'asc' | 'desc' } | undefined => {
  if (sort?.type !== 'static' || typeof sort.content !== 'string' || !sort.content.trim()) {
    return undefined
  }
  if (
    sortDirection &&
    (sortDirection.type !== 'static' || typeof sortDirection.content !== 'string')
  ) {
    return undefined
  }
  const direction = String(sortDirection?.content ?? '')
    .trim()
    .toLowerCase()
  return { field: sort.content.trim(), order: direction.startsWith('desc') ? 'desc' : 'asc' }
}

export const extractDynamicSort = (
  sort: UIDLStaticValue | UIDLExpressionValue | undefined,
  sortDirection: UIDLStaticValue | UIDLExpressionValue | undefined
): DynamicSortAST | undefined => {
  if (!sort) {
    return undefined
  }

  const field = toExpressionAndDeps(sort)

  const order: { expr: types.Expression; deps: string[] } = sortDirection
    ? toExpressionAndDeps(sortDirection)
    : { expr: types.stringLiteral('asc'), deps: [] }

  const depSet = new Set<string>([...field.deps, ...order.deps])

  return {
    field: field.expr,
    order: order.expr,
    depStateIds: Array.from(depSet),
  }
}

// `JSON.stringify([{ field: <fieldExpr>, order: <orderExpr> }])`
const buildDynamicSortsValue = (dynamicSort: DynamicSortAST): types.CallExpression =>
  types.callExpression(
    types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
    [
      types.arrayExpression([
        types.objectExpression([
          types.objectProperty(types.identifier('field'), types.cloneNode(dynamicSort.field, true)),
          types.objectProperty(types.identifier('order'), types.cloneNode(dynamicSort.order, true)),
        ]),
      ]),
    ]
  )

// Build the AST for `sorts: JSON.stringify([{ field: <fieldExpr>, order: <orderExpr> }])`
const buildDynamicSortsProperty = (dynamicSort: DynamicSortAST): types.ObjectProperty =>
  types.objectProperty(types.identifier('sorts'), buildDynamicSortsValue(dynamicSort))

/**
 * A page state a state-bound sort reads, at the value the visitor starts with.
 */
export interface SortStateDefault {
  /** The state's binding in the component: the name the sort expressions read. */
  binding: string
  value: string | number | boolean
}

// Names a sort expression may read besides its states: they mean the same on
// the server and in the browser.
const CONSTANT_IDENTIFIERS: ReadonlySet<string> = new Set(['undefined', 'NaN', 'Infinity'])

const isStartingValue = (value: unknown): value is SortStateDefault['value'] =>
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value))

/**
 * The states a state-bound sort reads, at their defaults: the sort a visitor
 * starts with, which the build can fetch the first page by.
 *
 * Only when every name the column and the direction read is a state of this
 * component starting at a fixed value. Anything else they read — a prop, the
 * router, `window` — or a state the page seeds from its data leaves the build
 * unable to know the starting sort: `undefined`, and the list fetches its first
 * page in the browser. An empty list is a sort that reads nothing.
 */
export const readSortStateDefaults = (
  dynamicSort: DynamicSortAST,
  stateDefinitions: Record<string, UIDLStateDefinition> | undefined
): SortStateDefault[] | undefined => {
  const read = new Set<string>()
  collectIdentifiers(dynamicSort.field, read, CONSTANT_IDENTIFIERS)
  collectIdentifiers(dynamicSort.order, read, CONSTANT_IDENTIFIERS)

  // A state's binding is its sanitised name, as the component declares it.
  const stateByBinding = new Map<string, UIDLStateDefinition>()
  Object.entries(stateDefinitions ?? {}).forEach(([key, definition]) => {
    stateByBinding.set(JSIdentifiers.createSafeJSIdentifier(key), definition)
  })

  const defaults: SortStateDefault[] = []
  for (const binding of Array.from(read)) {
    const definition = stateByBinding.get(binding)
    if (
      !definition ||
      definition.dataSourceBinding ||
      definition.query ||
      !isStartingValue(definition.defaultValue)
    ) {
      return undefined
    }
    defaults.push({ binding, value: definition.defaultValue })
  }
  return defaults
}

/**
 * The `sorts` param of the build-time fetch: the browser's own expression,
 * evaluated with every state it reads at its default —
 *
 *   ((sortBy) => JSON.stringify([{ field: sortBy.split("-")?.[0] || '', order: … }]))("name-asc")
 *
 * — so it is the very string the browser sends while the sort is untouched, and
 * the data source orders the first page exactly as it orders every later one
 * (the same columns, empty values last, the row's id breaking ties).
 */
export const buildStartingSortsValue = (
  dynamicSort: DynamicSortAST,
  defaults: SortStateDefault[]
): types.Expression => {
  const sorts = buildDynamicSortsValue(dynamicSort)
  if (defaults.length === 0) {
    return sorts
  }
  return types.callExpression(
    types.arrowFunctionExpression(
      defaults.map((state) => types.identifier(state.binding)),
      sorts
    ),
    defaults.map((state) => types.valueToNode(state.value) as types.Expression)
  )
}

/**
 * `sortBy === "name-asc"`: the sort is still the one the visitor starts with,
 * so the rows fetched at build time are its first page. `null` for a sort that
 * reads nothing, which never moves.
 */
export const buildSortAtStartGuard = (defaults: SortStateDefault[]): types.Expression | null =>
  defaults
    .map(
      (state): types.Expression =>
        types.binaryExpression(
          '===',
          types.identifier(state.binding),
          types.valueToNode(state.value) as types.Expression
        )
    )
    .reduce<types.Expression | null>(
      (all, guard) => (all ? types.logicalExpression('&&', all, guard) : guard),
      null
    )

// Build the AST for the legacy static sorts array form.
// tslint:disable-next-line:no-any
const buildLegacySortsProperty = (sorts: any[]): types.ObjectProperty => {
  return types.objectProperty(
    types.identifier('sorts'),
    types.callExpression(
      types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
      [
        types.arrayExpression(
          // tslint:disable-next-line:no-any
          sorts.map((sort: any) =>
            types.objectExpression([
              types.objectProperty(
                types.identifier('field'),
                types.stringLiteral(sort.field || '')
              ),
              types.objectProperty(
                types.identifier('order'),
                types.stringLiteral(sort.order || '')
              ),
            ])
          )
        ),
      ]
    )
  )
}

// Push the `sorts` param to paramsProps. Legacy static-array form wins when present.
export const appendSortsParam = (
  paramsProps: types.ObjectProperty[],
  // tslint:disable-next-line:no-any
  legacySorts: any[] | undefined,
  dynamicSort: DynamicSortAST | undefined
): void => {
  if (legacySorts && legacySorts.length > 0) {
    paramsProps.push(buildLegacySortsProperty(legacySorts))
    return
  }

  if (dynamicSort) {
    paramsProps.push(buildDynamicSortsProperty(dynamicSort))
  }
}
