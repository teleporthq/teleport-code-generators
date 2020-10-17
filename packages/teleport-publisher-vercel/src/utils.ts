import fetch from 'cross-fetch'
import {
  GeneratedFolder,
  VercelDeployResponse,
  VercelServerError,
  VercelInvalidTokenError,
  VercelUnexpectedError,
  VercelDeploymentError,
  VercelDeploymentTimeoutError,
  VercelRateLimiterError,
  VercelProjectTooBigError,
} from '@teleporthq/teleport-types'
import { ProjectFolderInfo, VercelFile, VercelPayload } from './types'

const CREATE_DEPLOY_URL = 'https://api.vercel.com/v10/now/deployments'
const UPLOAD_FILES_URL = 'https://api.vercel.com/v10/now/files'
const CHECK_DEPLOY_BASE_URL = 'https://api.vercel.com/v10/now/deployments/get?url='

type DeploymentStatus = 'READY' | 'QUEUED' | 'BUILDING' | 'ERROR'

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

    if (individualUpload && file.contentEncoding !== 'base64') {
      // All non-images are uploaded separately
      const { digest, fileSize } = await uploadFile(file.content, token)
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

export const uploadFile = async (
  content: string,
  token: string
): Promise<{ digest: string; fileSize: number; result: unknown }> => {
  const enc = new TextEncoder()

  const fileData = enc.encode(content)
  const digest = await crypto.subtle.digest('SHA-1', fileData)
  const hashArray = Array.from(new Uint8Array(digest))
  const stringSHA = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

  const response = await fetch(UPLOAD_FILES_URL, {
    method: 'POST',
    headers: {
      'x-vercel-digest': stringSHA,
      Authorization: `Bearer ${token}`,
    },
    body: content,
  })

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

  if (response.status >= 500) {
    throw new VercelServerError()
  }

  const result = await response.json()
  if (result.error) {
    switch (result.error.code) {
      case 'forbidden':
        throw new VercelInvalidTokenError()
      // TODO: needs validation / checking
      case 'rate_limited':
        throw new VercelRateLimiterError()
      case 'payload_too_large':
        throw new VercelProjectTooBigError()
      default:
        throw new VercelUnexpectedError(result.error)
    }
  }

  return {
    url: result.url,
    alias: result.alias,
  }
}

export const checkDeploymentStatus = async (deploymentURL: string) => {
  await new Promise((resolve, reject) => {
    let retries = 60

    const clearHook = setInterval(async () => {
      retries = retries - 1

      const readyState = await checkDeploymentReady(deploymentURL)
      if (readyState === 'READY') {
        clearInterval(clearHook)
        return resolve()
      }

      if (readyState === 'ERROR') {
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

export const checkDeploymentReady = async (deploymentURL: string): Promise<DeploymentStatus> => {
  try {
    const vercelUrl = `${CHECK_DEPLOY_BASE_URL}${deploymentURL}`
    const result = await fetch(vercelUrl)
    const jsonResult = await result.json()
    if (jsonResult.readyState) {
      return jsonResult.readyState
    } else {
      return 'ERROR'
    }
  } catch (err) {
    console.warn(err)
    return 'ERROR'
  }
}
