import {
  createRouterIndexFile,
  createHtmlEntryFile,
  createComponentGenerator,
} from './component-generators'

import { buildFolderStructure } from './utils'

import {
  createPackageJSONFile,
  createPageOutputs,
  createComponentOutputs,
  joinGeneratorOutputs,
  createManifestJSONFile,
} from '@teleporthq/teleport-generator-shared/lib/utils/project-utils'
import { extractRoutes } from '@teleporthq/teleport-generator-shared/lib/utils/uidl-utils'
import {
  ASSETS_PREFIX,
  LOCAL_DEPENDENCIES_PREFIX,
  DEFAULT_OUTPUT_FOLDER,
  DEFAULT_PACKAGE_JSON,
} from './constants'

import { Validator, Parser } from '@teleporthq/teleport-generator-core'

import {
  ComponentFactoryParams,
  ProjectGeneratorOptions,
  GeneratedFile,
  GenerateProjectFunction,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { ComponentUIDL, Mapping } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

const createReactBasicGenerator = (generatorOptions: ProjectGeneratorOptions = {}) => {
  const validator = new Validator()
  const reactGenerator = createComponentGenerator(generatorOptions)

  const addCustomMapping = (mapping: Mapping) => {
    reactGenerator.addMapping(mapping)
  }

  const generateProject: GenerateProjectFunction = async (input, options = {}) => {
    // Step 0: Validate project input and transform to UIDL
    if (!options.skipValidation) {
      const validationResult = validator.validateProject(input)
      if (!validationResult.valid) {
        throw new Error(validationResult.errorMsg)
      }
    }

    const uidl = Parser.parseProjectJSON(input)

    // Step 1: Add any custom mappings found in the options
    if (options.customMapping) {
      reactGenerator.addMapping(options.customMapping)
    }

    const { components = {}, root } = uidl
    const routeNodes = extractRoutes(root)

    // Step 1: The first level conditionals become the pages
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
        componentOptions: {
          assetsPrefix: ASSETS_PREFIX,
          localDependenciesPrefix: LOCAL_DEPENDENCIES_PREFIX,
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
    const distFolder = buildFolderStructure(
      {
        pages: pageFiles,
        components: componentFiles,
        src: srcFiles,
        dist: distFiles,
        static: staticFiles,
      },
      options.distPath || DEFAULT_OUTPUT_FOLDER
    )

    return {
      outputFolder: distFolder,
      assetsPath: 'src' + ASSETS_PREFIX,
    }
  }

  return {
    addCustomMapping,
    generateProject,
  }
}

export default createReactBasicGenerator
