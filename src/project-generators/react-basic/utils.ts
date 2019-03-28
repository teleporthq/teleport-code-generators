import createRouterComponentGenerator from '../../component-generators/react/react-router'

import { createFolder, createFile } from '../../shared/utils/project-utils'
import { FILE_EXTENSIONS } from '../../shared/constants'

export const buildFolderStructure = (params: FolderStructureParams): GeneratedFolder => {
  const { componentFiles, pageFiles, publicFiles, srcFiles, distFiles } = params
  const { distFolderName } = params

  const pagesFolder = createFolder('pages', pageFiles)
  const componentsFolder = createFolder('components', componentFiles)
  const staticFolder = createFolder('static', publicFiles)
  const srcFolder = createFolder('src', srcFiles, [componentsFolder, pagesFolder, staticFolder])

  return createFolder(distFolderName, distFiles, [srcFolder])
}

export const createRouterIndexFile = async (root: ComponentUIDL) => {
  const routingComponentGenerator = createRouterComponentGenerator()
  const { code, externalDependencies } = await routingComponentGenerator.generateComponent(root)
  const indexFile = createFile('index', FILE_EXTENSIONS.JS, code)

  return { indexFile, externalDependencies }
}
