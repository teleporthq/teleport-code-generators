import reactProjectMapping from './react-project-mapping.json'

import createReactGenerator, {
  ReactComponentStylingFlavors,
} from '../../component-generators/react/react-component'

import { createRouterIndexFile, buildFolderStructure } from './utils'

import {
  createPackageJSONFile,
  createHtmlIndexFile,
  createPageOutputs,
  createComponentOutputs,
  joinGeneratorOutputs,
  createManifestJSONFile,
} from '../../shared/utils/project-utils'

import {
  ASSETS_PREFIX,
  LOCAL_DEPENDENCIES_PREFIX,
  DEFAULT_OUTPUT_FOLDER,
  DEFAULT_PACKAGE_JSON,
} from './constants'

const initGenerator = (options: ProjectGeneratorOptions): ComponentGenerator => {
  const reactGenerator = createReactGenerator({
    variation: ReactComponentStylingFlavors.CSSModules,
  })

  reactGenerator.addMapping(reactProjectMapping)
  if (options.customMapping) {
    reactGenerator.addMapping(options.customMapping)
  }

  return reactGenerator
}

const createReactBasicGenerator = (generatorOptions: ProjectGeneratorOptions = {}) => {
  const reactGenerator = initGenerator(generatorOptions)

  const addCustomMapping = (mapping: Mapping) => {
    reactGenerator.addMapping(mapping)
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
        name: stateBranch.value,
        content: stateBranch.content,
        stateDefinitions: {
          routerDefinitions,
        },
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

    // Step 2: The components generation process is started
    const componentPromises = Object.keys(components).map((componentName) => {
      const componentUIDL = components[componentName]
      const componentParams: ComponentFactoryParams = {
        componentGenerator: reactGenerator,
        componentUIDL,
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

    // Step 5: Global settings are transformed into the root html file and the manifest file for PWA support
    const staticFiles: GeneratedFile[] = []
    if (uidl.globals.manifest) {
      const manifestFile = createManifestJSONFile(uidl, ASSETS_PREFIX)
      staticFiles.push(manifestFile)
    }

    // Step 6: Create the routing component (index.js)
    const { routerFile, externalDependencies } = await createRouterIndexFile(root)
    const htmlIndexFile = createHtmlIndexFile(uidl, { assetsPrefix: ASSETS_PREFIX })

    const srcFiles: GeneratedFile[] = [htmlIndexFile, routerFile]

    // Step 7: Join all the external dependencies
    const collectedDependencies = {
      ...externalDependencies,
      ...joinedPageFiles.dependencies,
      ...joinedComponentFiles.dependencies,
    }

    // Step 8: Create the package.json file
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
