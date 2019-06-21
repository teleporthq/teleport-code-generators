import * as types from '@babel/types'
import { stringAsTemplateLiteral, addAttributeToJSXTag } from '../utils/ast-jsx-utils'

export const createConstAssignment = (constName: string, asignment: any = null, t = types) => {
  const declarator = t.variableDeclarator(t.identifier(constName), asignment)
  const constAssignment = t.variableDeclaration('const', [declarator])
  return constAssignment
}

export const createDefaultExport = (name: string, t = types) => {
  return t.exportDefaultDeclaration(t.identifier(name))
}

/**
 * You can pass the path of the package which is added at the top of the file and
 * an array of imports that we extract from that package.
 */
export const createGenericImportStatement = (path: string, imports: any[], t = types) => {
  // Only one of the imports can be the default one so this is a fail safe for invalid UIDL data
  const defaultImport = imports.find((imp) => !imp.namedImport) // only one import can be default
  let importASTs: any[] = []
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

// TODO: Use generateASTDefinitionForJSXTag instead?
export const generateStyledJSXTag = (
  templateLiteral: string | types.TemplateLiteral,
  t = types
) => {
  if (typeof templateLiteral === 'string') {
    templateLiteral = stringAsTemplateLiteral(templateLiteral, t)
  }

  const jsxTagChild = t.jsxExpressionContainer(templateLiteral)
  const jsxTag = generateBasicJSXTag('style', [jsxTagChild, t.jsxText('\n')], t)
  addAttributeToJSXTag(jsxTag, { name: 'jsx' }, t)
  return jsxTag
}

const generateBasicJSXTag = (tagName: string, children: any[] = [], t = types) => {
  const jsxIdentifier = t.jsxIdentifier(tagName)
  const openingDiv = t.jsxOpeningElement(jsxIdentifier, [], false)
  const closingDiv = t.jsxClosingElement(jsxIdentifier)

  const tag = t.jsxElement(openingDiv, closingDiv, children, false)

  return tag
}

/**
 * Generates the AST definiton (without start/end position) for a JSX tag
 * with an opening and closing tag.
 *
 * t is the babel-types api which generates the JSON structure representing the AST.
 * This is set as a parameter to allow us to remove babel-types at some point if we
 * decide to, and to allow easier unit testing of the utils.
 *
 * Requires the tagName, which is a string that will be used to generate the
 * tag.
 *
 * Example:
 * generateASTDefinitionForJSXTag("div") will generate the AST
 * equivalent of <div></div>
 */
export const generateASTDefinitionForJSXTag = (tagName: string, t = types) => {
  const jsxIdentifier = t.jsxIdentifier(tagName)
  const openingDiv = t.jsxOpeningElement(jsxIdentifier, [], false)
  const closingDiv = t.jsxClosingElement(jsxIdentifier)

  const tag = t.jsxElement(openingDiv, closingDiv, [], false)

  return tag
}

export const createJSXSpreadAttribute = (name: string, t = types) => {
  return t.jsxSpreadAttribute(t.identifier(name))
}
