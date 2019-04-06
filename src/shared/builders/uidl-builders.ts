import {
  UIDLNode,
  UIDLAttributeValue,
  UIDLElementNode,
  UIDLStaticValue,
  UIDLDynamicReference,
  ReferenceType,
  ComponentUIDL,
  UIDLSlotNode,
} from '../../typings/uidl-definitions'

export const component = (name: string, node: UIDLNode): ComponentUIDL => {
  return {
    name,
    node,
  }
}

export const elementNode = (
  elementType: string,
  attrs?: Record<string, UIDLAttributeValue>,
  children?: UIDLNode[]
): UIDLElementNode => {
  return {
    type: 'element',
    content: element(elementType, attrs, children),
  }
}

export const element = (
  elementType: string,
  attrs?: Record<string, UIDLAttributeValue>,
  children?: UIDLNode[]
) => {
  return {
    elementType,
    name: elementType,
    attrs,
    children,
  }
}

export const staticNode = (content: string): UIDLStaticValue => {
  return {
    type: 'static',
    content,
  }
}

export const dynamicNode = (referenceType: ReferenceType, id: string): UIDLDynamicReference => {
  return {
    type: 'dynamic',
    content: {
      referenceType,
      id,
    },
  }
}

export const slotNode = (fallback?: UIDLNode, name?: string): UIDLSlotNode => {
  return {
    type: 'slot',
    content: {
      fallback,
      name,
    },
  }
}
