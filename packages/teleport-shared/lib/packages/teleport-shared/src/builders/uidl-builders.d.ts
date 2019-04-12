import {
  UIDLNode,
  UIDLAttributeValue,
  UIDLElementNode,
  UIDLStaticValue,
  UIDLDynamicReference,
  ReferenceType,
  ComponentUIDL,
  UIDLSlotNode,
} from '@teleporthq/teleport-types-uidl-definitions'
export declare const component: (name: string, node: UIDLNode) => ComponentUIDL
export declare const elementNode: (
  elementType: string,
  attrs?: Record<string, UIDLAttributeValue>,
  children?: UIDLNode[]
) => UIDLElementNode
export declare const element: (
  elementType: string,
  attrs?: Record<string, UIDLAttributeValue>,
  children?: UIDLNode[]
) => {
  elementType: string
  name: string
  attrs: Record<string, UIDLAttributeValue>
  children: UIDLNode[]
}
export declare const staticNode: (content: string) => UIDLStaticValue
export declare const dynamicNode: (referenceType: ReferenceType, id: string) => UIDLDynamicReference
export declare const slotNode: (fallback?: UIDLNode, name?: string) => UIDLSlotNode
