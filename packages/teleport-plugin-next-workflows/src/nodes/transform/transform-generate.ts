import { NodeHandlerGenerator, handlerToString } from '../types'

async function transform_generate(config: any, context: Record<string, unknown>) {
  const generateType = config.generateType || 'uuid'
  const length = config.length !== undefined ? Number(config.length) : 16
  const charset = config.charset || 'alphanumeric'
  const min = config.min !== undefined ? Number(config.min) : 0
  const max = config.max !== undefined ? Number(config.max) : 100
  const dateFormat = config.dateFormat || 'iso'
  const hashAlgorithm = config.hashAlgorithm || 'sha256'
  const hashInput = config.hashInput || ''
  const sequenceStart = config.sequenceStart !== undefined ? Number(config.sequenceStart) : 1
  const sequenceKey = config.sequenceKey || 'default'
  let result: any

  try {
    switch (generateType) {
      case 'uuid':
        const hex = []
        const hexChars = '0123456789abcdef'
        for (let i = 0; i < 36; i++) {
          if (i === 8 || i === 13 || i === 18 || i === 23) {
            hex.push('-')
          } else if (i === 14) {
            hex.push('4')
          } else if (i === 19) {
            hex.push(hexChars.charAt(Math.floor(Math.random() * 4) + 8))
          } else {
            hex.push(hexChars.charAt(Math.floor(Math.random() * 16)))
          }
        }
        result = hex.join('')
        break
      case 'random-number':
        result = min + Math.random() * (max - min)
        if (Number.isInteger(min) && Number.isInteger(max)) {
          result = Math.floor(result)
        }
        break
      case 'random-string':
        let chars = ''
        if (charset === 'alphanumeric' || charset === 'alpha') {
          chars += 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
        }
        if (charset === 'alphanumeric' || charset === 'numeric') {
          chars += '0123456789'
        }
        if (charset === 'hex') {
          chars = '0123456789abcdef'
        }
        if (!chars) {
          chars = charset
        }
        result = ''
        for (let ri = 0; ri < length; ri++) {
          result += chars.charAt(Math.floor(Math.random() * chars.length))
        }
        break
      case 'timestamp':
        result = Date.now()
        break
      case 'date':
        const now = new Date()
        if (dateFormat === 'iso') {
          result = now.toISOString()
        } else if (dateFormat === 'unix') {
          result = Math.floor(now.getTime() / 1000)
        } else if (dateFormat === 'date-only') {
          result = now.toISOString().split('T')[0]
        } else if (dateFormat === 'time-only') {
          result = now.toISOString().split('T')[1].split('.')[0]
        } else {
          result = now.toISOString()
        }
        break
      case 'hash':
        if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
          const encoder = new TextEncoder()
          const data = encoder.encode(hashInput)
          const algo =
            hashAlgorithm === 'sha256'
              ? 'SHA-256'
              : hashAlgorithm === 'sha512'
              ? 'SHA-512'
              : 'SHA-256'
          const hashBuffer = await globalThis.crypto.subtle.digest(algo, data)
          const hashArray = new Uint8Array(hashBuffer)
          let hashHex = ''
          for (let hi = 0; hi < hashArray.length; hi++) {
            const byte = hashArray[hi].toString(16)
            hashHex += byte.length === 1 ? '0' + byte : byte
          }
          result = hashHex
        } else {
          result = null
        }
        break
      case 'sequence':
        if (!context.__sequences) {
          context.__sequences = {}
        }
        if (context.__sequences[sequenceKey] === undefined) {
          context.__sequences[sequenceKey] = sequenceStart
        } else {
          context.__sequences[sequenceKey]++
        }
        result = context.__sequences[sequenceKey]
        break
      default:
        return { value: null, result: null, error: 'Unknown generate type: ' + generateType }
    }

    // The declared output contract (node-context-schemas) is
    // `{ value, type, timestamp }` — workflow builders and AI-generated
    // workflows read `.value`. Emit that (plus `result` as a defensive alias).
    return { value: result, result, type: generateType, timestamp: Date.now() }
  } catch (err: unknown) {
    return { value: null, result: null, error: (err as Error).message }
  }
}
export const transformGenerate: NodeHandlerGenerator = {
  nodeType: 'transform-generate',
  executionEnv: 'universal',
  generateHandler(): string {
    return handlerToString(transform_generate)
  },
}
