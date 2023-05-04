import * as types from '@babel/types'
import ParsedASTNode from './parsed-ast'
import { StringUtils } from '@teleporthq/teleport-shared'
import { UIDLStateDefinition, UIDLPropDefinition, UIDLRawValue } from '@teleporthq/teleport-types'
/**
 * Adds a class definition string to an existing string of classes
 */
export const addClassStringOnJSXTag = (
  jsxNode: types.JSXElement,
  classString: string,
  classAttributeName?: string,
  dynamicValues: Array<types.MemberExpression | types.Identifier> = []
) => {
  const classAttribute = getClassAttribute(jsxNode, { createIfNotFound: true, classAttributeName })

  if (dynamicValues.length === 0) {
    if (classAttribute.value && classAttribute.value.type === 'StringLiteral') {
      const classArray = classAttribute.value.value.split(' ')
      classArray.push(classString)
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
      const expression: Array<types.MemberExpression | types.Identifier> = []

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
  const content =
    prefix === ''
      ? t.identifier(value)
      : t.memberExpression(t.identifier(prefix), t.identifier(value))

  jsxASTNode.openingElement.attributes.push(
    t.jsxAttribute(t.jsxIdentifier(name), t.jsxExpressionContainer(content))
  )
}

/*
  Use, when we need to add a mix of dynamic and static values to
  the same attribute at the same time.
*/

export const addMultipleDynamicAttributesToJSXTag = (
  jsxASTNode: types.JSXElement,
  name: string,
  attrValues: Array<types.MemberExpression | types.Identifier> = [],
  t = types
) => {
  const memberExpressions: Array<types.Identifier | types.MemberExpression> = []
  const templateElements: types.TemplateElement[] = []

  if (attrValues.length === 0) {
    return
  }

  let content: types.TemplateLiteral | types.MemberExpression | types.Identifier
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

export const stringAsTemplateLiteral = (str: string, t = types) => {
  const formmattedString = `
${str}
  `
  return t.templateLiteral(
    [
      t.templateElement(
        {
          raw: formmattedString,
          cooked: formmattedString,
        },
        true
      ),
    ],
    []
  )
}

export const addAttributeToJSXTag = (
  jsxNode: types.JSXElement,
  attrName: string,
  attrValue?: boolean | unknown,
  t = types
) => {
  const nameOfAttribute = t.jsxIdentifier(attrName)
  let attributeDefinition
  if (typeof attrValue === 'boolean') {
    attributeDefinition = t.jsxAttribute(
      nameOfAttribute,
      attrValue === true ? undefined : t.jsxExpressionContainer(t.booleanLiteral(attrValue))
    )
  } else {
    attributeDefinition = t.jsxAttribute(
      nameOfAttribute,
      getProperAttributeValueAssignment(attrValue)
    )
  }

  jsxNode.openingElement.attributes.push(attributeDefinition)
}

export const addRawAttributeToJSXTag = (
  jsxNode: types.JSXElement,
  attrName: string,
  attrValue: UIDLRawValue,
  t = types
) => {
  const attributeDefinition = t.jsxAttribute(
    t.jsxIdentifier(attrName),
    t.jsxExpressionContainer(
      types.templateLiteral([types.templateElement({ raw: attrValue.content })], [])
    )
  )
  jsxNode.openingElement.attributes.push(attributeDefinition)
}

/**
 * node must be a AST node element of type JSXElement (babel-types) or
 * equivalent
 */
const getProperAttributeValueAssignment = (value: string | unknown, t = types) => {
  if (!value) {
    return null
  }

  if (typeof value === 'string') {
    return t.stringLiteral(StringUtils.encode(value))
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

    if (value instanceof ParsedASTNode || value.constructor.name === 'ParsedASTNode') {
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

  const typeToCompare = explicitType ? explicitType : typeof value
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
      return t.tsUnknownKeyword()
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
  t = types
): types.VariableDeclaration => {
  const arrowFunctionBody = createReturnExpressionSyntax(
    stateDefinitions,
    jsxTagTree,
    windowImports
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
  t = types
) => {
  const returnStatement = t.returnStatement(jsxTagTree)

  const stateHooks = Object.keys(stateDefinitions).map((stateKey) =>
    createStateHookAST(stateKey, stateDefinitions[stateKey])
  )

  return t.blockStatement([...stateHooks, ...Object.values(windowImports), returnStatement] || [])
}

/**
 * Creates an AST line for defining a single state hook
 */
export const createStateHookAST = (
  stateKey: string,
  stateDefinition: UIDLStateDefinition,
  t = types
) => {
  const defaultValueArgument = convertValueToLiteral(
    stateDefinition.defaultValue,
    stateDefinition.type
  )

  return t.variableDeclaration('const', [
    t.variableDeclarator(
      t.arrayPattern([
        t.identifier(stateKey),
        t.identifier(`set${StringUtils.capitalize(stateKey)}`),
      ]),
      t.callExpression(t.identifier('useState'), [defaultValueArgument])
    ),
  ])
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
