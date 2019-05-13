import {
  ComponentUIDL,
  ReferenceType,
  ComponentDependency,
  UIDLNode,
  UIDLSlotNode,
  UIDLRepeatNode,
  UIDLElementNode,
  UIDLStaticValue,
  UIDLAttributeValue,
  UIDLPropDefinition,
  UIDLStateDefinition,
  UIDLConditionalNode,
  UIDLDynamicReference,
} from '../typings/uidl'

export const component = (
  name: string,
  node: UIDLNode,
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
  dependency?: ComponentDependency
): UIDLElementNode => {
  return {
    type: 'element',
    content: element(elementType, attrs, children, dependency),
  }
}

export const element = (
  elementType: string,
  attrs?: Record<string, UIDLAttributeValue>,
  children?: UIDLNode[],
  dependency?: ComponentDependency
) => {
  return {
    elementType,
    name: elementType,
    dependency,
    attrs,
    children,
  }
}

export const componentDependency = (
  type?: string,
  path?: string,
  version?: string,
  meta?: Record<string, string | boolean>
): ComponentDependency => {
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

export const slotNode = (fallback?: UIDLNode, name?: string): UIDLSlotNode => {
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
  node: UIDLNode,
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
