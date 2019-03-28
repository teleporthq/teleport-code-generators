import createVueGenerator from '../../component-generators/vue/vue-component'
import {
  createPageFile,
  createComponentFile,
  joinComponentFiles,
  createManifestJSONFile,
  createHtmlIndexFile,
  createPackageJSONFile,
} from '../../shared/utils/project-utils'

import {
  ASSETS_PREFIX,
  LOCAL_DEPENDENCIES_PREFIX,
  DEFAULT_OUTPUT_FOLDER,
  DEFAULT_PACKAGE_JSON,
} from './constants'
import vueProjectMapping from './vue-project-mapping.json'
import { FILE_EXTENSIONS } from '../../shared/constants'
import { createRouterFile, buildFolderStructure } from './utils'

const initGenerator = (options: ProjectGeneratorOptions): ComponentGenerator => {
  const vueGenerator = createVueGenerator({
    customMapping: vueProjectMapping,
  })

  if (options.customMapping) {
    vueGenerator.addMapping(options.customMapping)
  }

  return vueGenerator
}

export default async (uidl: ProjectUIDL, options: ProjectGeneratorOptions = {}) => {
  // Step 0: Initialize the component generator
  const vueGenerator = initGenerator(options)

  const { components = {}, root } = uidl
  const { states = [] } = root.content

  const stateDefinitions = root.stateDefinitions || {}
  const routerDefinitions = stateDefinitions.router || null

  // Step 1: The first level stateBranches (the pages) transformation in react components is started
  const pagePromises = states.map(async (stateBranch) => {
    const pageParams: PageFactoryParams = {
      componentGenerator: vueGenerator,
      stateBranch,
      routerDefinitions,
      pageExtension: FILE_EXTENSIONS.VUE,
      componentOptions: {
        assetsPrefix: ASSETS_PREFIX,
        localDependenciesPrefix: LOCAL_DEPENDENCIES_PREFIX,
      },
    }
    return createPageFile(pageParams)
  })

  // Step 2: The components generation process is started
  const componentPromises = Object.keys(components).map(async (componentName) => {
    const componentUIDL = components[componentName]
    const componentParams: ComponentFactoryParams = {
      componentUIDL,
      componentGenerator: vueGenerator,
      componentExtension: FILE_EXTENSIONS.VUE,
      componentOptions: { assetsPrefix: ASSETS_PREFIX },
    }

    return createComponentFile(componentParams)
  })

  // Step 3: The process of creating the pages and the components is awaited
  const createdPageFiles = await Promise.all(pagePromises)
  const createdComponentFiles = await Promise.all(componentPromises)

  // Step 4: The generated page and component files are joined
  const joinedPageFiles = joinComponentFiles(createdPageFiles)
  const pageFiles: GeneratedFile[] = [].concat(joinedPageFiles.files)

  const joinedComponentFiles = joinComponentFiles(createdComponentFiles)
  const componentFiles = joinedComponentFiles.files

  // Step 5: Global settings are transformed into the root html file and the manifest file for PWA support
  const manifestFile = createManifestJSONFile(uidl, ASSETS_PREFIX)
  const htmlIndexFile = createHtmlIndexFile(uidl, ASSETS_PREFIX)
  const publicFiles: GeneratedFile[] = [].concat(manifestFile).concat(htmlIndexFile)

  // Step 6: Create the routing component (router.js)
  const { routerFile, externalDependencies } = await createRouterFile(root)
  const srcFiles: GeneratedFile[] = [].concat(routerFile)

  const collectedDependencies = {
    ...externalDependencies,
    ...joinedPageFiles.dependencies,
    ...joinedComponentFiles.dependencies,
  }

  // Step 7: External dependencies are added to the package.json file from the template project
  const packageJSONFile = createPackageJSONFile(options.sourcePackageJson || DEFAULT_PACKAGE_JSON, {
    dependencies: collectedDependencies,
    projectName: uidl.name,
  })
  const distFiles = [packageJSONFile]

  // Step 8: Build the folder structure
  const folderStructure = buildFolderStructure({
    pageFiles,
    componentFiles,
    publicFiles,
    srcFiles,
    distFiles,
    distFolderName: options.distPath || DEFAULT_OUTPUT_FOLDER,
  })

  return {
    outputFolder: folderStructure,
    assetsPath: 'src' + ASSETS_PREFIX,
  }
}
