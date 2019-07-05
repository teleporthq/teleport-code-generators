import * as ts from 'typescript'

export const createProperyDeclerationAST = (key: string, value: any, type: string) => {
  return ts.createProperty(
    undefined,
    undefined,
    ts.createIdentifier(key),
    undefined,
    undefined,
    createPropertyInitializerAST(value, type) as ts.Expression
  )
}

export const createPropertyInitializerAST = (value: any, type: string) => {
  switch (type) {
    case 'string':
      return ts.createStringLiteral(value)

    case 'number':
      return ts.createNumericLiteral(String(value))

    case 'boolean':
      return value
        ? ts.createToken(ts.SyntaxKind.TrueKeyword)
        : ts.createToken(ts.SyntaxKind.FalseKeyword)

    case 'object': {
      const properties = []
      Object.keys(value).forEach((key: any) => {
        const property = ts.createPropertyAssignment(key, createPropertyInitializerAST(
          value[key],
          typeof value[key]
        ) as ts.Expression)
        properties.push(property)
      })

      return ts.createObjectLiteral(properties)
    }

    case 'array': {
      const literals = []
      value.forEach((literal: any) =>
        literals.push(createPropertyInitializerAST(literal, typeof literal))
      )
      return ts.createArrayLiteral(literals)
    }

    default:
      throw new Error(`
        Initializer type is not identified for the value ${value}
      `)
  }
}

export const createConstructorAST = (statements: any) => {
  return ts.createConstructor(undefined, undefined, undefined, ts.createBlock(statements))
}

export const createDefaultClassComponent = (members: any) => {
  const classComponent = ts.createClassDeclaration(
    undefined,
    [ts.createToken(ts.SyntaxKind.ExportKeyword)],
    ts.createIdentifier('AppComponent'),
    undefined,
    undefined,
    members
  )
  return classComponent
}

export const createDecoratorAST = () => {
  const selector: ts.PropertyAssignment = ts.createPropertyAssignment(
    ts.createIdentifier('selector'),
    ts.createStringLiteral('app-root')
  )

  const templateUrl: ts.PropertyAssignment = ts.createPropertyAssignment(
    ts.createIdentifier('templateUrl'),
    ts.createStringLiteral('./app.component.html')
  )

  const stylesUrl: ts.PropertyAssignment = ts.createPropertyAssignment(
    ts.createIdentifier('styleUrls'),
    ts.createArrayLiteral([ts.createStringLiteral('./app.component.css')])
  )

  const object: ts.ObjectLiteralExpression = ts.createObjectLiteral([
    selector,
    templateUrl,
    stylesUrl,
  ])

  const expression: ts.CallExpression = ts.createCall(
    ts.createIdentifier('Component'),
    [],
    [object]
  )

  const decorator: ts.Decorator = ts.createDecorator(expression)

  return decorator
}
