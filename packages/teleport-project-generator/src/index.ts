import {
  joinGeneratorOutputs,
  createManifestJSONFile,
  generateLocalDependenciesPrefix,
  handlePackageJSON,
  injectFilesToPath,
} from './utils'

import { ProjectStrategy } from './types'

import { DEFAULT_TEMPLATE } from './constants'

import {
  extractRoutes,
  extractPageMetadata,
  cloneObject,
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

    const uidl = Parser.parseProjectJSON(input)
    const contentValidationResult = validator.validateProjectContent(uidl)
    if (!contentValidationResult.valid) {
      throw new Error(contentValidationResult.errorMsg)
    }

    // Handling pages, based on the conditionals in the root node
    const { components = {}, root } = uidl
    const routeNodes = extractRoutes(root)
    const routeDefinitions = root.stateDefinitions.route
    const rootFolder = cloneObject(template || DEFAULT_TEMPLATE)

    // Pages have local dependencies in components
    const pagesLocalDependenciesPrefix = generateLocalDependenciesPrefix(
      strategy.pages.path,
      strategy.components.path
    )

    const pagePromises = routeNodes.map((routeNode) => {
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
        localDependenciesPrefix: pagesLocalDependenciesPrefix,
        assetsPrefix,
        projectRouteDefinition: routeDefinitions,
        skipValidation: true,
        mapping,
      }

      return strategy.pages.generator.generateComponent(pageUIDL, generatorOptions)
    })

    // Handle the components from the UIDL
    const componentPromises = Object.keys(components).map((componentName) => {
      const componentUIDL = components[componentName]
      const generatorOptions: GeneratorOptions = {
        assetsPrefix,
        projectRouteDefinition: routeDefinitions,
        skipValidation: true,
        mapping,
      }

      return strategy.components.generator.generateComponent(componentUIDL, generatorOptions)
    })

    // The components and pages are generated in parallel
    const createdPageFiles = await Promise.all(pagePromises)
    const createdComponentFiles = await Promise.all(componentPromises)

    // The generated page and component files are joined into a single structure
    // and the files are injected in the corresponding folders
    const joinedPageFiles = joinGeneratorOutputs(createdPageFiles)
    injectFilesToPath(rootFolder, strategy.pages.path, joinedPageFiles.files)

    const joinedComponentFiles = joinGeneratorOutputs(createdComponentFiles)
    injectFilesToPath(rootFolder, strategy.components.path, joinedComponentFiles.files)

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

    // Handle the package.json file
    const collectedDependencies = {
      ...joinedPageFiles.dependencies,
      ...joinedComponentFiles.dependencies,
    }

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
