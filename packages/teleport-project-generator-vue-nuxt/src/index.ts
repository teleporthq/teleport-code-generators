import { createVueGenerator, createHtmlEntryFile } from './component-generators'
import { buildFolderStructure } from './utils'

import {
  ASSETS_PREFIX,
  DEFAULT_PACKAGE_JSON,
  APP_ROOT_OVERRIDE,
  DEFAULT_COMPONENT_FILES_PATH,
  DEFAULT_PAGE_FILES_PATH,
} from './constants'

import {
  createPageOutputs,
  createComponentOutputs,
  createManifestJSONFile,
  createPackageJSONFile,
  joinGeneratorOutputs,
  generateLocalDependenciesPrefix,
} from '@teleporthq/teleport-generator-shared/lib/utils/project-utils'

import { extractRoutes } from '@teleporthq/teleport-generator-shared/lib/utils/uidl-utils'
import { Validator, Parser } from '@teleporthq/teleport-generator-core'

import {
  ProjectGeneratorOptions,
  ComponentFactoryParams,
  GeneratedFile,
  GenerateProjectFunction,
  TemplateDefinition,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { ComponentUIDL, Mapping } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

const createVueNuxtGenerator = (generatorOptions: ProjectGeneratorOptions = {}) => {
  const validator = new Validator()
  const vueGenerator = createVueGenerator(generatorOptions)

  const addCustomMapping = (mapping: Mapping) => {
    vueGenerator.addMapping(mapping)
  }

  const generateProject: GenerateProjectFunction = async (
    input: Record<string, unknown>,
    template: TemplateDefinition,
    options: ProjectGeneratorOptions = {}
  ) => {
    // Step 0: Validate project input
    if (!options.skipValidation) {
      const schemaValidationResult = validator.validateProjectSchema(input)
      if (!schemaValidationResult.valid) {
        throw new Error(schemaValidationResult.errorMsg)
      }
    }
    const uidl = Parser.parseProjectJSON(input)
    const contentValidationResult = validator.validateProjectContent(uidl)
    if (!contentValidationResult.valid) {
      throw new Error(contentValidationResult.errorMsg)
    }
    // Step 1: Add any custom mappings found in the options
    if (options.customMapping) {
      vueGenerator.addMapping(options.customMapping)
    }

    const { components = {}, root } = uidl
    const routes = extractRoutes(root)

    // Step 2: The first level stateBranches (the pages) transformation in react components is started
    const localDependenciesPrefix = generateLocalDependenciesPrefix(template, {
      defaultComponentsPath: DEFAULT_COMPONENT_FILES_PATH,
      defaultPagesPath: DEFAULT_PAGE_FILES_PATH,
    })

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
        generatorOptions: {
          localDependenciesPrefix,
          assetsPrefix: ASSETS_PREFIX,
          projectRouteDefinition: root.stateDefinitions.route,
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
        generatorOptions: {
          assetsPrefix: ASSETS_PREFIX,
          projectRouteDefinition: root.stateDefinitions.route,
        },
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

    const htmlIndexFile = createHtmlEntryFile(uidl, {
      assetsPrefix: ASSETS_PREFIX,
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
        componentFiles,
        pageFiles,
        distFiles,
        staticFiles,
      },
      template
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
