import fetch, { RequestInit } from 'node-fetch'
import { webcrypto } from 'crypto'

export const getSHA = async (buf: Buffer | Uint8Array) => {
  const hashBuffer = await webcrypto.subtle.digest('SHA-1', buf) // hash the message
  const hashArray = Array.from(new Uint8Array(hashBuffer)) // convert buffer to byte array
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('') // convert bytes to hex string
}

export const getImageBufferFromRemoteUrl = async (content: string, options: RequestInit) => {
  const response = await fetch(content, options)
  const buffer = await response.arrayBuffer()
  return Buffer.from(buffer)
}
