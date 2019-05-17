import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'
import {
  createPageOutputs,
  createComponentOutputs,
  joinGeneratorOutputs,
  createManifestJSONFile,
  createHtmlIndexFile,
  createPackageJSONFile,
  generateLocalDependenciesPrefix,
} from '@teleporthq/teleport-generator-shared/lib/utils/project-utils'

import {
  ASSETS_PREFIX,
  DEFAULT_PACKAGE_JSON,
  DEFAULT_COMPONENT_FILES_PATH,
  DEFAULT_PAGE_FILES_PATH,
} from './constants'
import vueProjectMapping from './vue-project-mapping.json'
import { createRouterFile, buildFolderStructure } from './utils'
import { extractRoutes } from '@teleporthq/teleport-generator-shared/lib/utils/uidl-utils'
import { Validator, Parser } from '@teleporthq/teleport-generator-core'

import {
  ProjectGeneratorOptions,
  ComponentGenerator,
  ComponentFactoryParams,
  GeneratedFile,
  GenerateProjectFunction,
  TemplateDefinition,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { Mapping, ComponentUIDL } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

const initGenerator = (options: ProjectGeneratorOptions): ComponentGenerator => {
  const vueGenerator = createVueComponentGenerator({
    mapping: vueProjectMapping as Mapping,
  })

  if (options.customMapping) {
    vueGenerator.addMapping(options.customMapping)
  }

  return vueGenerator
}

const createVueBasicGenerator = (generatorOptions: ProjectGeneratorOptions = {}) => {
  const validator = new Validator()
  const vueGenerator = initGenerator(generatorOptions)

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
      const validationResult = validator.validateProject(input)
      if (!validationResult.valid) {
        throw new Error(validationResult.errorMsg)
      }
    }
    const uidl = Parser.parseProjectJSON(input)

    // Step 1: Add any custom mappings found in the options
    if (options.customMapping) {
      addCustomMapping(options.customMapping)
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
        componentOptions: {
          localDependenciesPrefix,
          assetsPrefix: ASSETS_PREFIX,
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
    const pageFiles: GeneratedFile[] = [].concat(joinedPageFiles.files)

    const joinedComponentFiles = joinGeneratorOutputs(createdComponentFiles)
    const componentFiles = joinedComponentFiles.files

    // Step 6: Global settings are transformed into the root html file and the manifest file for PWA support
    const publicFiles: GeneratedFile[] = []
    if (uidl.globals.manifest) {
      const manifestFile = createManifestJSONFile(uidl, ASSETS_PREFIX)
      publicFiles.push(manifestFile)
    }

    const htmlIndexFile = createHtmlIndexFile(uidl, { assetsPrefix: ASSETS_PREFIX })
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
    const folderStructure = buildFolderStructure(
      {
        componentFiles,
        distFiles,
        pageFiles,
        publicFiles,
        srcFiles,
      },
      template
    )

    return {
      outputFolder: folderStructure,
      assetsPath: 'src' + ASSETS_PREFIX,
    }
  }

  return {
    addCustomMapping,
    generateProject,
  }
}

export default createVueBasicGenerator
