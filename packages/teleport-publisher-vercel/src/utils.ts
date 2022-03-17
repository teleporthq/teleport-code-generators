import fetch from 'node-fetch'
import retry from 'async-retry'
import { Agent } from 'https'
import { Sema } from 'async-sema'
import {
  GeneratedFolder,
  VercelDeployResponse,
  VercelDeploymentError,
  VercelDeploymentTimeoutError,
  GeneratedFile,
} from '@teleporthq/teleport-types'
import { ProjectFolderInfo, VercelError, VercelFile, VercelPayload, VercelResponse } from './types'
import { getImageBufferFromRemoteUrl, getSHA } from './hash'

const CREATE_DEPLOY_URL = 'https://api.vercel.com/v13/deployments'
const DELETE_PROJECT_URL = 'https://api.vercel.com/v8/projects'
const UPLOAD_FILES_URL = 'https://api.vercel.com/v2/files'
const CHECK_DEPLOY_BASE_URL = 'https://api.vercel.com/v13/deployments/get?url='

type FileSha = Omit<GeneratedFile, 'content'> & {
  sha: string
  size: number
  isBuffer: boolean
  content: Buffer | string
}

export const generateProjectFiles = async (
  project: GeneratedFolder,
  token: string,
  individualUpload: boolean,
  teamId?: string
): Promise<VercelFile[]> => {
  const projectFilesArray = destructureProjectFiles(
    {
      folder: project,
      ignoreFolder: true,
    },
    token,
    individualUpload,
    teamId
  )

  if (!individualUpload) {
    return projectFilesArray.map((file) => ({
      file: file.name,
      data: file.content,
      encoding: file.contentEncoding,
    }))
  }

  const promises = projectFilesArray.map((key) => generateSha(key))
  const shaProjectFiles: FileSha[] = await Promise.all(promises)

  const vercelUploadFilesURL = teamId ? `${UPLOAD_FILES_URL}?teamId=${teamId}` : UPLOAD_FILES_URL

  const semaphore = new Sema(10, { capacity: 10 })
  const agent = new Agent({ keepAlive: true })

  const shaPromises = shaProjectFiles.map((shaFile) =>
    retry(
      async (bail): Promise<void> => {
        let err

        try {
          await semaphore.acquire()
          const res = await fetch(vercelUploadFilesURL, {
            agent,
            method: 'POST',
            headers: {
              ...(shaFile.isBuffer && { 'Content-Type': 'application/octet-stream' }),
              Authorization: `Bearer ${token}`,
              accept: 'application/json',
              'Content-Length': shaFile.size.toString(),
              'x-now-digest': shaFile.sha,
              'x-now-size': shaFile.size.toString(),
            },
            body: shaFile.content,
          })

          if (res.status === 200) {
            return
          } else if (res.status > 200 && res.status < 500) {
            const { error } = (await res.json()) as VercelError

            err = new Error(error.message)
          } else {
            // If something is wrong with the server, we retry
            const { error } = (await res.json()) as VercelError
            throw new Error(error.message)
          }
        } catch (e) {
          err = new Error(e)
        } finally {
          semaphore.release()
        }

        if (err) {
          if (isClientNetworkError(err)) {
            // If it's a network error, we retry
            throw err
          } else {
            // Otherwise we bail
            return bail(err)
          }
        }
      },
      {
        retries: 5,
        factor: 6,
        minTimeout: 10,
      }
    )
  )

  await Promise.all(shaPromises)

  return shaProjectFiles.map((file) => ({
    file: file.name,
    sha: file.sha,
    size: file.size,
  }))
}

const destructureProjectFiles = (
  folderInfo: ProjectFolderInfo,
  token: string,
  individualUpload: boolean,
  teamId?: string
): GeneratedFile[] => {
  const { folder, prefix = '', files = [], ignoreFolder = false } = folderInfo
  const folderToPutFileTo = ignoreFolder ? '' : `${prefix}${folder.name}/`

  for (const file of folder.files) {
    const fileName = file.fileType
      ? `${folderToPutFileTo}${file.name}.${file.fileType}`
      : `${folderToPutFileTo}${file.name}`

    file.name = fileName
    files.push(file)
  }

  for (const subFolder of folder.subFolders) {
    destructureProjectFiles(
      {
        files,
        folder: subFolder,
        prefix: folderToPutFileTo,
      },
      token,
      individualUpload,
      teamId
    )
  }

  return files
}

const generateSha = async (file: GeneratedFile): Promise<FileSha> => {
  if (file.contentEncoding === 'base64') {
    const image = Buffer.from(file.content, 'base64')
    const hash = await getSHA(image)

    return {
      ...file,
      sha: hash,
      size: image.length,
      isBuffer: true,
      content: image,
    }
  } else if (file.location === 'remote' && !file.fileType && !file.contentEncoding) {
    const image = await getImageBufferFromRemoteUrl(file.content, {
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    })
    const hash = await getSHA(image)

    return {
      ...file,
      sha: hash,
      size: image.byteLength,
      isBuffer: true,
      content: image,
    }
  } else {
    const enc = new TextEncoder()
    const fileData = Buffer.from(enc.encode(file.content))
    const hash = await getSHA(fileData)

    return {
      ...file,
      sha: hash,
      size: hash.length,
      isBuffer: false,
    }
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

  const result = (await response.json()) as VercelResponse
  if ('error' in result) {
    throwErrorFromVercelResponse(result)
  }

  const { id, url, alias } = result as VercelDeployResponse

  return {
    id,
    url,
    alias,
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

  const result = (await response.json()) as VercelResponse
  if ('error' in result) {
    throwErrorFromVercelResponse(result)
  }

  return false
}

export const checkDeploymentStatus = async (deploymentURL: string, teamId?: string) => {
  await new Promise<void>((resolve, reject) => {
    let retries = 60

    const clearHook = setInterval(async () => {
      retries = retries - 1

      const vercelUrl = teamId
        ? `${CHECK_DEPLOY_BASE_URL}${deploymentURL}&teamId=${teamId}`
        : `${CHECK_DEPLOY_BASE_URL}${deploymentURL}`
      const response = await fetch(vercelUrl)
      const result = (await response.json()) as VercelResponse

      if ('error' in result) {
        throwErrorFromVercelResponse(result)
      }

      if ('readyState' in result && result.readyState === 'READY') {
        clearInterval(clearHook)
        return resolve()
      }

      if ('readyState' in result && result.readyState === 'ERROR') {
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

function throwErrorFromVercelResponse(result: VercelError) {
  // https://vercel.com/docs/rest-api#api-basics/errors
  // message fields are designed to be neutral,
  // not contain sensitive information,
  // and can be safely passed down to user interfaces
  const message = result.error.message
    ? result.error.message + JSON.stringify(result.error?.errors)
    : result.error.code
  throw new Error(message)
}

const isClientNetworkError = (err: Error) => {
  if (err.message) {
    // These are common network errors that may happen occasionally and we should retry if we encounter these
    return (
      err.message.includes('ETIMEDOUT') ||
      err.message.includes('ECONNREFUSED') ||
      err.message.includes('ENOTFOUND') ||
      err.message.includes('ECONNRESET') ||
      err.message.includes('EAI_FAIL') ||
      err.message.includes('socket hang up') ||
      err.message.includes('network socket disconnected')
    )
  }

  return false
}
