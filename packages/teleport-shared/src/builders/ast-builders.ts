import * as types from '@babel/types'

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
