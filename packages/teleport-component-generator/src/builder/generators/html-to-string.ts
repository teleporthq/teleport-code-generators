// @ts-ignore
import toHTML from '@starptech/prettyhtml-hast-to-html'
import { CodeGeneratorFunction, HastNode } from '@teleporthq/teleport-types'

export const generator: CodeGeneratorFunction<HastNode> = (htmlObject) => {
  const normalizedHtml = normalizeHtmlObject(htmlObject)
  return toHTML(normalizedHtml)
}

// Normalizes HTML structure by flattening nested arrays in children
const normalizeHtmlObject = (node: HastNode): HastNode => {
  if (!node) {
    return node
  }

  if (node.children) {
    // Flatten any nested arrays in children
    node.children = node.children.flat()

    // Recursively normalize all children
    node.children = node.children.map((child: HastNode) => normalizeHtmlObject(child))
  }

  return node
}
