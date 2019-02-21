import * as types from '@babel/types'
/**
 * A tricky way to pass down custom configuration into
 * the objectToObjectExpression values, to allow for member expressions like
 * Proptypes.String.isRequired to be handled by the function.
 */
export class ParsedASTNode {
  public ast: any

  constructor(ast: any) {
    this.ast = ast
  }
}

export const objectToObjectExpression = (objectMap: { [key: string]: any }, t = types) => {
  const props = Object.keys(objectMap).reduce((acc: any[], key) => {
    const keyIdentifier = t.stringLiteral(key)
    const value = objectMap[key]
    let computedLiteralValue: any = null

    if (value instanceof ParsedASTNode) {
      computedLiteralValue = value.ast
    } else if (Array.isArray(value)) {
      computedLiteralValue = t.arrayExpression(value)
    } else if (typeof value === 'string') {
      computedLiteralValue = t.stringLiteral(value)
    } else if (typeof value === 'number') {
      computedLiteralValue = t.numericLiteral(value)
    } else if (typeof value === 'object') {
      computedLiteralValue = objectToObjectExpression(value, t)
    } else if (value === String) {
      computedLiteralValue = t.identifier('String')
    } else if (value === Number) {
      computedLiteralValue = t.identifier('Number')
    }

    if (computedLiteralValue) {
      acc.push(t.objectProperty(keyIdentifier, computedLiteralValue))
    }
    return acc
  }, [])

  const objectExpression = t.objectExpression(props)
  return objectExpression
}

type ExpressionLiteral =
  | types.StringLiteral
  | types.BooleanLiteral
  | types.NumberLiteral
  | types.Identifier
  | types.ArrayExpression
export const convertValueToLiteral = (
  value: any,
  explicitType: string = '',
  t = types
): ExpressionLiteral => {
  if (Array.isArray(value)) {
    return t.arrayExpression(value.map((val) => convertValueToLiteral(val)))
  }

  const typeToCompare = explicitType ? explicitType : typeof value
  switch (typeToCompare) {
    case 'string':
      return t.stringLiteral(value)
    case 'boolean':
      return t.booleanLiteral(value)
    case 'number':
      return t.numericLiteral(value)
    default:
      return t.identifier(value.toString())
  }
}

export const makeConstAssign = (constName: string, asignment: any = null, t = types) => {
  const declarator = t.variableDeclarator(t.identifier(constName), asignment)
  const constAsignment = t.variableDeclaration('const', [declarator])
  return constAsignment
}

export const makeDefaultExport = (name: string, t = types) => {
  return t.exportDefaultDeclaration(t.identifier(name))
}

export const makeJSSDefaultExport = (componentName: string, stylesName: string, t = types) => {
  return t.exportDefaultDeclaration(
    t.callExpression(t.callExpression(t.identifier('injectSheet'), [t.identifier(stylesName)]), [
      t.identifier(componentName),
    ])
  )
}

export const makeProgramBody = (statements: any[] = [], t = types) => t.program(statements)

/**
 * You can pass the path of the package which is added at the top of the file and
 * an array of imports that we extract from that package.
 */
export const makeGenericImportStatement = (path: string, imports: any[], t = types) => {
  // Only one of the imports can be the default one so this is a fail safe for invalid UIDL data
  const defaultImport = imports.find((imp) => !imp.namedImport) // only one import can be default
  let importASTs: any = []
  if (defaultImport) {
    const namedImports = imports.filter((imp) => imp.identifier !== defaultImport.identifier)
    // Default import needs to be the first in the array
    importASTs = [
      t.importDefaultSpecifier(t.identifier(defaultImport.identifier)),
      ...namedImports.map((imp) =>
        t.importSpecifier(t.identifier(imp.identifier), t.identifier(imp.originalName))
      ),
    ]
  } else {
    // No default import, so array order doesn't matter
    importASTs = imports.map((imp) =>
      t.importSpecifier(t.identifier(imp.identifier), t.identifier(imp.originalName))
    )
  }
  return t.importDeclaration(importASTs, t.stringLiteral(path))
}
