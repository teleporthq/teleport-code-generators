import * as ts from 'typescript'

export const createGenericImportStatement = (path: string, imports: any[]) => {
  const defaultImport = imports.find((imp) => !imp.namedImport)
  let importClause: ts.ImportClause
  if (defaultImport) {
    importClause = ts.createImportClause(ts.createIdentifier(defaultImport.identifier), undefined)
  } else {
    const elements: ts.ImportSpecifier[] = imports.map((item) => {
      return ts.createImportSpecifier(undefined, ts.createIdentifier(item.identifier))
    })
    const namedBindings: ts.NamedImports = ts.createNamedImports(elements)
    importClause = ts.createImportClause(undefined, namedBindings)
  }
  return ts.createImportDeclaration(
    undefined,
    undefined,
    importClause,
    ts.createStringLiteral(path)
  )
}

export const createInputDecoratorAST = (name: string, value: any, type: string) => {
  const decorator: ts.Decorator[] = [
    ts.createDecorator(ts.createCall(ts.createIdentifier('Input'), undefined, undefined)),
  ]
  return ts.createProperty(
    decorator,
    undefined,
    ts.createIdentifier(name),
    undefined,
    undefined,
    createPropertyInitializerAST(value, type) as ts.Expression
  )
}

export const createProperyDeclerationAST = (name: string, value: any, type: string) => {
  return ts.createProperty(
    undefined,
    undefined,
    ts.createIdentifier(name),
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

export const createComponentDecoratorAST = (
  selectorName: string,
  templateUrlName: string,
  stylesUrlName: string
) => {
  const selector: ts.PropertyAssignment = ts.createPropertyAssignment(
    ts.createIdentifier('selector'),
    ts.createStringLiteral(selectorName)
  )

  const templateUrl: ts.PropertyAssignment = ts.createPropertyAssignment(
    ts.createIdentifier('templateUrl'),
    ts.createStringLiteral(templateUrlName)
  )

  const stylesUrl: ts.PropertyAssignment = ts.createPropertyAssignment(
    ts.createIdentifier('styleUrls'),
    ts.createArrayLiteral([ts.createStringLiteral(stylesUrlName)])
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
