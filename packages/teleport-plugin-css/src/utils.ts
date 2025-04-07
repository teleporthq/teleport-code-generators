import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { PluginCSS, UIDLConditionalNode, UIDLPropDefinition } from '@teleporthq/teleport-types'

export const createConditionalStatement = (
  conditions: UIDLConditionalNode['content']['condition']['conditions'],
  leftOperand: UIDLPropDefinition['defaultValue']
) => {
  return conditions.map((condition) => {
    const { operation, operand } = condition

    if (operand === undefined) {
      return `${ASTUtils.convertToUnaryOperator(operation)}${getValueType(operand)}`
    }

    return `${getValueType(leftOperand)} ${ASTUtils.convertToBinaryOperator(
      operation
    )} ${getValueType(operand)}`
  })
}

const getValueType = (value: UIDLPropDefinition['defaultValue']) => {
  const valueType = typeof value
  switch (valueType) {
    case 'string':
      return `"${value}"`
    case 'number':
      return value
    case 'boolean':
      return value
    default:
      throw new PluginCSS(
        `Conditional node received an operand of type ${valueType} \n
            Received ${JSON.stringify(value)}`
      )
  }
}
