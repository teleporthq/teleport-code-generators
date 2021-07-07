import * as types from '@babel/types'
import { ASTUtils, ParsedASTNode } from '@teleporthq/teleport-plugin-common'
import { UIDLPropDefinition } from '@teleporthq/teleport-types'

export const buildDefaultPropsAst = (
  componentName: string,
  propDefinitions: Record<string, UIDLPropDefinition>,
  t = types
) => {
  if (!propDefinitions) {
    return null
  }

  const defaultValuesSearch = Object.keys(propDefinitions).reduce(
    // tslint:disable-next-line no-any
    (acc: any, key) => {
      const { defaultValue } = propDefinitions[key]
      if (typeof defaultValue !== 'undefined') {
        acc.values[key] = defaultValue
        acc.count++
      }
      return acc
    },
    { values: {}, count: 0 }
  )

  if (defaultValuesSearch.count === 0) {
    return null
  }

  const memberExpression = t.memberExpression(
    t.identifier(componentName),
    t.identifier('defaultProps')
  )

  const memberExpressionValue = ASTUtils.objectToObjectExpression(defaultValuesSearch.values)

  const assignmentExpression = t.assignmentExpression('=', memberExpression, memberExpressionValue)

  return t.expressionStatement(assignmentExpression)
}

export const buildTypesOfPropsAst = (
  componentName: string,
  propTypesNames: string,
  propDefinitions: Record<string, UIDLPropDefinition>,
  t = types
) => {
  if (!propDefinitions) {
    return null
  }

  const defaultValuesSearch = Object.keys(propDefinitions).reduce(
    // tslint:disable-next-line no-any
    (acc: any, key) => {
      const { type, isRequired } = propDefinitions[key]
      const astProp = t.memberExpression(t.identifier(propTypesNames), t.identifier(type))
      const astValue = isRequired
        ? t.memberExpression(astProp, t.identifier('isRequired'))
        : astProp
      acc.values[key] = new ParsedASTNode(astValue)
      acc.count++
      return acc
    },
    { values: {}, count: 0 }
  )

  if (defaultValuesSearch.count === 0) {
    return null
  }

  const memberExpression = t.memberExpression(
    t.identifier(componentName),
    t.identifier('propTypes')
  )

  const memberExpressionValue = ASTUtils.objectToObjectExpression(defaultValuesSearch.values)

  const assignmentExpression = t.assignmentExpression('=', memberExpression, memberExpressionValue)

  return t.expressionStatement(assignmentExpression)
}
