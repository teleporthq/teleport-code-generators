import fetch from 'cross-fetch'
import {
  GeneratedFolder,
  VercelDeployResponse,
  VercelServerError,
  VercelDeploymentError,
  VercelDeploymentTimeoutError,
  GeneratedFile,
} from '@teleporthq/teleport-types'
import { ProjectFolderInfo, VercelFile, VercelPayload } from './types'

const CREATE_DEPLOY_URL = 'https://api.vercel.com/v12/now/deployments'
const DELETE_PROJECT_URL = 'https://api.vercel.com/v8/projects'
const UPLOAD_FILES_URL = 'https://api.vercel.com/v2/now/files'
const CHECK_DEPLOY_BASE_URL = 'https://api.vercel.com/v11/now/deployments/get?url='

export const generateProjectFiles = async (
  project: GeneratedFolder,
  token: string,
  individualUpload: boolean
): Promise<VercelFile[]> => {
  return destructureProjectFiles(
    {
      folder: project,
      ignoreFolder: true,
    },
    token,
    individualUpload
  )
}

const destructureProjectFiles = async (
  folderInfo: ProjectFolderInfo,
  token: string,
  individualUpload: boolean
): Promise<VercelFile[]> => {
  const { folder, prefix = '', files = [], ignoreFolder = false } = folderInfo
  const folderToPutFileTo = ignoreFolder ? '' : `${prefix}${folder.name}/`

  for (const file of folder.files) {
    const fileName = file.fileType
      ? `${folderToPutFileTo}${file.name}.${file.fileType}`
      : `${folderToPutFileTo}${file.name}`

    if (individualUpload) {
      const { digest, fileSize } = await uploadFile(file, token)
      const vercelFile: VercelFile = {
        file: fileName,
        sha: digest,
        size: fileSize,
      }

      files.push(vercelFile)
      continue
    }

    files.push({
      file: fileName,
      data: file.content,
      encoding: file.contentEncoding,
    })
  }

  for (const subFolder of folder.subFolders) {
    await destructureProjectFiles(
      {
        files,
        folder: subFolder,
        prefix: folderToPutFileTo,
      },
      token,
      individualUpload
    )
  }

  return files
}

const uploadFile = async (
  file: GeneratedFile,
  token: string
): Promise<{ digest: string; fileSize: number; result: unknown }> => {
  // @ts-ignore
  const module: typeof import('./browser') = await import('#builtins').then((mod) => mod)
  const { getImageBufferFromRemoteUrl, getSHA, getImageBufferFromase64 } = module

  if (file.contentEncoding === 'base64') {
    const image = getImageBufferFromase64(file.content)
    const { hash } = await getSHA(image)

    const uploadResponse = await makeRequest(token, hash, image, true)
    const uploadResponseResult = await uploadResponse.json()

    return {
      digest: hash,
      fileSize: image.length,
      result: uploadResponseResult,
    }
  }

  if (file.location === 'remote' && !file.fileType && !file.contentEncoding) {
    const image = await getImageBufferFromRemoteUrl(file.content)
    const { hash: digest } = await getSHA(image)

    const uploadResponse = await makeRequest(token, digest, image, true)
    if (uploadResponse.status >= 500) {
      throw new VercelServerError()
    }

    const uploadResponseResult = await uploadResponse.json()

    return {
      digest,
      fileSize: image.byteLength,
      result: uploadResponseResult,
    }
  }

  const enc = new TextEncoder()
  const fileData = enc.encode(file.content)
  const { hash: shaHash, hashLength } = await getSHA(fileData)

  const response = await makeRequest(token, shaHash, file.content)

  if (response.status >= 500) {
    throw new VercelServerError()
  }

  const result = await response.json()

  return {
    digest: shaHash,
    fileSize: hashLength,
    result,
  }
}

export const createDeployment = async (
  payload: VercelPayload,
  token: string,
  teamId?: string
): Promise<VercelDeployResponse> => {
  const vercelDeployURL = teamId ? `${CREATE_DEPLOY_URL}?teamId=${teamId}` : CREATE_DEPLOY_URL

  const response = await fetch(vercelDeployURL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  const result = await response.json()
  if (result.error) {
    throwErrorFromVercelResponse(result)
  }

  return {
    url: result.url,
    alias: result.alias,
  }
}

export const removeProject = async (
  token: string,
  projectSlug: string,
  teamId?: string
): Promise<boolean> => {
  const vercelDeployURL = teamId
    ? `${DELETE_PROJECT_URL}/${projectSlug}?teamId=${teamId}`
    : `${DELETE_PROJECT_URL}/${projectSlug}`

  const response = await fetch(vercelDeployURL, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (response.status === 204) {
    return true
  }

  const result = await response.json()
  if (result.error) {
    throwErrorFromVercelResponse(result)
  }

  return false
}

export const checkDeploymentStatus = async (deploymentURL: string) => {
  await new Promise<void>((resolve, reject) => {
    let retries = 60

    const clearHook = setInterval(async () => {
      retries = retries - 1

      const vercelUrl = `${CHECK_DEPLOY_BASE_URL}${deploymentURL}`
      const result = await fetch(vercelUrl)
      const response = await result.json()

      if (response.error) {
        throwErrorFromVercelResponse(response)
      }

      if (response.readyState === 'READY') {
        clearInterval(clearHook)
        return resolve()
      }

      if (response.readyState === 'ERROR') {
        clearInterval(clearHook)
        reject(new VercelDeploymentError())
      }

      if (retries <= 0) {
        clearInterval(clearHook)
        reject(new VercelDeploymentTimeoutError())
      }
    }, 5000)
  })
}

export const makeRequest = async (
  token: string,
  stringSHA: string,
  content: string | Buffer | ArrayBuffer,
  isBuffer = false
) => {
  const response = await fetch(UPLOAD_FILES_URL, {
    method: 'POST',
    headers: {
      ...(isBuffer && { 'Content-Type': 'application/octet-stream' }),
      Authorization: `Bearer ${token}`,
      'x-vercel-digest': stringSHA,
    },
    body: content,
  })

  if (response.status !== 200) {
    const result = await response.json()
    throwErrorFromVercelResponse(result)
  }

  return response
}

function throwErrorFromVercelResponse(result: { error: { code: string; message?: string } }) {
  // https://vercel.com/docs/rest-api#api-basics/errors
  // message fields are designed to be neutral,
  // not contain sensitive information,
  // and can be safely passed down to user interfaces
  const message = result.error.message ? result.error.message : result.error.code
  throw new Error(message)
}
