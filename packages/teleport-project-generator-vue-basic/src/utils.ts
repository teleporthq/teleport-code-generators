import createVueRouterFileGenerator from '../../component-generators/vue/vue-router'
import { createFile, createFolder } from '../../shared/utils/project-utils'
import { FILE_TYPE } from '../../shared/constants'

import { GeneratedFile, GeneratedFolder } from '../../typings/generators'
import { ComponentUIDL } from '../../typings/uidl-definitions'

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
  const vueRouterGenerator = createVueRouterFileGenerator()
  const { code, externalDependencies } = await vueRouterGenerator.generateComponent(root)
  const routerFile = createFile('router', FILE_TYPE.JS, code)

  return { routerFile, externalDependencies }
}
