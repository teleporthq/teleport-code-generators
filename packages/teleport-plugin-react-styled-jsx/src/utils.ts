import * as types from '@babel/types'
import { ASTUtils, ASTBuilders } from '@teleporthq/teleport-plugin-common'

export const generateStyledJSXTag = async (content: string): Promise<types.JSXElement> => {
  const styleContent = await ASTBuilders.createDynamicStyleStringsToTemplates(content)
  const styleTag = ASTBuilders.createJSXTag('style', [styleContent])
  ASTUtils.addChildJSXText(styleTag, '\n') // for better formatting
  ASTUtils.addAttributeToJSXTag(styleTag, 'jsx')
  return styleTag
}
