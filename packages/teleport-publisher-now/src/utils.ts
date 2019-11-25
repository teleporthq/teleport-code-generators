import fetch from 'cross-fetch'
import { GeneratedFolder, GeneratedFile } from '@teleporthq/teleport-types'
import { ProjectFolderInfo, NowFile, NowPayload } from './types'
import { GENERIC_ERROR } from './errors'

const CREATE_DEPLOY_URL = 'https://api.zeit.co/v10/now/deployments'
const CHECK_DEPLOY_BASE_URL = 'https://api.zeit.co/v10/now/deployments/get?url='

type DeploymentStatus = 'READY' | 'QUEUED' | 'BUILDING' | 'ERROR'

export const generateProjectFiles = (project: GeneratedFolder): NowFile[] => {
  return destructureProjectFiles({
    folder: project,
    ignoreFolder: true,
  })
}

const destructureProjectFiles = (folderInfo: ProjectFolderInfo): NowFile[] => {
  const { folder, prefix = '', files = [], ignoreFolder = false } = folderInfo
  const folderToPutFileTo = ignoreFolder ? '' : `${prefix}${folder.name}/`

  folder.files.forEach((file: GeneratedFile) => {
    const fileName = file.fileType
      ? `${folderToPutFileTo}${file.name}.${file.fileType}`
      : `${folderToPutFileTo}${file.name}`

    const nowFile: NowFile = {
      file: fileName,
      data: file.content,
    }

    if (file.contentEncoding) {
      nowFile.encoding = file.contentEncoding
    }

    files.push(nowFile)
  })

  folder.subFolders.forEach((subfolder: GeneratedFolder) => {
    const subfolderInfo: ProjectFolderInfo = {
      files,
      folder: subfolder,
      prefix: folderToPutFileTo,
    }
    destructureProjectFiles(subfolderInfo)
  })

  return files
}

export const createDeployment = async (payload: NowPayload, token: string): Promise<string> => {
  const response = await fetch(CREATE_DEPLOY_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  const result = await response.json()
  if (result.error) {
    throw new Error(JSON.stringify(result.error))
  }

  return result.url
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
        reject(GENERIC_ERROR)
      }

      if (retries <= 0) {
        clearInterval(clearHook)
        reject(GENERIC_ERROR)
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
