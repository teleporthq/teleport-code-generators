import { NodeHandlerGenerator, handlerToString } from '../types'

async function transform_object(config: any, context: Record<string, unknown>) {
  const operation = config.operation || 'merge'
  const input = config.input || {}
  const inputs = config.inputs || []
  const keys = config.keys || []
  const key = config.key || ''
  const value = config.value
  const path = config.path || ''
  const defaultValue = config.defaultValue
  let result: any

  try {
    switch (operation) {
      case 'merge':
        result = {}
        const allObjs = [input].concat(inputs)
        for (let mi = 0; mi < allObjs.length; mi++) {
          const obj = allObjs[mi] || {}
          const objKeys = Object.keys(obj)
          for (let mk = 0; mk < objKeys.length; mk++) {
            result[objKeys[mk]] = obj[objKeys[mk]]
          }
        }
        break
      case 'pick':
        result = {}
        for (let pi = 0; pi < keys.length; pi++) {
          if (input.hasOwnProperty(keys[pi])) {
            result[keys[pi]] = input[keys[pi]]
          }
        }
        break
      case 'omit':
        result = {}
        const inputKeys = Object.keys(input)
        for (let oi = 0; oi < inputKeys.length; oi++) {
          let shouldOmit = false
          for (let ok = 0; ok < keys.length; ok++) {
            if (inputKeys[oi] === keys[ok]) {
              shouldOmit = true
              break
            }
          }
          if (!shouldOmit) {
            result[inputKeys[oi]] = input[inputKeys[oi]]
          }
        }
        break
      case 'keys':
        result = Object.keys(input)
        break
      case 'values':
        const vKeys = Object.keys(input)
        result = []
        for (let vi = 0; vi < vKeys.length; vi++) {
          result.push(input[vKeys[vi]])
        }
        break
      case 'entries':
        const eKeys = Object.keys(input)
        result = []
        for (let ei = 0; ei < eKeys.length; ei++) {
          result.push([eKeys[ei], input[eKeys[ei]]])
        }
        break
      case 'get':
        const pathParts = path ? path.split('.') : [key]
        let current = input
        for (let gi = 0; gi < pathParts.length; gi++) {
          if (current === null || current === undefined) {
            current = undefined
            break
          }
          current = current[pathParts[gi]]
        }
        result = current !== undefined ? current : defaultValue
        break
      case 'set':
        result = JSON.parse(JSON.stringify(input))
        const setParts = path ? path.split('.') : [key]
        let setTarget = result
        for (let si = 0; si < setParts.length - 1; si++) {
          if (setTarget[setParts[si]] === undefined || setTarget[setParts[si]] === null) {
            setTarget[setParts[si]] = {}
          }
          setTarget = setTarget[setParts[si]]
        }
        setTarget[setParts[setParts.length - 1]] = value
        break
      case 'delete':
        result = JSON.parse(JSON.stringify(input))
        const delParts = path ? path.split('.') : [key]
        let delTarget = result
        for (let di = 0; di < delParts.length - 1; di++) {
          if (delTarget[delParts[di]] === undefined) {
            break
          }
          delTarget = delTarget[delParts[di]]
        }
        delete delTarget[delParts[delParts.length - 1]]
        break
      case 'has':
        const hasParts = path ? path.split('.') : [key]
        let hasCurrent = input
        result = true
        for (let hi = 0; hi < hasParts.length; hi++) {
          if (
            hasCurrent === null ||
            hasCurrent === undefined ||
            !hasCurrent.hasOwnProperty(hasParts[hi])
          ) {
            result = false
            break
          }
          hasCurrent = hasCurrent[hasParts[hi]]
        }
        break
      case 'assign':
        result = {}
        const assignKeys = Object.keys(input)
        for (let ai = 0; ai < assignKeys.length; ai++) {
          result[assignKeys[ai]] = input[assignKeys[ai]]
        }
        for (let aj = 0; aj < inputs.length; aj++) {
          const srcObj = inputs[aj] || {}
          const srcKeys = Object.keys(srcObj)
          for (let ak = 0; ak < srcKeys.length; ak++) {
            result[srcKeys[ak]] = srcObj[srcKeys[ak]]
          }
        }
        break
      case 'clone':
        result = JSON.parse(JSON.stringify(input))
        break
      case 'freeze':
        result = Object.freeze(JSON.parse(JSON.stringify(input)))
        break
      case 'seal':
        result = Object.seal(JSON.parse(JSON.stringify(input)))
        break
      case 'stringify':
        result = JSON.stringify(input)
        break
      default:
        return { result: null, error: 'Unknown operation: ' + operation }
    }

    return { result }
  } catch (err: unknown) {
    return { result: null, error: (err as Error).message }
  }
}
export const transformObject: NodeHandlerGenerator = {
  nodeType: 'transform-object',
  executionEnv: 'universal',
  generateHandler(): string {
    return handlerToString(transform_object)
  },
}
