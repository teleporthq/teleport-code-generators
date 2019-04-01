import createVueGenerator from '../../component-generators/vue/vue-component'
import { buildFolderStructure } from './utils'
import nuxtMapping from './nuxt-mapping.json'

import {
  ASSETS_PREFIX,
  DEFAULT_OUTPUT_FOLDER,
  DEFAULT_PACKAGE_JSON,
  APP_ROOT_OVERRIDE,
  LOCAL_DEPENDENCIES_PREFIX,
} from './constants'
import { FILE_EXTENSIONS } from '../../shared/constants'

import {
  createPageOutputs,
  createComponentOutputs,
  createManifestJSONFile,
  createHtmlIndexFile,
  createPackageJSONFile,
  joinGeneratorOutputs,
} from '../../shared/utils/project-utils'

const initGenerator = (options: ProjectGeneratorOptions): ComponentGenerator => {
  const vueGenerator = createVueGenerator({
    customMapping: nuxtMapping as Mapping,
  })

  if (options.customMapping) {
    vueGenerator.addMapping(options.customMapping)
  }

  return vueGenerator
}

const createVueNuxtGenerator = (generatorOptions: ProjectGeneratorOptions = {}) => {
  const vueGenerator = initGenerator(generatorOptions)

  const addCustomMapping = (mapping: Mapping) => {
    vueGenerator.addMapping(mapping)
  }

  const generateProject = async (uidl: ProjectUIDL, options: ProjectGeneratorOptions = {}) => {
    // Step 0: Add any custom mappings found in the options
    if (options.customMapping) {
      addCustomMapping(options.customMapping)
    }

    const { components = {}, root } = uidl
    const { states = [] } = root.content

    const stateDefinitions = root.stateDefinitions || {}
    const routerDefinitions = stateDefinitions.router || null

    // Step 1: The first level stateBranches (the pages) transformation in react components is started
    const pagePromises = states.map((stateBranch) => {
      if (
        typeof stateBranch.value !== 'string' ||
        typeof stateBranch.content === 'string' ||
        !routerDefinitions
      ) {
        return { files: [], dependencies: {} }
      }

      const componentUIDL: ComponentUIDL = {
        name: stateBranch.value as string,
        content: stateBranch.content as ContentNode,
        stateDefinitions: {
          routerDefinitions,
        },
      }

      const pageParams: ComponentFactoryParams = {
        componentGenerator: vueGenerator,
        componentUIDL,
        componentOptions: {
          assetsPrefix: ASSETS_PREFIX,
          localDependenciesPrefix: LOCAL_DEPENDENCIES_PREFIX,
        },
        componentExtension: FILE_EXTENSIONS.VUE,
        metadataOptions: {
          usePathAsFileName: true,
          convertDefaultToIndex: true,
        },
      }

      return createPageOutputs(pageParams)
    })

    // Step 2: The components generation process is started
    const componentPromises = Object.keys(components).map((componentName) => {
      const componentUIDL = components[componentName]
      const componentParams: ComponentFactoryParams = {
        componentUIDL,
        componentExtension: FILE_EXTENSIONS.VUE,
        componentGenerator: vueGenerator,
        componentOptions: { assetsPrefix: ASSETS_PREFIX },
      }
      return createComponentOutputs(componentParams)
    })

    // Step 3: The process of creating the pages and the components is awaited
    const createdPageFiles = await Promise.all(pagePromises)
    const createdComponentFiles = await Promise.all(componentPromises)

    // Step 4: The generated page and component files are joined
    const joinedPageFiles = joinGeneratorOutputs(createdPageFiles)
    const pageFiles = joinedPageFiles.files

    const joinedComponentFiles = joinGeneratorOutputs(createdComponentFiles)
    const componentFiles = joinedComponentFiles.files

    // Step 5: Global settings are transformed into the manifest file for PWA support
    const staticFiles: GeneratedFile[] = []
    if (uidl.globals.manifest) {
      const manifestFile = createManifestJSONFile(uidl, ASSETS_PREFIX)
      staticFiles.push(manifestFile)
    }

    const htmlIndexFile = createHtmlIndexFile(uidl, {
      assetsPrefix: ASSETS_PREFIX,
      fileName: 'app',
      appRootOverride: APP_ROOT_OVERRIDE,
    })

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
    const folderStructure = buildFolderStructure(
      {
        pages: pageFiles,
        components: componentFiles,
        static: staticFiles,
        dist: distFiles,
      },
      options.distPath || DEFAULT_OUTPUT_FOLDER
    )

    return {
      outputFolder: folderStructure,
      assetsPath: ASSETS_PREFIX.slice(1), // remove the leading `/`
    }
  }

  return {
    addCustomMapping,
    generateProject,
  }
}

export default createVueNuxtGenerator
