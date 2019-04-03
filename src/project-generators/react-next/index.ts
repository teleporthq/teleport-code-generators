import {
  createPageOutputs,
  createComponentOutputs,
  joinGeneratorOutputs,
  createManifestJSONFile,
  createPackageJSONFile,
} from '../../shared/utils/project-utils'

import { extractRoutes } from '../../shared/utils/uidl-utils'

import createReactGenerator, {
  ReactComponentStylingFlavors,
} from '../../component-generators/react/react-component'
import { createDocumentComponentFile, buildFolderStructure } from './utils'

import {
  ASSETS_PREFIX,
  DEFAULT_OUTPUT_FOLDER,
  DEFAULT_PACKAGE_JSON,
  LOCAL_DEPENDENCIES_PREFIX,
} from './constants'

import { Validator } from '../../core'

import nextMapping from './next-mapping.json'

const initGenerator = (options: ProjectGeneratorOptions): ComponentGenerator => {
  const reactGenerator = createReactGenerator({
    variation: ReactComponentStylingFlavors.StyledJSX,
  })

  reactGenerator.addMapping(nextMapping as Mapping)
  if (options.customMapping) {
    reactGenerator.addMapping(options.customMapping)
  }

  return reactGenerator
}

const createReactNextGenerator = (generatorOptions: ProjectGeneratorOptions = {}) => {
  const validator = new Validator()
  const reactGenerator = initGenerator(generatorOptions)

  const addCustomMapping = (mapping: Mapping) => {
    reactGenerator.addMapping(mapping)
  }

  const generateProject = async (uidl: ProjectUIDL, options: ProjectGeneratorOptions = {}) => {
    // Step 0: Validate project UIDL
    if (options.skipValidation) {
      const validationResult = validator.validateProject(uidl)
      if (!validationResult.valid) {
        throw new Error(validationResult.errorMsg)
      }
    }
    // Step 1: Add any custom mappings found in the options
    if (options.customMapping) {
      addCustomMapping(options.customMapping)
    }

    const { components = {}, root } = uidl
    const routeNodes = extractRoutes(root)

    // Step 2: The root html file is customized in next via the _document.js page
    const documentComponentFile = [].concat(createDocumentComponentFile(uidl))

    // Step 2: The first level conditional nodes are taken as project pages
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
        componentOptions: { assetsPrefix: ASSETS_PREFIX },
      }
      return createComponentOutputs(componentParams)
    })

    // Step 5: The process of creating the pages and the components is awaited
    const createdPageFiles = await Promise.all(pagePromises)
    const createdComponentFiles = await Promise.all(componentPromises)

    // Step 6: The generated page and component files are joined
    const joinedPageFiles = joinGeneratorOutputs(createdPageFiles)
    const pageFiles: GeneratedFile[] = documentComponentFile.concat(joinedPageFiles.files)

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
    const distFolder = buildFolderStructure(
      {
        pages: pageFiles,
        components: componentFiles,
        dist: distFiles,
        static: staticFiles,
      },
      options.distPath || DEFAULT_OUTPUT_FOLDER
    )

    return {
      outputFolder: distFolder,
      assetsPath: ASSETS_PREFIX.slice(1),
    }
  }

  return {
    addCustomMapping,
    generateProject,
  }
}

export default createReactNextGenerator
