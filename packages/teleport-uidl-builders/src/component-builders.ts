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
  UIDLRawValue,
  UIDLReferencedStyles,
  UIDLElement,
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
  defaultValue: string | number | boolean | unknown[] | object
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
  events?: UIDLEventDefinitions,
  referencedStyles?: UIDLReferencedStyles
): UIDLElementNode => {
  return {
    type: 'element',
    content: element(elementType, attrs, children, dependency, events, style, referencedStyles),
  }
}

export const element = (
  elementType: string,
  attrs?: Record<string, UIDLAttributeValue>,
  children?: UIDLNode[],
  dependency?: UIDLDependency,
  events?: UIDLEventDefinitions,
  style?: Record<string, UIDLStyleValue>,
  referencedStyles?: UIDLReferencedStyles
) => {
  const elementObj: UIDLElement = {
    key: elementType,
    elementType,
    name: elementType,
    children,
  }

  if (attrs) {
    elementObj.attrs = attrs
  }

  if (events) {
    elementObj.events = events
  }

  if (dependency) {
    elementObj.elementType = 'component'
    elementObj.semanticType = elementType
    elementObj.dependency = dependency
  }

  if (style) {
    elementObj.style = style
  }

  if (referencedStyles) {
    elementObj.referencedStyles = referencedStyles
  }

  return elementObj
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

export const staticNode = (content: string | boolean | number): UIDLStaticValue => {
  return {
    type: 'static',
    content,
  }
}

export const dynamicNode = (
  referenceType: ReferenceType,
  id: string,
  refPath?: string[]
): UIDLDynamicReference => {
  return {
    type: 'dynamic',
    content: {
      referenceType,
      id,
      refPath,
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
  dataSource: UIDLDynamicReference | UIDLStaticValue | UIDLRawValue,
  meta?: Record<string, unknown>
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

export const rawNode = (content: string): UIDLRawValue => {
  return {
    type: 'raw',
    content,
  }
}
