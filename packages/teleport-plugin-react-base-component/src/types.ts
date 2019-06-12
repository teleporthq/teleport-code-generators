import * as types from '@babel/types'

import {
  UIDLPropDefinition,
  StateIdentifier,
  ComponentDependency,
} from '@teleporthq/teleport-types'

export interface JSXConfig {
  componentChunkName: string
  exportChunkName: string
  importChunkName: string
}

export interface ReactComponentAccumulators {
  propDefinitions: Record<string, UIDLPropDefinition>
  stateIdentifiers: Record<string, StateIdentifier>
  nodesLookup: Record<string, types.JSXElement>
  dependencies: Record<string, ComponentDependency>
}

export type GenerateNodeSyntaxReturnValue =
  | string
  | types.JSXExpressionContainer
  | types.JSXElement
  | types.LogicalExpression
  | types.Identifier
  | types.MemberExpression

export type ContentType =
  | types.JSXElement
  | types.JSXExpressionContainer
  | types.LogicalExpression
  | string
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
