import * as types from '@babel/types'

import {
  UIDLPropDefinition,
  UIDLDependency,
  UIDLStateDefinition,
  UIDLGlobalReference,
} from '@teleporthq/teleport-types'

export interface JSXGenerationParams {
  propDefinitions: Record<string, UIDLPropDefinition>
  stateDefinitions: Record<string, UIDLStateDefinition>
  nodesLookup: Record<string, types.JSXElement | types.JSXExpressionContainer>
  dependencies: Record<string, UIDLDependency>
  windowImports: Record<string, types.ExpressionStatement>
  localeReferences: types.JSXElement[]
  globalReferences: Array<UIDLGlobalReference['content']['id']>
}

export interface JSXGenerationOptions {
  /*
    Depending on the framework implementation, dynamic values can be prefixed in different ways.
    A few examples:
    - this.props.<propKey> - 'this.props' would be the prefix
    - this.<stateKey> - 'this' would be the prefix
    There are also cases where the prefix is empty, like when using hooks with React, the state key exists in the local scope
    Finally, frameworks might have a mix of both, depending on the use of stateful/stateless components (eg: Preact)
  */
  dynamicReferencePrefixMap?: {
    prop: string
    state: string
    local: string
  }

  /*
    Dependencies handling can differ based on the target framework. Web components do not need implicit imports
    because all the components are registered at the DOM level, so they will be used as regular HTML tags.
    - 'import' will create an import statement in the current component for any other local dependency
    - 'ignore' will not perform any action for the dependency, assuming it's been solved by another means
  */
  dependencyHandling?: 'import' | 'ignore'

  /*
    State changes handled inside event listeners differ from framework to framework
    - 'hooks' will assume state hooks (useState) are defined outside the JSX node and will call the set<stateKey> hook
    - 'function' will assume a classic react-like syntax, calling this.setState() for the state change
    - 'mutation' will create a standard assignment this.<stateKey> = newValue
  */
  stateHandling?: 'hooks' | 'function' | 'mutation'

  /*
    Slot nodes are handled differently in React/Preact than in web components driven frameworks (eg: Stencil)
    - 'native' will render a <slot> tag and has full support for named slots
    - 'props' will render a `props.children` node and needs some workarounds for multiple slots per component
  */
  slotHandling?: 'native' | 'props'
  customElementTag?: (name: string) => string
  domHTMLInjection?: (content: string) => types.JSXElement
}

export type NodeToJSX<NodeType, ReturnType> = (
  node: NodeType,
  params: JSXGenerationParams,
  options?: JSXGenerationOptions
) => ReturnType

export type JSXASTReturnType =
  | string
  | types.JSXExpressionContainer
  | types.JSXElement
  | types.LogicalExpression
  | types.Identifier
  | types.MemberExpression

export interface ConditionalIdentifier {
  key: string
  type: string
  prefix?: string
}
