import {
  transformStylesAssignmentsToJson,
  transformAttributesAssignmentsToJson,
  transformStringAssignmentToJson,
  cloneObject,
} from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'

import {
  UIDLDynamicReference,
  ComponentUIDL,
  ProjectUIDL,
  UIDLNode,
  UIDLConditionalNode,
  UIDLRepeatNode,
  UIDLSlotNode,
  UIDLElementNode,
  UIDLStaticValue,
} from '@teleporthq/teleport-types'

interface ParseComponentJSONParams {
  noClone?: boolean
}

export const parseComponentJSON = (
  input: Record<string, unknown>,
  params: ParseComponentJSONParams = {}
): ComponentUIDL => {
  const safeInput = params.noClone ? input : cloneObject(input)

  const node = safeInput.node as Record<string, unknown>
  const result: ComponentUIDL = {
    ...((safeInput as unknown) as ComponentUIDL),
  }

  // other parsers for other sections of the component here
  result.node = parseComponentNode(node) as UIDLElementNode

  return result
}

interface ParseProjectJSONParams {
  noClone?: boolean
}

export const parseProjectJSON = (
  input: Record<string, unknown>,
  params: ParseProjectJSONParams = {}
): ProjectUIDL => {
  const safeInput = params.noClone ? input : cloneObject(input)
  const root = safeInput.root as Record<string, unknown>

  const result = {
    ...((safeInput as unknown) as ProjectUIDL),
  }

  result.root = parseComponentJSON(root, { noClone: true })
  if (result.components) {
    result.components = Object.keys(result.components).reduce((parsedComponnets, key) => {
      parsedComponnets[key] = parseComponentJSON((result.components[key] as unknown) as Record<
        string,
        unknown
      >)
      return parsedComponnets
    }, {})
  }

  return result
}

const parseComponentNode = (node: Record<string, unknown>): UIDLNode => {
  switch (((node as unknown) as UIDLNode).type) {
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
        elementContent.children = elementContent.children.map((child) => {
          if (typeof child === 'string') {
            return transformStringAssignmentToJson(child)
          } else {
            return parseComponentNode(child)
          }
        }, [])
      }

      return (node as unknown) as UIDLNode

    case 'conditional':
      const conditionalNode = (node as unknown) as UIDLConditionalNode
      const { reference } = conditionalNode.content

      conditionalNode.content.node = parseComponentNode((conditionalNode.content
        .node as unknown) as Record<string, unknown>)

      if (typeof reference === 'string') {
        conditionalNode.content.reference = transformStringAssignmentToJson(
          reference
        ) as UIDLDynamicReference
      }

      return conditionalNode

    case 'repeat':
      const repeatNode = (node as unknown) as UIDLRepeatNode
      const { dataSource } = repeatNode.content

      repeatNode.content.node = parseComponentNode((repeatNode.content.node as unknown) as Record<
        string,
        unknown
      >) as UIDLElementNode

      if (typeof dataSource === 'string') {
        repeatNode.content.dataSource = transformStringAssignmentToJson(dataSource)
      }

      return repeatNode

    case 'slot':
      const slotNode = (node as unknown) as UIDLSlotNode

      if (slotNode.content.fallback) {
        slotNode.content.fallback = parseComponentNode((slotNode.content
          .fallback as unknown) as Record<string, unknown>) as
          | UIDLElementNode
          | UIDLStaticValue
          | UIDLDynamicReference
      }

      return slotNode

    case 'dynamic':
    case 'static':
      return (node as unknown) as UIDLNode

    default:
      throw new Error(`parseComponentNode attempted to parsed invalid node type ${node.type}`)
  }
}
