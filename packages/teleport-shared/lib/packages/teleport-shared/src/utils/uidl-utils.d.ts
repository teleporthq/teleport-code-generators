import {
  ComponentUIDL,
  UIDLStateDefinition,
  UIDLStyleDefinitions,
  UIDLConditionalNode,
  UIDLElement,
  UIDLNode,
  UIDLAttributeValue,
  UIDLDynamicReference,
} from '@teleporthq/teleport-types-uidl-definitions'
/**
 * A couple of different cases which need to be handled
 * In case of next/nuxt generators, the file names represent the urls of the pages
 * Also the root path needs to be represented by the index file
 */
export declare const extractPageMetadata: (
  routeDefinitions: UIDLStateDefinition,
  stateName: string,
  options?: {
    usePathAsFileName?: boolean
    convertDefaultToIndex?: boolean
  }
) => {
  fileName: string
  componentName: string
  path: string
}
export declare const extractRoutes: (rootComponent: ComponentUIDL) => UIDLConditionalNode[]
export declare const prefixPlaygroundAssetsURL: (prefix: string, originalString: string) => string
export declare const cloneObject: <T>(node: T) => T
export declare const traverseNodes: (
  node: UIDLNode,
  fn: (node: UIDLNode, parentNode: UIDLNode) => void,
  parent?: UIDLNode
) => void
export declare const traverseElements: (node: UIDLNode, fn: (element: UIDLElement) => void) => void
interface SplitResponse {
  staticStyles: UIDLStyleDefinitions
  dynamicStyles: UIDLStyleDefinitions
}
export declare const splitDynamicAndStaticStyles: (
  style: Record<string, import('@teleporthq/teleport-types-uidl-definitions').UIDLStyleValue>
) => SplitResponse
export declare const cleanupNestedStyles: (
  style: Record<string, import('@teleporthq/teleport-types-uidl-definitions').UIDLStyleValue>
) => Record<string, import('@teleporthq/teleport-types-uidl-definitions').UIDLStyleValue>
export declare const cleanupDynamicStyles: (
  style: Record<string, import('@teleporthq/teleport-types-uidl-definitions').UIDLStyleValue>
) => Record<string, import('@teleporthq/teleport-types-uidl-definitions').UIDLStyleValue>
export declare const transformDynamicStyles: (
  style: Record<string, import('@teleporthq/teleport-types-uidl-definitions').UIDLStyleValue>,
  transform: (value: UIDLDynamicReference, key?: string) => unknown
) => {}
/**
 * Transform properties like
 * $props.something
 * $local.something
 * $state.something
 *
 * Into their json alternative which is used in beta release/0.6 and
 * later.
 */
export declare const transformStringAssignmentToJson: (
  declaration: string | number
) => UIDLAttributeValue
export declare const transformStylesAssignmentsToJson: (
  styleObject: Record<string, unknown>
) => Record<string, import('@teleporthq/teleport-types-uidl-definitions').UIDLStyleValue>
export declare const transformAttributesAssignmentsToJson: (
  attributesObject: Record<string, unknown>
) => Record<string, UIDLAttributeValue>
export {}
