import {
  createManifestJSONFile,
  generateLocalDependenciesPrefix,
  handlePackageJSON,
  injectFilesToPath,
  resolveLocalDependencies,
} from './utils'

import { ProjectStrategy } from './types'

import { DEFAULT_TEMPLATE } from './constants'

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
      const routerLocalDependenciesPrefix = generateLocalDependenciesPrefix(
        strategy.router.path,
        strategy.pages.path
      )
      const routerFile = await strategy.router.generatorFunction(root, {
        localDependenciesPrefix: routerLocalDependenciesPrefix,
      })
      injectFilesToPath(rootFolder, strategy.router.path, [routerFile])
    }

    // Create the entry file of the project (index.html in most of the cases)
    const entryFile = await strategy.entry.generatorFunction(uidl, { assetsPrefix })
    injectFilesToPath(rootFolder, strategy.entry.path, [entryFile])

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
