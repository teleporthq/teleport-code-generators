import createVueGenerator from '../../component-generators/vue/vue-component'
import { buildFolderStructure } from './utils'
import nuxtMapping from './nuxt-mapping.json'

import {
  ASSETS_PREFIX,
  DEFAULT_OUTPUT_FOLDER,
  LOCAL_DEPENDENCIES_PREFIX,
  DEFAULT_PACKAGE_JSON,
  APP_ROOT_OVERRIDE,
} from './constants'
import { FILE_EXTENSIONS } from '../../shared/constants'

import {
  createPageFile,
  createComponentFile,
  createManifestJSONFile,
  createHtmlIndexFile,
  createPackageJSONFile,
  joinComponentFiles,
} from '../../shared/utils/project-utils'

const initGenerator = (options: ProjectGeneratorOptions): ComponentGenerator => {
  const vueGenerator = createVueGenerator({
    customMapping: { ...nuxtMapping },
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
      componentOptions: {
        assetsPrefix: ASSETS_PREFIX,
        localDependenciesPrefix: LOCAL_DEPENDENCIES_PREFIX,
      },
      pageExtension: FILE_EXTENSIONS.VUE,
      pageMetadataOptions: {
        usePathAsFileName: true,
        convertDefaultToIndex: true,
      },
    }
    return createPageFile(pageParams)
  })

  // Step 2: The components generation process is started
  const componentPromises = Object.keys(components).map(async (componentName) => {
    const componentUIDL = components[componentName]
    const componentParams: ComponentFactoryParams = {
      componentUIDL,
      componentExtension: FILE_EXTENSIONS.VUE,
      componentGenerator: vueGenerator,
      componentOptions: { assetsPrefix: ASSETS_PREFIX },
    }
    return createComponentFile(componentParams)
  })

  // Step 3: The process of creating the pages and the components is awaited
  const createdPageFiles = await Promise.all(pagePromises)
  const createdComponentFiles = await Promise.all(componentPromises)

  // Step 4: The generated page and component files are joined
  const joinedPageFiles = joinComponentFiles(createdPageFiles)
  const pageFiles = joinedPageFiles.files

  const joinedComponentFiles = joinComponentFiles(createdComponentFiles)
  const componentFiles = joinedComponentFiles.files

  // Step 5: Global settings are transformed into the manifest file for PWA support
  const manifestFile = createManifestJSONFile(uidl, ASSETS_PREFIX)
  const staticFiles: GeneratedFile[] = [].concat(manifestFile)

  const htmlIndexFile = createHtmlIndexFile(uidl, ASSETS_PREFIX, 'app', APP_ROOT_OVERRIDE)

  const collectedDependencies = {
    ...joinedPageFiles.dependencies,
    ...joinedComponentFiles.dependencies,
  }

  // Step 6: External dependencies are added to the package.json file from the template project
  const packageFile = createPackageJSONFile(options.sourcePackageJson || DEFAULT_PACKAGE_JSON, {
    dependencies: collectedDependencies,
    projectName: uidl.name,
  })

  const distFiles = [htmlIndexFile, packageFile]

  // Step 7: Build the folder structure
  const folderStructure = buildFolderStructure({
    pageFiles,
    componentFiles,
    publicFiles: staticFiles,
    distFiles,
    distFolderName: options.distPath || DEFAULT_OUTPUT_FOLDER,
  })

  return {
    outputFolder: folderStructure,
    assetsPath: ASSETS_PREFIX.slice(1), // remove the leading `/`
  }
}
