import * as types from '@babel/types'
import { UIDLConditionalExpression } from '@teleporthq/teleport-types-uidl-definitions'
import { ConditionalIdentifier } from '@teleporthq/teleport-types-generator'
/**
 * Adds a class definition string to an existing string of classes
 */
export declare const addClassStringOnJSXTag: (
  jsxNode: types.JSXElement,
  classString: string,
  t?: typeof types
) => void
/**
 * Makes `${name}={${prefix}.${value}}` happen in AST
 *
 * @param jsxASTNode the jsx ast element
 * @param name the name of the prop
 * @param value the value of the prop (will be concatenated with props. before it)
 */
export declare const addDynamicAttributeOnTag: (
  jsxASTNode: types.JSXElement,
  name: string,
  value: string,
  prefix?: string,
  t?: typeof types
) => void
export declare const generateStyledJSXTag: (
  templateLiteral: string | types.TemplateLiteral,
  t?: typeof types
) => types.JSXElement
export declare const addAttributeToJSXTag: (
  jsxNode: types.JSXElement,
  attribute: {
    name: string
    value?: any
  },
  t?: typeof types
) => void
/**
 * Generates the AST definiton (without start/end position) for a JSX tag
 * with an opening and closing tag.
 *
 * t is the babel-types api which generates the JSON structure representing the AST.
 * This is set as a parameter to allow us to remove babel-types at some point if we
 * decide to, and to allow easier unit testing of the utils.
 *
 * Requires the tagName, which is a string that will be used to generate the
 * tag.
 *
 * Example:
 * generateASTDefinitionForJSXTag("div") will generate the AST
 * equivalent of <div></div>
 */
export declare const generateASTDefinitionForJSXTag: (
  tagName: string,
  t?: typeof types
) => types.JSXElement
export declare const addChildJSXTag: (
  tag: types.JSXElement,
  childNode: types.JSXElement | types.JSXExpressionContainer
) => void
export declare const addChildJSXText: (
  tag: types.JSXElement,
  text: string,
  t?: typeof types
) => void
export declare const addJSXTagStyles: (
  tag: types.JSXElement,
  styleMap: any,
  t?: typeof types
) => void
export declare const createConditionalJSXExpression: (
  content: string | types.JSXElement | types.JSXExpressionContainer,
  conditionalExpression: UIDLConditionalExpression,
  conditionalIdentifier: ConditionalIdentifier,
  t?: typeof types
) => types.JSXExpressionContainer
export declare const createBinaryExpression: (
  condition: {
    operation: string
    operand?: string | number | boolean
  },
  conditionalIdentifier: ConditionalIdentifier,
  t?: typeof types
) => types.BinaryExpression | types.Identifier | types.MemberExpression | types.UnaryExpression
export declare const createTernaryOperation: (
  stateKey: string,
  leftNode: types.StringLiteral | types.JSXElement,
  rightNode: types.StringLiteral | types.JSXElement,
  t?: typeof types
) => types.JSXExpressionContainer
