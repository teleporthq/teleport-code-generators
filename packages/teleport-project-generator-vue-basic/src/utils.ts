import { createFolder } from '@teleporthq/teleport-generator-shared/lib/utils/project-utils'

import {
  GeneratedFile,
  GeneratedFolder,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'

export const buildFolderStructure = (
  files: Record<string, GeneratedFile[]>,
  distFolderName: string
): GeneratedFolder => {
  const componentsFolder = createFolder('components', files.components)
  const pagesFolder = createFolder('views', files.pages)
  const publicFolder = createFolder('public', files.public)
  const srcFolder = createFolder('src', files.src, [componentsFolder, pagesFolder])

  return createFolder(distFolderName, files.dist, [srcFolder, publicFolder])
}
