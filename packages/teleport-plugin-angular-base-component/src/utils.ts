import * as types from '@babel/types'
import {
  convertValueToLiteral,
  getTSAnnotationForType,
} from '@teleporthq/teleport-shared/dist/cjs/utils/ast-js-utils'
import { getComponentFileName } from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import { UIDLPropDefinition, UIDLStateDefinition, ComponentUIDL } from '@teleporthq/teleport-types'
import { FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

export const generateComponentDecorator = (uidl: ComponentUIDL, t = types) => {
  const decoratorArgs = [
    t.objectExpression([
      t.objectProperty(t.identifier('selector'), t.stringLiteral('app-root')),
      t.objectProperty(
        t.identifier('templateUrl'),
        t.stringLiteral(`${getComponentFileName(uidl)}.${FILE_TYPE.HTML}`)
      ),
    ]),
  ]

  return t.decorator(t.callExpression(t.identifier('Component'), decoratorArgs))
}

export const generateExportAST = (
  componentName: string,
  propDefinitions: Record<string, UIDLPropDefinition>,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  dataObject: Record<string, any>,
  t = types
) => {
  const propDeclaration = Object.keys(propDefinitions).map((propKey) =>
    t.classProperty(
      t.identifier(propKey),
      convertValueToLiteral(propDefinitions[propKey].defaultValue),
      t.tsTypeAnnotation(getTSAnnotationForType(propDefinitions[propKey].type)),
      [t.decorator(t.callExpression(t.identifier('Input'), []))]
    )
  )

  const propertyDecleration = Object.keys(stateDefinitions).map((stateKey) =>
    t.classProperty(
      t.identifier(stateKey),
      convertValueToLiteral(stateDefinitions[stateKey].defaultValue),
      t.tsTypeAnnotation(getTSAnnotationForType(stateDefinitions[stateKey].type))
    )
  )

  const dataDecleration = Object.keys(dataObject).map((dataKey) => {
    return t.classProperty(
      t.identifier(dataKey),
      convertValueToLiteral(dataObject[dataKey]),
      t.tsTypeAnnotation(getTSAnnotationForType(typeof dataObject[dataKey]))
    )
  })

  const classBodyAST = () => {
    return t.classBody([
      ...propDeclaration,
      ...propertyDecleration,
      ...dataDecleration,
      constructorAST(),
    ])
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
