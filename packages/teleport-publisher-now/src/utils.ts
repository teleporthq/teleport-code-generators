import fetch from 'cross-fetch'
import {
  GeneratedFolder,
  NowDeployResponse,
  NowServerError,
  NowInvalidTokenError,
  NowUnexpectedError,
  NowDeploymentError,
  NowDeploymentTimeoutError,
  NowRateLimiterError,
  NowProjectTooBigError,
} from '@teleporthq/teleport-types'
import { ProjectFolderInfo, NowFile, NowPayload } from './types'

const CREATE_DEPLOY_URL = 'https://api.vercel.com/v10/now/deployments'
const UPLOAD_FILES_URL = 'https://api.vercel.com/v10/now/files'
const CHECK_DEPLOY_BASE_URL = 'https://api.vercel.com/v10/now/deployments/get?url='

type DeploymentStatus = 'READY' | 'QUEUED' | 'BUILDING' | 'ERROR'

export const generateProjectFiles = async (
  project: GeneratedFolder,
  token: string,
  individualUpload: boolean
): Promise<NowFile[]> => {
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
): Promise<NowFile[]> => {
  const { folder, prefix = '', files = [], ignoreFolder = false } = folderInfo
  const folderToPutFileTo = ignoreFolder ? '' : `${prefix}${folder.name}/`

  for (const file of folder.files) {
    const fileName = file.fileType
      ? `${folderToPutFileTo}${file.name}.${file.fileType}`
      : `${folderToPutFileTo}${file.name}`

    if (individualUpload && file.contentEncoding !== 'base64') {
      // All non-images are uploaded separately
      const { digest, fileSize } = await uploadFile(file.content, token)
      const nowFile: NowFile = {
        file: fileName,
        sha: digest,
        size: fileSize,
      }

      files.push(nowFile)
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
      'x-now-digest': stringSHA,
      Authorization: `Bearer ${token}`,
    },
    body: content,
  })

  if (response.status >= 500) {
    throw new NowServerError()
  }

  const result = await response.json()

  return {
    digest: stringSHA,
    fileSize: hashArray.length,
    result,
  }
}

export const createDeployment = async (
  payload: NowPayload,
  token: string,
  teamId?: string
): Promise<NowDeployResponse> => {
  const nowDeployURL = teamId ? `${CREATE_DEPLOY_URL}?teamId=${teamId}` : CREATE_DEPLOY_URL

  const response = await fetch(nowDeployURL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  if (response.status >= 500) {
    throw new NowServerError()
  }

  const result = await response.json()
  if (result.error) {
    switch (result.error.code) {
      case 'forbidden':
        throw new NowInvalidTokenError()
      // TODO: needs validation / checking
      case 'rate_limited':
        throw new NowRateLimiterError()
      case 'payload_too_large':
        throw new NowProjectTooBigError()
      default:
        throw new NowUnexpectedError(result.error)
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
        reject(new NowDeploymentError())
      }

      if (retries <= 0) {
        clearInterval(clearHook)
        reject(new NowDeploymentTimeoutError())
      }
    }, 5000)
  })
}

export const checkDeploymentReady = async (deploymentURL: string): Promise<DeploymentStatus> => {
  try {
    const nowUrl = `${CHECK_DEPLOY_BASE_URL}${deploymentURL}`
    const result = await fetch(nowUrl)
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
