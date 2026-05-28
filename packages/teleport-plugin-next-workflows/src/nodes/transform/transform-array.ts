import { NodeHandlerGenerator, handlerToString } from '../types'

async function transform_array(config: any, context: Record<string, unknown>) {
  const operation = config.operation || 'map'
  const input = config.input || []
  const inputs = config.inputs || []
  const separator = config.separator !== undefined ? config.separator : ','
  const start = config.start !== undefined ? Number(config.start) : 0
  const end = config.end
  const chunkSize = config.chunkSize !== undefined ? Number(config.chunkSize) : 1
  const arr = Array.isArray(input) ? input.slice() : []
  const originalLength = arr.length

  const variables: Record<string, unknown> = {}
  if (config.expressionVariables && Array.isArray(config.expressionVariables)) {
    for (let vi = 0; vi < config.expressionVariables.length; vi++) {
      const entry = config.expressionVariables[vi]
      if (entry && typeof entry.name === 'string') {
        variables[entry.name] = entry.value
      }
    }
  }

  const getExpression = (operationField: string): string => {
    return config[operationField] || config.expression || 'return item'
  }

  let result: any

  try {
    switch (operation) {
      case 'map': {
        const mapFn = new Function(
          'item',
          'index',
          'array',
          'variables',
          getExpression('mapExpression')
        )
        result = []
        for (let mi = 0; mi < arr.length; mi++) {
          result.push(mapFn(arr[mi], mi, arr, variables))
        }
        break
      }
      case 'filter': {
        const filterFn = new Function(
          'item',
          'index',
          'array',
          'variables',
          getExpression('filterExpression')
        )
        result = []
        for (let fi = 0; fi < arr.length; fi++) {
          if (filterFn(arr[fi], fi, arr, variables)) {
            result.push(arr[fi])
          }
        }
        break
      }
      case 'reduce': {
        const reduceFn = new Function(
          'accumulator',
          'item',
          'index',
          'array',
          'variables',
          getExpression('reduceExpression')
        )
        const initialValue = config.initialValue
        let acc = initialValue !== undefined ? initialValue : arr.length > 0 ? arr[0] : undefined
        const startIdx = initialValue !== undefined ? 0 : 1
        for (let ri = startIdx; ri < arr.length; ri++) {
          acc = reduceFn(acc, arr[ri], ri, arr, variables)
        }
        result = acc
        break
      }
      case 'find': {
        const findFn = new Function(
          'item',
          'index',
          'array',
          'variables',
          getExpression('findExpression')
        )
        result = undefined
        for (let fdi = 0; fdi < arr.length; fdi++) {
          if (findFn(arr[fdi], fdi, arr, variables)) {
            result = arr[fdi]
            break
          }
        }
        break
      }
      case 'findIndex': {
        const fiFn = new Function(
          'item',
          'index',
          'array',
          'variables',
          getExpression('findExpression')
        )
        result = -1
        for (let fii = 0; fii < arr.length; fii++) {
          if (fiFn(arr[fii], fii, arr, variables)) {
            result = fii
            break
          }
        }
        break
      }
      case 'sort': {
        result = arr.slice()
        const sortExpr = config.sortExpression || config.expression
        if (sortExpr) {
          const sortFn = new Function('item', 'index', 'array', 'variables', sortExpr)
          result.sort(function (a: any, b: any) {
            return sortFn(a, 0, arr, variables) - sortFn(b, 0, arr, variables)
          })
        } else {
          result.sort()
        }
        break
      }
      case 'reverse':
        result = arr.slice().reverse()
        break
      case 'slice': {
        const sliceEnd = end !== undefined ? Number(end) : undefined
        result = sliceEnd !== undefined ? arr.slice(start, sliceEnd) : arr.slice(start)
        break
      }
      case 'concat':
        result = arr
        for (let ci = 0; ci < inputs.length; ci++) {
          const concatArr = Array.isArray(inputs[ci]) ? inputs[ci] : [inputs[ci]]
          result = result.concat(concatArr)
        }
        break
      case 'join':
        result = arr.join(separator)
        break
      case 'includes': {
        if (config.includesExpression) {
          const includesFn = new Function('item', 'index', 'variables', config.includesExpression)
          result = false
          for (let ii = 0; ii < arr.length; ii++) {
            if (includesFn(arr[ii], ii, variables)) {
              result = true
              break
            }
          }
        } else {
          const searchVal =
            config.searchValue !== undefined
              ? config.searchValue
              : config.expression || config.value
          result = false
          for (let ii = 0; ii < arr.length; ii++) {
            if (arr[ii] === searchVal) {
              result = true
              break
            }
          }
        }
        break
      }
      case 'indexOf': {
        const idxVal = config.expression || config.value
        result = -1
        for (let ioi = 0; ioi < arr.length; ioi++) {
          if (arr[ioi] === idxVal) {
            result = ioi
            break
          }
        }
        break
      }
      case 'push': {
        result = arr.slice()
        const pushVal = config.value !== undefined ? config.value : config.expression
        result.push(pushVal)
        break
      }
      case 'pop':
        result = arr.slice()
        result.pop()
        break
      case 'shift':
        result = arr.slice()
        result.shift()
        break
      case 'unshift': {
        result = arr.slice()
        const unshiftVal = config.value !== undefined ? config.value : config.expression
        result.unshift(unshiftVal)
        break
      }
      case 'unique': {
        result = []
        for (let ui = 0; ui < arr.length; ui++) {
          let found = false
          for (let uj = 0; uj < result.length; uj++) {
            if (result[uj] === arr[ui]) {
              found = true
              break
            }
          }
          if (!found) {
            result.push(arr[ui])
          }
        }
        break
      }
      case 'flatten': {
        result = []
        const stack = arr.slice()
        while (stack.length > 0) {
          const flatItem = stack.shift()
          if (Array.isArray(flatItem)) {
            for (let fli = 0; fli < flatItem.length; fli++) {
              stack.push(flatItem[fli])
            }
          } else {
            result.push(flatItem)
          }
        }
        break
      }
      case 'chunk':
        result = []
        for (let chi = 0; chi < arr.length; chi += chunkSize) {
          result.push(arr.slice(chi, chi + chunkSize))
        }
        break
      case 'getFirst':
        result = arr.length > 0 ? arr[0] : undefined
        return { result, operation, originalLength }
      case 'getLast':
        result = arr.length > 0 ? arr[arr.length - 1] : undefined
        return { result, operation, originalLength }
      case 'length':
        result = arr.length
        break
      default:
        return { result: null, error: 'Unknown operation: ' + operation }
    }

    return { result, operation, originalLength }
  } catch (err: unknown) {
    return { result: null, error: (err as Error).message }
  }
}

export const transformArray: NodeHandlerGenerator = {
  nodeType: 'transform-array',
  executionEnv: 'universal',
  generateHandler(): string {
    return handlerToString(transform_array)
  },
}
