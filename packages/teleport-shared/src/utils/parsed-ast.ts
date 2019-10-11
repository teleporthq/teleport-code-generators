/**
 * A tricky way to pass down custom configuration into
 * the objectToObjectExpression values, to allow for member expressions like
 * Proptypes.String.isRequired to be handled by the function.
 */
export default class ParsedASTNode {
  public ast: any

  constructor(ast: any) {
    this.ast = ast
  }
}
