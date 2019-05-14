import createVueRouterComponentGenerator from './component-generators/router-component'
import { createFolder } from '@teleporthq/teleport-generator-shared/lib/utils/project-utils'

import {
  GeneratedFile,
  GeneratedFolder,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { ComponentUIDL } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

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

export const createRouterFile = async (root: ComponentUIDL) => {
  const vueRouterGenerator = createVueRouterComponentGenerator()

  // Routes are defined in router.js
  root.meta = root.meta || {}
  root.meta.fileName = 'router'

  const { files, dependencies } = await vueRouterGenerator.generateComponent(root)
  const routerFile = files[0]

  return { routerFile, dependencies }
}
