import { VercelServerError, GeneratedFile } from '@teleporthq/teleport-types'
import { makeRequest, computeHashArray, computeSHA } from './utils'
import fetch from 'cross-fetch'

export const uploadFile = async (
  file: GeneratedFile,
  token: string
): Promise<{ digest: string; fileSize: number; result: unknown }> => {
  console.warn(`Uploading from browser ${file.name}`)

  if (file.contentEncoding === 'base64') {
    const image = Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0))
    const hash = await computeHash(image)
    const hashArray = computeHashArray(hash)
    const stringSHA = computeSHA(hashArray)

    const uploadResponse = await makeRequest(token, stringSHA, image, true)
    const uploadResponseResult = await uploadResponse.json()

    return {
      digest: stringSHA,
      fileSize: image.length,
      result: uploadResponseResult,
    }
  }

  if (file.location === 'remote' && !file.fileType && !file.contentEncoding) {
    const response = await fetch(file.content)
    const image = await response.arrayBuffer()
    const hash = await computeHash(image)
    const hashArray = computeHashArray(hash)
    const stringSHA = computeSHA(hashArray)

    const uploadResponse = await makeRequest(token, stringSHA, image, true)
    const uploadResponseResult = await uploadResponse.json()

    return {
      digest: stringSHA,
      fileSize: image.byteLength,
      result: uploadResponseResult,
    }
  }

  const enc = new TextEncoder()
  const fileData = enc.encode(file.content)
  const digest = await computeHash(fileData)
  const hashArray = computeHashArray(digest)
  const stringSHA = computeSHA(hashArray)

  const response = await makeRequest(token, stringSHA, file.content)

  if (response.status >= 500) {
    throw new VercelServerError()
  }

  const result = await response.json()

  return {
    digest: stringSHA,
    fileSize: hashArray.length,
    result,
  }
}

const computeHash = (data: ArrayBuffer) => crypto.subtle.digest('SHA-1', data)
