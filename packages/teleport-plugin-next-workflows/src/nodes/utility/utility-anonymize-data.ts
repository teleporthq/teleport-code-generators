import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_anonymize_data(config: any, context: Record<string, unknown>) {
  const data = config.data
  const fields = config.fields || []
  const strategy = config.strategy || 'mask'
  const fieldStrategies = config.fieldStrategies || {}

  if (data === undefined || data === null) {
    return { result: null, error: 'No data provided' }
  }

  try {
    let result = JSON.parse(JSON.stringify(data))

    function anonymizeValue(val: any, strat: string): any {
      if (val === null || val === undefined) {
        return val
      }
      const strVal = String(val)

      switch (strat) {
        case 'mask': {
          if (strVal.indexOf('@') !== -1) {
            const atIndex = strVal.indexOf('@')
            const local = strVal.substring(0, atIndex)
            const domain = strVal.substring(atIndex)
            if (local.length <= 2) {
              return '**' + domain
            }
            return (
              local.charAt(0) +
              new Array(local.length - 1).join('*') +
              local.charAt(local.length - 1) +
              domain
            )
          }
          if (/^\+?[\d\s\-\(\)\.]{7,}$/.test(strVal)) {
            const digits = strVal.replace(/[^\d]/g, '')
            if (digits.length >= 4) {
              return (
                strVal.substring(0, strVal.length - 4).replace(/\d/g, '*') +
                strVal.substring(strVal.length - 4)
              )
            }
          }
          if (strVal.length <= 2) {
            return '**'
          }
          return (
            strVal.charAt(0) +
            new Array(strVal.length - 1).join('*') +
            strVal.charAt(strVal.length - 1)
          )
        }
        case 'redact':
          return '[REDACTED]'
        case 'hash': {
          let hash = 5381
          const uint32mod = 0x100000000
          for (let i = 0; i < strVal.length; i++) {
            hash = hash * 32 + hash + strVal.charCodeAt(i)
            hash = ((hash % uint32mod) + uint32mod) % uint32mod
          }
          return 'anon_' + Math.abs(hash).toString(16)
        }
        case 'randomize': {
          if (typeof val === 'number') {
            const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(val) || 1)))
            return Math.floor(Math.random() * 9 * magnitude + magnitude)
          }
          const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
          let randomized = ''
          for (let r = 0; r < strVal.length; r++) {
            randomized += chars.charAt(Math.floor(Math.random() * chars.length))
          }
          return randomized
        }
        case 'remove':
          return undefined
        case 'partial-mask': {
          if (strVal.length <= 4) {
            return '****'
          }
          const visibleCount = Math.max(1, Math.floor(strVal.length / 4))
          return (
            strVal.substring(0, visibleCount) +
            new Array(strVal.length - visibleCount * 2 + 1).join('*') +
            strVal.substring(strVal.length - visibleCount)
          )
        }
        case 'generalize': {
          if (typeof val === 'number') {
            const bucket = Math.pow(10, Math.floor(Math.log10(Math.abs(val) || 1)))
            return (
              Math.floor(val / bucket) * bucket +
              '-' +
              (Math.floor(val / bucket) * bucket + bucket - 1)
            )
          }
          return strVal.charAt(0) + '***'
        }
        case 'nullify':
          return null
        default:
          return '[ANONYMIZED]'
      }
    }

    function anonymizeObject(
      obj: any,
      fieldList: string[],
      defaultStrat: string,
      perFieldStrats: Record<string, string>
    ): any {
      if (typeof obj !== 'object' || obj === null) {
        return obj
      }

      if (Array.isArray(obj)) {
        for (let ai = 0; ai < obj.length; ai++) {
          obj[ai] = anonymizeObject(obj[ai], fieldList, defaultStrat, perFieldStrats)
        }
        return obj
      }

      const keys = Object.keys(obj)
      for (let k = 0; k < keys.length; k++) {
        let shouldAnonymize = false
        if (fieldList.length === 0) {
          shouldAnonymize = false
        } else {
          for (let f = 0; f < fieldList.length; f++) {
            if (keys[k] === fieldList[f]) {
              shouldAnonymize = true
              break
            }
            if (fieldList[f].indexOf('.') !== -1) {
              const pathParts = fieldList[f].split('.')
              if (pathParts[pathParts.length - 1] === keys[k]) {
                shouldAnonymize = true
                break
              }
            }
          }
        }

        if (shouldAnonymize) {
          const fieldStrat = perFieldStrats[keys[k]] || defaultStrat
          const anonVal = anonymizeValue(obj[keys[k]], fieldStrat)
          if (anonVal === undefined) {
            delete obj[keys[k]]
          } else {
            obj[keys[k]] = anonVal
          }
        } else if (typeof obj[keys[k]] === 'object' && obj[keys[k]] !== null) {
          obj[keys[k]] = anonymizeObject(obj[keys[k]], fieldList, defaultStrat, perFieldStrats)
        }
      }
      return obj
    }

    result = anonymizeObject(result, fields, strategy, fieldStrategies)
    return { result }
  } catch (err: unknown) {
    return { result: null, error: (err as Error).message }
  }
}
export const utilityAnonymizeData: NodeHandlerGenerator = {
  nodeType: 'utility-anonymize-data',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(utility_anonymize_data)
  },
}
