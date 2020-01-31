import {
  injectFilesToPath,
  resolveLocalDependencies,
  createPageUIDLs,
  prepareComponentOutputOptions,
} from './utils'

import {
  createManifestJSONFile,
  handlePackageJSON,
  createComponent,
  createPage,
  createRouterFile,
  createEntryFile,
  createComponentModule,
  createPageModule,
} from './file-handlers'

import { DEFAULT_TEMPLATE, STYLED_DEPENDENCIES } from './constants'

import { UIDLUtils } from '@teleporthq/teleport-shared'

import { Validator, Parser } from '@teleporthq/teleport-uidl-validator'

import {
  GeneratorOptions,
  GeneratedFolder,
  Mapping,
  ProjectStrategy,
  ProjectStrategyComponentOptions,
  ComponentGenerator,
  ProjectStrategyPageOptions,
  ReactStyleVariation,
} from '@teleporthq/teleport-types'

import MagicString from 'magic-string'

type UpdateGeneratorCallback = (generator: ComponentGenerator) => void

export class ProjectGenerator {
  private strategy: ProjectStrategy
  private validator: Validator

  constructor(strategy: ProjectStrategy) {
    this.validator = new Validator()
    this.strategy = strategy
  }

  public getStrategy() {
    return this.strategy
  }

  public updateStrategy(strategy: Partial<ProjectStrategy>) {
    this.strategy = { ...this.strategy, ...strategy }
  }

  public updateGenerator(callback: UpdateGeneratorCallback) {
    this.updateComponentsGenerator(callback)
    this.updatePagesGenerator(callback)
  }

  public updateComponentsGenerator(callback: UpdateGeneratorCallback) {
    if (typeof callback === 'function') {
      callback(this.strategy.components.generator)
    }
  }

  public updatePagesGenerator(callback: UpdateGeneratorCallback) {
    if (typeof callback === 'function') {
      callback(this.strategy.pages.generator)
    }
  }

  public updateComponentsStrategy({
    generator,
    path,
    options,
  }: {
    generator?: ComponentGenerator
    path?: string[]
    options?: ProjectStrategyComponentOptions
  }) {
    if (generator) {
      this.strategy.components.generator = generator
    }

    if (path) {
      this.strategy.components.path = path
    }

    if (options && Object.keys(options).length > 0) {
      this.strategy.components.options = { ...this.strategy.components.options, ...options }
    }
  }

  public updatePagesStrategy({
    generator,
    path,
    options,
  }: {
    generator?: ComponentGenerator
    path?: string[]
    options?: ProjectStrategyPageOptions
  }) {
    if (generator) {
      this.strategy.pages.generator = generator
    }

    if (path) {
      this.strategy.pages.path = path
    }

    if (options && Object.keys(options).length > 0) {
      this.strategy.pages.options = { ...this.strategy.pages.options, ...options }
    }
  }

  public async generateProject(
    input: Record<string, unknown>,
    template: GeneratedFolder = DEFAULT_TEMPLATE,
    mapping: Mapping = {}
  ): Promise<GeneratedFolder> {
    // Validating and parsing the UIDL
    const schemaValidationResult = this.validator.validateProjectSchema(input)
    if (!schemaValidationResult.valid) {
      throw new Error(schemaValidationResult.errorMsg)
    }

    const uidl = Parser.parseProjectJSON(input)
    const contentValidationResult = this.validator.validateProjectContent(uidl)
    if (!contentValidationResult.valid) {
      throw new Error(contentValidationResult.errorMsg)
    }

    const { components = {}, root } = uidl

    // Based on the routing roles, separate pages into distict UIDLs with their own file names and paths
    const pageUIDLs = createPageUIDLs(uidl, this.strategy)

    // Set the filename and folder path for each component based on the strategy
    prepareComponentOutputOptions(components, this.strategy)

    // Set the local dependency paths based on the relative paths between files
    resolveLocalDependencies(pageUIDLs, components, this.strategy)

    // Initialize output folder and other reusable structures
    const rootFolder = UIDLUtils.cloneObject(template || DEFAULT_TEMPLATE)
    let collectedDependencies: Record<string, string> = {}

    // If static prefix is not specified, compute it from the path, but if the string is empty it should work
    const assetsPrefix =
      typeof this.strategy.static.prefix === 'string'
        ? this.strategy.static.prefix
        : '/' + this.getAssetsPath().join('/')
    const options: GeneratorOptions = {
      assetsPrefix,
      projectRouteDefinition: root.stateDefinitions.route,
      mapping,
      skipValidation: true,
    }

    // Handling pages
    for (const pageUIDL of pageUIDLs) {
      const { files, dependencies } = await createPage(pageUIDL, this.strategy, options)

      // Pages might be generated inside subfolders in the main pages folder
      const relativePath = UIDLUtils.getComponentFolderPath(pageUIDL)
      const path = this.strategy.pages.path.concat(relativePath)

      injectFilesToPath(rootFolder, path, files)
      collectedDependencies = { ...collectedDependencies, ...dependencies }

      if (this.strategy.pages.moduleGenerator) {
        const pageModule = await createPageModule(pageUIDL, this.strategy, options)
        injectFilesToPath(rootFolder, path, pageModule.files)
      }
    }

    // Handling components
    for (const componentName of Object.keys(components)) {
      const componentUIDL = components[componentName]
      const { files, dependencies } = await createComponent(componentUIDL, this.strategy, options)

      // Components might be generated inside subfolders in the main components folder
      const relativePath = UIDLUtils.getComponentFolderPath(componentUIDL)
      const path = this.strategy.components.path.concat(relativePath)

      injectFilesToPath(rootFolder, path, files)
      collectedDependencies = { ...collectedDependencies, ...dependencies }
    }

    // Handling module generation for components
    if (this.strategy.components.moduleGenerator) {
      const componentsModuleFile = await createComponentModule(uidl, this.strategy)
      injectFilesToPath(rootFolder, this.strategy.components.path, [componentsModuleFile])
    }

    // Handling framework specific changes to the project
    const { framework } = this.strategy

    if (framework && framework.config) {
      const { fileName, fileType, styleVariation } = framework.config
      if (styleVariation === ReactStyleVariation.StyledComponents) {
        const configFile = template.files.find(
          (file) => file.name === fileName && file.fileType === fileType
        )

        if (!configFile || !configFile.content) {
          throw new Error(`${fileName} not found, while adding gatsby-plugin-styled-components`)
        }

        const parsedFile = configFile.content.replace('/n', '//n')
        const magic = new MagicString(parsedFile)
        magic.appendRight(parsedFile.length - 5, `'gatsby-plugin-styled-components'`)
        configFile.content = magic.toString()

        collectedDependencies = { ...collectedDependencies, ...STYLED_DEPENDENCIES }
        injectFilesToPath(rootFolder, this.strategy.framework.config.configPath, [configFile])
      }
    }

    // Global settings are transformed into the root html file and the manifest file for PWA support
    if (uidl.globals.manifest) {
      const manifestFile = createManifestJSONFile(uidl, assetsPrefix)
      injectFilesToPath(rootFolder, this.strategy.static.path, [manifestFile])
    }

    // Create the routing component in case the project generator has a strategy for that
    if (this.strategy.router) {
      const routerFile = await createRouterFile(root, this.strategy)
      injectFilesToPath(rootFolder, this.strategy.router.path, [routerFile])
    }

    // Create the entry file of the project (ex: index.html, _document.js)
    if (this.strategy.entry) {
      const entryFile = await createEntryFile(uidl, this.strategy, { assetsPrefix })
      injectFilesToPath(rootFolder, this.strategy.entry.path, [entryFile])
    }

    // Inject all the collected dependencies in the package.json file
    handlePackageJSON(rootFolder, uidl, collectedDependencies)

    return rootFolder
  }

  public addMapping(mapping: Mapping) {
    this.strategy.components.generator.addMapping(mapping)

    if (this.strategy.components.generator !== this.strategy.pages.generator) {
      this.strategy.pages.generator.addMapping(mapping)
    }

    if (this.strategy.router) {
      // TODO: Add mapping later if we decide to reference a generator object instead of a generator function for routing
    }
  }

  public getAssetsPath() {
    return this.strategy.static.path
  }
}

export const createProjectGenerator = (strategy: ProjectStrategy): ProjectGenerator => {
  return new ProjectGenerator(strategy)
}

export default createProjectGenerator
