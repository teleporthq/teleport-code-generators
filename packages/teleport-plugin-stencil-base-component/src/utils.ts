import * as types from '@babel/types'

import {
  objectToObjectExpression,
  convertValueToLiteral,
  getTSAnnotationForType,
} from '@teleporthq/teleport-shared/dist/cjs/utils/ast-js-utils'
import { camelCaseToDashCase } from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'
import { UIDLStateDefinition, UIDLPropDefinition } from '@teleporthq/teleport-types'

export const createClassDeclaration = (
  name: string,
  propDefinitions: Record<string, UIDLPropDefinition>,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  jsxTagTree: types.JSXElement,
  t = types
) => {
  const propDeclaration = Object.keys(propDefinitions).map((propKey) =>
    t.classProperty(
      t.identifier(propKey),
      convertValueToLiteral(propDefinitions[propKey].defaultValue),
      types.tsTypeAnnotation(getTSAnnotationForType(propDefinitions[propKey].type)),
      [t.decorator(t.callExpression(t.identifier('Prop'), []))]
    )
  )

  const stateDeclaration = Object.keys(stateDefinitions).map((stateKey) =>
    t.classProperty(
      t.identifier(stateKey),
      convertValueToLiteral(stateDefinitions[stateKey].defaultValue),
      t.tsTypeAnnotation(getTSAnnotationForType(stateDefinitions[stateKey].type)),
      [t.decorator(t.callExpression(t.identifier('State'), []))]
    )
  )

  const classBody = t.classBody([
    ...propDeclaration,
    ...stateDeclaration,
    types.classMethod(
      'method',
      t.identifier('render'),
      [],
      t.blockStatement([t.returnStatement(jsxTagTree)])
    ),
  ])

  const classDeclaration = t.classDeclaration(t.identifier(name), null, classBody, [])
  return t.exportNamedDeclaration(classDeclaration, [])
}

export const createComponentDecorator = (name: string, t = types) => {
  return t.decorator(
    t.callExpression(t.identifier('Component'), [
      objectToObjectExpression({
        tag: camelCaseToDashCase(name),
        shadow: true,
      }),
    ])
  )
}
