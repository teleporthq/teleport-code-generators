import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_hash_data(config: any, context: Record<string, unknown>) {
  const data = config.data !== undefined ? String(config.data) : ''
  const algorithm = config.algorithm || 'sha256'
  let encoding = config.encoding || 'hex'
  const hmacKey = config.hmacKey || ''

  try {
    const __nodeRequire =
      typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
    const crypto = __nodeRequire('crypto')

    const validAlgorithms: Record<string, boolean> = {
      md5: true,
      sha1: true,
      sha256: true,
      sha512: true,
      sha384: true,
      sha224: true,
      'sha3-256': true,
      'sha3-512': true,
    }
    const algo = algorithm.toLowerCase()

    if (!validAlgorithms[algo]) {
      return {
        hash: null,
        error:
          'Unsupported algorithm: ' +
          algorithm +
          '. Use: md5, sha1, sha224, sha256, sha384, sha512, sha3-256, sha3-512',
      }
    }

    const validEncodings: Record<string, boolean> = { hex: true, base64: true, base64url: true }
    if (!validEncodings[encoding]) {
      encoding = 'hex'
    }

    let hash: string

    if (hmacKey) {
      hash = crypto.createHmac(algo, hmacKey).update(data).digest(encoding)
      return { hash, algorithm: algo, encoding, type: 'hmac' }
    }

    hash = crypto.createHash(algo).update(data).digest(encoding)
    return { hash, algorithm: algo, encoding, type: 'hash' }
  } catch (err: unknown) {
    return { hash: null, error: (err as Error).message }
  }
}
export const utilityHashData: NodeHandlerGenerator = {
  nodeType: 'utility-hash-data',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(utility_hash_data)
  },
}
