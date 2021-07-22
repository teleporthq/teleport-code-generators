import { GeneratedFile } from '@teleporthq/teleport-types'
import fetch from 'cross-fetch'
import { createHash } from 'crypto'
import { computeSHA, computeHashArray, makeRequest } from './utils'

export const uploadFile = async (
  file: GeneratedFile,
  token: string
): Promise<{ digest: string; fileSize: number; result: unknown }> => {
  console.warn(`Uploading from node ${file.name}`)

  if (file.contentEncoding === 'base64') {
    const image = Buffer.from(file.content, 'base64')
    const hashArray = computeHashArray(computeHash(image))
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
    const buffer = await response.arrayBuffer()
    const imageBuffer = Buffer.from(buffer)

    const hashArray = computeHashArray(computeHash(imageBuffer))
    const stringSHA = computeSHA(hashArray)

    const uploadResponse = await makeRequest(token, stringSHA, imageBuffer, true)
    const uploadResponseResult = await uploadResponse.json()

    return {
      digest: stringSHA,
      fileSize: imageBuffer.length,
      result: uploadResponseResult,
    }
  }

  const enc = new TextEncoder()
  const fileData = enc.encode(file.content)

  const hashArray = computeHashArray(computeHash(fileData))
  const stringSHA = computeSHA(hashArray)

  const response = await makeRequest(token, stringSHA, file.content)
  const result = await response.json()

  return {
    digest: stringSHA,
    fileSize: hashArray.length,
    result,
  }
}

const computeHash = (data: string | Uint8Array | Buffer) => createHash('SHA1').update(data).digest()
