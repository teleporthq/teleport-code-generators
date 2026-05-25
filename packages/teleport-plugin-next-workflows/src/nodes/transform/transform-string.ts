import { NodeHandlerGenerator, handlerToString } from '../types'

async function transform_string(config: any, context: Record<string, unknown>) {
  const operation = config.operation || 'concat'
  let input = config.input !== undefined ? String(config.input) : ''
  const inputs = config.inputs || []
  const separator = config.separator !== undefined ? config.separator : ''
  const searchValue = config.searchValue || ''
  const replaceValue = config.replaceValue !== undefined ? config.replaceValue : ''
  const start = config.start !== undefined ? Number(config.start) : 0
  const end = config.end
  const length = config.length
  const padString = config.padString || ' '
  const times = config.times !== undefined ? Number(config.times) : 1
  const maxLength = config.maxLength
  const ellipsis = config.ellipsis !== undefined ? config.ellipsis : '...'
  let result: any

  try {
    switch (operation) {
      case 'concat':
        const parts = inputs.length > 0 ? inputs.map(String) : [input]
        result = parts.join(separator)
        break
      case 'split':
        result = input.split(separator)
        break
      case 'trim':
        result = input.trim()
        break
      case 'uppercase':
        result = input.toUpperCase()
        break
      case 'lowercase':
        result = input.toLowerCase()
        break
      case 'capitalize':
        result = input.charAt(0).toUpperCase() + input.slice(1)
        break
      case 'replace':
        result = input.split(searchValue).join(replaceValue)
        break
      case 'substring':
        const subEnd =
          end !== undefined
            ? Number(end)
            : length !== undefined
            ? start + Number(length)
            : undefined
        result = subEnd !== undefined ? input.substring(start, subEnd) : input.substring(start)
        break
      case 'length':
        result = input.length
        break
      case 'includes':
        result = input.indexOf(searchValue) !== -1
        break
      case 'startsWith':
        result = input.indexOf(searchValue) === 0
        break
      case 'endsWith':
        result = input.indexOf(searchValue, input.length - searchValue.length) !== -1
        break
      case 'padStart':
        const psLen = length !== undefined ? Number(length) : input.length
        while (input.length < psLen) {
          input = padString + input
        }
        result = input.substring(0, psLen)
        break
      case 'padEnd':
        const peLen = length !== undefined ? Number(length) : input.length
        while (input.length < peLen) {
          input = input + padString
        }
        result = input.substring(0, peLen)
        break
      case 'repeat':
        result = ''
        for (let r = 0; r < times; r++) {
          result += input
        }
        break
      case 'reverse':
        result = input.split('').reverse().join('')
        break
      case 'slugify':
        result = input
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
        break
      case 'truncate':
        const ml = maxLength !== undefined ? Number(maxLength) : input.length
        if (input.length > ml) {
          result = input.substring(0, ml) + ellipsis
        } else {
          result = input
        }
        break
      default:
        return { result: null, error: 'Unknown operation: ' + operation }
    }

    return { result }
  } catch (err: unknown) {
    return { result: null, error: (err as Error).message }
  }
}
export const transformString: NodeHandlerGenerator = {
  nodeType: 'transform-string',
  executionEnv: 'universal',
  generateHandler(): string {
    return handlerToString(transform_string)
  },
}
