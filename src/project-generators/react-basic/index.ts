import reactProjectMapping from './react-project-mapping.json'

import createReactGenerator, {
  ReactComponentStylingFlavors,
} from '../../component-generators/react/react-component'

import { generateManifestFile, createRouterIndexFile, buildFolderStructure } from './utils'

import {
  createPackageJSONFile,
  createHtmlIndexFile,
  createPageFile,
  createComponentFile,
  joinComponentFiles,
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

export default async (uidl: ProjectUIDL, options: ProjectGeneratorOptions = {}) => {
  // Step 0: Initialize the component generator
  const reactGenerator = initGenerator(options)

  const { components = {}, root } = uidl
  const { states = [] } = root.content

  const stateDefinitions = root.stateDefinitions || {}
  const routerDefinitions = stateDefinitions.router || null

  // Step 1: The first level stateBranches (the pages) transformation in react components is started
  const pagePromises = states.map(async (stateBranch) => {
    const pageParams: PageFactoryParams = {
      reactGenerator,
      stateBranch,
      routerDefinitions,
      componentOptions: {
        assetsPrefix: ASSETS_PREFIX,
        localDependenciesPrefix: LOCAL_DEPENDENCIES_PREFIX,
      },
    }
    return createPageFile(pageParams)
  })

  // Step 2: The components generation process is started
  const componentPromises = Object.keys(components).map(async (componentName) => {
    const componentUIDL = components[componentName]
    const componentParams: ComponentFactoryParams = {
      reactGenerator,
      componentUIDL,
      componentOptions: { assetsPrefix: ASSETS_PREFIX },
    }
    return createComponentFile(componentParams)
  })

  // Step 3: The process of creating the pages and the components is awaited
  const createdPageFiles = await Promise.all(pagePromises)
  const createdComponentFiles = await Promise.all(componentPromises)

  // Step 4: The generated page and component files are joined
  const joinedPageFiles = joinComponentFiles(createdPageFiles)
  const pageFiles: GeneratedFile[] = joinedPageFiles.files

  const joinedComponentFiles = joinComponentFiles(createdComponentFiles)
  const componentFiles: GeneratedFile[] = joinedComponentFiles.files

  // Step 5: Global settings are transformed into the root html file and the manifest file for PWA support
  const manifestFile = generateManifestFile(uidl)
  const staticFiles: GeneratedFile[] = [].concat(manifestFile)

  // Step 6: Create the routing component (index.js)
  const { indexFile, externalDependencies } = await createRouterIndexFile(root)
  const htmlIndexFile = createHtmlIndexFile(uidl, ASSETS_PREFIX)

  const srcFiles: GeneratedFile[] = [].concat(htmlIndexFile).concat(indexFile)

  // Step 7: Join all the external dependencies
  const collectedDependencies = {
    ...externalDependencies,
    ...joinedPageFiles.dependencies,
    ...joinedComponentFiles.dependencies,
  }

  // Step 8: Create the package.json file
  const { sourcePackageJson } = options
  const packageFile = createPackageJSONFile(sourcePackageJson || DEFAULT_PACKAGE_JSON, {
    dependencies: collectedDependencies,
    projectName: uidl.name,
  })

  const distFiles: GeneratedFile[] = [packageFile]

  // Step 9: Build the folder structure
  const distFolder = buildFolderStructure({
    componentFiles,
    pageFiles,
    staticFiles,
    srcFiles,
    distFiles,
    distFolderName: options.distPath || DEFAULT_OUTPUT_FOLDER,
  })

  const result = {
    outputFolder: distFolder,
    assetsPath: 'src' + ASSETS_PREFIX,
  }

  return result
}
