import {
  UIDLNode,
  UIDLAttributeValue,
  UIDLElementNode,
  UIDLStaticValue,
  UIDLDynamicReference,
  ReferenceType,
  ComponentUIDL,
  UIDLSlotNode,
  UIDLStyleValue,
} from '../typings/uidl'

export const component = (name: string, node: UIDLNode): ComponentUIDL => {
  return {
    name,
    node,
  }
}

export const elementNode = (
  elementType: string,
  attrs?: Record<string, UIDLAttributeValue>,
  children?: UIDLNode[],
  style?: Record<string, UIDLStyleValue>
): UIDLElementNode => {
  return {
    type: 'element',
    content: style
      ? element(elementType, attrs, children, style)
      : element(elementType, attrs, children),
  }
}

export const element = (
  elementType: string,
  attrs?: Record<string, UIDLAttributeValue>,
  children?: UIDLNode[],
  style?: Record<string, UIDLStyleValue>
) => {
  return {
    elementType,
    name: elementType,
    attrs,
    style,
    children,
    key: elementType,
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
