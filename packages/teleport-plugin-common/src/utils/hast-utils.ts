import { HastNode } from '@teleporthq/teleport-types'
import { createTextNode } from '../builders/hast-builders'

export const addBooleanAttributeToNode = (node: HastNode, key: string, value: boolean = true) => {
  node.properties[key] = value === true ? '' : false
  /* adding empty string as @starptech/prettyhtml-hast-to-html which we are currently
  using for generating HTML supports boolean way of adding attributes only for HTML
  attributes but not for Vue*/
}

export const addAttributeToNode = (node: HastNode, key: string, value: string) => {
  node.properties[key] = value
}

export const addClassToNode = (node: HastNode, className: string) => {
  node.properties.class = className
}

export const addChildNode = (node: HastNode, child: HastNode) => {
  node.children.push(child)
}

export const addTextNode = (node: HastNode, text: string) => {
  node.children.push(createTextNode(text))
}
