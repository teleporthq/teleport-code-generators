import * as types from '@babel/types'
import {
  convertValueToLiteral,
  getTSAnnotationForType,
} from '@teleporthq/teleport-shared/dist/cjs/utils/ast-js-utils'
import { UIDLPropDefinition, UIDLStateDefinition } from '@teleporthq/teleport-types'

export const generateComponentDecorator = (fileName: string, t = types) => {
  const decoratorArgs = [
    t.objectExpression([
      t.objectProperty(t.identifier('selector'), t.stringLiteral('app-root')),
      t.objectProperty(t.identifier('templateUrl'), t.stringLiteral(`./${fileName}.html`)),
      t.objectProperty(t.identifier('styleUrls'), t.stringLiteral(`./${fileName}.css`)),
    ]),
  ]

  return t.decorator(t.callExpression(t.identifier('Component'), decoratorArgs))
}

export const generateExportAST = (
  componentName: string,
  propDefinitions: Record<string, UIDLPropDefinition>,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  t = types
) => {
  const propDeclaration = Object.keys(propDefinitions).map((propKey) =>
    t.classProperty(
      t.identifier(propKey),
      convertValueToLiteral(propDefinitions[propKey].defaultValue),
      types.tsTypeAnnotation(getTSAnnotationForType(propDefinitions[propKey].type)),
      [t.decorator(t.callExpression(t.identifier('Input'), []))]
    )
  )

  const propertydeclerations = Object.keys(stateDefinitions).map((stateKey) =>
    t.classProperty(
      t.identifier(stateKey),
      convertValueToLiteral(stateDefinitions[stateKey].defaultValue),
      types.tsTypeAnnotation(getTSAnnotationForType(stateDefinitions[stateKey].type))
    )
  )

  const classBodyAST = () => {
    return t.classBody([...propDeclaration, ...propertydeclerations, constructorAST()])
  }

  return t.exportNamedDeclaration(
    t.classDeclaration(t.identifier(componentName), null, classBodyAST()),
    [],
    null
  )
}

const constructorAST = (t = types) => {
  return t.classMethod('constructor', t.identifier('constructor'), [], t.blockStatement([]))
}
