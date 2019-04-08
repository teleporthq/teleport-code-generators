import createRouterComponentGenerator from '../../component-generators/react/react-router'

import { createFolder, createFile } from '../../shared/utils/project-utils'
import { FILE_EXTENSIONS } from '../../shared/constants'

import { GeneratedFile, GeneratedFolder } from '../../typings/generators'
import { ComponentUIDL } from '../../typings/uidl-definitions'

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

export const createRouterIndexFile = async (root: ComponentUIDL) => {
  const routingComponentGenerator = createRouterComponentGenerator()
  const { code, externalDependencies } = await routingComponentGenerator.generateComponent(root)
  const routerFile = createFile('index', FILE_EXTENSIONS.JS, code)

  return { routerFile, externalDependencies }
}
