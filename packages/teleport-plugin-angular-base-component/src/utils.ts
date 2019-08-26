import * as types from '@babel/types'
import {
  convertValueToLiteral,
  getTSAnnotationForType,
  createMethodsObject,
} from '@teleporthq/teleport-shared/dist/cjs/utils/ast-js-utils'
import {
  UIDLPropDefinition,
  UIDLStateDefinition,
  UIDLEventHandlerStatement,
} from '@teleporthq/teleport-types'

export const generateExportAST = (
  componentName: string,
  propDefinitions: Record<string, UIDLPropDefinition>,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  dataObject: Record<string, any>,
  methodsObject: Record<string, UIDLEventHandlerStatement[]>,
  t = types
) => {
  let angularMethodsAST = []
  if (Object.keys(methodsObject).length > 0) {
    angularMethodsAST = createMethodsObject(
      methodsObject,
      propDefinitions,
      'angular'
    ) as types.ClassMethod[]
  }

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

  const dataDeclaration = Object.keys(dataObject).map((dataKey) => {
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
      ...dataDeclaration,
      constructorAST(),
      ...angularMethodsAST,
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
