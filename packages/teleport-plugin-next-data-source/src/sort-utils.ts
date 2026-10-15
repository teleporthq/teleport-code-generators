import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { UIDLExpressionValue, UIDLStaticValue } from '@teleporthq/teleport-types'

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

const collectIdentifiers = (node: types.Node | null | undefined, acc: Set<string>): void => {
  if (!node || typeof node !== 'object') {
    return
  }

  if (node.type === 'Identifier') {
    if (!SKIP_IDENTIFIERS.has(node.name)) {
      acc.add(node.name)
    }
    return
  }

  if (node.type === 'MemberExpression') {
    collectIdentifiers(node.object, acc)
    if (node.computed) {
      collectIdentifiers(node.property, acc)
    }
    return
  }

  // tslint:disable-next-line:no-any
  for (const key of Object.keys(node as any)) {
    // tslint:disable-next-line:no-any
    const child = (node as any)[key]
    if (Array.isArray(child)) {
      child.forEach((c) => collectIdentifiers(c, acc))
    } else if (child && typeof child === 'object' && typeof child.type === 'string') {
      collectIdentifiers(child, acc)
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

// Build the AST for `sorts: JSON.stringify([{ field: <fieldExpr>, order: <orderExpr> }])`
const buildDynamicSortsProperty = (dynamicSort: DynamicSortAST): types.ObjectProperty => {
  return types.objectProperty(
    types.identifier('sorts'),
    types.callExpression(
      types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
      [
        types.arrayExpression([
          types.objectExpression([
            types.objectProperty(types.identifier('field'), types.cloneNode(dynamicSort.field)),
            types.objectProperty(types.identifier('order'), types.cloneNode(dynamicSort.order)),
          ]),
        ]),
      ]
    )
  )
}

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
