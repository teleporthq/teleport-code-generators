import { createGithubGateway } from '@teleporthq/teleport-github-gateway'

import {
  AssetsDefinition,
  GeneratedFolder,
  GeneratedFile,
  RemoteTemplateDefinition,
} from '@teleporthq/teleport-types'

export const fetchTemplate = async (template: RemoteTemplateDefinition) => {
  const authData = template.auth || {}
  const githubGateway = createGithubGateway(authData)
  return githubGateway.getRepository(template)
}

export const injectAssetsToProject = async (
  project: GeneratedFolder,
  assetsData: AssetsDefinition,
  assetsRootPath: string[]
): Promise<GeneratedFolder> => {
  if (!assetsData) {
    return project
  }

  // const { assets, path = [] } = assetsData
  const { assets } = assetsData

  assets.forEach((asset: GeneratedFile) => {
    // TODO reinclude ...path (playground_assets) and find how to configure it to not be present
    let filePath = [...assetsRootPath]

    if (asset.name.split('/')[0] === 'private') {
      filePath = ['']
      asset.name = asset.name.split('/')[1]
    }
    project = injectFileInGeneratedFolder(project, asset, filePath)
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
