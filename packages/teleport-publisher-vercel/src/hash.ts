import fetch, { RequestInit } from 'node-fetch'
import { createHash } from 'crypto'

export const getSHA = async (buf: Buffer) => {
  return createHash('sha1').update(buf).digest('hex')
}

export const getImageBufferFromRemoteUrl = async (content: string, options: RequestInit) => {
  const response = await fetch(content, options)
  const buffer = await response.arrayBuffer()
  return Buffer.from(buffer)
}
