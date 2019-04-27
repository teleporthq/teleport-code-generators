import { createVueRouterComponentGenerator } from '@teleporthq/teleport-component-generator-vue'
import {
  createFile,
  createFolder,
} from '@teleporthq/teleport-generator-shared/lib/utils/project-utils'
import { FILE_TYPE } from '@teleporthq/teleport-generator-shared/lib/constants'

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
  const { code, externalDependencies } = await vueRouterGenerator.generateComponent(root)
  const routerFile = createFile('router', FILE_TYPE.JS, code)

  return { routerFile, externalDependencies }
}
