import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_encode_decode(config: any, context: Record<string, unknown>) {
  const data = config.data !== undefined ? String(config.data) : ''
  const operation = config.operation || 'base64-encode'
  let result: any

  if (!data && operation !== 'json-encode') {
    return { result: '', error: null }
  }

  try {
    switch (operation) {
      case 'base64-encode':
        result = Buffer.from(data, 'utf-8').toString('base64')
        break
      case 'base64-decode':
        result = Buffer.from(data, 'base64').toString('utf-8')
        break
      case 'base64url-encode':
        result = Buffer.from(data, 'utf-8').toString('base64url')
        break
      case 'base64url-decode':
        result = Buffer.from(data, 'base64url').toString('utf-8')
        break
      case 'url-encode':
        result = encodeURIComponent(data)
        break
      case 'url-decode':
        result = decodeURIComponent(data)
        break
      case 'url-encode-full':
        result = encodeURI(data)
        break
      case 'url-decode-full':
        result = decodeURI(data)
        break
      case 'html-encode':
        result = data
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;')
        break
      case 'html-decode':
        result = data
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&gt;/g, '>')
          .replace(/&lt;/g, '<')
          .replace(/&amp;/g, '&')
        break
      case 'hex-encode':
        result = Buffer.from(data, 'utf-8').toString('hex')
        break
      case 'hex-decode':
        result = Buffer.from(data, 'hex').toString('utf-8')
        break
      case 'json-encode':
        const jsonInput = config.data
        result = JSON.stringify(jsonInput)
        break
      case 'json-decode':
        result = JSON.parse(data)
        break
      case 'unicode-escape':
        result = ''
        for (let i = 0; i < data.length; i++) {
          const code = data.charCodeAt(i)
          if (code > 127) {
            result += '\\u' + ('0000' + code.toString(16)).slice(-4)
          } else {
            result += data.charAt(i)
          }
        }
        break
      case 'unicode-unescape':
        result = data.replace(/\\u([0-9a-fA-F]{4})/g, function (_: string, hex: string) {
          return String.fromCharCode(parseInt(hex, 16))
        })
        break
      default:
        return {
          result: null,
          error:
            'Unknown operation: ' +
            operation +
            '. Supported: base64-encode, base64-decode, base64url-encode, base64url-decode, url-encode, url-decode, url-encode-full, url-decode-full, html-encode, html-decode, hex-encode, hex-decode, json-encode, json-decode, unicode-escape, unicode-unescape',
        }
    }

    return { result }
  } catch (err: unknown) {
    return { result: null, error: (err as Error).message }
  }
}
export const utilityEncodeDecode: NodeHandlerGenerator = {
  nodeType: 'utility-encode-decode',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(utility_encode_decode)
  },
}
