import { createGithubGateway } from '@teleporthq/teleport-github-gateway'

import {
  AssetsDefinition,
  AssetInfo,
  GeneratedFolder,
  GeneratedFile,
  RemoteTemplateDefinition,
} from '@teleporthq/teleport-types'

export const fetchTemplate = async (template: RemoteTemplateDefinition) => {
  if (template.githubRepo) {
    const authData = template.githubRepo.auth || {}
    const githubGateway = createGithubGateway(authData)
    return githubGateway.getRepository(template.githubRepo)
  }
}

export const injectAssetsToProject = async (
  project: GeneratedFolder,
  assetsData: AssetsDefinition,
  assetsPath: string
): Promise<GeneratedFolder> => {
  if (!assetsData) {
    return project
  }

  const { assets, meta } = assetsData

  assets.forEach((asset: AssetInfo) => {
    const { data, name, type } = asset
    const file: GeneratedFile = {
      name,
      content: data,
      contentEncoding: 'base64',
      fileType: type,
    }

    let filePath = [assetsPath]
    if (meta && meta.prefix) {
      const prefix = [].concat(meta.prefix)
      filePath = filePath.concat(prefix)
    }
    project = injectFileInGeneratedFolder(project, file, filePath)
  })

  return project
}

const injectFileInGeneratedFolder = (
  generatedFolder: GeneratedFolder,
  file: GeneratedFile,
  path: string[]
): GeneratedFolder => {
  if (fileMustBeOnFirstLevel(path)) {
    generatedFolder.files.push(file)
    return generatedFolder
  }

  let currentFolder = generatedFolder

  path.forEach((folderName, index) => {
    let subFolder = currentFolder.subFolders.find((folder) => folder.name === folderName)

    if (!subFolder) {
      subFolder = {
        name: folderName,
        files: [],
        subFolders: [],
      }
      currentFolder.subFolders.push(subFolder)
    }

    currentFolder = subFolder
    if (index === path.length - 1) {
      currentFolder.files.push(file)
    }
  })

  return generatedFolder
}

const fileMustBeOnFirstLevel = (path: string[]): boolean => {
  return !path.length || (path.length === 1 && path[0] === '')
}
