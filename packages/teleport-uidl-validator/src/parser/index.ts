import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
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
  UIDLDesignTokens,
  ParserError,
  UIDLComponentSEO,
  VUIDLGlobalAsset,
  UIDLGlobalAsset,
  UIDLRootComponent,
  VUIDLLinkNode,
  UIDLPropDefinition,
  UIDLStateDefinition,
  UIDLElementNodeInlineReferencedStyle,
  UIDLURLLinkNode,
  UIDLCMSItemNode,
  UIDLCMSListRepeaterNode,
  UIDLCMSListNode,
  UIDLDependency,
  UIDLEventHandlerStatement,
  UIDLCMSMixedTypeNode,
} from '@teleporthq/teleport-types'

interface ParseComponentJSONParams {
  noClone?: boolean
}

export const parseComponentJSON = (
  input: Record<string, unknown>,
  params: ParseComponentJSONParams = {}
): ComponentUIDL => {
  const safeInput = params.noClone ? input : UIDLUtils.cloneObject(input)

  if (safeInput?.propDefinitions) {
    const acc: Record<string, UIDLPropDefinition> = {}
    for (const prop of Object.keys(safeInput.propDefinitions)) {
      const propValue = (safeInput.propDefinitions as Record<string, UIDLPropDefinition>)[prop]
      const propName = StringUtils.createStateOrPropStoringValue(prop)
      acc[propName] = propValue
    }
    safeInput.propDefinitions = acc
  }

  if (safeInput?.stateDefinitions) {
    safeInput.stateDefinitions = Object.keys(safeInput.stateDefinitions).reduce(
      (acc: Record<string, UIDLStateDefinition>, state) => {
        const stateName = StringUtils.createStateOrPropStoringValue(state)
        acc[stateName] = (safeInput.stateDefinitions as Record<string, UIDLStateDefinition>)[state]
        return acc
      },
      {}
    )
  }

  if (safeInput?.styleSetDefinitions) {
    Object.values(safeInput?.styleSetDefinitions).forEach((styleRef) => {
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

  if (safeInput?.seo) {
    const { seo } = safeInput
    const { assets = [] } = (seo as UIDLComponentSEO) || { assets: [] }

    assets.forEach(parseAssets)
  }

  const node = safeInput.node as Record<string, unknown>
  const result: ComponentUIDL = {
    ...(safeInput as unknown as ComponentUIDL),
  }

  for (const propKey of Object.keys(result.propDefinitions || {})) {
    const prop = result.propDefinitions[propKey]
    if (
      prop.type === 'element' &&
      prop.defaultValue !== undefined &&
      typeof prop.defaultValue !== 'object'
    ) {
      throw new ParserError(
        `The defaultValue for prop ${propKey} in component ${result.name} is not an object. It should be a UIDLElementNode.`
      )
    }

    if (prop.type === 'element' && prop.defaultValue) {
      result.propDefinitions[propKey].defaultValue = parseComponentNode(
        prop.defaultValue as unknown as Record<string, unknown>,
        result
      )
    }
  }

  // other parsers for other sections of the component here
  result.node = parseComponentNode(node, result) as UIDLElementNode

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
    ...(safeInput as unknown as ProjectUIDL),
  }
  result.root = parseComponentJSON(root, { noClone: true }) as UIDLRootComponent

  result.globals?.assets?.forEach(parseAssets)

  if (result.root?.designLanguage) {
    const { tokens = {} } = result.root.designLanguage

    result.root.designLanguage.tokens = Object.keys(tokens).reduce(
      (acc: UIDLDesignTokens, tokenId: string) => {
        const token = tokens[tokenId]
        if (typeof token === 'string' || typeof token === 'number') {
          acc[tokenId] = {
            type: 'static',
            content: token,
          }
        } else {
          acc[tokenId] = token
        }
        return acc
      },
      {}
    )
  }

  if (result.components) {
    result.components = Object.keys(result.components).reduce(
      (parsedComponnets: Record<string, ComponentUIDL>, key) => {
        parsedComponnets[key] = parseComponentJSON(
          result.components[key] as unknown as Record<string, unknown>
        )
        return parsedComponnets
      },
      {}
    )
  }

  return result
}

const parseComponentNode = (node: Record<string, unknown>, component: ComponentUIDL): UIDLNode => {
  switch ((node as unknown as UIDLNode).type) {
    case 'cms-item':
    case 'cms-list': {
      const {
        initialData,
        nodes: { success, error, loading },
        resource,
      } = (node as unknown as UIDLCMSItemNode).content

      if (initialData) {
        initialData.content.id = StringUtils.createStateOrPropStoringValue(initialData.content.id)
      }

      // TODO all this casting is really ugly, maybe we'll be able to do something about it
      if (success) {
        ;(node as unknown as UIDLCMSItemNode | UIDLCMSListNode).content.nodes.success =
          parseComponentNode(
            success as unknown as Record<string, unknown>,
            component
          ) as UIDLElementNode
      }

      if (error) {
        ;(node as unknown as UIDLCMSItemNode | UIDLCMSListNode).content.nodes.error =
          parseComponentNode(
            error as unknown as Record<string, unknown>,
            component
          ) as UIDLElementNode
      }

      if (loading) {
        ;(node as unknown as UIDLCMSItemNode | UIDLCMSListNode).content.nodes.loading =
          parseComponentNode(
            loading as unknown as Record<string, unknown>,
            component
          ) as UIDLElementNode
      }

      if (resource?.params) {
        Object.values(resource?.params || {}).forEach((param) => {
          if (
            param.type === 'dynamic' &&
            (param.content.referenceType === 'state' || param.content.referenceType === 'prop')
          ) {
            param.content.id = StringUtils.createStateOrPropStoringValue(param.content.id)
          }
        })
      }

      return node as unknown as UIDLCMSListNode | UIDLCMSItemNode
    }
    case 'cms-list-repeater': {
      const {
        nodes: { list, empty },
      } = (node as unknown as UIDLCMSListRepeaterNode).content

      if (list) {
        ;(node as unknown as UIDLCMSListRepeaterNode).content.nodes.list = parseComponentNode(
          list as unknown as Record<string, unknown>,
          component
        ) as UIDLElementNode
      }

      if (empty) {
        ;(node as unknown as UIDLCMSListRepeaterNode).content.nodes.empty = parseComponentNode(
          empty as unknown as Record<string, unknown>,
          component
        ) as UIDLElementNode
      }

      return node as unknown as UIDLCMSListRepeaterNode
    }
    case 'cms-mixed-type': {
      const {
        nodes: { fallback, error },
        dependency,
        attrs,
        mappings,
      } = (node as unknown as UIDLCMSMixedTypeNode).content

      if (attrs) {
        const nodeAttrs = attrs as Record<string, unknown>
        for (const attrKey of Object.keys(nodeAttrs)) {
          const attrValue = nodeAttrs[attrKey] as Record<string, unknown>
          if ('type' in attrValue && attrValue.type === 'element') {
            nodeAttrs[attrKey] = parseComponentNode(attrValue, component)
          }
        }

        ;(node.content as UIDLCMSMixedTypeNode['content']).attrs =
          UIDLUtils.transformAttributesAssignmentsToJson(
            nodeAttrs,
            dependency && (dependency as UIDLDependency)?.type === 'local'
          )
      }

      if (fallback) {
        ;(node as unknown as UIDLCMSMixedTypeNode).content.nodes.fallback = parseComponentNode(
          fallback as unknown as Record<string, unknown>,
          component
        ) as UIDLElementNode
      }

      if (error) {
        ;(node as unknown as UIDLCMSMixedTypeNode).content.nodes.error = parseComponentNode(
          error as unknown as Record<string, unknown>,
          component
        ) as UIDLElementNode
      }

      Object.keys(mappings).forEach((mapping) => {
        ;(node.content as unknown as UIDLCMSMixedTypeNode['content']).mappings[mapping] =
          parseComponentNode(
            mappings[mapping] as unknown as Record<string, unknown>,
            component
          ) as UIDLElementNode
      })

      return node as unknown as UIDLCMSMixedTypeNode
    }
    case 'element':
      const elementContent = node.content as Record<string, unknown>
      if (elementContent?.referencedStyles) {
        Object.values(elementContent.referencedStyles).forEach((styleRef) => {
          switch (styleRef.content.mapType) {
            case 'inlined': {
              const { content } = styleRef as UIDLElementNodeInlineReferencedStyle
              content.styles = UIDLUtils.transformStylesAssignmentsToJson(content.styles)
              break
            }

            case 'project-referenced':
              break

            case 'component-referenced': {
              if (['string', 'number'].includes(typeof styleRef.content.content)) {
                styleRef.content.content = {
                  type: 'static',
                  content: styleRef.content.content,
                }
              }

              break
            }

            default: {
              throw new ParserError(
                `Un-expected mapType passed in referencedStyles - ${styleRef.content.mapType}`
              )
            }
          }
        })
      }

      if (elementContent.events) {
        Object.values(elementContent.events).forEach(
          (eventHandler: UIDLEventHandlerStatement[]) => {
            eventHandler.forEach((eventStatement) => {
              if (eventStatement.type === 'stateChange') {
                eventStatement.modifies = StringUtils.createStateOrPropStoringValue(
                  eventStatement.modifies
                )
              }

              if (eventStatement.type === 'propCall') {
                eventStatement.calls = StringUtils.createStateOrPropStoringValue(
                  eventStatement.calls
                )
              }
            })
          }
        )
      }

      if (elementContent.style) {
        elementContent.style = UIDLUtils.transformStylesAssignmentsToJson(
          elementContent.style as Record<string, unknown>
        )
      }

      if (elementContent.attrs) {
        const attrs = UIDLUtils.transformAttributesAssignmentsToJson(
          elementContent.attrs as Record<string, unknown>,
          'dependency' in elementContent &&
            (elementContent.dependency as UIDLDependency)?.type === 'local'
        )

        for (const attrKey of Object.keys(attrs)) {
          const attrValue = attrs[attrKey]

          if (attrValue.type === 'element') {
            const parsedNamedSlot = parseComponentNode(
              attrValue as unknown as Record<string, unknown>,
              component
            )
            attrs[attrKey] = parsedNamedSlot as UIDLElementNode
          }
        }

        elementContent.attrs = attrs
      }

      if (elementContent?.abilities?.hasOwnProperty('link')) {
        const { content, type } = (elementContent.abilities as { link: VUIDLLinkNode }).link

        if (type === 'navlink' && typeof content.routeName === 'string') {
          const route: UIDLStaticValue = {
            type: 'static',
            content: content.routeName,
          }
          content.routeName = route
        }

        if (type === 'url' && typeof content.url === 'string') {
          content.url = UIDLUtils.transformStringAssignmentToJson(content.url)
        }

        if (type === 'url' && (content as UIDLURLLinkNode['content']).url.type === 'dynamic') {
          ;(content as UIDLURLLinkNode['content']).url.content = {
            referenceType: ((content as UIDLURLLinkNode['content']).url as UIDLDynamicReference)
              .content.referenceType,
            id: StringUtils.createStateOrPropStoringValue(
              ((content as UIDLURLLinkNode['content']).url as UIDLDynamicReference).content.id
            ),
            refPath: ((content as UIDLURLLinkNode['content']).url as UIDLDynamicReference).content
              .refPath,
          }
        }

        if (type === 'section' && typeof content.section === 'string') {
          content.section = {
            type: 'static',
            content: content.section,
          }
        }
      }

      if (Array.isArray(elementContent.children)) {
        elementContent.children = elementContent.children.map((child) => {
          if (typeof child === 'string') {
            return UIDLUtils.transformStringAssignmentToJson(child)
          } else {
            return parseComponentNode(child, component)
          }
        }, [])
      }

      return node as unknown as UIDLNode

    case 'conditional':
      const conditionalNode = node as unknown as UIDLConditionalNode
      const { reference } = conditionalNode.content

      conditionalNode.content.node = parseComponentNode(
        conditionalNode.content.node as unknown as Record<string, unknown>,
        component
      )

      if (typeof reference === 'string') {
        conditionalNode.content.reference = UIDLUtils.transformStringAssignmentToJson(
          reference
        ) as UIDLDynamicReference
      }

      if (
        reference.type === 'dynamic' &&
        reference.content.referenceType !== 'global' &&
        conditionalNode.content.reference.type === 'dynamic'
      ) {
        conditionalNode.content.reference.content = {
          referenceType: reference.content.referenceType,
          id: StringUtils.createStateOrPropStoringValue(
            conditionalNode.content.reference.content.id
          ),
          refPath: reference.content.refPath,
        }
      }

      return conditionalNode

    case 'repeat':
      const repeatNode = node as unknown as UIDLRepeatNode
      const { dataSource } = repeatNode.content

      repeatNode.content.node = parseComponentNode(
        repeatNode.content.node as unknown as Record<string, unknown>,
        component
      ) as UIDLElementNode

      if (typeof dataSource === 'string') {
        repeatNode.content.dataSource = UIDLUtils.transformStringAssignmentToJson(dataSource)
      }

      return repeatNode

    case 'slot':
      const slotNode = node as unknown as UIDLSlotNode
      if (slotNode.content.fallback) {
        slotNode.content.fallback = parseComponentNode(
          slotNode.content.fallback as unknown as Record<string, unknown>,
          component
        ) as UIDLElementNode | UIDLStaticValue | UIDLDynamicReference
      }

      return slotNode

    case 'dynamic':
      const dyamicNode = node as unknown as UIDLDynamicReference
      if (['state', 'prop'].includes(dyamicNode.content.referenceType)) {
        dyamicNode.content.id = UIDLUtils.generateIdWithRefPath(
          dyamicNode.content.id,
          dyamicNode.content.refPath
        )
      }
      return dyamicNode
    case 'static':
    case 'raw':
    case 'expr':
    case 'inject':
      return node as unknown as UIDLNode

    default:
      throw new ParserError(`parseComponentNode attempted to parsed invalid node type ${node.type}`)
  }
}

export const parseAssets = (asset: VUIDLGlobalAsset): UIDLGlobalAsset => {
  if ('attrs' in asset) {
    asset.attrs = UIDLUtils.transformAttributesAssignmentsToJson(asset.attrs) as Record<
      string,
      UIDLStaticValue
    >
  }

  return asset as UIDLGlobalAsset
}
