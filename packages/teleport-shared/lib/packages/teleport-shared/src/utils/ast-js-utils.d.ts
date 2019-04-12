import * as types from '@babel/types'
/**
 * A tricky way to pass down custom configuration into
 * the objectToObjectExpression values, to allow for member expressions like
 * Proptypes.String.isRequired to be handled by the function.
 */
export declare class ParsedASTNode {
  ast: any
  constructor(ast: any)
}
export declare const objectToObjectExpression: (
  objectMap: {
    [key: string]: any
  },
  t?: typeof types
) => types.ObjectExpression
declare type ExpressionLiteral =
  | types.StringLiteral
  | types.BooleanLiteral
  | types.NumberLiteral
  | types.Identifier
  | types.ArrayExpression
  | types.ObjectExpression
export declare const convertValueToLiteral: (
  value: any,
  explicitType?: string,
  t?: typeof types
) => ExpressionLiteral
export declare const makeConstAssign: (
  constName: string,
  asignment?: any,
  t?: typeof types
) => types.VariableDeclaration
export declare const makeDefaultExport: (
  name: string,
  t?: typeof types
) => types.ExportDefaultDeclaration
/**
 * You can pass the path of the package which is added at the top of the file and
 * an array of imports that we extract from that package.
 */
export declare const makeGenericImportStatement: (
  path: string,
  imports: any[],
  t?: typeof types
) => types.ImportDeclaration
export {}
