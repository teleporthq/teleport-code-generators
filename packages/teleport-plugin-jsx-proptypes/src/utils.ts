import * as types from '@babel/types'
import { parse } from '@babel/core'
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
      const { defaultValue, type } = propDefinitions[key]

      if (type === 'func') {
        // Initialize with empty function
        let parsedFunction: unknown = new ParsedASTNode(
          types.arrowFunctionExpression([], types.blockStatement([]))
        )

        try {
          const options = {
            sourceType: 'module' as const,
          }
          const parseResult = parse(defaultValue.toString(), options)?.program?.body?.[0]
          if (parseResult.type === 'ExpressionStatement') {
            parsedFunction = parseResult.expression
          }
        } catch (err) {
          // silet fail.
        }

        acc.values[key] = parsedFunction
        acc.count++
        return acc
      }

      if (type === 'element') {
        acc.values[key] = new ParsedASTNode(types.identifier('undefined'))
        acc.count++
        return acc
      }

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
