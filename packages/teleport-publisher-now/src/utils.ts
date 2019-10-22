import fetch from 'cross-fetch'
import { GeneratedFolder, GeneratedFile } from '@teleporthq/teleport-types'
import { NOW_CONFIG, DEPLOY_URL, NOW_LINK_PREFIX } from './constants'

interface ProjectFolderInfo {
  folder: GeneratedFolder
  prefix?: string
  files?: NowFile[]
  ignoreFolder?: boolean
}

interface NowFile {
  file: string
  data: Blob | string
  encoding?: string
}

interface NowFiles {
  files: NowFile[]
  name: string
}

export const generateProjectFiles = (project: GeneratedFolder): NowFiles => {
  const files = destructureProjectFiles({
    folder: project,
    ignoreFolder: true,
  })

  return {
    ...NOW_CONFIG,
    files,
    name: project.name,
  }
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

export const publishToNow = async (projectFiles: NowFiles, token: string): Promise<string> => {
  const response = await fetch(DEPLOY_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(projectFiles),
  })

  const result = await response.json()
  if (result.error) {
    throw new Error(result.error.message)
  }

  return `${NOW_LINK_PREFIX}${result.url}`
}
