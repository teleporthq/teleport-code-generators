import * as types from '@babel/types'
import { ASTBuilders, ASTUtils } from '@teleporthq/teleport-plugin-common'
import {
  UIDLStructuredDataEntry,
  UIDLStructuredDataNode,
  UIDLStructuredDataObject,
  UIDLStructuredDataComputed,
  UIDLDynamicReference,
  UIDLStaticValue,
} from '@teleporthq/teleport-types'

const SCHEMA_CONDITION_MAP: Record<string, string> = {
  new: 'https://schema.org/NewCondition',
  refurbished: 'https://schema.org/RefurbishedCondition',
  used: 'https://schema.org/UsedCondition',
}
const DEFAULT_CONDITION = 'https://schema.org/NewCondition'
const IN_STOCK = 'https://schema.org/InStock'
const OUT_OF_STOCK = 'https://schema.org/OutOfStock'

export interface StructuredDataScript {
  scriptTag: types.JSXElement
  /** True when any leaf resolved to a `translate.raw(...)` (locale) reference. */
  usesTranslations: boolean
}

/**
 * `props?.a?.b` — optional member chain rooted at `props` (the page-level props
 * returned by getStaticProps), so missing entity fields resolve to `undefined`
 * and drop out of `JSON.stringify`.
 */
const buildPropExpression = (refPath: string[] = []): types.Expression => {
  let expression: types.Expression = types.identifier('props')
  refPath.forEach((segment) => {
    expression = types.optionalMemberExpression(expression, types.identifier(segment), false, true)
  })
  return expression
}

const buildLocaleExpression = (id: string): types.Expression =>
  types.callExpression(
    types.memberExpression(types.identifier('translate'), types.identifier('raw')),
    [types.stringLiteral(id)]
  )

const buildDynamicExpression = (
  ref: UIDLDynamicReference
): { expression: types.Expression; usesTranslations: boolean } => {
  const { referenceType, refPath, id } = ref.content
  if (referenceType === 'locale') {
    return { expression: buildLocaleExpression(id), usesTranslations: true }
  }
  // prop (and any other reference) resolves against the page props.
  return { expression: buildPropExpression(refPath || []), usesTranslations: false }
}

const buildComputedExpression = (node: UIDLStructuredDataComputed): types.Expression => {
  const entityField = buildPropExpression([...node.refPath, node.column])

  if (node.kind === 'availability') {
    // <entity>.<column> === 0 ? OutOfStock : InStock
    return types.conditionalExpression(
      types.binaryExpression('===', entityField, types.numericLiteral(0)),
      types.stringLiteral(OUT_OF_STOCK),
      types.stringLiteral(IN_STOCK)
    )
  }

  if (node.kind === 'itemCondition') {
    // ({new:..., refurbished:..., used:...})[<entity>.<column>] || NewCondition
    const mapExpression = types.objectExpression(
      Object.keys(SCHEMA_CONDITION_MAP).map((key) =>
        types.objectProperty(types.identifier(key), types.stringLiteral(SCHEMA_CONDITION_MAP[key]))
      )
    )
    return types.logicalExpression(
      '||',
      types.memberExpression(mapExpression, entityField, true, false),
      types.stringLiteral(DEFAULT_CONDITION)
    )
  }

  // concatUrl: `${urlPrefix}${<entity>.<column>}`
  const prefix = node.urlPrefix || ''
  return types.templateLiteral(
    [
      types.templateElement({ raw: prefix, cooked: prefix }, false),
      types.templateElement({ raw: '', cooked: '' }, true),
    ],
    [entityField]
  )
}

/** Converts a plain JSON value (no dynamic/computed markers) into a literal AST. */
const jsonToAST = (value: unknown): types.Expression => {
  if (value === null || value === undefined) {
    return types.nullLiteral()
  }
  if (typeof value === 'string') {
    return types.stringLiteral(value)
  }
  if (typeof value === 'number') {
    return types.numericLiteral(value)
  }
  if (typeof value === 'boolean') {
    return types.booleanLiteral(value)
  }
  if (Array.isArray(value)) {
    return types.arrayExpression(value.map((item) => jsonToAST(item)))
  }
  return types.objectExpression(
    Object.entries(value as Record<string, unknown>).map(([key, val]) =>
      types.objectProperty(types.stringLiteral(key), jsonToAST(val))
    )
  )
}

const isDynamicRef = (node: UIDLStructuredDataNode): node is UIDLDynamicReference =>
  typeof node === 'object' && node !== null && (node as { type?: string }).type === 'dynamic'

const isStaticValue = (node: UIDLStructuredDataNode): node is UIDLStaticValue =>
  typeof node === 'object' && node !== null && (node as { type?: string }).type === 'static'

const isComputed = (node: UIDLStructuredDataNode): node is UIDLStructuredDataComputed =>
  typeof node === 'object' && node !== null && (node as { type?: string }).type === 'computed'

const buildNode = (
  node: UIDLStructuredDataNode
): { expression: types.Expression; usesTranslations: boolean } => {
  if (node === null) {
    return { expression: types.nullLiteral(), usesTranslations: false }
  }
  if (typeof node === 'string') {
    return { expression: types.stringLiteral(node), usesTranslations: false }
  }
  if (typeof node === 'number') {
    return { expression: types.numericLiteral(node), usesTranslations: false }
  }
  if (typeof node === 'boolean') {
    return { expression: types.booleanLiteral(node), usesTranslations: false }
  }
  if (Array.isArray(node)) {
    let usesTranslations = false
    const elements = node.map((item) => {
      const built = buildNode(item)
      usesTranslations = usesTranslations || built.usesTranslations
      return built.expression
    })
    return { expression: types.arrayExpression(elements), usesTranslations }
  }
  if (isStaticValue(node)) {
    return { expression: jsonToAST(node.content), usesTranslations: false }
  }
  if (isDynamicRef(node)) {
    return buildDynamicExpression(node)
  }
  if (isComputed(node)) {
    return { expression: buildComputedExpression(node), usesTranslations: false }
  }
  return buildObject(node as UIDLStructuredDataObject)
}

const buildObject = (
  obj: UIDLStructuredDataObject
): { expression: types.Expression; usesTranslations: boolean } => {
  let usesTranslations = false
  const properties = Object.entries(obj).map(([key, value]) => {
    const built = buildNode(value)
    usesTranslations = usesTranslations || built.usesTranslations
    return types.objectProperty(types.stringLiteral(key), built.expression)
  })
  return { expression: types.objectExpression(properties), usesTranslations }
}

/**
 * Builds `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html }} />`.
 * - A string entry is a pre-serialized JSON document (the mapper has already
 *   escaped `<`), emitted verbatim.
 * - An object entry is built into an object expression and rendered at runtime
 *   via `JSON.stringify(obj).replace(/</g, '<')` — the replace prevents a
 *   product value containing `</script>` from breaking out of the tag, and
 *   `JSON.stringify` drops `undefined` (missing optional fields).
 */
export const buildStructuredDataScript = (entry: UIDLStructuredDataEntry): StructuredDataScript => {
  let htmlExpression: types.Expression
  let usesTranslations = false

  if (typeof entry === 'string') {
    htmlExpression = types.stringLiteral(entry)
  } else {
    const built = buildObject(entry)
    usesTranslations = built.usesTranslations
    const stringifyCall = types.callExpression(
      types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
      [built.expression]
    )
    htmlExpression = types.callExpression(
      types.memberExpression(stringifyCall, types.identifier('replace')),
      [types.regExpLiteral('<', 'g'), types.stringLiteral('\\u003c')]
    )
  }

  const scriptTag = ASTBuilders.createSelfClosingJSXTag('script')
  ASTUtils.addAttributeToJSXTag(scriptTag, 'type', 'application/ld+json')
  scriptTag.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('dangerouslySetInnerHTML'),
      types.jsxExpressionContainer(
        types.objectExpression([types.objectProperty(types.identifier('__html'), htmlExpression)])
      )
    )
  )

  return { scriptTag, usesTranslations }
}
