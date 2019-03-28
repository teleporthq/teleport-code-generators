import createRouterComponentGenerator from '../../component-generators/react/react-router'

import { createFolder, createManifestJSONFile, createFile } from '../../shared/utils/project-utils'
import { ASSETS_PREFIX } from './constants'
import { FILE_EXTENSIONS } from '../../shared/constants'

interface FolderStructureParams {
  componentFiles: GeneratedFile[]
  pageFiles: GeneratedFile[]
  staticFiles: GeneratedFile[]
  srcFiles: GeneratedFile[]
  distFiles: GeneratedFile[]
  distFolderName: string
}

export const buildFolderStructure = (params: FolderStructureParams): GeneratedFolder => {
  const { componentFiles, pageFiles, staticFiles, srcFiles, distFiles } = params
  const { distFolderName } = params

  const componentsFolder = createFolder('components', componentFiles)
  const pagesFolder = createFolder('pages', pageFiles)
  const staticFolder = createFolder('static', staticFiles)
  const srcFolder = createFolder('src', srcFiles, [componentsFolder, pagesFolder, staticFolder])

  return createFolder(distFolderName, distFiles, [srcFolder])
}

export const generateManifestFile = (uidl: ProjectUIDL): GeneratedFile | [] => {
  if (!uidl.globals.manifest) {
    return []
  }

  return createManifestJSONFile(uidl.globals.manifest, uidl.name, ASSETS_PREFIX)
}

export const createRouterIndexFile = async (root: ComponentUIDL) => {
  const routingComponentGenerator = createRouterComponentGenerator()
  const { code, externalDependencies } = await routingComponentGenerator.generateComponent(root)
  const indexFile = createFile('index', FILE_EXTENSIONS.JS, code)

  return { indexFile, externalDependencies }
}
