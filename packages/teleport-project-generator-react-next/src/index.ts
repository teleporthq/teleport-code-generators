import { createReactGenerator, createDocumentFile } from './component-generators'
import {
  createPageOutputs,
  createComponentOutputs,
  joinGeneratorOutputs,
  generateLocalDependenciesPrefix,
  createManifestJSONFile,
  createPackageJSONFile,
  injectFilesInFolderStructure,
} from '@teleporthq/teleport-generator-shared/lib/utils/project-utils'

import { extractRoutes } from '@teleporthq/teleport-generator-shared/lib/utils/uidl-utils'

import {
  ASSETS_PREFIX,
  DEFAULT_PACKAGE_JSON,
  DEFAULT_COMPONENT_FILES_PATH,
  DEFAULT_PAGE_FILES_PATH,
  DEFAULT_STATIC_FILES_PATH,
} from './constants'

import { Validator, Parser } from '@teleporthq/teleport-generator-core'

import {
  ProjectGeneratorOptions,
  ComponentFactoryParams,
  GeneratedFile,
  GenerateProjectFunction,
  TemplateDefinition,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { ComponentUIDL, Mapping } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

const createReactNextGenerator = (generatorOptions: ProjectGeneratorOptions = {}) => {
  const validator = new Validator()
  const reactGenerator = createReactGenerator(generatorOptions)

  const addCustomMapping = (mapping: Mapping) => {
    reactGenerator.addMapping(mapping)
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
      reactGenerator.addMapping(options.customMapping)
    }

    const { components = {}, root } = uidl
    const routeNodes = extractRoutes(root)

    // Step 2: The root html file is customized in next via the _document.js page
    const documentComponentFile = createDocumentFile(uidl)

    // Step 3: The first level conditional nodes are taken as project pages
    const localDependenciesPrefix = generateLocalDependenciesPrefix(template, {
      defaultComponentsPath: DEFAULT_COMPONENT_FILES_PATH,
      defaultPagesPath: DEFAULT_PAGE_FILES_PATH,
    })

    const pagePromises = routeNodes.map((routeNode) => {
      const { value, node } = routeNode.content
      const pageName = value.toString()

      const componentUIDL: ComponentUIDL = {
        name: pageName,
        node,
        stateDefinitions: root.stateDefinitions,
      }

      const pageParams: ComponentFactoryParams = {
        componentGenerator: reactGenerator,
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

    // Step 4: The components generation process is started
    const componentPromises = Object.keys(components).map((componentName) => {
      const componentUIDL = components[componentName]
      const componentParams: ComponentFactoryParams = {
        componentUIDL,
        componentGenerator: reactGenerator,
        generatorOptions: {
          assetsPrefix: ASSETS_PREFIX,
          projectRouteDefinition: root.stateDefinitions.route,
        },
      }
      return createComponentOutputs(componentParams)
    })

    // Step 5: The process of creating the pages and the components is awaited
    const createdPageFiles = await Promise.all(pagePromises)
    const createdComponentFiles = await Promise.all(componentPromises)

    // Step 6: The generated page and component files are joined
    const joinedPageFiles = joinGeneratorOutputs(createdPageFiles)
    const pageFiles: GeneratedFile[] = [documentComponentFile, ...joinedPageFiles.files]

    const joinedComponentFiles = joinGeneratorOutputs(createdComponentFiles)
    const componentFiles: GeneratedFile[] = joinedComponentFiles.files

    // Step 7: Global settings are transformed into the manifest file for PWA support
    const staticFiles: GeneratedFile[] = []
    if (uidl.globals.manifest) {
      const manifestFile = createManifestJSONFile(uidl, ASSETS_PREFIX)
      staticFiles.push(manifestFile)
    }

    const collectedDependencies = {
      ...joinedPageFiles.dependencies,
      ...joinedComponentFiles.dependencies,
    }

    // Step 8: External dependencies are added to the package.json file from the template project
    const packageFile = createPackageJSONFile(options.sourcePackageJson || DEFAULT_PACKAGE_JSON, {
      dependencies: collectedDependencies,
      projectName: uidl.name,
    })
    const distFiles: GeneratedFile[] = [packageFile]

    // Step 9: Build the folder structure
    template.meta = template.meta || {}

    const filesWithPath = [
      {
        path: [],
        files: distFiles,
      },
      {
        path: template.meta.componentsPath || DEFAULT_COMPONENT_FILES_PATH,
        files: componentFiles,
      },
      {
        path: template.meta.pagesPath || DEFAULT_PAGE_FILES_PATH,
        files: pageFiles,
      },
      {
        path: template.meta.staticFilesPath || DEFAULT_STATIC_FILES_PATH,
        files: staticFiles,
      },
    ]

    const outputFolder = injectFilesInFolderStructure(filesWithPath, template)

    return {
      outputFolder,
      assetsPath: ASSETS_PREFIX.slice(1),
    }
  }

  return {
    addCustomMapping,
    generateProject,
  }
}

export default createReactNextGenerator
