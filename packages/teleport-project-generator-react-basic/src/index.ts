import {
  createRouterIndexFile,
  createHtmlEntryFile,
  createComponentGenerator,
} from './component-generators'

import {
  createPackageJSONFile,
  createPageOutputs,
  createComponentOutputs,
  joinGeneratorOutputs,
  createManifestJSONFile,
  generateLocalDependenciesPrefix,
  injectFilesInFolderStructure,
} from '@teleporthq/teleport-generator-shared/lib/utils/project-utils'
import { extractRoutes } from '@teleporthq/teleport-generator-shared/lib/utils/uidl-utils'
import {
  ASSETS_PREFIX,
  DEFAULT_PACKAGE_JSON,
  DEFAULT_COMPONENT_FILES_PATH,
  DEFAULT_PAGE_FILES_PATH,
  DEFAULT_STATIC_FILES_PATH,
  DEFAULT_SRC_FILES_PATH,
} from './constants'

import { Validator, Parser } from '@teleporthq/teleport-generator-core'

import {
  ComponentFactoryParams,
  ProjectGeneratorOptions,
  GeneratedFile,
  GenerateProjectFunction,
  TemplateDefinition,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { ComponentUIDL, Mapping } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

const createReactBasicGenerator = (generatorOptions: ProjectGeneratorOptions = {}) => {
  const validator = new Validator()
  const reactGenerator = createComponentGenerator(generatorOptions)

  const addCustomMapping = (mapping: Mapping) => {
    reactGenerator.addMapping(mapping)
  }

  const generateProject: GenerateProjectFunction = async (
    input: Record<string, unknown>,
    template: TemplateDefinition,
    options: ProjectGeneratorOptions = {}
  ) => {
    // Step 0: Validate project input and transform to UIDL and validate content of UIDL
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

    // Step 2: The first level conditionals become the pages
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
      }
      return createPageOutputs(pageParams)
    })

    // Step 3: The components generation process is started
    const componentPromises = Object.keys(components).map((componentName) => {
      const componentUIDL = components[componentName]
      const componentParams: ComponentFactoryParams = {
        componentGenerator: reactGenerator,
        componentUIDL,
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

    // Step 6: Global settings are transformed into the root html file and the manifest file for PWA support
    const staticFiles: GeneratedFile[] = []
    if (uidl.globals.manifest) {
      const manifestFile = createManifestJSONFile(uidl, ASSETS_PREFIX)
      staticFiles.push(manifestFile)
    }

    // Step 7: Create the routing component (index.js) and the html entry file (index.html)
    const { routerFile, dependencies: routerDependencies } = await createRouterIndexFile(root)
    const htmlIndexFile = createHtmlEntryFile(uidl, { assetsPrefix: ASSETS_PREFIX })

    const srcFiles: GeneratedFile[] = [htmlIndexFile, routerFile]

    // Step 8: Join all the external dependencies
    const collectedDependencies = {
      ...routerDependencies,
      ...joinedPageFiles.dependencies,
      ...joinedComponentFiles.dependencies,
    }

    // Step 9: Create the package.json file
    const packageFile = createPackageJSONFile(options.sourcePackageJson || DEFAULT_PACKAGE_JSON, {
      dependencies: collectedDependencies,
      projectName: uidl.name,
    })

    const distFiles: GeneratedFile[] = [packageFile]

    // Step 10: Build the folder structure
    template.meta = template.meta || {}

    const filesWithPath = [
      {
        path: [],
        files: distFiles,
      },
      {
        path: template.meta.srcFilesPath || DEFAULT_SRC_FILES_PATH,
        files: srcFiles,
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
      assetsPath: 'src' + ASSETS_PREFIX,
    }
  }

  return {
    addCustomMapping,
    generateProject,
  }
}

export default createReactBasicGenerator
