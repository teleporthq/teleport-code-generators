import { UIDLUtils } from '@teleporthq/teleport-shared'

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
  UIDLStyleSetConditions,
} from '@teleporthq/teleport-types'

interface ParseComponentJSONParams {
  noClone?: boolean
}

export const parseComponentJSON = (
  input: Record<string, unknown>,
  params: ParseComponentJSONParams = {}
): ComponentUIDL => {
  const safeInput = params.noClone ? input : UIDLUtils.cloneObject(input)

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
  const safeInput = params.noClone ? input : UIDLUtils.cloneObject(input)
  const root = safeInput.root as Record<string, unknown>

  const result = {
    ...((safeInput as unknown) as ProjectUIDL),
  }

  result.root = parseComponentJSON(root, { noClone: true })

  if (result.root?.styleSetDefinitions) {
    const { styleSetDefinitions } = root
    Object.values(styleSetDefinitions).forEach((styleRef) => {
      const { conditions = [] } = styleRef
      styleRef.content = UIDLUtils.transformStylesAssignmentsToJson(styleRef.content)
      if (conditions.length > 0) {
        conditions.forEach((style: UIDLStyleSetConditions) => {
          style.content = UIDLUtils.transformStylesAssignmentsToJson(style.content) as Record<
            string,
            UIDLStaticValue
          >
        })
      }
    })
  }

  if (result.components) {
    result.components = Object.keys(result.components).reduce(
      (parsedComponnets: Record<string, ComponentUIDL>, key) => {
        parsedComponnets[key] = parseComponentJSON(
          (result.components[key] as unknown) as Record<string, unknown>
        )
        return parsedComponnets
      },
      {}
    )
  }

  return result
}

const parseComponentNode = (node: Record<string, unknown>): UIDLNode => {
  switch (((node as unknown) as UIDLNode).type) {
    case 'element':
      const elementContent = node.content as Record<string, unknown>

      if (elementContent?.referencedStyles) {
        Object.values(elementContent.referencedStyles).forEach((styleRef) => {
          const { content } = styleRef
          if (content.mapType === 'inlined') {
            content.styles = UIDLUtils.transformStylesAssignmentsToJson(
              content.styles as Record<string, string>
            )
          }

          if (content.mapType === 'project-referenced' && content?.conditions) {
            throw new Error(`
              We currently don't support conditions for "referencedStyles" which are
              "project-referenced". Because we need a solution to conditionally apply on the nodes
              with the condition they are being used.

              Eg: If a reference styles is used only for hover, we should be applying the style
              on hover of the node which is using it by pulling from project-style sheet.
            `)
          }
        })
      }

      if (elementContent.style) {
        elementContent.style = UIDLUtils.transformStylesAssignmentsToJson(
          elementContent.style as Record<string, unknown>
        )
      }

      if (elementContent.attrs) {
        elementContent.attrs = UIDLUtils.transformAttributesAssignmentsToJson(
          elementContent.attrs as Record<string, unknown>
        )
      }

      // @ts-ignore
      if (elementContent.abilities?.link) {
        // @ts-ignore
        const { content, type } = elementContent.abilities?.link
        if (type === 'url' && typeof content.url === 'string') {
          content.url = UIDLUtils.transformStringAssignmentToJson(content.url)
        }
      }

      if (Array.isArray(elementContent.children)) {
        elementContent.children = elementContent.children.map((child) => {
          if (typeof child === 'string') {
            return UIDLUtils.transformStringAssignmentToJson(child)
          } else {
            return parseComponentNode(child)
          }
        }, [])
      }

      return (node as unknown) as UIDLNode

    case 'conditional':
      const conditionalNode = (node as unknown) as UIDLConditionalNode
      const { reference } = conditionalNode.content

      conditionalNode.content.node = parseComponentNode(
        (conditionalNode.content.node as unknown) as Record<string, unknown>
      )

      if (typeof reference === 'string') {
        conditionalNode.content.reference = UIDLUtils.transformStringAssignmentToJson(
          reference
        ) as UIDLDynamicReference
      }

      return conditionalNode

    case 'repeat':
      const repeatNode = (node as unknown) as UIDLRepeatNode
      const { dataSource } = repeatNode.content

      repeatNode.content.node = parseComponentNode(
        (repeatNode.content.node as unknown) as Record<string, unknown>
      ) as UIDLElementNode

      if (typeof dataSource === 'string') {
        repeatNode.content.dataSource = UIDLUtils.transformStringAssignmentToJson(dataSource)
      }

      return repeatNode

    case 'slot':
      const slotNode = (node as unknown) as UIDLSlotNode

      if (slotNode.content.fallback) {
        slotNode.content.fallback = parseComponentNode(
          (slotNode.content.fallback as unknown) as Record<string, unknown>
        ) as UIDLElementNode | UIDLStaticValue | UIDLDynamicReference
      }

      return slotNode

    case 'dynamic':
    case 'static':
    case 'raw':
      return (node as unknown) as UIDLNode

    default:
      throw new Error(`parseComponentNode attempted to parsed invalid node type ${node.type}`)
  }
}
