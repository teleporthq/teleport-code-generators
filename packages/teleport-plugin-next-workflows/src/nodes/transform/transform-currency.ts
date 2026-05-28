import { NodeHandlerGenerator, handlerToString } from '../types'

async function transform_currency(config: any, context: Record<string, unknown>) {
  const operation = config.operation || 'format'
  const amount = config.amount !== undefined ? Number(config.amount) : 0
  const amount2 = config.amount2 !== undefined ? Number(config.amount2) : 0
  const currency = config.currency || 'USD'
  const locale = config.locale || 'en-US'
  const precision = config.precision !== undefined ? Number(config.precision) : 2
  const parts = config.parts !== undefined ? Number(config.parts) : 2
  const percentage = config.percentage !== undefined ? Number(config.percentage) : 0
  const comparison = config.comparison || 'equal'
  let result: any

  function roundTo(val, dec) {
    const factor = Math.pow(10, dec)
    return Math.round(val * factor) / factor
  }

  try {
    switch (operation) {
      case 'format':
        try {
          result = new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            minimumFractionDigits: precision,
            maximumFractionDigits: precision,
          }).format(amount)
        } catch (e) {
          result = currency + ' ' + roundTo(amount, precision).toFixed(precision)
        }
        break
      case 'parse':
        if (typeof config.amount === 'string') {
          const cleaned = config.amount.replace(/[^0-9.\\-]/g, '')
          result = roundTo(parseFloat(cleaned) || 0, precision)
        } else {
          result = roundTo(amount, precision)
        }
        break
      case 'add':
        result = roundTo(amount + amount2, precision)
        break
      case 'subtract':
        result = roundTo(amount - amount2, precision)
        break
      case 'multiply':
        result = roundTo(amount * amount2, precision)
        break
      case 'divide':
        if (amount2 === 0) {
          return { result: null, error: 'Division by zero' }
        }
        result = roundTo(amount / amount2, precision)
        break
      case 'compare':
        const a = roundTo(amount, precision)
        const b = roundTo(amount2, precision)
        switch (comparison) {
          case 'equal':
            result = a === b
            break
          case 'greater':
            result = a > b
            break
          case 'less':
            result = a < b
            break
          case 'greater-or-equal':
            result = a >= b
            break
          case 'less-or-equal':
            result = a <= b
            break
          default:
            result = a === b
        }
        break
      case 'round':
        result = roundTo(amount, precision)
        break
      case 'split':
        const splitAmount = roundTo(amount / parts, precision)
        const remainder = roundTo(amount - splitAmount * parts, precision)
        const splitResult = []
        for (let i = 0; i < parts; i++) {
          splitResult.push(splitAmount)
        }
        if (remainder !== 0) {
          splitResult[0] = roundTo(splitResult[0] + remainder, precision)
        }
        result = splitResult
        break
      case 'percentage':
        result = roundTo((amount * percentage) / 100, precision)
        break
      default:
        return { result: null, error: 'Unknown operation: ' + operation }
    }

    return { result }
  } catch (err: unknown) {
    return { result: null, error: (err as Error).message }
  }
}
export const transformCurrency: NodeHandlerGenerator = {
  nodeType: 'transform-currency',
  executionEnv: 'universal',
  generateHandler(): string {
    return handlerToString(transform_currency)
  },
}
