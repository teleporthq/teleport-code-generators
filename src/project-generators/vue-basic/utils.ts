import createVueRouterFileGenerator from '../../component-generators/vue/vue-router'
import { createFile, createFolder } from '../../shared/utils/project-utils'
import { FILE_EXTENSIONS } from '../../shared/constants'

interface VuewFolderStructureParams {
  componentFiles: GeneratedFile[]
  pageFiles: GeneratedFile[]
  publicFiles: GeneratedFile[]
  srcFiles: GeneratedFile[]
  distFiles: GeneratedFile[]
  distFolderName: string
}

export const buildFolderStructure = (params: VuewFolderStructureParams): GeneratedFolder => {
  const { componentFiles, pageFiles, publicFiles, srcFiles, distFiles } = params
  const { distFolderName } = params

  const componentsFolder = createFolder('components', componentFiles)
  const pagesFolder = createFolder('views', pageFiles)
  const publicFolder = createFolder('public', publicFiles)
  const srcFolder = createFolder('src', srcFiles, [componentsFolder, pagesFolder])

  return createFolder(distFolderName, distFiles, [srcFolder, publicFolder])
}

export const createRouterFile = async (root: ComponentUIDL) => {
  const vueRouterGenerator = createVueRouterFileGenerator()
  const { code, externalDependencies } = await vueRouterGenerator.generateComponent(root)
  const routerFile = createFile('router', FILE_EXTENSIONS.JS, code)

  return { routerFile, externalDependencies }
}
