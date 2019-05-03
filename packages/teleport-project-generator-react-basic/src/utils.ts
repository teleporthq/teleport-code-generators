import { createReactRouterComponentGenerator } from '@teleporthq/teleport-component-generator-react'

import {
  createFolder,
  createFile,
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
  const pagesFolder = createFolder('pages', files.pages)
  const componentsFolder = createFolder('components', files.components)
  const staticFolder = createFolder('static', files.static)
  const srcFolder = createFolder('src', files.src, [componentsFolder, pagesFolder, staticFolder])

  return createFolder(distFolderName, files.dist, [srcFolder])
}

export const createRouterIndexFile = async (root: ComponentUIDL) => {
  const routingComponentGenerator = createReactRouterComponentGenerator()
  const { code, externalDependencies } = await routingComponentGenerator.generateComponent(root)
  const routerFile = createFile('index', FILE_TYPE.JS, code)

  return { routerFile, externalDependencies }
}
