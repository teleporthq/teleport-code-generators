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
  UIDLCMSItemNode,
  UIDLCMSListNode,
  UIDLCMSListRepeaterNode,
  UIDLDynamicLinkNode,
  UIDLPropValue,
  UIDLExpressionValue,
  UIDLDateTimeNode,
  UIDLLocalResource,
  UIDLExternalResource,
  UIDLInjectValue,
  UIDLStateValueDetails,
  UIDLStateDefinition,
  UIDLCMSMixedTypeNode,
  UIDLDependency,
  UIDLLocalFontAsset,
  UIDLStyleValue,
  UIDLPropDefinition,
  UIDLExternalDependency,
  UIDLResources,
} from './uidl'
import { Modify, ModifyUnionNumber } from './helper'

export interface VUIDLElementNode extends Modify<UIDLElementNode, { content: VUIDLElement }> {}

export interface VUIDLDateTimeNode extends Modify<UIDLDateTimeNode, { content: VUIDLElement }> {}

export interface VCMSItemUIDLElementNode
  extends Modify<
    UIDLCMSItemNode,
    {
      content: {
        name?: string
        nodes: {
          success: VUIDLElementNode
          error?: VUIDLElementNode
          loading?: VUIDLElementNode
        }
        valuePath: string[]
        resource?: UIDLLocalResource | UIDLExternalResource
        initialData?: UIDLPropValue
      }
    }
  > {}

export interface VCMSListRepeaterElementNode
  extends Modify<
    UIDLCMSListRepeaterNode,
    {
      content: {
        nodes: {
          list: VUIDLElementNode
          empty?: VUIDLElementNode
        }
      }
    }
  > {}

export interface VCMSListUIDLElementNode
  extends Modify<
    UIDLCMSListNode,
    {
      content: {
        elementType: string
        name?: string
        dependency?: UIDLDependency
        nodes: {
          key?: string
          success: VUIDLElementNode
          error?: VUIDLElementNode
          loading?: VUIDLElementNode
        }
        valuePath: string[]
        resource?: UIDLLocalResource | UIDLExternalResource
        initialData?: UIDLPropValue
      }
    }
  > {}

export interface VUIDLCMSMixedTypeNode
  extends Modify<
    UIDLCMSMixedTypeNode,
    {
      content: {
        elementType: string
        name: string
        nodes: {
          fallback?: VUIDLElementNode
          error?: VUIDLElementNode
        }
        renderPropIdentifier: string
        dependency?: UIDLDependency
        attrs: Record<string, VUIDLAttributeValue | string | number>
        mappings: Record<string, VUIDLElementNode>
      }
    }
  > {}

export type VUIDLConditionalNode = Modify<
  UIDLConditionalNode,
  {
    content: {
      node: VUIDLNode
      reference: UIDLDynamicReference | UIDLExpressionValue
      value?: string | number | boolean
      importDefinitions?: Record<string, UIDLExternalDependency>
      condition?: UIDLConditionalExpression
    }
  }
>

export type VUIDLRepeatNode = Modify<
  UIDLRepeatNode,
  {
    content: {
      node: VUIDLElementNode
      dataSource?: UIDLRepeatNode['content']['dataSource']
      meta?: UIDLRepeatMeta
    }
  }
>

export type VUIDLNode =
  | UIDLDynamicReference
  | UIDLStaticValue
  | UIDLRawValue
  | VUIDLDateTimeNode
  | VUIDLElementNode
  | VUIDLRepeatNode
  | VUIDLConditionalNode
  | VUIDLSlotNode
  | VCMSItemUIDLElementNode
  | VCMSListUIDLElementNode
  | VCMSListRepeaterElementNode
  | VUIDLCMSMixedTypeNode
  | UIDLExpressionValue
  | UIDLInjectValue
  | string

export type VUIDLElement = Modify<
  UIDLElement,
  {
    elementType: string
    semanticType?: string
    selfClosing?: boolean
    ignore?: boolean
    abilities?: {
      link?: VUIDLLinkNode
    }
    events: UIDLElement['events']
    dependency?: UIDLDependency
    children?: VUIDLNode[]
    style?: Record<string, UIDLStyleValue | string | number>
    attrs?: Record<string, VUIDLAttributeValue | string | number>
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
      styles: Record<string, UIDLStyleValue | string | number>
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
    stateDefinitions?: {
      route: {
        type: string
        defaultValue: string
        values: VUIDLStateValueDetails[]
      }
      [x: string]: UIDLStateDefinition & { values?: VUIDLStateValueDetails[] }
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
    resources?: UIDLResources
    internationalization?: {
      main: {
        name: string
        locale: string
      }
      languages: Record<string, string>
      translations: Record<string, Record<string, VUIDLElementNode | UIDLStaticValue>>
    }
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
    content: {
      section: string | UIDLStaticValue | UIDLExpressionValue
    }
  }
>

export type VUIDLURLLinkNode = Modify<
  UIDLURLLinkNode,
  {
    content: {
      url: UIDLURLLinkNode['content']['url'] | string
      newTab: boolean
    }
  }
>

export type VUIDLNavLinkNode = Modify<
  UIDLNavLinkNode,
  {
    content: {
      routeName: string | UIDLNavLinkNode['content']['routeName']
    }
  }
>

export type VUIDLDynamicLinkNode = UIDLDynamicLinkNode

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
  | VUIDLNavLinkNode
  | UIDLMailLinkNode
  | UIDLPhoneLinkNode
  | VUIDLDynamicLinkNode

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

export type VUIDLAttributeValue = ModifyUnionNumber<
  UIDLAttributeValue,
  UIDLElementNode,
  VUIDLElementNode
>

export type VUIDLPropDefinitions = Modify<
  UIDLPropDefinition,
  {
    defaultValue?: string | number | boolean | unknown[] | object | (() => void) | VUIDLElementNode
  }
>
