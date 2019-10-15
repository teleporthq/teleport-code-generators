import * as types from '@babel/types'
import { ASTUtils, ASTBuilders } from '@teleporthq/teleport-plugin-common'

export const generateStyledJSXTag = (content: string): types.JSXElement => {
  const templateLiteral = ASTUtils.stringAsTemplateLiteral(content)
  const styleContent = ASTBuilders.createJSXExpresionContainer(templateLiteral)
  const styleTag = ASTBuilders.createJSXTag('style', [styleContent])
  ASTUtils.addChildJSXText(styleTag, '\n') // for better formatting
  ASTUtils.addAttributeToJSXTag(styleTag, 'jsx')
  return styleTag
}
