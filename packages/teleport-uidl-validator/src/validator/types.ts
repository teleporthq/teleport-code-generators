import {
  UIDLElement,
  UIDLElementNode,
  UIDLAttributeValue,
  ComponentUIDL,
  UIDLStaticValue,
  UIDLStyleSetDefnition,
  ProjectUIDL,
} from '@teleporthq/teleport-types'

type Modify<T, R> = Omit<T, keyof R> & R

export interface VUIDLElementNode extends Modify<UIDLElementNode, { content: VUIDLElement }> {}

export interface VUIDLElement
  extends Modify<UIDLElement, { style: Record<string, UIDLAttributeValue | string> }> {}

export interface VUIDLStyleSetDefnition
  extends Modify<
    UIDLStyleSetDefnition,
    {
      content: Record<string, UIDLStaticValue> | Record<string, string>
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
