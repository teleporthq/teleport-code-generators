import { HastNode, HastText } from '@teleporthq/teleport-types'

export const createHTMLNode = (tagName: string, children = []): HastNode => {
  return {
    type: 'element',
    tagName,
    properties: {},
    children,
  }
}

export const createTextNode = (content: string): HastText => {
  return {
    type: 'text',
    value: content,
  }
}
