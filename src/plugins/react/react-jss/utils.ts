import types from '@babel/types'

export const makeJSSDefaultExport = (componentName: string, stylesName: string, t = types) => {
  return t.exportDefaultDeclaration(
    t.callExpression(t.callExpression(t.identifier('injectSheet'), [t.identifier(stylesName)]), [
      t.identifier(componentName),
    ])
  )
}
