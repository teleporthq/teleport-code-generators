import { HastNode, HastText } from '@teleporthq/teleport-types'

export const createHTMLNode = (
  tagName: string,
  children: Array<HastNode | HastText> = []
): HastNode => {
  if (tagName === undefined) {
    console.trace({ tagName, children })
  }

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

export const createComment = (content: string): HastText => {
  return {
    type: 'comment',
    value: content,
  }
}
