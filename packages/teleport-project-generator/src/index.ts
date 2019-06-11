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

import { GeneratorOptions, GeneratedFolder } from '@teleporthq/teleport-types'

export const createProjectGenerator = (strategy: ProjectStrategy) => {
  const validator = new Validator()

  const assetsPath = strategy.static.path.join('/')
  const assetsPrefix = strategy.static.prefix || assetsPath

  const getAssetsPath = () => {
    return assetsPath
  }

  const generateProject = async (
    input: Record<string, unknown>,
    template: GeneratedFolder = DEFAULT_TEMPLATE,
    options: GeneratorOptions = {}
  ) => {
    if (!options.skipValidation) {
      const schemaValidationResult = validator.validateProjectSchema(input)
      if (!schemaValidationResult.valid) {
        throw new Error(schemaValidationResult.errorMsg)
      }
    }

    const uidl = Parser.parseProjectJSON(input)
    const contentValidationResult = validator.validateProjectContent(uidl)
    if (!contentValidationResult.valid) {
      throw new Error(contentValidationResult.errorMsg)
    }

    // Handling pages
    const { components = {}, root } = uidl
    const routeNodes = extractRoutes(root)
    const routeDefinitions = root.stateDefinitions.route
    const rootFolder = cloneObject(template)

    // pages have local dependencies in components
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
        strategy.pages.metaOptions
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
      }

      return strategy.pages.generator.generateComponent(pageUIDL, generatorOptions)
    })

    // Handle the components
    const componentPromises = Object.keys(components).map((componentName) => {
      const componentUIDL = components[componentName]
      const generatorOptions: GeneratorOptions = {
        assetsPrefix,
        projectRouteDefinition: routeDefinitions,
        skipValidation: true,
      }

      return strategy.components.generator.generateComponent(componentUIDL, generatorOptions)
    })

    // Step 4: The process of creating the pages and the components is awaited
    const createdPageFiles = await Promise.all(pagePromises)
    const createdComponentFiles = await Promise.all(componentPromises)

    // Step 5: The generated page and component files are joined
    const joinedPageFiles = joinGeneratorOutputs(createdPageFiles)
    injectFilesToPath(rootFolder, strategy.pages.path, joinedPageFiles.files)

    const joinedComponentFiles = joinGeneratorOutputs(createdComponentFiles)
    injectFilesToPath(rootFolder, strategy.components.path, joinedComponentFiles.files)

    // Step 6: Global settings are transformed into the root html file and the manifest file for PWA support
    if (uidl.globals.manifest) {
      const manifestFile = createManifestJSONFile(uidl, assetsPrefix)
      injectFilesToPath(rootFolder, strategy.static.path, [manifestFile])
    }

    // Step 7: Create the routing component (index.js) and the html entry file (index.html)
    if (strategy.router) {
      const routerLocalDependenciesPrefix = generateLocalDependenciesPrefix(
        strategy.router.path,
        strategy.pages.path
      )
      const routerFile = await strategy.router.generator(root, {
        localDependenciesPrefix: routerLocalDependenciesPrefix,
      })
      injectFilesToPath(rootFolder, strategy.router.path, [routerFile])
    }

    const entryFile = await strategy.entry.generator(uidl, { assetsPrefix })
    injectFilesToPath(rootFolder, strategy.entry.path, [entryFile])

    // Step 8: Join all the external dependencies
    const collectedDependencies = {
      ...joinedPageFiles.dependencies,
      ...joinedComponentFiles.dependencies,
    }

    // Step 9: Handle the package.json file
    handlePackageJSON(rootFolder, uidl, collectedDependencies)

    return {
      outputFolder: rootFolder,
      assetsPath,
    }
  }

  return {
    generateProject,
    getAssetsPath,
  }
}

export default createProjectGenerator
