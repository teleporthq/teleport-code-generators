import { createReactRouterGenerator } from './component-generators/router-component'

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
  const pagesFolder = createFolder('pages', files.pages)
  const componentsFolder = createFolder('components', files.components)
  const staticFolder = createFolder('static', files.static)
  const srcFolder = createFolder('src', files.src, [componentsFolder, pagesFolder, staticFolder])

  return createFolder(distFolderName, files.dist, [srcFolder])
}

export const createRouterIndexFile = async (root: ComponentUIDL) => {
  const routingComponentGenerator = createReactRouterGenerator()

  // React router is generated in index.js
  root.meta = root.meta || {}
  root.meta.fileName = 'index'

  const { files, dependencies } = await routingComponentGenerator.generateComponent(root)
  const routerFile = files[0]

  return { routerFile, dependencies }
}
