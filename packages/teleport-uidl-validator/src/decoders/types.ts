import {
  UIDLElement,
  UIDLElementNode,
  UIDLAttributeValue,
  ComponentUIDL,
  UIDLStaticValue,
  UIDLStyleSetDefinition,
  ProjectUIDL,
  UIDLSlotNode,
  UIDLDynamicReference,
  UIDLRawValue,
  UIDLRepeatNode,
  UIDLConditionalNode,
  UIDLRepeatMeta,
  UIDLConditionalExpression,
  UIDLElementNodeInlineReferencedStyle,
  UIDLStyleConditions,
  UIDLElementNodeProjectReferencedStyle,
  UIDLSectionLinkNode,
  UIDLURLLinkNode,
  UIDLNavLinkNode,
  UIDLMailLinkNode,
  UIDLPhoneLinkNode,
} from '@teleporthq/teleport-types'

type Modify<T, R> = Omit<T, keyof R> & R

export interface VUIDLElementNode extends Modify<UIDLElementNode, { content: VUIDLElement }> {}

export interface VUIDLConditionalNode
  extends Modify<
    UIDLConditionalNode,
    {
      content: {
        node: VUIDLNode
        reference: UIDLDynamicReference
        value?: string | number | boolean
        condition?: UIDLConditionalExpression
      }
    }
  > {}

export interface VUIDLRepeatNode
  extends Modify<
    UIDLRepeatNode,
    {
      content: {
        node: VUIDLElementNode
        dataSource?: UIDLAttributeValue
        meta?: UIDLRepeatMeta
      }
    }
  > {}

export type VUIDLNode =
  | UIDLDynamicReference
  | UIDLStaticValue
  | UIDLRawValue
  | VUIDLElementNode
  | VUIDLRepeatNode
  | VUIDLConditionalNode
  | VUIDLSlotNode
  | string
export interface VUIDLElement
  extends Modify<
    UIDLElement,
    {
      abilities?: {
        link?: VUIDLLinkNode
      }
      children?: VUIDLNode[]
      style?: Record<string, UIDLAttributeValue | string | number>
      attrs?: Record<string, UIDLAttributeValue | string | number>
      referencedStyles: Record<
        string,
        UIDLElementNodeProjectReferencedStyle | VUIDLElementNodeInlineReferencedStyle
      >
    }
  > {}

export interface VUIDLElementNodeInlineReferencedStyle
  extends Modify<
    UIDLElementNodeInlineReferencedStyle,
    {
      content: {
        mapType: 'inlined'
        conditions: UIDLStyleConditions[]
        styles: Record<string, UIDLAttributeValue | string | number>
      }
    }
  > {}

export interface VUIDLStyleSetDefnition
  extends Modify<
    UIDLStyleSetDefinition,
    {
      content: Record<string, UIDLStaticValue | string | number>
    }
  > {}

export interface VComponentUIDL
  extends Modify<
    ComponentUIDL,
    { styleSetDefinitions: Record<string, VUIDLStyleSetDefnition>; node: VUIDLElementNode }
  > {}

export interface VProjectUIDL
  extends Modify<
    ProjectUIDL,
    {
      root: VComponentUIDL
      components?: Record<string, VComponentUIDL>
    }
  > {}

export interface VUIDLSlotNode
  extends Modify<
    UIDLSlotNode,
    {
      content:
        | {
            name?: string
            fallback?: VUIDLElementNode | UIDLStaticValue | UIDLDynamicReference
          }
        | {}
    }
  > {}

export interface VUIDLSectionLinkNode
  extends Modify<
    UIDLSectionLinkNode,
    {
      content: Record<string, string>
    }
  > {}

export interface VUIDLURLLinkNode
  extends Modify<
    UIDLURLLinkNode,
    {
      content: {
        url: UIDLAttributeValue | string
        newTab: boolean
      }
    }
  > {}

export type VUIDLLinkNode =
  | VUIDLURLLinkNode
  | VUIDLSectionLinkNode
  | UIDLNavLinkNode
  | UIDLMailLinkNode
  | UIDLPhoneLinkNode
