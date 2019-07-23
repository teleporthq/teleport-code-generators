import {
  stringAsTemplateLiteral,
  addAttributeToJSXTag,
  addChildJSXText,
} from '@teleporthq/teleport-shared/dist/cjs/utils/ast-jsx-utils'

import {
  createJSXTag,
  createJSXExpresionContainer,
} from '@teleporthq/teleport-shared/dist/cjs/builders/ast-builders'

export const generateStyledJSXTag = (content: string) => {
  const templateLiteral = stringAsTemplateLiteral(content)
  const styleContent = createJSXExpresionContainer(templateLiteral)
  const styleTag = createJSXTag('style', [styleContent])
  addChildJSXText(styleTag, '\n') // for better formatting
  addAttributeToJSXTag(styleTag, 'jsx')
  return styleTag
}
