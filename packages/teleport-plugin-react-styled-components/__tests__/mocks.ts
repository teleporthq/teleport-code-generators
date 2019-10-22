import { staticNode, elementNode } from '@teleporthq/teleport-uidl-builders'

export const createElementWithStyle = () => {
  const style = {
    height: staticNode('100px'),
  }
  const element = elementNode('container', {}, [], null, style)
  const elementWithKey = {
    ...element,
    content: {
      ...element.content,
      key: 'container',
    },
  }

  return elementWithKey
}
