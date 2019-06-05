import { createHtmlEntryFile, createRouterFile, createVueGenerator } from './component-generators'
import {
  createPageOutputs,
  createComponentOutputs,
  joinGeneratorOutputs,
  createManifestJSONFile,
  createPackageJSONFile,
  generateLocalDependenciesPrefix,
  injectFilesInFolderStructure,
} from '@teleporthq/teleport-shared/lib/utils/project-utils'

import {
  ASSETS_PREFIX,
  DEFAULT_PACKAGE_JSON,
  DEFAULT_COMPONENT_FILES_PATH,
  DEFAULT_PAGE_FILES_PATH,
  DEFAULT_SRC_FILES_PATH,
  DEFAULT_PUBLIC_FILES_PATH,
} from './constants'

import { extractRoutes } from '@teleporthq/teleport-shared/lib/utils/uidl-utils'
import { Validator, Parser } from '@teleporthq/teleport-uidl-validator'

import {
  ProjectGeneratorOptions,
  ComponentFactoryParams,
  GeneratedFile,
  GenerateProjectFunction,
  TemplateDefinition,
  Mapping,
  ComponentUIDL,
} from '@teleporthq/teleport-types'

export const createVueBasicGenerator = (generatorOptions: ProjectGeneratorOptions = {}) => {
  const validator = new Validator()
  const vueGenerator = createVueGenerator(generatorOptions)

  const addCustomMapping = (mapping: Mapping) => {
    vueGenerator.addMapping(mapping)
  }

  const generateProject: GenerateProjectFunction = async (
    input: Record<string, unknown>,
    template: TemplateDefinition = {},
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

    // Step 2: The first level conditional nodes are taken as project pages
    const localDependenciesPrefix = generateLocalDependenciesPrefix(template, {
      defaultComponentsPath: DEFAULT_COMPONENT_FILES_PATH,
      defaultPagesPath: DEFAULT_PAGE_FILES_PATH,
    })

    const pagePromises = routes.map((routeNode) => {
      const { value, node } = routeNode.content
      const pageName = value.toString()

      const componentUIDL: ComponentUIDL = {
        name: pageName,
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
    const pageFiles: GeneratedFile[] = [].concat(joinedPageFiles.files)

    const joinedComponentFiles = joinGeneratorOutputs(createdComponentFiles)
    const componentFiles = joinedComponentFiles.files

    // Step 6: Global settings are transformed into the root html file and the manifest file for PWA support
    const publicFiles: GeneratedFile[] = []
    if (uidl.globals.manifest) {
      const manifestFile = createManifestJSONFile(uidl, ASSETS_PREFIX)
      publicFiles.push(manifestFile)
    }

    const htmlIndexFile = createHtmlEntryFile(uidl, { assetsPrefix: ASSETS_PREFIX })
    publicFiles.push(htmlIndexFile)

    // Step 7: Create the routing component (router.js)
    const { routerFile, dependencies: routerDependencies } = await createRouterFile(root)
    const srcFiles: GeneratedFile[] = [].concat(routerFile)

    const collectedDependencies = {
      ...routerDependencies,
      ...joinedPageFiles.dependencies,
      ...joinedComponentFiles.dependencies,
    }

    // Step 8: External dependencies are added to the package.json file from the template project
    const packageJSONFile = createPackageJSONFile(
      options.sourcePackageJson || DEFAULT_PACKAGE_JSON,
      {
        dependencies: collectedDependencies,
        projectName: uidl.name,
      }
    )
    const distFiles = [packageJSONFile]

    // Step 9: Build the folder structure
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
        path: template.meta.publicFiles || DEFAULT_PUBLIC_FILES_PATH,
        files: publicFiles,
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

export default createVueBasicGenerator()
