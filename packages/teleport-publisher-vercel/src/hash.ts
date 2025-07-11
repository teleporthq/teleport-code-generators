import fetch, { RequestInit } from 'node-fetch'
import crypto from 'crypto'

const getSubtle = (): SubtleCrypto => {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    return window.crypto.subtle
  }

  if (typeof crypto !== 'undefined' && 'webcrypto' in crypto && crypto.webcrypto?.subtle) {
    return crypto.webcrypto.subtle as SubtleCrypto
  }

  throw new Error('SubtleCrypto is not available in this environment')
}

export const getSHA = async (buf: Buffer | Uint8Array) => {
  const hashBuffer = await getSubtle().digest('SHA-1', buf) // hash the message
  const hashArray = Array.from(new Uint8Array(hashBuffer)) // convert buffer to byte array
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('') // convert bytes to hex string
}

export const getImageBufferFromRemoteUrl = async (content: string, options: RequestInit) => {
  const response = await fetch(content, options)
  const buffer = await response.arrayBuffer()
  return Buffer.from(buffer)
}
