import * as types from '@babel/types'
import { PropDefinition } from '../../../../uidl-definitions/types'
import { objectToObjectExpression, ParsedASTNode } from '../../../utils/js-ast'

export const buildDefaultPropsAst = (
  componentName: string,
  propDefinitions: Record<string, PropDefinition>,
  t = types
) => {
  if (!propDefinitions) {
    return null
  }

  const defaultValuesSearch = Object.keys(propDefinitions).reduce(
    (acc: any, key) => {
      const { defaultValue } = propDefinitions[key]
      if (defaultValue) {
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

  const memberExpressionValue = objectToObjectExpression(defaultValuesSearch.values)

  const assignmentExpression = t.assignmentExpression('=', memberExpression, memberExpressionValue)

  return t.expressionStatement(assignmentExpression)
}

export const buildTypesOfPropsAst = (
  componentName: string,
  propTypesNames: string,
  propDefinitions: Record<string, PropDefinition>,
  t = types
) => {
  if (!propDefinitions) {
    return null
  }

  const defaultValuesSearch = Object.keys(propDefinitions).reduce(
    (acc: any, key) => {
      const { defaultValue, type } = propDefinitions[key]
      if (defaultValue) {
        const astValue = t.memberExpression(t.identifier(propTypesNames), t.identifier(type))
        acc.values[key] = new ParsedASTNode(astValue)
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
    t.identifier('propTypes')
  )

  const memberExpressionValue = objectToObjectExpression(defaultValuesSearch.values)

  const assignmentExpression = t.assignmentExpression('=', memberExpression, memberExpressionValue)

  return t.expressionStatement(assignmentExpression)
}

export const buildReactSFCTypescriptAnnotation = (annotationName: string, t = types) => {
  // makes the <MyComponent> part from React.SFC<MyComponent>
  const ComponentNameInBraketsPart = t.typeParameterInstantiation([
    t.genericTypeAnnotation(t.identifier(annotationName)),
  ])

  const annotation = t.genericTypeAnnotation(t.identifier('React.SFC'), ComponentNameInBraketsPart)

  return annotation
}
