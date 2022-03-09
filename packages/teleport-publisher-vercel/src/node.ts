import fetch from 'cross-fetch'
import { createHash } from 'crypto'

export const getSHA = async (image: Buffer | Uint8Array) => {
  const hashArray = computeHashArray(createHash('SHA1').update(image).digest())
  return {
    hash: computeSHA(hashArray),
    hashLength: hashArray.length,
  }
}

export const getImageBufferFromase64 = (content: string) => Buffer.from(content, 'base64')

export const getImageBufferFromRemoteUrl = async (content: string, options?: RequestInit) => {
  const response = await fetch(content, options)
  const buffer = await response.arrayBuffer()
  return Buffer.from(buffer)
}

const computeHashArray = (digest: Buffer | ArrayBuffer) => Array.from(new Uint8Array(digest))
const computeSHA = (hashArray: number[]) => {
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}
