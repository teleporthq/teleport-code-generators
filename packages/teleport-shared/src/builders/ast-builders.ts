import * as types from '@babel/types'
import { convertValueToLiteral } from '../utils/ast-js-utils'
import { ImportIdentifier } from '@teleporthq/teleport-types'

export const createConstAssignment = (constName: string, asignment: any = null, t = types) => {
  const declarator = t.variableDeclarator(t.identifier(constName), asignment)
  const constAssignment = t.variableDeclaration('const', [declarator])
  return constAssignment
}

export const createDefaultExport = (exportReference: string, t = types) => {
  return t.exportDefaultDeclaration(t.identifier(exportReference))
}

export const createReactJSSDefaultExport = (
  componentName: string,
  stylesName: string,
  t = types
) => {
  return t.exportDefaultDeclaration(
    t.callExpression(t.callExpression(t.identifier('injectSheet'), [t.identifier(stylesName)]), [
      t.identifier(componentName),
    ])
  )
}

/**
 * You can pass the path of the package which is added at the top of the file and
 * an array of imports that we extract from that package.
 */
export const createGenericImportStatement = (
  path: string,
  imports: ImportIdentifier[],
  t = types
) => {
  // Only one of the imports can be the default one so this is a fail safe for invalid UIDL data
  const defaultImport = imports.find((imp) => !imp.namedImport) // only one import can be default
  const importJustPath = imports.some((imp) => imp.importJustPath)
  let importASTs: any[] = []
  if (importJustPath) {
    // Just the import path will be present, eg: import './styles.css'
    importASTs = []
  } else if (defaultImport) {
    const namedImports = imports.filter(
      (imp) => imp.identifierName !== defaultImport.identifierName
    )
    // Default import needs to be the first in the array
    importASTs = [
      t.importDefaultSpecifier(t.identifier(defaultImport.identifierName)),
      ...namedImports.map((imp) =>
        t.importSpecifier(
          t.identifier(imp.identifierName),
          t.identifier(imp.originalName || imp.identifierName)
        )
      ),
    ]
  } else {
    // No default import, so array order doesn't matter
    importASTs = imports.map((imp) =>
      t.importSpecifier(
        t.identifier(imp.identifierName),
        t.identifier(imp.originalName || imp.identifierName)
      )
    )
  }
  return t.importDeclaration(importASTs, t.stringLiteral(path))
}

type JSXChild =
  | types.JSXText
  | types.JSXExpressionContainer
  | types.JSXSpreadChild
  | types.JSXElement
  | types.JSXFragment

export const createJSXTag = (
  tagName: string,
  children: JSXChild[] = [],
  selfClosing = false,
  t = types
) => {
  const jsxIdentifier = t.jsxIdentifier(tagName)
  const openingTag = t.jsxOpeningElement(jsxIdentifier, [], selfClosing)
  const closingTag = t.jsxClosingElement(jsxIdentifier)

  const tag = t.jsxElement(openingTag, closingTag, children, selfClosing)

  return tag
}

export const createSelfClosingJSXTag = (tagName: string) => {
  return createJSXTag(tagName, [], true)
}

export const createJSXExpresionContainer = (expression: types.Expression, t = types) => {
  return t.jsxExpressionContainer(expression)
}

export const createFunctionCall = (functionName: string, args: any[] = [], t = types) => {
  const convertedArgs = args.map((value) => {
    // skip objects which are already in AST format
    if (objectIsASTType(value)) {
      return value
    }

    return convertValueToLiteral(value)
  })
  return t.callExpression(t.identifier(functionName), convertedArgs)
}

const objectIsASTType = (obj: any) => {
  if (typeof obj !== 'object') {
    return false
  }

  // TODO: extensive list
  return obj.type === 'JSXElement' || obj.type === 'CallExpression'
}

// equivalent to (props) => props.title
export const createArrowFunctionWithMemberExpression = (
  argument: string,
  returnIdentifier: string,
  t = types
) => {
  return t.arrowFunctionExpression(
    [t.identifier(argument)],
    t.memberExpression(t.identifier(argument), t.identifier(returnIdentifier))
  )
}

export const createFunctionalComponent = (
  componentName: string,
  jsxRoot: types.JSXElement,
  t = types
) => {
  const returnStatement = t.returnStatement(jsxRoot)
  const arrowFunction = t.arrowFunctionExpression([], t.blockStatement([returnStatement] || []))

  const declarator = t.variableDeclarator(t.identifier(componentName), arrowFunction)
  const component = t.variableDeclaration('const', [declarator])

  return component
}
