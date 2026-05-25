import { NodeHandlerGenerator, handlerToString } from '../types'

async function transform_merge(config: any, context: Record<string, unknown>) {
  const inputs = config.inputs || []
  const mergeStrategy = config.mergeStrategy || 'shallow'
  const arrayHandling = config.arrayHandling || 'replace'
  const nullHandling = config.nullHandling || 'keep'
  const nullReplacement = config.nullReplacement
  let result: any

  function deepMerge(target, source) {
    const output = {}
    const tKeys = Object.keys(target)
    for (let ti = 0; ti < tKeys.length; ti++) {
      output[tKeys[ti]] = target[tKeys[ti]]
    }
    const sKeys = Object.keys(source)
    for (let si = 0; si < sKeys.length; si++) {
      const key = sKeys[si]
      const sVal = source[key]
      const tVal = output[key]
      if (
        sVal !== null &&
        typeof sVal === 'object' &&
        !Array.isArray(sVal) &&
        tVal !== null &&
        typeof tVal === 'object' &&
        !Array.isArray(tVal)
      ) {
        output[key] = deepMerge(tVal, sVal)
      } else if (Array.isArray(sVal) && Array.isArray(tVal)) {
        if (arrayHandling === 'concat') {
          output[key] = tVal.concat(sVal)
        } else {
          output[key] = sVal
        }
      } else {
        if (sVal === null && nullHandling === 'skip') {
          continue
        } else if (sVal === null && nullHandling === 'replace') {
          output[key] = nullReplacement
        } else {
          output[key] = sVal
        }
      }
    }
    return output
  }

  try {
    switch (mergeStrategy) {
      case 'shallow':
        result = {}
        for (let i = 0; i < inputs.length; i++) {
          const obj = inputs[i] || {}
          const objKeys = Object.keys(obj)
          for (let k = 0; k < objKeys.length; k++) {
            const val = obj[objKeys[k]]
            if (val === null && nullHandling === 'skip') {
              continue
            } else if (val === null && nullHandling === 'replace') {
              result[objKeys[k]] = nullReplacement
            } else {
              result[objKeys[k]] = val
            }
          }
        }
        break
      case 'deep':
        result = {}
        for (let di = 0; di < inputs.length; di++) {
          result = deepMerge(result, inputs[di] || {})
        }
        break
      case 'concat':
        if (Array.isArray(inputs[0])) {
          result = []
          for (let ci = 0; ci < inputs.length; ci++) {
            const arr = Array.isArray(inputs[ci]) ? inputs[ci] : [inputs[ci]]
            result = result.concat(arr)
          }
        } else {
          result = {}
          for (let coi = 0; coi < inputs.length; coi++) {
            const cObj = inputs[coi] || {}
            const cKeys = Object.keys(cObj)
            for (let ck = 0; ck < cKeys.length; ck++) {
              if (Array.isArray(result[cKeys[ck]]) && Array.isArray(cObj[cKeys[ck]])) {
                result[cKeys[ck]] = result[cKeys[ck]].concat(cObj[cKeys[ck]])
              } else {
                result[cKeys[ck]] = cObj[cKeys[ck]]
              }
            }
          }
        }
        break
      case 'union':
        result = []
        for (let ui = 0; ui < inputs.length; ui++) {
          const uArr = Array.isArray(inputs[ui]) ? inputs[ui] : [inputs[ui]]
          for (let uj = 0; uj < uArr.length; uj++) {
            let exists = false
            for (let ux = 0; ux < result.length; ux++) {
              if (JSON.stringify(result[ux]) === JSON.stringify(uArr[uj])) {
                exists = true
                break
              }
            }
            if (!exists) {
              result.push(uArr[uj])
            }
          }
        }
        break
      case 'intersection':
        if (inputs.length === 0) {
          result = []
        } else {
          const first = Array.isArray(inputs[0]) ? inputs[0] : [inputs[0]]
          result = first.slice()
          for (let ii = 1; ii < inputs.length; ii++) {
            const other = Array.isArray(inputs[ii]) ? inputs[ii] : [inputs[ii]]
            const filtered = []
            for (let ix = 0; ix < result.length; ix++) {
              let inOther = false
              for (let iy = 0; iy < other.length; iy++) {
                if (JSON.stringify(result[ix]) === JSON.stringify(other[iy])) {
                  inOther = true
                  break
                }
              }
              if (inOther) {
                filtered.push(result[ix])
              }
            }
            result = filtered
          }
        }
        break
      case 'difference':
        if (inputs.length === 0) {
          result = []
        } else {
          result = Array.isArray(inputs[0]) ? inputs[0].slice() : [inputs[0]]
          for (let dfi = 1; dfi < inputs.length; dfi++) {
            const diffArr = Array.isArray(inputs[dfi]) ? inputs[dfi] : [inputs[dfi]]
            const diffResult = []
            for (let dx = 0; dx < result.length; dx++) {
              let inDiff = false
              for (let dy = 0; dy < diffArr.length; dy++) {
                if (JSON.stringify(result[dx]) === JSON.stringify(diffArr[dy])) {
                  inDiff = true
                  break
                }
              }
              if (!inDiff) {
                diffResult.push(result[dx])
              }
            }
            result = diffResult
          }
        }
        break
      default:
        return { result: null, error: 'Unknown merge strategy: ' + mergeStrategy }
    }

    return { result }
  } catch (err: unknown) {
    return { result: null, error: (err as Error).message }
  }
}
export const transformMerge: NodeHandlerGenerator = {
  nodeType: 'transform-merge',
  executionEnv: 'universal',
  generateHandler(): string {
    return handlerToString(transform_merge)
  },
}
