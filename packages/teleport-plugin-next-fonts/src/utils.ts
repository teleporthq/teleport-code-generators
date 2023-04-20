import { StringUtils } from '@teleporthq/teleport-shared'
import { ChunkDefinition, ChunkType, UIDLDependency, FileType } from '@teleporthq/teleport-types'
import { GOOGLE_FONTS } from './fonts'
import * as types from '@babel/types'

export const NEXT_FONT_DEPENDENCY: UIDLDependency = {
  type: 'library',
  path: 'next/font/google',
  version: '13.3.0',
}

export const getFontAndVariable = (content: string): [string, string, string] => {
  const font = (content as string).replace(/\s+/g, '_')
  const fontDecleration = StringUtils.camelCaseToDashCase(StringUtils.removeIllegalCharacters(font))
  const variable = `--${fontDecleration}-font`

  return [font, fontDecleration, variable]
}

export const generateFontDeclerationChunk = (
  font: string,
  fontVariable: string,
  variable: string,
  weight?: string
): ChunkDefinition => {
  const objectExpressions: types.ObjectProperty[] = [
    types.objectProperty(types.identifier('preload'), types.identifier('false')),
    types.objectProperty(types.identifier('variable'), types.stringLiteral(variable)),
  ]

  if (weight) {
    objectExpressions.push(
      types.objectProperty(types.identifier('weight'), types.stringLiteral(String(weight)))
    )
  }

  return {
    type: ChunkType.AST,
    name: 'font-decleration-chunk',
    fileType: FileType.JS,
    content: types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier(fontVariable),
        types.callExpression(types.identifier(font), [types.objectExpression(objectExpressions)])
      ),
    ]),
    linkAfter: ['google-font-import-chunk'],
  }
}

export const isGoogleFont = (font: string) => GOOGLE_FONTS.indexOf(font) !== -1
