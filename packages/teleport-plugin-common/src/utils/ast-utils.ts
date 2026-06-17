import * as types from '@babel/types'
import { parse } from '@babel/core'
import ParsedASTNode from './parsed-ast'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import {
  UIDLStateDefinition,
  UIDLPropDefinition,
  UIDLRawValue,
  UIDLStaticValue,
  UIDLResourceItem,
  UIDLENVValue,
  UIDLPropValue,
  UIDLExpressionValue,
  UIDLStateValue,
  HastNode,
} from '@teleporthq/teleport-types'
import babelPresetReact from '@babel/preset-react'
import { UnaryOperation, BinaryOperator } from './types'

/**
 * Converts HTML attribute names to React/JSX camelCase format
 * Preserves data-* and aria-* attributes as-is
 */
export const convertToReactAttributeName = (attrName: string): string => {
  if (attrName.startsWith('data-') || attrName.startsWith('aria-')) {
    return attrName
  }

  const htmlToReact: Record<string, string> = {
    colspan: 'colSpan',
    rowspan: 'rowSpan',
    maxlength: 'maxLength',
    minlength: 'minLength',
    readonly: 'readOnly',
    autocomplete: 'autoComplete',
    autofocus: 'autoFocus',
    tabindex: 'tabIndex',
    contenteditable: 'contentEditable',
    spellcheck: 'spellCheck',
  }
  if (htmlToReact[attrName]) {
    return htmlToReact[attrName]
  }

  return attrName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * Adds a CSS class definition string to an existing string of classes
 */
export const addClassStringOnJSXTag = (
  jsxNode: types.JSXElement,
  classString: string,
  classAttributeName?: string,
  dynamicValues: Array<types.MemberExpression | types.Identifier | types.ConditionalExpression> = []
) => {
  if (classString === '' && dynamicValues.length === 0) {
    return
  }

  const classAttribute = getClassAttribute(jsxNode, { createIfNotFound: true, classAttributeName })
  if (dynamicValues.length === 0) {
    if (classAttribute.value && classAttribute.value.type === 'StringLiteral') {
      const classArray = classAttribute.value.value.split(' ')
      if (classString) {
        classArray.push(classString)
      }
      classArray.filter((item) => item)
      classAttribute.value.value = classArray.join(' ').trim()
    } else {
      throw new Error(
        'Attempted to set a class string literral on a jsx tag which had an invalid className attribute'
      )
    }
  }

  if (dynamicValues.length) {
    if (classAttribute.value && classAttribute.value.type === 'StringLiteral') {
      const classArray = classAttribute.value.value.split(' ')
      const quasis: types.TemplateElement[] = []
      const expression: Array<
        types.MemberExpression | types.Identifier | types.ConditionalExpression
      > = []

      quasis.push(
        types.templateElement({
          raw: classString + classArray.join(' ') + ' ',
          cooked: classString + classArray.join(' ') + ' ',
        })
      )

      dynamicValues.forEach((dynamicVal) => {
        expression.push(dynamicVal)
        quasis.push(types.templateElement({ raw: ' ', cooked: ' ' }))
      })

      classAttribute.value = types.jsxExpressionContainer(types.templateLiteral(quasis, expression))
    } else {
      throw new Error(
        `Attempted to set a dynamic class literral on a jsx tag which had an invalid className attribute`
      )
    }
  }
}

/**
 * Gets the existing className declaration attribute or generates and returns
 * a newly created and assigned one to the given JSXNode
 */
const getClassAttribute = (
  jsxNode: types.JSXElement,
  { createIfNotFound = false, classAttributeName = 'className' },
  t = types
): types.JSXAttribute => {
  const classNameAttribute = jsxNode.openingElement.attributes.find((attribute) => {
    return attribute.type === 'JSXAttribute' && attribute.name.name === classAttributeName
  })

  if (!classNameAttribute && createIfNotFound) {
    const createdClassAttribute = t.jsxAttribute(
      t.jsxIdentifier(classAttributeName),
      t.stringLiteral('')
    )

    jsxNode.openingElement.attributes.push(createdClassAttribute)
    return createdClassAttribute
  }

  return classNameAttribute as types.JSXAttribute
}

/**
 * Makes `${name}={${prefix}.${value}}` happen in AST
 */
export const addDynamicAttributeToJSXTag = (
  jsxASTNode: types.JSXElement,
  name: string,
  value: string,
  prefix: string = '',
  t = types
) => {
  const reactName = convertToReactAttributeName(name)
  const content =
    prefix === ''
      ? t.identifier(value)
      : t.memberExpression(t.identifier(prefix), t.identifier(value))

  jsxASTNode.openingElement.attributes.push(
    t.jsxAttribute(t.jsxIdentifier(reactName), t.jsxExpressionContainer(content))
  )
}

/**
 * Make code expressions happen in AST
 * Replace variables that are found in AST with
 * the corresponding value from the contexts for now
 * and in the future with other sources.
 */
/**
 * UIDL `expr` values are opaque JavaScript expressions, but authoring tools
 * (notably Teleport-GUI while the differentiator-navlink contract is mid-
 * migration) occasionally emit malformed template literals with empty
 * substitutions like `` `/profile/${}` ``. Babel rejects these and the whole
 * generation run fails.
 *
 * We only repair a narrow set of known-safe patterns to avoid silently
 * masking real UIDL bugs:
 *   1. `/profile/${}`  → `/profile/${currentUser?.id}` (My Profile navlink
 *                         per the dual-mode profile page contract).
 *   2. any remaining empty `${}` → `${''}` — at least the output parses and
 *      the placeholder is visibly empty at runtime.
 * Each repair logs a warning so the upstream UIDL bug remains visible.
 */
export const sanitizeExprContent = (content: string, attrKey?: string): string => {
  if (typeof content !== 'string' || !content.includes('${}')) {
    return content
  }

  let repaired = content

  // My Profile navlink: the differentiator is always the session user's id.
  repaired = repaired.replace(
    /`([^`]*\/profile\/)\$\{\}([^`]*)`/g,
    '`$1' + '$' + '{' + 'currentUser?.id}' + '$2`'
  )

  // Generic fallback: any other empty `${}` becomes an empty string literal so
  // downstream Babel parsing succeeds. This is intentionally lossy — the goal
  // is not to guess the original intent, just to keep the build from crashing.
  if (repaired.includes('${}')) {
    repaired = repaired.replace(/\$\{\}/g, '$' + '{' + "'" + "'" + '}')
  }

  if (repaired !== content) {
    // tslint:disable-next-line:no-console
    console.warn(
      `[teleport] Repaired malformed empty template substitution in expr${
        attrKey ? ` attribute "${attrKey}"` : ''
      }: ${content} → ${repaired}`
    )
  }

  return repaired
}

export const addDynamicExpressionAttributeToJSXTag = (
  jsxASTNode: types.JSXElement,
  dynamicRef: UIDLExpressionValue,
  attrKey: string,
  t = types
) => {
  const dynamicContent = dynamicRef.content
  if (dynamicRef.type !== 'expr') {
    throw new Error(`This method only works with dynamic nodes that have code expressions`)
  }

  const code = sanitizeExprContent(dynamicContent, attrKey)
  const options = {
    sourceType: 'module' as const,
  }

  const ast = parse(code, options)

  if (!('program' in ast)) {
    throw new Error(
      `The AST does not have a program node in the expression inside addDynamicExpressionAttributeToJSXTag`
    )
  }

  const theStatementOnlyWihtoutTheProgram = ast.program.body[0]

  if (theStatementOnlyWihtoutTheProgram.type !== 'ExpressionStatement') {
    throw new Error(`Expr dynamic attribute only support expressions statements at the moment.`)
  }

  let expression = theStatementOnlyWihtoutTheProgram.expression

  // When an expression accesses `.value` on a simple identifier (e.g. `galleryImage?.value`),
  // wrap it with a typeof check so that if the item is already a string we use it directly:
  // `typeof galleryImage === 'string' ? galleryImage : galleryImage?.value`
  if (
    (expression.type === 'OptionalMemberExpression' || expression.type === 'MemberExpression') &&
    expression.object.type === 'Identifier' &&
    expression.property.type === 'Identifier' &&
    expression.property.name === 'value'
  ) {
    const varName = expression.object.name
    expression = t.conditionalExpression(
      t.binaryExpression(
        '===',
        t.unaryExpression('typeof', t.identifier(varName)),
        t.stringLiteral('string')
      ),
      t.identifier(varName),
      expression
    )
  }

  jsxASTNode.openingElement.attributes.push(
    t.jsxAttribute(
      t.jsxIdentifier(convertToReactAttributeName(attrKey)),
      t.jsxExpressionContainer(expression)
    )
  )
}

/*
  Use, when we need to add a mix of dynamic and static values to
  the same attribute at the same time.
*/

export const addMultipleDynamicAttributesToJSXTag = (
  jsxASTNode: types.JSXElement,
  name: string,
  attrValues: Array<types.MemberExpression | types.Identifier | types.StringLiteral> = [],
  t = types
) => {
  const memberExpressions: Array<types.Identifier | types.MemberExpression | types.StringLiteral> =
    []
  const templateElements: types.TemplateElement[] = []
  if (attrValues.length === 0) {
    return
  }

  let content:
    | types.TemplateLiteral
    | types.MemberExpression
    | types.Identifier
    | types.StringLiteral
  if (attrValues.length === 1) {
    content = attrValues[0]
  } else {
    attrValues.forEach((attr) => {
      memberExpressions.push(attr)
      templateElements.push(t.templateElement({ raw: ' ', cooked: ' ' }))
    })
    templateElements.push(t.templateElement({ raw: ' ', cooked: ' ' }))
    content = t.templateLiteral(templateElements, memberExpressions)
  }

  jsxASTNode.openingElement.attributes.push(
    t.jsxAttribute(t.jsxIdentifier(name), t.jsxExpressionContainer(content))
  )
}

export const stringAsTemplateLiteral = (str: string): types.TemplateLiteral => {
  const ast = parse('<style jsx>{`' + str + '`}</style>', {
    presets: [babelPresetReact],
    sourceType: 'module',
  })

  if (!('program' in ast)) {
    throw new Error(
      `The AST does not have a program node in the expression inside addDynamicExpressionAttributeToJSXTag`
    )
  }

  const theStatementOnlyWihtoutTheProgram = ast.program.body[0] as types.ExpressionStatement
  const container = (theStatementOnlyWihtoutTheProgram.expression as types.JSXElement)
    .children[0] as types.JSXExpressionContainer

  return container.expression as types.TemplateLiteral
}

/**
 * Checks if a string contains {{ expression }} template patterns
 */
export const containsTemplateExpression = (str: string): boolean => {
  return /\{\{.+?\}\}/.test(str)
}

/**
 * Parses a JavaScript expression string into an AST Expression node.
 * e.g. "item.type || 'coin'" → LogicalExpression AST
 */
export const parseJSExpressionAsAST = (expr: string): types.Expression => {
  const ast = parse(`(${expr})`, {
    sourceType: 'module',
  })

  if (!ast || !('program' in ast)) {
    throw new Error(`Failed to parse expression: ${expr}`)
  }

  return (ast.program.body[0] as types.ExpressionStatement).expression
}

/**
 * Parses a string containing {{ expr }} template patterns into a TemplateLiteral AST node.
 * e.g. "translate({{ enemy.x || '0' }}px)" → `translate(${enemy.x || '0'}px)`
 */
export const parseStringWithTemplateExpressions = (str: string): types.TemplateLiteral => {
  // Step 1: Normalize state references: state.xxx → xxx
  const normalized = str.replace(/state\.(\w+)/g, '$1')

  // Step 2: Convert well-formed {{ expr }} to ${expr}
  let templateStr = normalized.replace(
    /\{\{\s*(.+?)\s*\}\}/g,
    (_, expr: string) => '${' + expr.trim() + '}'
  )

  // Step 3: Handle unclosed {{ expr (no closing }})
  // After step 2, any remaining {{ was not well-formed
  if (/\{\{/.test(templateStr)) {
    templateStr = templateStr.replace(
      /\{\{\s*(.+?)$/gm,
      (_, expr: string) => '${' + expr.trim() + '}'
    )
  }

  // Step 4: Detect and fix incomplete CSS function calls
  // If the original string contained a CSS function like translateX(...) or translate(...)
  // but the template expression consumed the closing, we need to re-close it.
  const openParens = (templateStr.match(/\(/g) || []).length
  const closeParens = (templateStr.match(/\)/g) || []).length
  if (openParens > closeParens) {
    // Determine the CSS unit by:
    // 1. Looking for existing units already in the string (e.g. "translate(${x}px, ${y" → px)
    // 2. Inferring from the CSS function name
    const existingUnit = templateStr.match(/(px|deg|em|rem|%|vh|vw)[),\s]/)
    let unit = 'px' // default
    if (existingUnit) {
      unit = existingUnit[1]
    } else {
      // Infer unit from the CSS function name
      const fnMatch = templateStr.match(/\b(rotate|skew|skewX|skewY)\s*\(/)
      if (fnMatch) {
        unit = 'deg'
      }
      const noUnitFns = /\b(scale|scaleX|scaleY|scale3d|opacity)\s*\(/
      if (noUnitFns.test(templateStr)) {
        unit = ''
      }
    }

    const missingCloses = openParens - closeParens
    templateStr += unit + ')'.repeat(missingCloses)
  }

  const ast = parse('const x = `' + templateStr + '`', {
    sourceType: 'module',
  })

  if (!ast || !('program' in ast)) {
    throw new Error(`Failed to parse template expression: ${str}`)
  }

  const decl = ast.program.body[0] as types.VariableDeclaration
  return decl.declarations[0].init as types.TemplateLiteral
}

const REACT_BOOLEAN_DOM_PROPS = new Set([
  'disabled',
  'required',
  'readOnly',
  'checked',
  'multiple',
  'hidden',
  'autoFocus',
  'muted',
  'loop',
  'playsInline',
  'controls',
  'async',
  'defer',
  'inert',
  'scoped',
  'reversed',
  'allowFullScreen',
  'defaultChecked',
  'selected',
  'formNoValidate',
  'noValidate',
])

export const addAttributeToJSXTag = (
  jsxNode: types.JSXElement,
  attrName: string,
  attrValue?: boolean | unknown,
  t = types
) => {
  const reactAttrName = convertToReactAttributeName(attrName)
  const nameOfAttribute = t.jsxIdentifier(reactAttrName)
  let attributeDefinition
  let normalizedValue: boolean | unknown = attrValue
  if (
    typeof attrValue === 'string' &&
    (attrValue === 'true' || attrValue === 'false') &&
    REACT_BOOLEAN_DOM_PROPS.has(reactAttrName)
  ) {
    normalizedValue = attrValue === 'true'
  }
  if (typeof normalizedValue === 'boolean') {
    attributeDefinition = t.jsxAttribute(
      nameOfAttribute,
      normalizedValue === true
        ? undefined
        : t.jsxExpressionContainer(t.booleanLiteral(normalizedValue))
    )
  } else if (t.isNode(attrValue) && t.isJSXElement(attrValue)) {
    attributeDefinition = t.jsxAttribute(nameOfAttribute, t.jsxExpressionContainer(attrValue))
  } else {
    attributeDefinition = t.jsxAttribute(
      nameOfAttribute,
      getProperAttributeValueAssignment(normalizedValue)
    )
  }

  const attribute: types.JSXAttribute = jsxNode.openingElement.attributes.find((attr) => {
    if (attr.type === 'JSXAttribute') {
      return attr.name.name === reactAttrName
    }
  }) as types.JSXAttribute

  if (attribute && attribute.value && attribute.value.type === 'StringLiteral') {
    attribute.value.value = `${attribute.value.value} ${attrValue}`
    return
  }

  jsxNode.openingElement.attributes.push(attributeDefinition)
}

export const addRawAttributeToJSXTag = (
  jsxNode: types.JSXElement,
  attrName: string,
  attrValue: UIDLRawValue,
  t = types
) => {
  // The content is expected to be pre-escaped for template literal context
  // (e.g., \` for backticks, \${ for interpolations). Babel validates that
  // the raw value is valid template literal content.
  //
  // We fix any unescaped backticks or ${ sequences that would make the
  // template literal invalid. "Unescaped" means preceded by an even number
  // of backslashes (0, 2, …), since pairs of backslashes form escape
  // sequences for backslash itself, leaving the next character unescaped.
  const content = attrValue.content
    .replace(/\\*`/g, (match) => {
      const bs = match.length - 1
      return bs % 2 === 0 ? match.slice(0, bs) + '\\`' : match
    })
    .replace(/\\*\$\{/g, (match) => {
      const bs = match.length - 2
      return bs % 2 === 0 ? match.slice(0, bs) + '\\${' : match
    })

  const attributeDefinition = t.jsxAttribute(
    t.jsxIdentifier(attrName),
    t.jsxExpressionContainer(types.templateLiteral([types.templateElement({ raw: content })], []))
  )
  jsxNode.openingElement.attributes.push(attributeDefinition)
}

/**
 * node must be a AST node element of type JSXElement (babel-types) or
 * equivalent
 */
const getProperAttributeValueAssignment = (value: string | unknown, t = types) => {
  if (typeof value === 'string') {
    return t.stringLiteral(StringUtils.encode(value))
  }

  if (!value && value !== 0 && value !== false) {
    return null
  }

  return t.jsxExpressionContainer(convertValueToLiteral(value))
}

export const addChildJSXTag = (
  tag: types.JSXElement,
  childNode: types.JSXElement | types.JSXExpressionContainer,
  t = types
) => {
  tag.children.push(childNode, t.jsxText('\n'))
}

export const addChildJSXText = (tag: types.JSXElement, text: string, t = types) => {
  tag.children.push(t.jsxText(text), t.jsxText('\n'))
}

export const addSpreadAttributeToJSXTag = (
  jsxTag: types.JSXElement,
  attrName: string,
  t = types
) => {
  jsxTag.openingElement.attributes.push(t.jsxSpreadAttribute(t.identifier(attrName)))
}

export const renameJSXTag = (jsxTag: types.JSXElement, newName: string, t = types) => {
  jsxTag.openingElement.name = t.jsxIdentifier(newName)
  if (jsxTag.closingElement) {
    jsxTag.closingElement.name = t.jsxIdentifier(newName)
  }
}

export const objectToObjectExpression = (
  objectMap: { [key: string]: ParsedASTNode | unknown },
  t = types
) => {
  const props = Object.keys(objectMap).reduce((acc: unknown[], key) => {
    const keyIdentifier = t.stringLiteral(key)
    const value = objectMap[key]
    let computedLiteralValue = null

    if (value === undefined) {
      return acc
    }

    // Handle null values explicitly - they are valid in array mappers with different schemas
    if (value === null) {
      computedLiteralValue = t.nullLiteral()
    }
    // This is for function props that have successfully been parsed.
    else if (typeof value === 'object' && 'functionExpressionParseResult' in value) {
      computedLiteralValue = value.functionExpressionParseResult
    } else if (value instanceof ParsedASTNode || value.constructor.name === 'ParsedASTNode') {
      computedLiteralValue = (value as ParsedASTNode).ast
    } else if (typeof value === 'boolean') {
      computedLiteralValue = t.booleanLiteral(value)
    } else if (typeof value === 'string') {
      computedLiteralValue = t.stringLiteral(value)
    } else if (typeof value === 'number') {
      computedLiteralValue = t.numericLiteral(value)
    } else if (Array.isArray(value)) {
      computedLiteralValue = t.arrayExpression(
        value.map((element) => convertValueToLiteral(element))
      )
    } else if (value === Object) {
      computedLiteralValue = t.identifier('Object')
    } else if (typeof value === 'object') {
      computedLiteralValue = objectToObjectExpression(value as Record<string, unknown>, t)
    } else if (value === String) {
      computedLiteralValue = t.identifier('String')
    } else if (value === Number) {
      computedLiteralValue = t.identifier('Number')
    } else if (value === Array) {
      computedLiteralValue = t.identifier('Array')
    }

    if (computedLiteralValue) {
      // @ts-ignore
      acc.push(t.objectProperty(keyIdentifier, computedLiteralValue))
    }

    return acc
  }, [])

  const objectExpression = t.objectExpression(
    props as Array<types.ObjectMethod | types.ObjectProperty | types.SpreadElement>
  )
  return objectExpression
}

type ExpressionLiteral =
  | types.StringLiteral
  | types.BooleanLiteral
  | types.NumericLiteral
  | types.Identifier
  | types.ArrayExpression
  | types.ObjectExpression
  | types.NullLiteral

export const convertValueToLiteral = (
  // tslint:disable-next-line no-any
  value: any,
  explicitType: string = '',
  t = types
): ExpressionLiteral => {
  if (value === undefined || value === null) {
    return t.nullLiteral()
  }

  if (Array.isArray(value)) {
    return t.arrayExpression(value.map((val) => convertValueToLiteral(val)))
  }

  if (explicitType === 'array' && typeof value === 'object' && value !== null) {
    const arr = Object.keys(value)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => convertValueToLiteral(value[key]))
    return t.arrayExpression(arr)
  }

  if ((explicitType === 'array' || explicitType === 'object') && typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return convertValueToLiteral(parsed, explicitType, t)
    } catch {
      // If parsing fails, fall through to treat as a regular string
    }
  }

  const actualType = typeof value
  const typeToCompare = explicitType && explicitType === actualType ? explicitType : actualType
  switch (typeToCompare) {
    case 'string':
      return t.stringLiteral(value)
    case 'boolean':
      return t.booleanLiteral(value)
    case 'number':
      return t.numericLiteral(value)
    case 'object':
      return objectToObjectExpression(value)
    default:
      return t.identifier(value.toString())
  }
}

export const addPropertyToASTObject = (
  obj: types.ObjectExpression,
  key: string,
  // tslint:disable-next-line no-any
  value: any,
  t = types
) => {
  obj.properties.push(t.objectProperty(t.identifier(key), convertValueToLiteral(value)))
}

// tslint:disable-next-line no-any
export const getTSAnnotationForType = (type: any, t = types) => {
  switch (type) {
    case 'string':
      return t.tsStringKeyword()
    case 'number':
      return t.tsNumberKeyword()
    case 'boolean':
      return t.tsBooleanKeyword()
    default:
      return t.tsAnyKeyword()
  }
}

export const findAttributeByName = (jsxTag: types.JSXElement, attrName: string) => {
  return jsxTag.openingElement.attributes.find(
    (attr) => attr.type === 'JSXAttribute' && attr.name.name === attrName
  ) as types.JSXAttribute
}

export const removeAttributeByName = (jsxTag: types.JSXElement, attrName: string) => {
  jsxTag.openingElement.attributes = jsxTag.openingElement.attributes.filter(
    (attr) =>
      attr.type === 'JSXSpreadAttribute' ||
      (attr.type === 'JSXAttribute' && attr.name.name !== attrName)
  )
}

export const createClassComponent = (
  name: string,
  propDefinitions: Record<string, UIDLPropDefinition>,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  jsxTagTree: types.JSXElement,
  dynamicReferencePrefixMap?: { prop: string; state: string; local: string },
  t = types
) => {
  // TODO: Add event handlers as separate functions later
  const classMethodsAndProperties = []
  const renderMethodArguments = []

  if (Object.keys(propDefinitions).length > 0 || Object.keys(stateDefinitions).length > 0) {
    renderMethodArguments.push(t.identifier('props'))
  }

  if (Object.keys(stateDefinitions).length > 0) {
    const stateDeclarationsAST = Object.keys(stateDefinitions).map((stateKey) => {
      const stateDefinition = stateDefinitions[stateKey]
      if (
        stateDefinition.type === 'object' &&
        dynamicReferencePrefixMap &&
        isObjectStateWithEntries(stateDefinition)
      ) {
        return t.objectProperty(
          t.identifier(stateKey),
          convertObjectStateDefaultToExpression(
            stateDefinition.defaultValue as Record<string, unknown>,
            dynamicReferencePrefixMap,
            t
          )
        )
      }
      return t.objectProperty(
        t.identifier(stateKey),
        convertValueToLiteral(stateDefinition.defaultValue)
      )
    })

    classMethodsAndProperties.push(
      t.classProperty(t.identifier('state'), t.objectExpression(stateDeclarationsAST))
    )
    renderMethodArguments.push(t.identifier('state'))
  }

  const classBody = t.classBody([
    ...classMethodsAndProperties,
    t.classMethod(
      'method',
      t.identifier('render'),
      renderMethodArguments,
      t.blockStatement([t.returnStatement(jsxTagTree)])
    ),
  ])

  const classDeclaration = t.classDeclaration(
    t.identifier(name),
    t.identifier('Component'),
    classBody,
    null
  )

  return classDeclaration
}

export const createPureComponent = (
  name: string,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  jsxTagTree: types.JSXElement,
  windowImports: Record<string, types.ExpressionStatement> = {},
  dynamicReferencePrefixMap?: { prop: string; state: string; local: string },
  t = types
): types.VariableDeclaration => {
  const arrowFunctionBody = createReturnExpressionSyntax(
    stateDefinitions,
    jsxTagTree,
    windowImports,
    dynamicReferencePrefixMap
  )
  const arrowFunction = t.arrowFunctionExpression([t.identifier('props')], arrowFunctionBody)

  const declarator = t.variableDeclarator(t.identifier(name), arrowFunction)
  const component = t.variableDeclaration('const', [declarator])

  return component
}

export const createReturnExpressionSyntax = (
  stateDefinitions: Record<string, UIDLStateDefinition>,
  jsxTagTree: types.JSXElement,
  windowImports: Record<string, types.ExpressionStatement> = {},
  dynamicReferencePrefixMap?: { prop: string; state: string; local: string },
  t = types
) => {
  const returnStatement = t.returnStatement(jsxTagTree)

  const stateHooks = Object.keys(stateDefinitions).map((stateKey) =>
    createStateHookAST(stateKey, stateDefinitions[stateKey], dynamicReferencePrefixMap)
  )

  return t.blockStatement([...stateHooks, ...Object.values(windowImports), returnStatement])
}

/**
 * Creates an AST line for defining a single state hook
 */
export const createStateHookAST = (
  stateKey: string,
  stateDefinition: UIDLStateDefinition,
  dynamicReferencePrefixMap?: { prop: string; state: string; local: string },
  t = types
) => {
  let defaultValueArgument: types.Expression

  if (
    stateDefinition.type === 'object' &&
    dynamicReferencePrefixMap &&
    isObjectStateWithEntries(stateDefinition)
  ) {
    defaultValueArgument = convertObjectStateDefaultToExpression(
      stateDefinition.defaultValue as Record<string, unknown>,
      dynamicReferencePrefixMap,
      t
    )
  } else {
    defaultValueArgument = convertValueToLiteral(stateDefinition.defaultValue, stateDefinition.type)
  }

  // When the state has a dataSourceBinding, the initial value comes from props
  // Generated: useState(props.stateKey !== undefined ? props.stateKey : defaultValue)
  let useStateArgument: types.Expression = defaultValueArgument
  if (stateDefinition.dataSourceBinding) {
    const propAccess = t.memberExpression(t.identifier('props'), t.identifier(stateKey))
    useStateArgument = t.conditionalExpression(
      t.binaryExpression('!==', propAccess, t.identifier('undefined')),
      propAccess,
      defaultValueArgument
    )
  } else if (
    stateDefinition.urlSearchParamBinding &&
    typeof stateDefinition.urlSearchParamBinding.key === 'string' &&
    stateDefinition.urlSearchParamBinding.key !== ''
  ) {
    // URL-search-param binding: seed the initial state directly from
    // `window.location.search`. We deliberately DO NOT use Next.js'
    // `router.query` here because on statically-generated pages (getStaticProps
    // / getStaticPaths) `router.query` is empty on the first render and only
    // hydrates after `router.isReady` flips to true — by which point React's
    // `useState` initializer has already captured the fallback default. That
    // regression shipped as "detail panel does not auto-open on deep links to
    // /admin/products?products_detail_panel_item_id=<id>". `window.location`
    // is populated synchronously on both direct loads and client-side
    // navigations, and the `typeof window` guard keeps SSR falling back to
    // the declared static default cleanly.
    //
    // Emitted shape:
    //   useState(
    //     (typeof window !== "undefined"
    //       ? new URLSearchParams(window.location.search).get("<key>")
    //       : null) ?? <defaultValueLiteral>
    //   )
    const paramKey = stateDefinition.urlSearchParamBinding.key
    const urlSearchParamsExpr = t.newExpression(t.identifier('URLSearchParams'), [
      t.memberExpression(
        t.memberExpression(t.identifier('window'), t.identifier('location')),
        t.identifier('search')
      ),
    ])
    const readParamExpr = t.callExpression(
      t.memberExpression(urlSearchParamsExpr, t.identifier('get')),
      [t.stringLiteral(paramKey)]
    )
    const browserGuard = t.binaryExpression(
      '!==',
      t.unaryExpression('typeof', t.identifier('window')),
      t.stringLiteral('undefined')
    )
    useStateArgument = t.logicalExpression(
      '??',
      t.conditionalExpression(browserGuard, readParamExpr, t.nullLiteral()),
      defaultValueArgument
    )
  }

  return t.variableDeclaration('const', [
    t.variableDeclarator(
      t.arrayPattern([
        t.identifier(stateKey),
        t.identifier(StringUtils.createStateStoringFunction(stateKey)),
      ]),
      t.callExpression(t.identifier('useState'), [useStateArgument])
    ),
  ])
}

export const isObjectStateWithEntries = (stateDefinition: UIDLStateDefinition): boolean => {
  if (stateDefinition.type !== 'object') {
    return false
  }
  const defaultValue = stateDefinition.defaultValue
  if (typeof defaultValue !== 'object' || defaultValue === null || Array.isArray(defaultValue)) {
    return false
  }
  return Object.values(defaultValue).some((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return false
    }
    const typed = entry as Record<string, unknown>
    return (typed.type === 'static' || typed.type === 'dynamic') && 'content' in typed
  })
}

export const convertObjectStateDefaultToExpression = (
  defaultValue: Record<string, unknown>,
  prefixMap: { prop: string; state: string; local: string },
  t = types
): types.ObjectExpression => {
  const properties = Object.keys(defaultValue).map((key) => {
    const valueExpression = resolveObjectStateEntry(defaultValue[key], prefixMap, t)
    return t.objectProperty(t.stringLiteral(key), valueExpression)
  })

  return t.objectExpression(properties)
}

const resolveObjectStateEntry = (
  entry: unknown,
  prefixMap: { prop: string; state: string; local: string },
  t = types
): types.Expression => {
  if (typeof entry !== 'object' || entry === null) {
    return convertValueToLiteral(entry) as types.Expression
  }

  const typed = entry as { type?: string; content?: unknown }

  if (typed.type === 'static') {
    return convertValueToLiteral(typed.content) as types.Expression
  }

  if (typed.type === 'dynamic') {
    const content = typed.content as {
      referenceType: string
      id: string
      refPath?: string[]
    }
    const { referenceType, id, refPath } = content

    if (referenceType === 'globalState') {
      const gsRefPath = refPath || []
      let expr: types.Identifier | types.OptionalMemberExpression = t.identifier(id)
      for (const segment of gsRefPath) {
        expr = t.optionalMemberExpression(expr, t.identifier(segment), false, true)
      }
      return expr
    }

    if (referenceType === 'global') {
      // Normalize Shape B ({ refPath: ['Current User', 'id'] }) to Shape A
      // ({ id: 'currentUser', refPath: ['id'] }) so downstream access is uniform.
      const resolvedId = resolveGlobalRefId(content)
      if (resolvedId) {
        const tail = !id && refPath && refPath.length > 0 ? refPath.slice(1) : refPath || []
        let expr: types.Identifier | types.OptionalMemberExpression = t.identifier(resolvedId)
        for (const segment of tail) {
          expr = t.optionalMemberExpression(expr, t.identifier(segment), false, true)
        }
        return expr
      }
    }

    const idWithPath = UIDLUtils.generateIdWithRefPath(id, refPath)
    const prefix = prefixMap[referenceType as 'prop' | 'state' | 'local'] || ''

    return prefix === ''
      ? t.identifier(idWithPath)
      : t.memberExpression(t.identifier(prefix), t.identifier(idWithPath))
  }

  return convertValueToLiteral(entry) as types.Expression
}

// Mapping from the UIDL display name used in a global reference refPath
// to the runtime variable name that holds the value. Kept here so both the
// JSX emitter and the object-state global-reference collectors stay in sync.
export const GLOBAL_REF_ID_MAP: Record<string, string> = {
  'E-commerce': 'ecommerce',
  Cart: 'cart',
  'Current User': 'currentUser',
}

export const resolveGlobalRefId = (
  content: { id?: string; refPath?: string[] } | undefined
): string | undefined => {
  if (!content) {
    return undefined
  }
  if (content.id) {
    return content.id
  }
  if (!content.refPath || content.refPath.length === 0) {
    return undefined
  }
  return GLOBAL_REF_ID_MAP[content.refPath[0]]
}

export const collectGlobalReferencesFromObjectStates = (
  stateDefinitions: Record<string, UIDLStateDefinition>
): string[] => {
  const globalRefs: string[] = []

  Object.values(stateDefinitions).forEach((stateDef) => {
    if (stateDef.type !== 'object') {
      return
    }
    const defaultValue = stateDef.defaultValue
    if (typeof defaultValue !== 'object' || defaultValue === null || Array.isArray(defaultValue)) {
      return
    }

    Object.values(defaultValue as Record<string, unknown>).forEach((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        return
      }
      const typed = entry as { type?: string; content?: unknown }
      if (typed.type === 'dynamic') {
        const content = typed.content as {
          referenceType?: string
          id?: string
          refPath?: string[]
        }
        if (content.referenceType === 'global') {
          const resolvedId = resolveGlobalRefId(content)
          if (resolvedId) {
            globalRefs.push(resolvedId)
          }
        }
      }
    })
  })

  return globalRefs
}

export const collectGlobalStateReferencesFromObjectStates = (
  stateDefinitions: Record<string, UIDLStateDefinition>
): Array<{ id: string }> => {
  const refs: Array<{ id: string }> = []

  Object.values(stateDefinitions).forEach((stateDef) => {
    if (stateDef.type !== 'object') {
      return
    }
    const defaultValue = stateDef.defaultValue
    if (typeof defaultValue !== 'object' || defaultValue === null || Array.isArray(defaultValue)) {
      return
    }

    Object.values(defaultValue as Record<string, unknown>).forEach((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        return
      }
      const typed = entry as { type?: string; content?: unknown }
      if (typed.type === 'dynamic') {
        const content = typed.content as { referenceType?: string; id?: string }
        if (content.referenceType === 'globalState' && content.id) {
          refs.push({ id: content.id })
        }
      }
    })
  })

  return refs
}

export const generateDynamicWindowImport = (
  hookName = 'useEffect',
  dependency: string
): types.ExpressionStatement => {
  return types.expressionStatement(
    types.callExpression(types.identifier(hookName), [
      types.arrowFunctionExpression(
        [],
        types.callExpression(types.identifier('import'), [types.stringLiteral(dependency)])
      ),
      types.arrayExpression([]),
    ])
  )
}

export const wrapObjectPropertiesWithExpression = (properties: types.ObjectProperty[]) =>
  types.objectExpression(properties)

export const generateRemoteResourceASTs = (resource: UIDLResourceItem) => {
  const fetchUrl = computeFetchUrl(resource)
  const headersASTs = resource?.headers ? generateRESTHeadersAST(resource.headers) : []
  const queryParams = generateURLParamsAST(resource?.params)
  const fetchUrlQuasis = fetchUrl.quasis
  const queryParamsQuasis = queryParams?.quasis || [types.templateElement({ raw: '', cooked: '' })]

  if (queryParams?.expressions.length > 0) {
    fetchUrlQuasis[fetchUrlQuasis.length - 1].value.raw =
      fetchUrlQuasis[fetchUrlQuasis.length - 1].value.raw + '?'

    fetchUrlQuasis[fetchUrlQuasis.length - 1].value.cooked =
      fetchUrlQuasis[fetchUrlQuasis.length - 1].value.cooked + '?'

    queryParamsQuasis.pop()
  }

  const urlParamsDecleration = generateParamsAST(resource?.params)
  const bodyParamsDecleration = generateParamsAST(resource?.body)
  const url = queryParams?.quasis
    ? types.templateLiteral(
        [...fetchUrlQuasis, ...queryParamsQuasis],
        [...fetchUrl.expressions.concat(queryParams.expressions)]
      )
    : fetchUrl

  const method = types.objectProperty(
    types.identifier('method'),
    types.stringLiteral(resource.method)
  )

  let allHeaders: types.ObjectProperty[] = []

  if (resource?.headers?.authToken) {
    allHeaders.push(computeAuthorizationHeaderAST(resource?.headers))
  }

  if (headersASTs.length) {
    allHeaders = allHeaders.concat(headersASTs)
  }

  const fetchAST = types.variableDeclaration('let', [
    types.variableDeclarator(
      types.identifier('data'),
      types.awaitExpression(
        types.callExpression(types.identifier('fetch'), [
          url,
          types.objectExpression([
            method,
            ...(allHeaders.length > 0
              ? [
                  types.objectProperty(
                    types.identifier('headers'),
                    types.objectExpression(allHeaders)
                  ),
                ]
              : []),
            ...(bodyParamsDecleration.length > 0 && resource?.method === 'POST'
              ? [
                  types.objectProperty(
                    types.identifier('body'),
                    types.callExpression(
                      types.memberExpression(
                        types.identifier('JSON'),
                        types.identifier('stringify')
                      ),
                      [types.identifier('bodyParams')]
                    )
                  ),
                ]
              : []),
          ]),
        ])
      )
    ),
  ])

  // Fallback in case i18n interferes with normal CMS flows
  // Only generate fallback if locale parameter exists
  const hasLocaleParam = resource?.params?.locale !== undefined
  let fallbackAST = null

  if (hasLocaleParam) {
    const fallbackParams = JSON.parse(JSON.stringify(resource))
    delete fallbackParams?.params?.locale
    const fallbackUrlParamsDeclaration = generateParamsAST(fallbackParams?.params)
    const assignmentOfNewUrlParams = types.expressionStatement(
      types.assignmentExpression(
        '=',
        types.identifier('urlParams'),
        types.objectExpression([...fallbackUrlParamsDeclaration])
      )
    )

    const assignmentExpressionAST = types.expressionStatement(
      types.assignmentExpression(
        '=',
        types.identifier('data'),
        types.awaitExpression(
          types.callExpression(types.identifier('fetch'), [
            url,
            types.objectExpression([
              method,
              ...(allHeaders.length > 0
                ? [
                    types.objectProperty(
                      types.identifier('headers'),
                      types.objectExpression(allHeaders)
                    ),
                  ]
                : []),
              ...(bodyParamsDecleration.length > 0 && resource?.method === 'POST'
                ? [
                    types.objectProperty(
                      types.identifier('body'),
                      types.callExpression(
                        types.memberExpression(
                          types.identifier('JSON'),
                          types.identifier('stringify')
                        ),
                        [types.identifier('bodyParams')]
                      )
                    ),
                  ]
                : []),
            ]),
          ])
        )
      )
    )

    fallbackAST = types.ifStatement(
      types.binaryExpression(
        '!==',
        types.memberExpression(types.identifier('data'), types.identifier('status')),
        types.numericLiteral(200)
      ),
      types.blockStatement([assignmentOfNewUrlParams, assignmentExpressionAST])
    )
  }
  const responseType = resource?.response?.type ?? 'json'
  let responseJSONAST

  /**
   * Responce types can be of json, text and we might be reading just headers
   * So, with the response type of the resource. We are returning either
   * - data.json()
   * - data.text()
   * - data.headers
   * back to the caller, from the fetch response.
   */

  switch (responseType) {
    case 'json':
      responseJSONAST = types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('response'),
          types.awaitExpression(
            types.callExpression(
              types.memberExpression(types.identifier('data'), types.identifier('json'), false),
              []
            )
          )
        ),
      ])
      break

    case 'text': {
      responseJSONAST = types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('response'),
          types.awaitExpression(
            types.callExpression(
              types.memberExpression(types.identifier('data'), types.identifier('text'), false),
              []
            )
          )
        ),
      ])
      break
    }

    case 'headers': {
      responseJSONAST = types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('response'),
          types.memberExpression(types.identifier('data'), types.identifier('headers'))
        ),
      ])
      break
    }

    case 'none': {
      responseJSONAST = types.variableDeclaration('const', [
        types.variableDeclarator(types.identifier('response'), types.identifier('data')),
      ])
      break
    }

    default: {
      responseJSONAST = types.variableDeclaration('const', [
        types.variableDeclarator(types.identifier('response'), types.identifier('data')),
      ])
    }
  }

  return [
    ...(urlParamsDecleration.length > 0
      ? [
          types.variableDeclaration('let', [
            types.variableDeclarator(
              types.identifier('urlParams'),
              types.objectExpression(urlParamsDecleration)
            ),
          ]),
        ]
      : []),
    ...(bodyParamsDecleration.length > 0
      ? [
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.identifier('bodyParams'),
              types.objectExpression(bodyParamsDecleration)
            ),
          ]),
        ]
      : []),
    fetchAST,
    ...(fallbackAST ? [fallbackAST] : []),
    responseJSONAST,
  ].filter(Boolean)
}

const generateParamsAST = (
  props: Record<string, UIDLStaticValue | UIDLPropValue | UIDLStateValue | UIDLExpressionValue>
): Array<types.ObjectProperty | types.SpreadElement> => {
  return Object.keys(props || {}).reduce(
    (acc: Array<types.ObjectProperty | types.SpreadElement>, item) => {
      const prop = props[item]
      if (prop.type === 'static') {
        acc.push(types.objectProperty(types.stringLiteral(item), resolveObjectValue(prop)))
      }

      if (prop.type === 'expr') {
        acc.push(
          types.objectProperty(types.stringLiteral(item), getExpressionFromUIDLExpressionNode(prop))
        )
      }

      if (prop.type === 'dynamic') {
        acc.push(
          types.spreadElement(
            types.logicalExpression(
              '&&',
              types.memberExpression(
                types.identifier('params'),
                types.stringLiteral(prop.content.id),
                true,
                false
              ),
              types.objectExpression([
                types.objectProperty(
                  types.stringLiteral(item),
                  types.memberExpression(
                    types.identifier('params'),
                    types.stringLiteral(prop.content.id),
                    true,
                    false
                  )
                ),
              ])
            )
          )
        )
      }

      return acc
    },
    []
  )
}

const generateRESTHeadersAST = (headers: UIDLResourceItem['headers']): types.ObjectProperty[] => {
  return (
    Object.keys(headers)
      // `authToken` is rendered as the `Authorization` header; `authScheme` is a
      // generator-only directive for that header's prefix — neither is emitted as
      // its own literal HTTP header.
      .filter((header) => header !== 'authToken' && header !== 'authScheme')
      .map((header) => {
        const headerResolved = resolveResourceValue(headers[header])
        const value =
          headers[header].type === 'static'
            ? types.stringLiteral(String(headerResolved))
            : types.identifier(String(headerResolved))
        return types.objectProperty(types.stringLiteral(header), value)
      })
  )
}

export const generateMemberExpressionASTFromBase = (
  base: types.OptionalMemberExpression | types.MemberExpression | types.Identifier,
  path: string[]
): types.OptionalMemberExpression => {
  if (path.length === 1) {
    return types.optionalMemberExpression(base, types.identifier(path[0]), false, true)
  }

  const pathClone = [...path]
  pathClone.pop()

  return types.optionalMemberExpression(
    generateMemberExpressionASTFromBase(base, pathClone),
    types.identifier(path[path.length - 1]),
    false,
    true
  )
}

export const parseValuePath = (valuePath: Array<string | number>): Array<string | number> => {
  return valuePath.map((segment) => {
    if (typeof segment === 'string') {
      const bracketMatch = segment.match(/^\[(\d+)\]$/)
      if (bracketMatch) {
        return parseInt(bracketMatch[1], 10)
      }
      const numericMatch = segment.match(/^\d+$/)
      if (numericMatch) {
        return parseInt(segment, 10)
      }
    }
    return segment
  })
}

export const generateMemberExpressionASTFromPath = (
  path: Array<string | number>
): types.OptionalMemberExpression | types.Identifier => {
  const pathClone = [...path]
  if (path.length === 1) {
    return types.identifier(path[0].toString())
  }

  pathClone.pop()

  const currentPath = path[path.length - 1]
  if (typeof currentPath === 'number') {
    return types.optionalMemberExpression(
      generateMemberExpressionASTFromPath(pathClone),
      types.numericLiteral(currentPath),
      true,
      true
    )
  }

  const containsSpecial = currentPath.indexOf('.') !== -1 || currentPath.indexOf('-') !== -1

  return types.optionalMemberExpression(
    generateMemberExpressionASTFromPath(pathClone),
    containsSpecial ? types.stringLiteral(currentPath) : types.identifier(currentPath),
    containsSpecial,
    true
  )
}

export const generateURLParamsAST = (
  urlParams: Record<string, UIDLStaticValue | UIDLStateValue | UIDLPropValue | UIDLExpressionValue>
): types.TemplateLiteral | null => {
  if (!urlParams) {
    return null
  }

  const queryString: Record<string, types.Expression> = {}
  Object.keys(urlParams).forEach((key) => {
    resolveDynamicValuesFromUrlParams(urlParams[key], queryString, key)
  })

  return types.templateLiteral(
    [
      types.templateElement({ raw: '', cooked: '' }, false),
      types.templateElement({ raw: '', cooked: '' }, true),
    ],
    [types.newExpression(types.identifier('URLSearchParams'), [types.identifier('urlParams')])]
  )
}

const resolveDynamicValuesFromUrlParams = (
  field: UIDLStaticValue | UIDLPropValue | UIDLStateValue | UIDLExpressionValue,
  query: Record<string, types.Expression>,
  prefix: string = null
) => {
  if (field.type === 'dynamic' || field.type === 'static') {
    query[prefix] = resolveUrlParamsValue(field)
  }
}

const resolveUrlParamsValue = (urlParam: UIDLStaticValue | UIDLPropValue | UIDLStateValue) => {
  if (urlParam.type === 'static') {
    return types.stringLiteral(`${urlParam.content}`)
  }

  if (urlParam.content.referenceType !== 'prop' && urlParam.content.referenceType !== 'state') {
    throw new Error('Only prop and state references are supported for url params')
  }

  const paramPath = [
    ...(urlParam.content.referenceType === 'prop' ? ['params'] : ['']),
    urlParam.content.id,
  ]

  const templateLiteralElements = paramPath
    .map((_, index) => {
      const isTail = index === paramPath.length - 1
      return types.templateElement(
        {
          cooked: '',
          raw: '',
        },
        isTail
      )
    })
    .filter((el) => el)

  return types.templateLiteral(templateLiteralElements, [
    generateMemberExpressionASTFromPath(paramPath),
  ])
}

const computeAuthorizationHeaderAST = (headers: UIDLResourceItem['headers']) => {
  const authToken = resolveResourceValue(headers.authToken)
  if (!authToken) {
    return null
  }

  const authTokenType = headers.authToken?.type

  // The auth scheme prefix defaults to `Bearer ` (back-compatible with every CMS
  // and data-source that stores a bare bearer token). A resource may override it
  // via a `headers.authScheme` static value — e.g. WordPress Basic / Application
  // Password auth sets `Basic ` so the rendered header is `Basic <base64>`
  // instead of the wrong `Bearer <base64>`. `authScheme` is consumed here and
  // filtered out of the emitted REST headers (see generateRESTHeadersAST).
  const authSchemeValue = headers.authScheme
  const schemePrefix =
    authSchemeValue &&
    authSchemeValue.type === 'static' &&
    typeof authSchemeValue.content === 'string'
      ? authSchemeValue.content
      : 'Bearer '

  return types.objectProperty(
    types.identifier('Authorization'),
    types.templateLiteral(
      [
        types.templateElement(
          {
            cooked: authTokenType === 'static' ? `${schemePrefix}${authToken}` : schemePrefix,
            raw: authTokenType === 'static' ? `${schemePrefix}${authToken}` : schemePrefix,
          },
          false
        ),
        ...(authTokenType === 'static'
          ? []
          : [
              types.templateElement(
                {
                  cooked: '',
                  raw: '',
                },
                true
              ),
            ]),
      ],
      [...(authTokenType === 'static' ? [] : [types.identifier(String(authToken))])]
    ),
    false,
    false
  )
}

export const computeFetchUrl = (resource: UIDLResourceItem) => {
  const { path } = resource
  const fetchBaseUrl = resolveResourceValue(path.baseUrl)
  const resourceRoute = resolveResourceValue(path.route)

  const baseUrlType = path.baseUrl?.type
  const routeType = path.route?.type

  if (baseUrlType === 'static' && routeType === 'static') {
    const baseUrlStr = typeof fetchBaseUrl === 'string' ? fetchBaseUrl : String(fetchBaseUrl || '')
    const routeStr = typeof resourceRoute === 'string' ? resourceRoute : String(resourceRoute || '')
    const cleanBaseUrl = baseUrlStr.endsWith('/') ? baseUrlStr.slice(0, -1) : baseUrlStr
    const cleanRoute = routeStr.startsWith('/') ? routeStr.slice(1) : routeStr
    const stringsToJoin = [cleanBaseUrl, cleanRoute].filter((item) => item).join('/')

    // If the URL is relative (starts with /), add a runtime base URL prefix
    // so fetch() works in server-side contexts (getStaticProps/getServerSideProps).
    // Non-NEXT_PUBLIC_ env vars are only available server-side in Next.js,
    // so NEXTAUTH_URL naturally resolves to undefined on the client (making baseUrl '').
    if (stringsToJoin.startsWith('/')) {
      const processEnv = types.memberExpression(
        types.identifier('process'),
        types.identifier('env')
      )
      const serverBaseUrlExpr = types.logicalExpression(
        '||',
        types.logicalExpression(
          '||',
          types.memberExpression(processEnv, types.identifier('NEXT_PUBLIC_SITE_URL')),
          types.memberExpression(
            types.memberExpression(types.identifier('process'), types.identifier('env')),
            types.identifier('NEXTAUTH_URL')
          )
        ),
        types.stringLiteral('')
      )
      return types.templateLiteral(
        [
          types.templateElement({ cooked: '', raw: '' }, false),
          types.templateElement({ cooked: `${stringsToJoin}`, raw: `${stringsToJoin}` }, true),
        ],
        [serverBaseUrlExpr]
      )
    }

    return types.templateLiteral(
      [types.templateElement({ cooked: `${stringsToJoin}`, raw: `${stringsToJoin}` }, true)],
      []
    )
  }

  if (!routeType) {
    return baseUrlType === 'static'
      ? types.templateLiteral(
          [types.templateElement({ cooked: `${fetchBaseUrl}`, raw: `${fetchBaseUrl}` }, true)],
          []
        )
      : types.templateLiteral(
          [
            types.templateElement(
              {
                cooked: '',
                raw: '',
              },
              false
            ),
            types.templateElement(
              {
                cooked: '',
                raw: '',
              },
              true
            ),
          ],
          [types.identifier(String(fetchBaseUrl))]
        )
  }

  return types.templateLiteral(
    [
      types.templateElement(
        {
          cooked: '',
          raw: '',
        },
        false
      ),
      types.templateElement(
        {
          cooked: routeType === 'static' ? `/${resourceRoute}` : '/',
          raw: routeType === 'static' ? `/${resourceRoute}` : '/',
        },
        false
      ),
      ...(routeType === 'static'
        ? []
        : [
            types.templateElement(
              {
                cooked: '',
                raw: '',
              },
              false
            ),
          ]),
    ],
    [
      types.identifier(String(fetchBaseUrl)),
      ...(routeType === 'static' ? [] : [types.identifier(String(resourceRoute))]),
    ]
  )
}

const resolveResourceValue = (value: UIDLStaticValue | UIDLENVValue) => {
  if (!value) {
    return ''
  }

  if (value.type === 'static') {
    return value.content
  }

  return `process.env.${value.content}`
}

export const resolveObjectValue = (
  prop: UIDLStaticValue | UIDLExpressionValue
):
  | types.Identifier
  | types.StringLiteral
  | types.NumericLiteral
  | types.BooleanLiteral
  | types.ObjectExpression
  | types.ArrayExpression
  | types.Expression => {
  if (prop.type === 'static') {
    const value =
      typeof prop.content === 'string'
        ? types.stringLiteral(prop.content)
        : typeof prop.content === 'boolean'
        ? types.booleanLiteral(prop.content)
        : typeof prop.content === 'number'
        ? types.numericLiteral(prop.content)
        : Array.isArray(prop.content)
        ? types.arrayExpression(prop.content.map((element) => convertValueToLiteral(element)))
        : typeof prop.content === 'object'
        ? objectToObjectExpression(prop.content as unknown as Record<string, unknown>)
        : types.identifier(String(prop.content))

    return value
  }

  if (prop.type === 'expr') {
    return getExpressionFromUIDLExpressionNode(prop)
  }
}

/**
 * Detects if a value is a UIDL dynamic reference (state or prop)
 */
export const isUIDLDynamicReference = (value: unknown): boolean => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as Record<string, unknown>).type === 'dynamic' &&
    'content' in value &&
    typeof (value as Record<string, unknown>).content === 'object' &&
    (value as Record<string, unknown>).content !== null &&
    'referenceType' in ((value as Record<string, unknown>).content as Record<string, unknown>) &&
    'id' in ((value as Record<string, unknown>).content as Record<string, unknown>)
  )
}

/**
 * Converts a filter destination value to an AST expression.
 * Handles both static values and dynamic references (state/prop).
 */
export const convertFilterDestinationToExpression = (
  destination: unknown,
  options?: { dynamicReferencePrefixMap?: Record<string, string> }
): types.Expression => {
  // Handle dynamic references (state or prop)
  if (isUIDLDynamicReference(destination)) {
    const content = (destination as Record<string, unknown>).content as {
      referenceType: string
      id: string
    }
    const { referenceType, id } = content

    if (referenceType === 'state') {
      return types.identifier(id)
    }

    if (referenceType === 'prop') {
      const prefix = options?.dynamicReferencePrefixMap?.prop || 'props'
      return types.memberExpression(types.identifier(prefix), types.identifier(id))
    }

    // Fallback for other reference types
    return types.identifier(id)
  }

  // Handle static string values
  if (typeof destination === 'string') {
    return types.stringLiteral(destination)
  }

  // Handle other primitives
  if (typeof destination === 'number') {
    return types.numericLiteral(destination)
  }

  if (typeof destination === 'boolean') {
    return types.booleanLiteral(destination)
  }

  // Handle arrays
  if (Array.isArray(destination)) {
    return types.arrayExpression(
      destination.map((item) => convertFilterDestinationToExpression(item, options))
    )
  }

  // Fallback to empty string for undefined/null
  return types.stringLiteral('')
}

export const getExpressionFromUIDLExpressionNode = (
  node: UIDLExpressionValue
): types.Expression => {
  let ast
  try {
    ast = parse(sanitizeExprContent(node.content), {
      sourceType: 'module' as const,
    })
  } catch (err) {
    // Malformed expression content in the UIDL (e.g. `?.subtitle` missing its
    // left-hand identifier). Don't abort the whole generation — warn and fall
    // back to `undefined`, which renders as nothing in JSX.
    // tslint:disable-next-line:no-console
    console.warn(
      `Failed to parse UIDL expression content ${JSON.stringify(node.content)}: ${
        (err as Error).message
      }. Falling back to 'undefined'.`
    )
    return types.identifier('undefined')
  }

  if (!ast || !('program' in ast)) {
    throw new Error(
      `The AST does not have a program node in the expression inside addDynamicExpressionAttributeToJSXTag`
    )
  }

  const theStatementOnlyWihtoutTheProgram = ast.program.body[0]

  if (
    !theStatementOnlyWihtoutTheProgram ||
    theStatementOnlyWihtoutTheProgram.type !== 'ExpressionStatement'
  ) {
    throw new Error(`Expr dynamic attribute only support expressions statements at the moment.`)
  }

  return theStatementOnlyWihtoutTheProgram.expression
}

export const isJSXElement = (value: types.JSXElement | HastNode): value is types.JSXElement =>
  value.type === 'JSXElement'

/**
 * Because of the restrictions of the AST Types we need to have a clear subset of binary operators we can use
 * @param operation - the operation defined in the UIDL for the current state branch
 */
export const convertToBinaryOperator = (operation: string): BinaryOperator => {
  const allowedOperations = ['===', '!==', '>=', '<=', '>', '<']
  if (allowedOperations.includes(operation)) {
    return operation as BinaryOperator
  } else {
    return '==='
  }
}

export const convertToUnaryOperator = (operation: string): UnaryOperation => {
  const allowedOperations = ['!']
  if (allowedOperations.includes(operation)) {
    return operation as UnaryOperation
  } else {
    return '!'
  }
}
