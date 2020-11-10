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
  UIDLStyleSetMediaCondition,
  UIDLStyleSetStateCondition,
} from '@teleporthq/teleport-types'
import { UIDLStyleSetTokenReference } from '@teleporthq/teleport-types/src'

type Modify<T, R> = Omit<T, keyof R> & R

export interface VUIDLElementNode extends Modify<UIDLElementNode, { content: VUIDLElement }> {}

export type VUIDLConditionalNode = Modify<
  UIDLConditionalNode,
  {
    content: {
      node: VUIDLNode
      reference: UIDLDynamicReference
      value?: string | number | boolean
      condition?: UIDLConditionalExpression
    }
  }
>

export type VUIDLRepeatNode = Modify<
  UIDLRepeatNode,
  {
    content: {
      node: VUIDLElementNode
      dataSource?: UIDLAttributeValue
      meta?: UIDLRepeatMeta
    }
  }
>

export type VUIDLNode =
  | UIDLDynamicReference
  | UIDLStaticValue
  | UIDLRawValue
  | VUIDLElementNode
  | VUIDLRepeatNode
  | VUIDLConditionalNode
  | VUIDLSlotNode
  | string

export type VUIDLElement = Modify<
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
>

export type VUIDLElementNodeInlineReferencedStyle = Modify<
  UIDLElementNodeInlineReferencedStyle,
  {
    content: {
      mapType: 'inlined'
      conditions: UIDLStyleConditions[]
      styles: Record<string, UIDLAttributeValue | string | number>
    }
  }
>

export type VUIDLStyleSetDefnition = Modify<
  UIDLStyleSetDefinition,
  {
    conditions?: VUIDLStyleSetConditions[]
    content: Record<string, UIDLStaticValue | string | number | UIDLStyleSetTokenReference>
  }
>

export type VUIDLDesignTokens = Record<string, UIDLStaticValue | string | number>

export type VRootComponentUIDL = Modify<
  ComponentUIDL,
  {
    styleSetDefinitions: Record<string, VUIDLStyleSetDefnition>
    node: VUIDLElementNode
    designLanguage: {
      tokens: VUIDLDesignTokens
    }
  }
>

export type VComponentUIDL = Omit<
  VRootComponentUIDL,
  'peerDefinitions' | 'styleSetDefinitions' | 'designLanguage'
>

export type VProjectUIDL = Modify<
  ProjectUIDL,
  {
    root: VRootComponentUIDL
    components?: Record<string, VComponentUIDL>
  }
>

export type VUIDLSlotNode = Modify<
  UIDLSlotNode,
  {
    content:
      | {
          name?: string
          fallback?: VUIDLElementNode | UIDLStaticValue | UIDLDynamicReference
        }
      | {}
  }
>

export type VUIDLSectionLinkNode = Modify<
  UIDLSectionLinkNode,
  {
    content: Record<string, string>
  }
>

export type VUIDLURLLinkNode = Modify<
  UIDLURLLinkNode,
  {
    content: {
      url: UIDLAttributeValue | string
      newTab: boolean
    }
  }
>

export type VUIDLStyleSetMediaCondition = Modify<
  UIDLStyleSetMediaCondition,
  {
    content: Record<string, UIDLStaticValue | string | number | UIDLStyleSetTokenReference>
  }
>

export type VUIDLStyleSetStateCondition = Modify<
  UIDLStyleSetStateCondition,
  {
    content: Record<string, UIDLStaticValue | string | number | UIDLStyleSetTokenReference>
  }
>

export type VUIDLStyleSetConditions = VUIDLStyleSetMediaCondition | VUIDLStyleSetStateCondition

export type VUIDLLinkNode =
  | VUIDLURLLinkNode
  | VUIDLSectionLinkNode
  | UIDLNavLinkNode
  | UIDLMailLinkNode
  | UIDLPhoneLinkNode
