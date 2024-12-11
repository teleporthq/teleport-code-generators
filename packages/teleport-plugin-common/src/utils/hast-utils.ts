import { HastNode, HastText } from '@teleporthq/teleport-types'
import { createTextNode } from '../builders/hast-builders'
import type { JSXElement } from '@babel/types'
import { isJSXElement } from './ast-utils'

export const addBooleanAttributeToNode = (
  node: HastNode | HastNode[],
  key: string,
  value: boolean = true
) => {
  if (Array.isArray(node)) {
    node.forEach((subnode) => (subnode.properties[key] = value === true ? '' : false))
    return
  }
  node.properties[key] = value === true ? '' : false
  // Adding boolean attributes is currently onyl supported for template generators
}

export const addAttributeToNode = (node: HastNode | HastNode[], key: string, value: string) => {
  if (Array.isArray(node)) {
    node.forEach((subnode) => (subnode.properties[key] = value))
    return
  }
  node.properties[key] = value
}

export const addClassToNode = (node: HastNode | HastNode[], className: string) => {
  if (Array.isArray(node)) {
    node.forEach((subnode) => (subnode.properties.class = className))
    return
  }
  node.properties.class = className
}

export const addChildNode = (node: HastNode | HastNode[], child: HastNode | HastText) => {
  if (Array.isArray(node)) {
    node.forEach((subnode) => subnode.children.push(child))
    return
  }
  node.children.push(child)
}

export const addTextNode = (node: HastNode | HastNode[], text: string) => {
  if (Array.isArray(node)) {
    node.forEach((subnode) => subnode.children.push(createTextNode(text)))
    return
  }
  node.children.push(createTextNode(text))
}

export const isHastElement = (value: JSXElement | HastNode): value is HastNode =>
  isJSXElement(value) === false &&
  ('properties' in value || 'children' in value || 'tagName' in value)
