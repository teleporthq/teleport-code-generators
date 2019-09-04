import * as types from '@babel/types'
import {
  convertValueToLiteral,
  getTSAnnotationForType,
  createStateChangeStatement,
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
    angularMethodsAST = createMethodsObject(methodsObject, propDefinitions)
  }

  const propDeclaration = Object.keys(propDefinitions).map((propKey) => {
    const definition = propDefinitions[propKey]
    // By default any prop with type function is used to emitting events to the callee
    if (definition.type === 'func') {
      return t.classProperty(
        t.identifier(propKey),
        t.newExpression(t.identifier('EventEmitter'), []),
        t.typeAnnotation(
          t.genericTypeAnnotation(
            t.identifier('EventEmitter'),
            t.typeParameterInstantiation([t.anyTypeAnnotation()])
          )
        ),
        [t.decorator(t.callExpression(t.identifier('Output'), []))]
      )
    }
    return t.classProperty(
      t.identifier(propKey),
      convertValueToLiteral(propDefinitions[propKey].defaultValue),
      t.tsTypeAnnotation(getTSAnnotationForType(propDefinitions[propKey].type)),
      [t.decorator(t.callExpression(t.identifier('Input'), []))]
    )
  })

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
    t.classDeclaration(t.identifier(`${componentName}Component`), null, classBodyAST()),
    [],
    null
  )
}

const constructorAST = (t = types) => {
  return t.classMethod('constructor', t.identifier('constructor'), [], t.blockStatement([]))
}

const createMethodsObject = (
  methods: Record<string, UIDLEventHandlerStatement[]>,
  propDefinitions: Record<string, UIDLPropDefinition>,
  t = types
) => {
  return Object.keys(methods).map((eventKey) => {
    const astStatements = []
    methods[eventKey].map((statement) => {
      const astStatement =
        statement.type === 'propCall'
          ? createPropCallStatement(statement, propDefinitions)
          : createStateChangeStatement(statement)

      if (astStatement) {
        astStatements.push(astStatement)
      }
    })
    return t.classMethod('method', t.identifier(eventKey), [], t.blockStatement(astStatements))
  })
}

export const createPropCallStatement = (
  eventHandlerStatement: UIDLEventHandlerStatement,
  propDefinitions: Record<string, UIDLPropDefinition>,
  t = types
) => {
  const { calls: propFunctionKey } = eventHandlerStatement

  if (!propFunctionKey) {
    console.warn(`No prop definition referenced under the "calls" field`)
    return null
  }

  const propDefinition = propDefinitions[propFunctionKey]

  if (!propDefinition) {
    console.warn(`No prop definition was found for function "${propFunctionKey}"`)
    return null
  }

  return t.expressionStatement(
    t.callExpression(
      t.memberExpression(
        t.memberExpression(t.thisExpression(), t.identifier(propFunctionKey)),
        t.identifier('emit')
      ),
      []
    )
  )
}
