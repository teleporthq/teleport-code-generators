import {
  createPageOutputs,
  createComponentOutputs,
  joinGeneratorOutputs,
  createManifestJSONFile,
  generateLocalDependenciesPrefix,
  handlePackageJSON,
  injectFilesToPath,
} from './utils'

import { ProjectStrategy } from './types'

import { DEFAULT_TEMPLATE } from './constants'

import { extractRoutes, cloneObject } from '@teleporthq/teleport-shared/lib/utils/uidl-utils'

import { Validator, Parser } from '@teleporthq/teleport-uidl-validator'

import {
  ComponentFactoryParams,
  GeneratorOptions,
  GeneratedFolder,
  ComponentUIDL,
} from '@teleporthq/teleport-types'

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

    const { components = {}, root } = uidl
    const routeNodes = extractRoutes(root)
    const rootFolder = cloneObject(template)

    // pages have local dependencies in components
    const pagesLocalDependenciesPrefix = generateLocalDependenciesPrefix(
      strategy.pages.path,
      strategy.components.path
    )

    const pagePromises = routeNodes.map((routeNode) => {
      const { value, node } = routeNode.content
      const pageName = value.toString()

      const componentUIDL: ComponentUIDL = {
        name: pageName,
        node,
        stateDefinitions: root.stateDefinitions,
      }

      const pageParams: ComponentFactoryParams = {
        componentGenerator: strategy.components.generator,
        componentUIDL,
        generatorOptions: {
          localDependenciesPrefix: pagesLocalDependenciesPrefix,
          assetsPrefix,
          projectRouteDefinition: root.stateDefinitions.route,
        },
      }
      return createPageOutputs(pageParams)
    })

    // Step 3: The components generation process is started
    const componentPromises = Object.keys(components).map((componentName) => {
      const componentUIDL = components[componentName]
      const componentParams: ComponentFactoryParams = {
        componentGenerator: strategy.components.generator,
        componentUIDL,
        generatorOptions: {
          assetsPrefix,
          projectRouteDefinition: root.stateDefinitions.route,
        },
      }
      return createComponentOutputs(componentParams)
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
