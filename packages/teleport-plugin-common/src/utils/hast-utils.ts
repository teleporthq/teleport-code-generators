import { HastNode, HastText } from '@teleporthq/teleport-types'
import { createTextNode } from '../builders/hast-builders'
import type { JSXElement } from '@babel/types'
import { isJSXElement } from './ast-utils'

export const addBooleanAttributeToNode = (node: HastNode, key: string, value: boolean = true) => {
  node.properties[key] = value === true ? '' : false
  // Adding boolean attributes is currently onyl supported for template generators
}

export const addAttributeToNode = (node: HastNode, key: string, value: string) => {
  node.properties[key] = value
}

export const addClassToNode = (node: HastNode, className: string) => {
  node.properties.class = className
}

export const addChildNode = (node: HastNode, child: HastNode | HastText) => {
  node.children.push(child)
}

export const addTextNode = (node: HastNode, text: string) => {
  node.children.push(createTextNode(text))
}

export const isHastElement = (value: JSXElement | HastNode): value is HastNode =>
  isJSXElement(value) === false &&
  ('properties' in value || 'children' in value || 'tagName' in value)
