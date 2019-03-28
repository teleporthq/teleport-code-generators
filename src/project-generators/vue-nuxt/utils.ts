import { createFolder } from '../../shared/utils/project-utils'

export const buildFolderStructure = (params: FolderStructureParams): GeneratedFolder => {
  const { componentFiles, pageFiles, publicFiles, distFiles } = params
  const { distFolderName } = params

  const pagesFolder = createFolder('pages', pageFiles)
  const componentsFolder = createFolder('components', componentFiles)
  const staticFolder = createFolder('static', publicFiles)

  return createFolder(distFolderName, distFiles, [pagesFolder, componentsFolder, staticFolder])
}
