import * as ts from 'typescript'

export const createConstructorAST = (statements: ts.Statement[]) => {
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
