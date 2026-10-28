import * as types from '@babel/types'
import { ASTBuilders, ASTUtils } from '@teleporthq/teleport-plugin-common'
import { RoutePaths } from '@teleporthq/teleport-shared'
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
  /**
   * True when a route parameter was interpolated, so the caller must add the
   * `useRouter` hook this script now depends on.
   */
  usesRouter: boolean
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

  if (node.kind === 'isoDate') {
    // (<entity>.<column> ?? <entity>.<fallback>) ? new Date(…).toISOString() : undefined
    const value = node.fallbackColumn
      ? types.logicalExpression(
          '??',
          entityField,
          buildPropExpression([...node.refPath, node.fallbackColumn])
        )
      : entityField
    return types.conditionalExpression(
      value,
      types.callExpression(
        types.memberExpression(
          types.newExpression(types.identifier('Date'), [value]),
          types.identifier('toISOString')
        ),
        []
      ),
      types.identifier('undefined')
    )
  }

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

  if (node.kind === 'aggregateRating') {
    // A rating block is only valid schema.org with at least one review, so
    // "no reviews" has to REMOVE the property — not emit `{}` and not emit a
    // zeroed rating, either of which Google reports as an error on every
    // product page in the catalogue.
    //
    //   <count> > 0 ? { '@type': 'AggregateRating', ... } : undefined
    //
    // `undefined` is what `JSON.stringify` drops, which is how the property
    // disappears from the emitted document entirely.
    const countField = buildPropExpression([...node.refPath, node.column])
    const valueField = buildPropExpression([...node.refPath, node.ratingValueColumn || node.column])
    return types.conditionalExpression(
      types.binaryExpression('>', countField, types.numericLiteral(0)),
      types.objectExpression([
        types.objectProperty(types.stringLiteral('@type'), types.stringLiteral('AggregateRating')),
        types.objectProperty(types.stringLiteral('ratingValue'), valueField),
        types.objectProperty(types.stringLiteral('reviewCount'), countField),
        types.objectProperty(types.stringLiteral('bestRating'), types.numericLiteral(5)),
        types.objectProperty(types.stringLiteral('worstRating'), types.numericLiteral(1)),
      ]),
      types.identifier('undefined')
    )
  }

  if (node.kind === 'namedEntity') {
    // A `Brand` or an `author` with no `name` is a missing-required-field error
    // that Google reports on EVERY page carrying it — and a nullable column
    // (`brand`, `author_name`) is empty on plenty of real rows. So an absent
    // value removes the whole object rather than emitting a typed shell.
    //
    //   <field> ? { '@type': <schemaType>, name: <field> } : undefined
    return types.conditionalExpression(
      entityField,
      types.objectExpression([
        types.objectProperty(
          types.stringLiteral('@type'),
          types.stringLiteral(node.schemaType || 'Thing')
        ),
        types.objectProperty(types.stringLiteral('name'), entityField),
      ]),
      types.identifier('undefined')
    )
  }

  if (node.kind === 'reviewList') {
    // The individual review snippets under a product's stars. The transform
    // hands over a plain domain array; the schema.org shaping happens here so
    // the data layer stays free of vocabulary it has no other use for.
    //
    //   Array.isArray(<field>) && <field>.length
    //     ? <field>.map(r => ({ '@type': 'Review', … }))
    //     : undefined
    //
    // `undefined` rather than `[]`: an empty `review` array is invalid
    // structured data in exactly the way an empty `aggregateRating` is.
    const reviewParam = types.identifier('r')
    const reviewProp = (name: string): types.MemberExpression =>
      types.memberExpression(reviewParam, types.identifier(name), false, false)
    const mapCallback = types.arrowFunctionExpression(
      [reviewParam],
      types.objectExpression([
        types.objectProperty(types.stringLiteral('@type'), types.stringLiteral('Review')),
        types.objectProperty(
          types.stringLiteral('author'),
          types.objectExpression([
            types.objectProperty(types.stringLiteral('@type'), types.stringLiteral('Person')),
            types.objectProperty(types.stringLiteral('name'), reviewProp('author')),
          ])
        ),
        types.objectProperty(
          types.stringLiteral('reviewRating'),
          types.objectExpression([
            types.objectProperty(types.stringLiteral('@type'), types.stringLiteral('Rating')),
            types.objectProperty(types.stringLiteral('ratingValue'), reviewProp('rating')),
            types.objectProperty(types.stringLiteral('bestRating'), types.numericLiteral(5)),
            types.objectProperty(types.stringLiteral('worstRating'), types.numericLiteral(1)),
          ])
        ),
        types.objectProperty(types.stringLiteral('reviewBody'), reviewProp('body')),
        types.objectProperty(types.stringLiteral('datePublished'), reviewProp('datePublished')),
      ])
    )
    return types.conditionalExpression(
      types.logicalExpression(
        '&&',
        types.callExpression(
          types.memberExpression(types.identifier('Array'), types.identifier('isArray')),
          [entityField]
        ),
        types.optionalMemberExpression(entityField, types.identifier('length'), false, true)
      ),
      // ⛔ An OPTIONAL CALL, not a plain call around an optional member. Both
      // read the same in modern JS, but they are different nodes and Babel
      // prints the second one parenthesised — `(a?.b?.map)(cb)`. Native V8 still
      // resolves the receiver through those parentheses; SWC, which is what
      // Next compiles this page with, lowers them to a CONDITIONAL as the
      // callee (`(… ? void 0 : ref.map)(cb)`). A conditional is a value, not a
      // reference, so `map` runs with `this === undefined` and the product page
      // dies with "Array.prototype.map called on null or undefined" — but only
      // on a product that HAS a review, because that is the only path that
      // reaches the call.
      types.optionalCallExpression(
        types.optionalMemberExpression(entityField, types.identifier('map'), false, true),
        [mapCallback],
        false
      ),
      types.identifier('undefined')
    )
  }

  if (node.kind === 'faqPage') {
    return buildFaqPageExpression(entityField)
  }

  if (node.kind === 'breadcrumbTrail') {
    return buildBreadcrumbTrailExpression(node)
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

const SCHEMA_CONTEXT = 'https://schema.org'

const property = (key: string, value: types.Expression): types.ObjectProperty =>
  types.objectProperty(types.stringLiteral(key), value)

/** `${prefix}${value}` */
const prefixed = (prefix: string, value: types.Expression): types.Expression =>
  types.templateLiteral(
    [
      types.templateElement({ raw: prefix, cooked: prefix }, false),
      types.templateElement({ raw: '', cooked: '' }, true),
    ],
    [value]
  )

/**
 * `.map` through an OPTIONAL CALL — see the note on `reviewList`: a plain call
 * around an optional member is lowered by SWC to a conditional callee, which
 * loses the receiver and dies at runtime on the one page that has rows.
 */
const optionalMap = (
  list: types.Expression,
  callback: types.ArrowFunctionExpression
): types.Expression =>
  types.optionalCallExpression(
    types.optionalMemberExpression(list, types.identifier('map'), false, true),
    [callback],
    false
  )

/**
 * The whole FAQPage, or `undefined` with fewer than two pairs:
 *   Array.isArray(f) && f.length >= 2
 *     ? { '@context', '@type': 'FAQPage', mainEntity: f.map(q => ({ Question… })) }
 *     : undefined
 */
const buildFaqPageExpression = (pairs: types.Expression): types.Expression => {
  const pair = types.identifier('q')
  const pairProp = (name: string): types.MemberExpression =>
    types.memberExpression(pair, types.identifier(name), false, false)
  const question = types.arrowFunctionExpression(
    [pair],
    types.objectExpression([
      property('@type', types.stringLiteral('Question')),
      property('name', pairProp('question')),
      property(
        'acceptedAnswer',
        types.objectExpression([
          property('@type', types.stringLiteral('Answer')),
          property('text', pairProp('answer')),
        ])
      ),
    ])
  )
  return types.conditionalExpression(
    types.logicalExpression(
      '&&',
      types.callExpression(
        types.memberExpression(types.identifier('Array'), types.identifier('isArray')),
        [pairs]
      ),
      types.binaryExpression(
        '>=',
        types.optionalMemberExpression(pairs, types.identifier('length'), false, true),
        types.numericLiteral(2)
      )
    ),
    types.objectExpression([
      property('@context', types.stringLiteral(SCHEMA_CONTEXT)),
      property('@type', types.stringLiteral('FAQPage')),
      property('mainEntity', optionalMap(pairs, question)),
    ]),
    types.identifier('undefined')
  )
}

/**
 * The whole BreadcrumbList, numbered at render time:
 *   { '@context', '@type': 'BreadcrumbList',
 *     itemListElement: [ ...crumbs, category || undefined, entity ]
 *       .filter(Boolean)
 *       .map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.item })) }
 */
const buildBreadcrumbTrailExpression = (node: UIDLStructuredDataComputed): types.Expression => {
  const crumb = (name: types.Expression, item: types.Expression): types.Expression =>
    types.objectExpression([property('name', name), property('item', item)])
  const staticCrumbs = (node.crumbs || []).map((entry) =>
    crumb(types.stringLiteral(entry.name), types.stringLiteral(entry.item))
  )
  const categoryName = node.categoryNameColumn
    ? buildPropExpression([...node.refPath, node.categoryNameColumn])
    : null
  // A crumb needs an address: a row may still name a category whose record is
  // gone (its slug null), and `…/category/null` is no address.
  const categoryCrumb =
    categoryName && node.categorySlugColumn
      ? [
          types.conditionalExpression(
            types.logicalExpression(
              '&&',
              categoryName,
              buildPropExpression([...node.refPath, node.categorySlugColumn])
            ),
            crumb(
              categoryName,
              prefixed(
                node.categoryUrlPrefix || '',
                buildPropExpression([...node.refPath, node.categorySlugColumn])
              )
            ),
            types.identifier('undefined')
          ),
        ]
      : []
  const entityCrumb = crumb(
    buildPropExpression([...node.refPath, node.column]),
    prefixed(
      node.urlPrefix || '',
      buildPropExpression([...node.refPath, node.slugColumn || 'slug'])
    )
  )
  const kept = types.callExpression(
    types.memberExpression(
      types.arrayExpression([...staticCrumbs, ...categoryCrumb, entityCrumb]),
      types.identifier('filter')
    ),
    [types.identifier('Boolean')]
  )
  const crumbParam = types.identifier('c')
  const index = types.identifier('i')
  const numbered = types.callExpression(types.memberExpression(kept, types.identifier('map')), [
    types.arrowFunctionExpression(
      [crumbParam, index],
      types.objectExpression([
        property('@type', types.stringLiteral('ListItem')),
        property('position', types.binaryExpression('+', index, types.numericLiteral(1))),
        property('name', types.memberExpression(crumbParam, types.identifier('name'))),
        property('item', types.memberExpression(crumbParam, types.identifier('item'))),
      ])
    ),
  ])
  return types.objectExpression([
    property('@context', types.stringLiteral(SCHEMA_CONTEXT)),
    property('@type', types.stringLiteral('BreadcrumbList')),
    property('itemListElement', numbered),
  ])
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

interface StructuredDataContent {
  /** The JSON text of one entry, as an expression evaluated when the page renders. */
  expression: types.Expression
  usesTranslations: boolean
  usesRouter: boolean
  /** A computed whole document: `''` at render time when it is absent. */
  optional: boolean
}

/** `JSON.stringify(<expression>).replace(/</g, '\u003c')` — the `<` escape keeps `</script>` inside the tag. */
const stringified = (expression: types.Expression): types.Expression =>
  types.callExpression(
    types.memberExpression(
      types.callExpression(
        types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
        [expression]
      ),
      types.identifier('replace')
    ),
    [types.regExpLiteral('<', 'g'), types.stringLiteral('\\u003c')]
  )

/**
 * The JSON text of one entry.
 * - A string entry is a pre-serialized JSON document (the mapper has already
 *   escaped `<`), emitted verbatim.
 * - An object entry is built into an object expression and serialized at
 *   runtime via `JSON.stringify(obj).replace(/</g, '\u003c')` — the replace
 *   prevents a product value containing `</script>` from breaking out of the
 *   tag, and `JSON.stringify` drops `undefined` (missing optional fields).
 */
const buildStructuredDataContent = (entry: UIDLStructuredDataEntry): StructuredDataContent => {
  if (typeof entry === 'string') {
    // A pre-serialized document can still embed the page's own ROUTE TEMPLATE:
    // the BreadcrumbList's last `item` is the current page's URL, which for a
    // details page is `https://host/event-details/[id]`. Shipped verbatim that
    // is a URL no crawler can follow, so the literal `[id]` becomes
    // `${router.query.id}` exactly as the canonical link does.
    const { staticParts, paramNames } = RoutePaths.parseDynamicPathSegments(entry)
    if (paramNames.length === 0) {
      return {
        expression: types.stringLiteral(entry),
        usesTranslations: false,
        usesRouter: false,
        optional: false,
      }
    }
    return {
      expression: types.templateLiteral(
        staticParts.map((part, index) =>
          types.templateElement({ raw: part, cooked: part }, index === staticParts.length - 1)
        ),
        paramNames.map((name) =>
          types.memberExpression(
            types.memberExpression(types.identifier('router'), types.identifier('query')),
            types.identifier(name)
          )
        )
      ),
      usesTranslations: false,
      usesRouter: true,
      optional: false,
    }
  }

  if (isComputed(entry)) {
    // A whole document the row may not have: `doc ? JSON.stringify(doc)… : ''`.
    const document = types.identifier('document')
    return {
      expression: types.callExpression(
        types.arrowFunctionExpression(
          [document],
          types.conditionalExpression(document, stringified(document), types.stringLiteral(''))
        ),
        [buildComputedExpression(entry)]
      ),
      usesTranslations: false,
      usesRouter: false,
      optional: true,
    }
  }

  const built = buildObject(entry)
  return {
    expression: stringified(built.expression),
    usesTranslations: built.usesTranslations,
    usesRouter: false,
    optional: false,
  }
}

/** `a + b + c`, with neighbouring string literals joined into one. */
const concatenate = (parts: types.Expression[]): types.Expression => {
  const folded = parts.reduce<types.Expression[]>((list, part) => {
    const previous = list[list.length - 1]
    if (previous && types.isStringLiteral(previous) && types.isStringLiteral(part)) {
      list[list.length - 1] = types.stringLiteral(previous.value + part.value)
    } else {
      list.push(part)
    }
    return list
  }, [])
  return folded.reduce((sum, part) => types.binaryExpression('+', sum, part))
}

/**
 * Builds the page's ONE `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html }} />`.
 * A page states everything it says about itself in a single document: one
 * entry as it is, several as a JSON-LD array of them (each keeps its own
 * `@context`, and nodes still link by `@id`). One script per entry put three,
 * four, five blocks in every page's head for what is one description of it.
 */
export const buildStructuredDataScript = (
  entries: UIDLStructuredDataEntry[]
): StructuredDataScript => {
  const contents = entries.map(buildStructuredDataContent)
  const anyOptional = contents.some((content) => content.optional)
  const htmlExpression =
    contents.length === 1
      ? contents[0].expression
      : anyOptional
      ? // An absent document must leave the array, not sit in it as a hole:
        // '[' + [a, b, c].filter(Boolean).join(',') + ']'
        concatenate([
          types.stringLiteral('['),
          types.callExpression(
            types.memberExpression(
              types.callExpression(
                types.memberExpression(
                  types.arrayExpression(contents.map((content) => content.expression)),
                  types.identifier('filter')
                ),
                [types.identifier('Boolean')]
              ),
              types.identifier('join')
            ),
            [types.stringLiteral(',')]
          ),
          types.stringLiteral(']'),
        ])
      : concatenate([
          types.stringLiteral('['),
          ...contents.flatMap((content, index) =>
            index === 0 ? [content.expression] : [types.stringLiteral(','), content.expression]
          ),
          types.stringLiteral(']'),
        ])

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

  return {
    scriptTag,
    usesTranslations: contents.some((content) => content.usesTranslations),
    usesRouter: contents.some((content) => content.usesRouter),
  }
}
