import {
  injectFilesToPath,
  resolveLocalDependencies,
  createPageUIDLs,
  prepareComponentFilenamesAndPath,
} from './utils'

import {
  createManifestJSONFile,
  handlePackageJSON,
  createComponent,
  createPage,
  createRouterFile,
  createEntryFile,
} from './file-handlers'

import { DEFAULT_TEMPLATE } from './constants'

import {
  cloneObject,
  getComponentPath,
} from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'

import { Validator, Parser } from '@teleporthq/teleport-uidl-validator'

import {
  GeneratorOptions,
  GeneratedFolder,
  Mapping,
  ProjectGenerator,
  ProjectStrategy,
} from '@teleporthq/teleport-types'

export const createProjectGenerator = (strategy: ProjectStrategy): ProjectGenerator => {
  const validator = new Validator()

  const assetsPath = strategy.static.path.join('/')
  const assetsPrefix = strategy.static.prefix || '/' + assetsPath

  const getAssetsPath = () => {
    return assetsPath
  }

  const generateProject = async (
    input: Record<string, unknown>,
    template: GeneratedFolder = DEFAULT_TEMPLATE,
    mapping: Mapping = {}
  ) => {
    // Validating and parsing the UIDL
    const schemaValidationResult = validator.validateProjectSchema(input)
    if (!schemaValidationResult.valid) {
      throw new Error(schemaValidationResult.errorMsg)
    }

    const uidl = Parser.parseProjectJSON(input)
    const contentValidationResult = validator.validateProjectContent(uidl)
    if (!contentValidationResult.valid) {
      throw new Error(contentValidationResult.errorMsg)
    }

    const { components = {}, root } = uidl

    // Based on the routing roles, separate pages into distict UIDLs with their own file names and paths
    const pageUIDLs = createPageUIDLs(root, strategy)

    // Set the filename and path for each component based on the strategy
    prepareComponentFilenamesAndPath(components, strategy)

    // Set the local dependency paths based on the relative paths between files
    resolveLocalDependencies(pageUIDLs, components, strategy)

    // Initialize output folder and other reusable structures
    const rootFolder = cloneObject(template || DEFAULT_TEMPLATE)
    let collectedDependencies: Record<string, string> = {}
    const options: GeneratorOptions = {
      assetsPrefix,
      projectRouteDefinition: root.stateDefinitions.route,
      mapping,
      skipValidation: true,
    }

    // Handling pages
    for (const pageUIDL of pageUIDLs) {
      const { files, dependencies } = await createPage(pageUIDL, strategy, options)

      // Pages might be generated inside subfolders in the main pages folder
      const relativePath = getComponentPath(pageUIDL)
      const path = strategy.pages.path.concat(relativePath)

      injectFilesToPath(rootFolder, path, files)
      collectedDependencies = { ...collectedDependencies, ...dependencies }
    }

    // Handling components
    for (const componentName of Object.keys(components)) {
      const componentUIDL = components[componentName]
      const { files, dependencies } = await createComponent(componentUIDL, strategy, options)

      // Components might be generated inside subfolders in the main components folder
      const relativePath = getComponentPath(componentUIDL)
      const path = strategy.components.path.concat(relativePath)

      injectFilesToPath(rootFolder, path, files)
      collectedDependencies = { ...collectedDependencies, ...dependencies }
    }

    // Global settings are transformed into the root html file and the manifest file for PWA support
    if (uidl.globals.manifest) {
      const manifestFile = createManifestJSONFile(uidl, assetsPrefix)
      injectFilesToPath(rootFolder, strategy.static.path, [manifestFile])
    }

    // Create the routing component in case the project generator has a strategy for that
    if (strategy.router) {
      const routerFile = await createRouterFile(root, strategy)
      injectFilesToPath(rootFolder, strategy.router.path, [routerFile])
    }

    // Create the entry file of the project (ex: index.html, _document.js)
    const entryFile = await createEntryFile(uidl, strategy, { assetsPrefix })
    injectFilesToPath(rootFolder, strategy.entry.path, [entryFile])

    // Inject all the collected dependencies in the package.json file
    handlePackageJSON(rootFolder, uidl, collectedDependencies)

    return rootFolder
  }

  const addMapping = (mapping: Mapping) => {
    strategy.components.generator.addMapping(mapping)

    if (strategy.components.generator !== strategy.pages.generator) {
      strategy.pages.generator.addMapping(mapping)
    }

    if (strategy.router) {
      // TODO: Add mapping later if we decide to reference a generator object instead of a generator function for routing
    }
  }

  return {
    addMapping,
    generateProject,
    getAssetsPath,
  }
}

export default createProjectGenerator
