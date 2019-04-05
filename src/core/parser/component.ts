import {
  transformStylesAssignmentsToJson,
  transformAttributesAssignmentsToJson,
  transformStringAssignmentToJson,
} from '../../shared/utils/uidl-utils'

import { ComponentUIDL, UIDLNode } from '../../typings/uidl-definitions'

export const parseComponentJSON = (input: Record<string, unknown>): ComponentUIDL => {
  const node = input.node as Record<string, unknown>
  const result: ComponentUIDL = {
    ...(input as ComponentUIDL),
  }

  switch (node.type) {
    case 'element':
      const elementContent = node.content as Record<string, unknown>

      if (elementContent.style) {
        elementContent.style = transformStylesAssignmentsToJson(elementContent.style as Record<
          string,
          unknown
        >)
      }

      if (elementContent.attrs) {
        elementContent.attrs = transformAttributesAssignmentsToJson(elementContent.attrs as Record<
          string,
          unknown
        >)
      }

      if (Array.isArray(elementContent.children)) {
        elementContent.children = elementContent.children.reduce(
          (newChildren: UIDLNode[], child) => {
            if (typeof child === 'string') {
              newChildren.push(transformStringAssignmentToJson(child))
            } else {
              newChildren.push(parseComponentJSON({ node: child }).node)
            }
            return newChildren
          },
          []
        )
      }
      break
  }

  return result
}
