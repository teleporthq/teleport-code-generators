import {
  createPageFile,
  createComponentFile,
  joinComponentFiles,
  createManifestJSONFile,
  createPackageJSONFile,
} from '../../shared/utils/project-utils'

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
import nextMapping from './next-mapping.json'

const initGenerator = (options: ProjectGeneratorOptions): ComponentGenerator => {
  const reactGenerator = createReactGenerator({
    variation: ReactComponentStylingFlavors.StyledJSX,
    customMapping: nextMapping,
  })

  reactGenerator.addMapping(nextMapping)
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

  // Step 1: The root html file is customized in next via the _document.js page
  const documentComponentFile = [].concat(createDocumentComponentFile(uidl))

  // Step 2: The first level stateBranches (the pages) transformation in react components is started
  const pagePromises = states.map(async (stateBranch) => {
    const pageParams: PageFactoryParams = {
      componentGenerator: reactGenerator,
      stateBranch,
      routerDefinitions,
      componentOptions: {
        assetsPrefix: ASSETS_PREFIX,
        localDependenciesPrefix: LOCAL_DEPENDENCIES_PREFIX,
      },
      pageMetadataOptions: {
        usePathAsFileName: true,
        convertDefaultToIndex: true,
      },
    }
    return createPageFile(pageParams)
  })

  // Step 3: The components generation process is started
  const componentPromises = Object.keys(components).map(async (componentName) => {
    const componentUIDL = components[componentName]
    const componentParams: ComponentFactoryParams = {
      componentUIDL,
      componentGenerator: reactGenerator,
      componentOptions: { assetsPrefix: ASSETS_PREFIX },
    }
    return createComponentFile(componentParams)
  })

  // Step 3: The process of creating the pages and the components is awaited
  const createdPageFiles = await Promise.all(pagePromises)
  const createdComponentFiles = await Promise.all(componentPromises)

  // Step 4: The generated page and component files are joined
  const joinedPageFiles = joinComponentFiles(createdPageFiles)
  const pageFiles: GeneratedFile[] = documentComponentFile.concat(joinedPageFiles.files)

  const joinedComponentFiles = joinComponentFiles(createdComponentFiles)
  const componentFiles: GeneratedFile[] = joinedComponentFiles.files

  // Step 5: Global settings are transformed into the manifest file for PWA support
  const manifestFile = createManifestJSONFile(uidl, ASSETS_PREFIX)
  const staticFiles: GeneratedFile[] = [].concat(manifestFile)

  const collectedDependencies = {
    ...joinedPageFiles.dependencies,
    ...joinedComponentFiles.dependencies,
  }

  // Step 6: External dependencies are added to the package.json file from the template project
  const packageFile = createPackageJSONFile(options.sourcePackageJson || DEFAULT_PACKAGE_JSON, {
    dependencies: collectedDependencies,
    projectName: uidl.name,
  })
  const distFiles: GeneratedFile[] = [packageFile]

  // Step 7: Build the folder structure
  const distFolder = buildFolderStructure({
    pageFiles,
    componentFiles,
    distFiles,
    publicFiles: staticFiles,
    distFolderName: options.distPath || DEFAULT_OUTPUT_FOLDER,
  })

  return {
    outputFolder: distFolder,
    assetsPath: ASSETS_PREFIX.slice(1),
  }
}
