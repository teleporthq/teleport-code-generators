import { NodeHandlerGenerator, handlerToString } from '../types'

async function transform_convert(config: any, context: Record<string, unknown>) {
  const input = config.input
  const targetType = config.targetType || 'string'
  const dateFormat = config.dateFormat
  const jsonSpaces = config.jsonSpaces !== undefined ? Number(config.jsonSpaces) : 2
  const defaultValue = config.defaultValue
  const strict = config.strict || false
  let result: any

  try {
    switch (targetType) {
      case 'string':
        if (input === null || input === undefined) {
          result = strict ? defaultValue : String(input)
        } else if (typeof input === 'object') {
          result = JSON.stringify(input)
        } else {
          result = String(input)
        }
        break
      case 'number':
        const num = Number(input)
        if (isNaN(num)) {
          if (strict) {
            return { result: null, error: 'Cannot convert to number' }
          }
          result = defaultValue !== undefined ? Number(defaultValue) : 0
        } else {
          result = num
        }
        break
      case 'boolean':
        if (typeof input === 'string') {
          const lower = input.toLowerCase().trim()
          result = lower === 'true' || lower === '1' || lower === 'yes'
        } else {
          result = Boolean(input)
        }
        break
      case 'array':
        if (Array.isArray(input)) {
          result = input
        } else if (typeof input === 'string') {
          try {
            const parsed = JSON.parse(input)
            result = Array.isArray(parsed) ? parsed : [parsed]
          } catch (e) {
            result = [input]
          }
        } else {
          result = [input]
        }
        break
      case 'object':
        if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
          result = input
        } else if (typeof input === 'string') {
          try {
            result = JSON.parse(input)
          } catch (e) {
            if (strict) {
              return { result: null, error: 'Cannot parse string to object' }
            }
            result = defaultValue !== undefined ? defaultValue : {}
          }
        } else {
          result = { value: input }
        }
        break
      case 'date':
        const date = new Date(input)
        if (isNaN(date.getTime())) {
          if (strict) {
            return { result: null, error: 'Invalid date input' }
          }
          result = defaultValue !== undefined ? defaultValue : null
        } else if (!dateFormat || dateFormat === 'iso' || dateFormat === 'ISO') {
          result = date.toISOString()
        } else if (dateFormat === 'locale') {
          result = date.toLocaleString()
        } else if (dateFormat === 'date-only') {
          result = date.toISOString().split('T')[0]
        } else if (dateFormat === 'time-only') {
          result = date.toTimeString().split(' ')[0]
        } else if (dateFormat === 'unix') {
          result = Math.floor(date.getTime() / 1000)
        } else if (dateFormat === 'unix-ms') {
          result = date.getTime()
        } else if (dateFormat === 'utc') {
          result = date.toUTCString()
        } else {
          let fmt = dateFormat
          const Y = date.getFullYear()
          const M = date.getMonth() + 1
          const D = date.getDate()
          const H = date.getHours()
          const mn = date.getMinutes()
          const S = date.getSeconds()
          fmt = fmt.replace('YYYY', String(Y))
          fmt = fmt.replace('YY', String(Y).slice(-2))
          fmt = fmt.replace('MM', (M < 10 ? '0' : '') + M)
          fmt = fmt.replace('DD', (D < 10 ? '0' : '') + D)
          fmt = fmt.replace('HH', (H < 10 ? '0' : '') + H)
          fmt = fmt.replace('mm', (mn < 10 ? '0' : '') + mn)
          fmt = fmt.replace('ss', (S < 10 ? '0' : '') + S)
          result = fmt
        }
        break
      case 'json-parse':
        try {
          result = JSON.parse(input)
        } catch (e) {
          if (strict) {
            return { result: null, error: 'Invalid JSON string' }
          }
          result = defaultValue !== undefined ? defaultValue : null
        }
        break
      case 'json-stringify':
        result = JSON.stringify(input, null, jsonSpaces)
        break
      case 'null':
        result = null
        break
      case 'undefined':
        result = undefined
        break
      default:
        return { result: null, error: 'Unknown target type: ' + targetType }
    }

    return { result }
  } catch (err: unknown) {
    return { result: null, error: (err as Error).message }
  }
}
export const transformConvert: NodeHandlerGenerator = {
  nodeType: 'transform-convert',
  executionEnv: 'universal',
  generateHandler(): string {
    return handlerToString(transform_convert)
  },
}
