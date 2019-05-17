import toHTML from '@starptech/prettyhtml-hast-to-html'
import {
  CodeGeneratorFunction,
  HastNode,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'

export const generator: CodeGeneratorFunction<HastNode> = (htmlObject) => {
  return toHTML(htmlObject)
}
