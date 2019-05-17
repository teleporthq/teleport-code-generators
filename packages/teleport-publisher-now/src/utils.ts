import {
  GeneratedFolder,
  GeneratedFile,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { NEXT_CONFIG, NEXT_CONFIG_FILE, DEPLOY_URL, NOW_LINK_PREFIX } from './constants'
import { DEPLOY_FAILED } from './errors'

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

export const publishToNow = async (project: GeneratedFolder, token: string): Promise<string> => {
  const files = generateProjectFiles(project)
  const data = {
    ...NEXT_CONFIG,
    files,
    name: project.name,
  }

  const response = await fetch(DEPLOY_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  })

  const result = await response.json()
  if (result.error) {
    throw new Error(DEPLOY_FAILED)
  }

  return `${NOW_LINK_PREFIX}${result.url}`
}

const generateProjectFiles = (project: GeneratedFolder) => {
  const projectFiles = destructureProjectFiles({
    folder: project,
    ignoreFolder: true,
  })

  return [...projectFiles, NEXT_CONFIG_FILE]
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
