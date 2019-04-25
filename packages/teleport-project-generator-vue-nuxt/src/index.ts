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

import {
  createPageOutputs,
  createComponentOutputs,
  createManifestJSONFile,
  createHtmlIndexFile,
  createPackageJSONFile,
  joinGeneratorOutputs,
} from '../../shared/utils/project-utils'

import { extractRoutes } from '../../shared/utils/uidl-utils'
import { Validator } from '../../core'
import { parseProjectJSON } from '../../core/parser/project'

import {
  ProjectGeneratorOptions,
  ComponentGenerator,
  ComponentFactoryParams,
  GeneratedFile,
  GenerateProjectFunction,
} from '../../typings/generators'
import { ComponentUIDL, Mapping } from '../../typings/uidl-definitions'

const initGenerator = (options: ProjectGeneratorOptions): ComponentGenerator => {
  const vueGenerator = createVueGenerator({
    mapping: nuxtMapping as Mapping,
  })

  if (options.customMapping) {
    vueGenerator.addMapping(options.customMapping)
  }

  return vueGenerator
}

const createVueNuxtGenerator = (generatorOptions: ProjectGeneratorOptions = {}) => {
  const validator = new Validator()
  const vueGenerator = initGenerator(generatorOptions)

  const addCustomMapping = (mapping: Mapping) => {
    vueGenerator.addMapping(mapping)
  }

  const generateProject: GenerateProjectFunction = async (input, options = {}) => {
    // Step 0: Validate project input
    if (!options.skipValidation) {
      const validationResult = validator.validateProject(input)
      if (!validationResult.valid) {
        throw new Error(validationResult.errorMsg)
      }
    }
    const uidl = parseProjectJSON(input)

    // Step 1: Add any custom mappings found in the options
    if (options.customMapping) {
      addCustomMapping(options.customMapping)
    }

    const { components = {}, root } = uidl
    const routes = extractRoutes(root)

    // Step 1: The first level stateBranches (the pages) transformation in react components is started
    const pagePromises = routes.map((routeNode) => {
      const { value: pageName, node } = routeNode.content

      const componentUIDL: ComponentUIDL = {
        name: pageName.toString(),
        node,
        stateDefinitions: root.stateDefinitions,
      }

      const pageParams: ComponentFactoryParams = {
        componentGenerator: vueGenerator,
        componentUIDL,
        componentOptions: {
          assetsPrefix: ASSETS_PREFIX,
          localDependenciesPrefix: LOCAL_DEPENDENCIES_PREFIX,
        },
        metadataOptions: {
          usePathAsFileName: true,
          convertDefaultToIndex: true,
        },
      }

      return createPageOutputs(pageParams)
    })

    // Step 3: The components generation process is started
    const componentPromises = Object.keys(components).map((componentName) => {
      const componentUIDL = components[componentName]
      const componentParams: ComponentFactoryParams = {
        componentUIDL,
        componentGenerator: vueGenerator,
        componentOptions: { assetsPrefix: ASSETS_PREFIX },
      }
      return createComponentOutputs(componentParams)
    })

    // Step 4: The process of creating the pages and the components is awaited
    const createdPageFiles = await Promise.all(pagePromises)
    const createdComponentFiles = await Promise.all(componentPromises)

    // Step 5: The generated page and component files are joined
    const joinedPageFiles = joinGeneratorOutputs(createdPageFiles)
    const pageFiles = joinedPageFiles.files

    const joinedComponentFiles = joinGeneratorOutputs(createdComponentFiles)
    const componentFiles = joinedComponentFiles.files

    // Step 6: Global settings are transformed into the manifest file for PWA support
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

    // Step 7: Join all the external dependencies
    const collectedDependencies = {
      ...joinedPageFiles.dependencies,
      ...joinedComponentFiles.dependencies,
    }

    // Step 8: External dependencies are added to the package.json file from the template project
    const packageFile = createPackageJSONFile(options.sourcePackageJson || DEFAULT_PACKAGE_JSON, {
      dependencies: collectedDependencies,
      projectName: uidl.name,
    })

    const distFiles = [htmlIndexFile, packageFile]

    // Step 9: Build the folder structure
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
