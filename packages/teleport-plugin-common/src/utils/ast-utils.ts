import * as types from '@babel/types'
import { parse } from '@babel/core'
import ParsedASTNode from './parsed-ast'
import { StringUtils } from '@teleporthq/teleport-shared'
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
 * Adds a class definition string to an existing string of classes
 */
export const addClassStringOnJSXTag = (
  jsxNode: types.JSXElement,
  classString: string,
  classAttributeName?: string,
  dynamicValues: Array<types.MemberExpression | types.Identifier> = []
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

/**
 * Make code expressions happen in AST
 * Replace variables that are found in AST with
 * the corresponding value from the contexts for now
 * and in the future with other sources.
 */
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

  const code = dynamicContent
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

  jsxASTNode.openingElement.attributes.push(
    t.jsxAttribute(
      t.jsxIdentifier(attrKey),
      t.jsxExpressionContainer(theStatementOnlyWihtoutTheProgram.expression)
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
  } else if (t.isNode(attrValue) && t.isJSXElement(attrValue)) {
    attributeDefinition = t.jsxAttribute(nameOfAttribute, t.jsxExpressionContainer(attrValue))
  } else {
    attributeDefinition = t.jsxAttribute(
      nameOfAttribute,
      getProperAttributeValueAssignment(attrValue)
    )
  }

  const attribute: types.JSXAttribute = jsxNode.openingElement.attributes.find((attr) => {
    if (attr.type === 'JSXAttribute') {
      return attr.name.name === attrName
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
        t.identifier(StringUtils.createStateStoringFunction(stateKey)),
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

  const fetchAST = types.variableDeclaration('const', [
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
          types.variableDeclaration('const', [
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
    responseJSONAST,
  ]
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
  return Object.keys(headers)
    .filter((header) => header !== 'authToken')
    .map((header) => {
      const headerResolved = resolveResourceValue(headers[header])
      const value =
        headers[header].type === 'static'
          ? types.stringLiteral(String(headerResolved))
          : types.identifier(String(headerResolved))
      return types.objectProperty(types.stringLiteral(header), value)
    })
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
      false,
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

  return types.objectProperty(
    types.identifier('Authorization'),
    types.templateLiteral(
      [
        types.templateElement(
          {
            cooked: authTokenType === 'static' ? `Bearer ${authToken}` : 'Bearer ',
            raw: authTokenType === 'static' ? `Bearer ${authToken}` : 'Bearer ',
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
    const stringsToJoin = [fetchBaseUrl, resourceRoute].filter((item) => item).join('/')
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
  | types.Expression => {
  if (prop.type === 'static') {
    const value =
      typeof prop.content === 'string'
        ? types.stringLiteral(prop.content)
        : typeof prop.content === 'boolean'
        ? types.booleanLiteral(prop.content)
        : typeof prop.content === 'number'
        ? types.numericLiteral(prop.content)
        : typeof prop.content === 'object'
        ? objectToObjectExpression(prop.content as unknown as Record<string, unknown>)
        : types.identifier(String(prop.content))

    return value
  }

  if (prop.type === 'expr') {
    return getExpressionFromUIDLExpressionNode(prop)
  }
}

export const getExpressionFromUIDLExpressionNode = (
  node: UIDLExpressionValue
): types.Expression => {
  const ast = parse(node.content, {
    sourceType: 'module' as const,
  })

  if (!('program' in ast)) {
    throw new Error(
      `The AST does not have a program node in the expression inside addDynamicExpressionAttributeToJSXTag`
    )
  }

  const theStatementOnlyWihtoutTheProgram = ast.program.body[0]

  if (theStatementOnlyWihtoutTheProgram.type !== 'ExpressionStatement') {
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
