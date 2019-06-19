import {
  generateLocalDependenciesPrefix,
  injectFilesToPath,
  resolveLocalDependencies,
} from './utils'

import {
  createManifestJSONFile,
  handlePackageJSON,
  createHTMLEntryFileChunks,
} from './file-handlers'

import { ProjectStrategy } from './types'

import { DEFAULT_TEMPLATE, DEFAULT_ROUTER_FILE_NAME } from './constants'

import {
  extractRoutes,
  extractPageMetadata,
  cloneObject,
  getComponentPath,
} from '@teleporthq/teleport-shared/lib/utils/uidl-utils'

import { Validator, Parser } from '@teleporthq/teleport-uidl-validator'

import {
  GeneratorOptions,
  GeneratedFolder,
  Mapping,
  ProjectGenerator,
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

    const parsedInput = Parser.parseProjectJSON(input)
    const contentValidationResult = validator.validateProjectContent(parsedInput)
    if (!contentValidationResult.valid) {
      throw new Error(contentValidationResult.errorMsg)
    }

    const uidl = resolveLocalDependencies(parsedInput, strategy)

    // Handling pages, based on the conditionals in the root node
    const { components = {}, root } = uidl
    const routeNodes = extractRoutes(root)
    const routeDefinitions = root.stateDefinitions.route
    const rootFolder = cloneObject(template || DEFAULT_TEMPLATE)
    let collectedDependencies: Record<string, string> = {}

    for (const routeNode of routeNodes) {
      const { value, node } = routeNode.content
      const pageName = value.toString()

      const { componentName, fileName } = extractPageMetadata(
        routeDefinitions,
        pageName,
        strategy.pages.metaDataOptions
      )

      const pageUIDL = {
        name: componentName,
        node,
        meta: {
          fileName,
        },
      }

      const generatorOptions: GeneratorOptions = {
        assetsPrefix,
        projectRouteDefinition: routeDefinitions,
        skipValidation: true,
        mapping,
      }

      const compiledPage = await strategy.pages.generator.generateComponent(
        pageUIDL,
        generatorOptions
      )

      const path = strategy.pages.path

      injectFilesToPath(rootFolder, path, compiledPage.files)
      collectedDependencies = { ...collectedDependencies, ...compiledPage.dependencies }
    }

    // Handle the components from the UIDL
    for (const componentName of Object.keys(components)) {
      const componentUIDL = components[componentName]

      const generatorOptions: GeneratorOptions = {
        assetsPrefix,
        projectRouteDefinition: routeDefinitions,
        skipValidation: true,
        mapping,
      }

      const compiledComponent = await strategy.components.generator.generateComponent(
        componentUIDL,
        generatorOptions
      )

      const relativePath = getComponentPath(componentUIDL)
      const path = strategy.components.path.concat(relativePath)

      injectFilesToPath(rootFolder, path, compiledComponent.files)
      collectedDependencies = { ...collectedDependencies, ...compiledComponent.dependencies }
    }

    // Global settings are transformed into the root html file and the manifest file for PWA support
    if (uidl.globals.manifest) {
      const manifestFile = createManifestJSONFile(uidl, assetsPrefix)
      injectFilesToPath(rootFolder, strategy.static.path, [manifestFile])
    }

    // Create the routing component in case the project generator has a strategy for that
    if (strategy.router) {
      const { generator: routerGenerator, path: routerFilePath, fileName } = strategy.router
      const routerLocalDependenciesPrefix = generateLocalDependenciesPrefix(
        routerFilePath,
        strategy.pages.path
      )
      const options = {
        localDependenciesPrefix: routerLocalDependenciesPrefix,
      }

      root.meta = root.meta || {}
      root.meta.fileName = fileName || DEFAULT_ROUTER_FILE_NAME

      const { files } = await routerGenerator.generateComponent(root, options)
      injectFilesToPath(rootFolder, routerFilePath, files)
    }

    // Create the entry file of the project (ex: index.html, _document.js)
    const chunkGenerationFunction =
      strategy.entry.chunkGenerationFunction || createHTMLEntryFileChunks
    const appRootOverride = strategy.entry.appRootOverride || null
    const entryFileName = strategy.entry.fileName || 'index'
    const chunks = chunkGenerationFunction(uidl, { assetsPrefix, appRootOverride })

    const [entryFile] = strategy.entry.generator.linkCodeChunks(chunks, entryFileName)
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
