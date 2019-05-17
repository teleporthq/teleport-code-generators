import { createFolder } from '@teleporthq/teleport-generator-shared/lib/utils/project-utils'

import {
  GeneratedFile,
  GeneratedFolder,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'

export const buildFolderStructure = (
  files: Record<string, GeneratedFile[]>,
  distFolderName: string
): GeneratedFolder => {
  const pagesFolder = createFolder('pages', files.pages)
  const componentsFolder = createFolder('components', files.components)
  const staticFolder = createFolder('static', files.static)
  const srcFolder = createFolder('src', files.src, [componentsFolder, pagesFolder, staticFolder])

  return createFolder(distFolderName, files.dist, [srcFolder])
}
