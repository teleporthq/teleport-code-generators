import fetch from 'cross-fetch'

export const getSHA = async (image: Uint8Array | ArrayBuffer) => {
  const hash = await crypto.subtle.digest('SHA-1', image)
  const hashArray = computeHashArray(hash)
  return {
    hash: computeSHA(hashArray),
    hashLength: hashArray.length,
  }
}

export const getImageBufferFromase64 = (content: string) =>
  Uint8Array.from(atob(content), (c) => c.charCodeAt(0))

export const getImageBufferFromRemoteUrl = async (content: string) => {
  const response = await fetch(content)
  const imageBuffer = await response.arrayBuffer()
  return imageBuffer
}

const computeHashArray = (digest: Buffer | ArrayBuffer) => Array.from(new Uint8Array(digest))
const computeSHA = (hashArray: number[]) => {
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}
