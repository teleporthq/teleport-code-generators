import toHTML from '@starptech/prettyhtml-hast-to-html'
import { CodeGeneratorFunction, HastNode } from '../typings/generators'

export const generator: CodeGeneratorFunction<HastNode> = (htmlObject) => {
  return toHTML(htmlObject)
}
