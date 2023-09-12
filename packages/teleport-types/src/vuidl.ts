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
  UIDLStyleSetTokenReference,
  UIDLElementNodeCompReferencedStyle,
  UIDLCompDynamicReference,
  UIDLStyleInlineAsset,
  UIDLFontAsset,
  UIDLComponentSEO,
  UIDLGlobalProjectValues,
  UIDLScriptAsset,
  UIDLStyleExternalAsset,
  UIDLCanonicalAsset,
  UIDLIconAsset,
  UIDLRootComponent,
  UIDLInjectValue,
  UIDLStateValueDetails,
  UIDLRouteDefinitions,
  UIDLStateDefinition,
  UIDLLocalFontAsset,
} from './uidl'
import { Modify } from './helper'

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
  | UIDLInjectValue
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
      | UIDLElementNodeProjectReferencedStyle
      | VUIDLElementNodeInlineReferencedStyle
      | VUIDLElementNodeClassReferencedStyle
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

export type VUIDLElementNodeClassReferencedStyle = Modify<
  UIDLElementNodeCompReferencedStyle,
  {
    content: {
      mapType: 'component-referenced'
      content: string | UIDLStaticValue | UIDLCompDynamicReference
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
  UIDLRootComponent,
  {
    seo?: VUIDLComponentSEO
    styleSetDefinitions: Record<string, VUIDLStyleSetDefnition>
    node: VUIDLElementNode
    stateDefinitions: {
      route: Modify<
        UIDLRouteDefinitions,
        {
          values: VUIDLStateValueDetails[]
        }
      >
      [x: string]: UIDLStateDefinition
    }
    designLanguage: {
      tokens: VUIDLDesignTokens
    }
  }
>

export type VComponentUIDL = Modify<
  Omit<ComponentUIDL, 'designLanguage'>,
  {
    seo?: VUIDLComponentSEO
    node: VUIDLElementNode
    styleSetDefinitions: Record<string, VUIDLStyleSetDefnition>
  }
>

export type VProjectUIDL = Modify<
  ProjectUIDL,
  {
    globals: VUIDLGlobalProjectValues
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

export type VUIDLGlobalAsset =
  | UIDLScriptAsset
  | UIDLStyleExternalAsset
  | UIDLCanonicalAsset
  | UIDLIconAsset
  | VUIDLStyleInlineAsset
  | VUIDLFontAsset
  | UIDLLocalFontAsset

export type VUIDLStyleInlineAsset = Modify<
  UIDLStyleInlineAsset,
  {
    attrs?: Record<string, UIDLStaticValue | string | boolean | number>
  }
>

export type VUIDLFontAsset = Modify<
  UIDLFontAsset,
  {
    attrs?: Record<string, UIDLStaticValue | string | boolean | number>
  }
>

export type VUIDLComponentSEO = Modify<
  UIDLComponentSEO,
  {
    assets?: VUIDLGlobalAsset[]
  }
>

export type VUIDLGlobalProjectValues = Modify<
  UIDLGlobalProjectValues,
  {
    assets: VUIDLGlobalAsset[]
  }
>

export type VUIDLStateValueDetails = Modify<
  UIDLStateValueDetails,
  {
    seo?: VUIDLComponentSEO
  }
>
