import {
  transformStylesAssignmentsToJson,
  transformAttributesAssignmentsToJson,
} from '../../shared/utils/uidl-utils'

export const parseComponentJSON = (input: Record<string, unknown>): ComponentUIDL => {
  const node = input.node as UIDLNode
  const result: ComponentUIDL = {
    ...(input as ComponentUIDL),
  }

  switch (node.type) {
    case 'element':
      const elementContent = node.content

      if (elementContent.style) {
        elementContent.style = transformStylesAssignmentsToJson(elementContent.style)
      }

      if (elementContent.attrs) {
        elementContent.attrs = transformAttributesAssignmentsToJson(elementContent.attrs)
      }

      if (node.content.children) {
        node.content.children.forEach((child) => {
          parseComponentJSON({ node: child })
        })
      }
      break
  }

  return result
}
