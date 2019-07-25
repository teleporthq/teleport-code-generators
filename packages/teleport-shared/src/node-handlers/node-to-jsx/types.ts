import * as types from '@babel/types'

import {
  UIDLPropDefinition,
  ComponentDependency,
  UIDLStateDefinition,
} from '@teleporthq/teleport-types'

export interface JSXGenerationParams {
  propDefinitions: Record<string, UIDLPropDefinition>
  stateDefinitions: Record<string, UIDLStateDefinition>
  nodesLookup: Record<string, types.JSXElement>
  dependencies: Record<string, ComponentDependency>
}

export interface JSXGenerationOptions {
  dynamicReferencePrefixMap?: {
    prop: string
    state: string
    local: string
  }
  useHooks?: boolean
}

export type JSXRootReturnType =
  | string
  | types.JSXExpressionContainer
  | types.JSXElement
  | types.LogicalExpression
  | types.Identifier
  | types.MemberExpression

export type BinaryOperator =
  | '==='
  | '+'
  | '-'
  | '/'
  | '%'
  | '*'
  | '**'
  | '&'
  | '|'
  | '>>'
  | '>>>'
  | '<<'
  | '^'
  | '=='
  | '!='
  | '!=='
  | 'in'
  | 'instanceof'
  | '>'
  | '<'
  | '>='
  | '<='

export type UnaryOperation = '+' | '-' | 'void' | 'throw' | 'delete' | '!' | '~' | 'typeof'

export interface ConditionalIdentifier {
  key: string
  type: string
  prefix?: string
}
