import { NodeHandlerGenerator, handlerToString } from '../types'

async function transform_calculate(config: any, context: Record<string, unknown>) {
  const operation = config.operation || 'add'
  const operand1 = Number(config.operand1) || 0
  const operand2 = Number(config.operand2) || 0
  const operands = config.operands || []
  const precision = config.precision
  const min = config.min
  const max = config.max
  let result: any

  try {
    switch (operation) {
      case 'add':
        result = operand1 + operand2
        break
      case 'subtract':
        result = operand1 - operand2
        break
      case 'multiply':
        result = operand1 * operand2
        break
      case 'divide':
        if (operand2 === 0) {
          return { result: null, error: 'Division by zero' }
        }
        result = operand1 / operand2
        break
      case 'modulo':
        if (operand2 === 0) {
          return { result: null, error: 'Modulo by zero' }
        }
        result = operand1 % operand2
        break
      case 'power':
        result = Math.pow(operand1, operand2)
        break
      case 'sqrt':
        result = Math.sqrt(operand1)
        break
      case 'abs':
        result = Math.abs(operand1)
        break
      case 'round':
        result = Math.round(operand1)
        break
      case 'floor':
        result = Math.floor(operand1)
        break
      case 'ceil':
        result = Math.ceil(operand1)
        break
      case 'min':
        const minArr = operands.length > 0 ? operands.map(Number) : [operand1, operand2]
        result = Math.min.apply(null, minArr)
        break
      case 'max':
        const maxArr = operands.length > 0 ? operands.map(Number) : [operand1, operand2]
        result = Math.max.apply(null, maxArr)
        break
      case 'sum':
        const sumArr = operands.length > 0 ? operands.map(Number) : [operand1, operand2]
        result = 0
        for (let i = 0; i < sumArr.length; i++) {
          result += sumArr[i]
        }
        break
      case 'average':
        const avgArr = operands.length > 0 ? operands.map(Number) : [operand1, operand2]
        let total = 0
        for (let j = 0; j < avgArr.length; j++) {
          total += avgArr[j]
        }
        result = avgArr.length > 0 ? total / avgArr.length : 0
        break
      case 'random':
        const rMin = min !== undefined ? Number(min) : 0
        const rMax = max !== undefined ? Number(max) : 1
        result = rMin + Math.random() * (rMax - rMin)
        break
      default:
        return { result: null, error: 'Unknown operation: ' + operation }
    }

    if (precision !== undefined && precision !== null) {
      const factor = Math.pow(10, Number(precision))
      result = Math.round(result * factor) / factor
    }

    return { result }
  } catch (err: unknown) {
    return { result: null, error: (err as Error).message }
  }
}
export const transformCalculate: NodeHandlerGenerator = {
  nodeType: 'transform-calculate',
  executionEnv: 'universal',
  generateHandler(): string {
    return handlerToString(transform_calculate)
  },
}
