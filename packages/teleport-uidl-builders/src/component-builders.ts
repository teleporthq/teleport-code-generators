import {
  ComponentUIDL,
  ReferenceType,
  UIDLDependency,
  UIDLNode,
  UIDLSlotNode,
  UIDLStyleValue,
  UIDLRepeatNode,
  UIDLElementNode,
  UIDLStaticValue,
  UIDLAttributeValue,
  UIDLPropDefinition,
  UIDLStateDefinition,
  UIDLConditionalNode,
  UIDLDynamicReference,
  UIDLEventDefinitions,
} from '@teleporthq/teleport-types'

export const component = (
  name: string,
  node: UIDLElementNode,
  propDefinitions?: Record<string, UIDLPropDefinition>,
  stateDefinitions?: Record<string, UIDLStateDefinition>
): ComponentUIDL => {
  return {
    name,
    node,
    stateDefinitions,
    propDefinitions,
  }
}

export const definition = (
  type: string,
  defaultValue: string | number | boolean | any[] | object
) => {
  return {
    type,
    defaultValue,
  }
}

export const elementNode = (
  elementType: string,
  attrs?: Record<string, UIDLAttributeValue>,
  children?: UIDLNode[],
  dependency?: UIDLDependency,
  style?: Record<string, UIDLStyleValue>,
  events?: UIDLEventDefinitions
): UIDLElementNode => {
  return {
    type: 'element',
    content: style
      ? element(elementType, attrs, children, dependency, events, style)
      : element(elementType, attrs, children, dependency, events),
  }
}

export const element = (
  elementType: string,
  attrs?: Record<string, UIDLAttributeValue>,
  children?: UIDLNode[],
  dependency?: UIDLDependency,
  events?: UIDLEventDefinitions,
  style?: Record<string, UIDLStyleValue>
) => {
  if (dependency) {
    return {
      elementType,
      name: elementType,
      dependency,
      attrs,
      style,
      events,
      children,
    }
  }
  return {
    elementType,
    name: elementType,
    attrs,
    style,
    events,
    children,
  }
}

export const componentDependency = (
  type: 'library' | 'package' | 'local',
  path?: string,
  version?: string,
  meta?: Record<string, string | boolean>
): UIDLDependency => {
  return {
    type,
    path,
    version,
    meta,
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

export const slotNode = (
  fallback?: UIDLElementNode | UIDLStaticValue | UIDLDynamicReference,
  name?: string
): UIDLSlotNode => {
  return {
    type: 'slot',
    content: {
      fallback,
      name,
    },
  }
}

export const conditionalNode = (
  reference: UIDLDynamicReference,
  node: UIDLNode,
  value: string | number | boolean
): UIDLConditionalNode => {
  return {
    type: 'conditional',
    content: {
      reference,
      node,
      value,
    },
  }
}

export const repeatNode = (
  node: UIDLElementNode,
  dataSource: UIDLAttributeValue,
  meta?: Record<string, any>
): UIDLRepeatNode => {
  return {
    type: 'repeat',
    content: {
      node,
      dataSource,
      meta,
    },
  }
}
