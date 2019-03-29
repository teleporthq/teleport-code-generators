import { createFolder } from '../../shared/utils/project-utils'

export const buildFolderStructure = (
  files: Record<string, GeneratedFile[]>,
  distFolderName: string
): GeneratedFolder => {
  const pagesFolder = createFolder('pages', files.pages)
  const componentsFolder = createFolder('components', files.components)
  const staticFolder = createFolder('static', files.static)

  return createFolder(distFolderName, files.dist, [pagesFolder, componentsFolder, staticFolder])
}
