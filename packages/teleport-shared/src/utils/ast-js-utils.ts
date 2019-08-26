import * as types from '@babel/types'
import { UIDLEventHandlerStatement, UIDLPropDefinition } from '@teleporthq/teleport-types'
/**
 * A tricky way to pass down custom configuration into
 * the objectToObjectExpression values, to allow for member expressions like
 * Proptypes.String.isRequired to be handled by the function.
 */
export class ParsedASTNode {
  public ast: any

  constructor(ast: any) {
    this.ast = ast
  }
}

export const objectToObjectExpression = (objectMap: { [key: string]: any }, t = types) => {
  const props = Object.keys(objectMap).reduce((acc: any[], key) => {
    const keyIdentifier = t.stringLiteral(key)
    const value = objectMap[key]
    let computedLiteralValue: any = null

    if (value instanceof ParsedASTNode || value.constructor.name === 'ParsedASTNode') {
      computedLiteralValue = value.ast
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
      computedLiteralValue = objectToObjectExpression(value, t)
    } else if (value === String) {
      computedLiteralValue = t.identifier('String')
    } else if (value === Number) {
      computedLiteralValue = t.identifier('Number')
    } else if (value === Array) {
      computedLiteralValue = t.identifier('Array')
    }

    if (computedLiteralValue) {
      acc.push(t.objectProperty(keyIdentifier, computedLiteralValue))
    }

    return acc
  }, [])

  const objectExpression = t.objectExpression(props)
  return objectExpression
}

type ExpressionLiteral =
  | types.StringLiteral
  | types.BooleanLiteral
  | types.NumberLiteral
  | types.Identifier
  | types.ArrayExpression
  | types.ObjectExpression
  | types.NullLiteral

export const convertValueToLiteral = (
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
  value: any,
  t = types
) => {
  obj.properties.push(t.objectProperty(t.identifier(key), convertValueToLiteral(value)))
}

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

export const createMethodsObject = (
  methods: Record<string, UIDLEventHandlerStatement[]>,
  propDefinitions: Record<string, UIDLPropDefinition>,
  flavor: 'angular' | 'vue',
  t = types
) => {
  return Object.keys(methods).map((eventKey) => {
    const astStatements = []
    methods[eventKey].map((statement) => {
      const astStatement =
        statement.type === 'propCall'
          ? createPropCallStatement(statement, propDefinitions, flavor)
          : createStateChangeStatement(statement)

      if (astStatement) {
        astStatements.push(astStatement)
      }
    })
    return flavor === 'angular'
      ? t.classMethod('method', t.identifier(eventKey), [], t.blockStatement(astStatements))
      : t.objectMethod('method', t.identifier(eventKey), [], t.blockStatement(astStatements))
  })
}

const createStateChangeStatement = (statement: UIDLEventHandlerStatement, t = types) => {
  const { modifies, newState } = statement

  const rightOperand =
    newState === '$toggle'
      ? t.unaryExpression('!', t.memberExpression(t.identifier('this'), t.identifier(modifies)))
      : convertValueToLiteral(newState)

  return t.expressionStatement(
    t.assignmentExpression(
      '=',
      t.memberExpression(t.identifier('this'), t.identifier(modifies)),
      rightOperand
    )
  )
}

const createPropCallStatement = (
  eventHandlerStatement: UIDLEventHandlerStatement,
  propDefinitions: Record<string, UIDLPropDefinition>,
  flavor: 'angular' | 'vue',
  t = types
) => {
  const { calls: propFunctionKey, args = [] } = eventHandlerStatement

  if (!propFunctionKey) {
    console.warn(`No prop definition referenced under the "calls" field`)
    return null
  }

  const propDefinition = propDefinitions[propFunctionKey]

  if (!propDefinition) {
    console.warn(`No prop definition was found for function "${propFunctionKey}"`)
    return null
  }

  // In vue it's favorable to use $emit for a specific event than sending the function as a prop
  const emitter =
    flavor === 'angular'
      ? t.expressionStatement(
          t.callExpression(
            t.memberExpression(
              t.memberExpression(t.thisExpression(), t.identifier(propFunctionKey)),
              t.identifier('emit')
            ),
            []
          )
        )
      : t.expressionStatement(
          t.callExpression(t.identifier('this.$emit'), [
            t.stringLiteral(propFunctionKey),
            ...args.map((arg) => convertValueToLiteral(arg)),
          ])
        )
  return emitter
}
