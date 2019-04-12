import { HastNode, HastText } from '@teleporthq/teleport-types-generator'
export declare const createHTMLNode: (tagName: string, children?: any[]) => HastNode
export declare const createTextNode: (content: string) => HastText
export declare const addBooleanAttributeToNode: (node: HastNode, key: string) => void
export declare const addAttributeToNode: (node: HastNode, key: string, value: string) => void
export declare const addClassToNode: (node: HastNode, className: string) => void
export declare const addChildNode: (node: HastNode, child: HastNode) => void
export declare const addTextNode: (node: HastNode, text: string) => void
