import {
  injectFilesToPath,
  resolveLocalDependencies,
  createPageUIDLs,
  prepareComponentOutputOptions,
  generateExternalCSSImports,
  fileFileAndReplaceContent,
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

import PathResolver from 'path'

import { DEFAULT_TEMPLATE } from './constants'

import { UIDLUtils } from '@teleporthq/teleport-shared'
import { Validator, Parser } from '@teleporthq/teleport-uidl-validator'
import { resolveStyleSetDefinitions } from '@teleporthq/teleport-uidl-resolver'
import {
  GeneratorOptions,
  GeneratedFolder,
  Mapping,
  ProjectStrategy,
  ProjectStrategyComponentOptions,
  ComponentGenerator,
  ProjectStrategyPageOptions,
  ConfigGeneratorResult,
  GeneratedFile,
} from '@teleporthq/teleport-types'

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
    let cleanedUIDL = input
    const inMemoryFilesMap = new Map<
      string,
      { rootFolder: GeneratedFolder; path: string[]; files: GeneratedFile[] }
    >()
    // Validating and parsing the UIDL
    const schemaValidationResult = this.validator.validateProjectSchema(input)
    const { valid, projectUIDL } = schemaValidationResult
    if (valid && projectUIDL) {
      cleanedUIDL = (projectUIDL as unknown) as Record<string, unknown>
    } else {
      throw new Error(schemaValidationResult.errorMsg)
    }

    const uidl = Parser.parseProjectJSON(cleanedUIDL)

    /* Style sets contains only on project level. So passing them through componentcycle
    just resolves for that component alone and don't have any impact for other components.
    So, resolving happens here and is passed to all components. */
    if (uidl.root?.styleSetDefinitions) {
      uidl.root.styleSetDefinitions = resolveStyleSetDefinitions(uidl.root.styleSetDefinitions)
    }

    const contentValidationResult = this.validator.validateProjectContent(uidl)
    if (!contentValidationResult.valid) {
      throw new Error(contentValidationResult.errorMsg)
    }

    const { components = {} } = uidl
    const { styleSetDefinitions = {} } = uidl.root

    // Based on the routing roles, separate pages into distict UIDLs with their own file names and paths
    const pageUIDLs = createPageUIDLs(uidl, this.strategy)

    if (Object.keys(components).length > 0) {
      // Set the filename and folder path for each component based on the strategy
      prepareComponentOutputOptions(components, this.strategy)
      // Set the local dependency paths based on the relative paths between files
      resolveLocalDependencies(pageUIDLs, components, this.strategy)
    }

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
      projectRouteDefinition: uidl.root.stateDefinitions.route,
      mapping,
      skipValidation: true,
    }

    // Handling project style sheet
    if (this.strategy.projectStyleSheet?.generator && Object.keys(styleSetDefinitions).length > 0) {
      const { generator, path } = this.strategy.projectStyleSheet
      const { files, dependencies } = await generator.generateComponent(uidl.root, {
        isRootComponent: true,
      })

      inMemoryFilesMap.set('projectStyleSheet', {
        rootFolder,
        path,
        files,
      })

      collectedDependencies = { ...collectedDependencies, ...dependencies }
    }

    // Handling pages
    for (const pageUIDL of pageUIDLs) {
      let pageOptions = options
      const pagesPath = this.strategy.pages.path
      if (Object.keys(styleSetDefinitions).length > 0 && this.strategy.projectStyleSheet) {
        const relativePathForProjectStyleSheet =
          PathResolver.relative(
            /* When each page is created inside a another folder then we just need to 
          add one more element to the path resolver to maintian the hierarcy */
            this.strategy.pages.options?.createFolderForEachComponent
              ? [...pagesPath, pageUIDL.name].join('/')
              : pagesPath.join('/'),
            this.strategy.projectStyleSheet.path.join('/')
          ) || '.'

        /* If relative path resolver returns empty string, then both the files are in the same
        folder. */

        pageOptions = {
          ...options,
          projectStyleSet: {
            styleSetDefinitions,
            fileName: this.strategy.projectStyleSheet.fileName,
            path: relativePathForProjectStyleSheet,
            importFile: this.strategy.projectStyleSheet?.importFile ? true : false,
          },
        }
      }

      const { files, dependencies } = await createPage(pageUIDL, this.strategy, pageOptions)
      // Pages might be generated inside subfolders in the main pages folder
      const relativePath = UIDLUtils.getComponentFolderPath(pageUIDL)
      const path = this.strategy.pages.path.concat(relativePath)

      inMemoryFilesMap.set(pageUIDL.name, {
        rootFolder,
        path,
        files,
      })

      collectedDependencies = { ...collectedDependencies, ...dependencies }

      if (this.strategy.pages.moduleGenerator) {
        const pageModule = await createPageModule(pageUIDL, this.strategy, options)

        inMemoryFilesMap.set(`${pageUIDL.name}Module`, {
          rootFolder,
          path,
          files: pageModule.files,
        })

        collectedDependencies = { ...collectedDependencies, ...pageModule.dependencies }
      }
    }

    // Handling module generation for components
    if (this.strategy.components.moduleGenerator) {
      const componentsModule = await createComponentModule(uidl, this.strategy)

      inMemoryFilesMap.set(componentsModule.files[0].name, {
        rootFolder,
        path: this.strategy.components.path,
        files: componentsModule.files,
      })

      collectedDependencies = { ...collectedDependencies, ...componentsModule.dependencies }
    }

    // Handling components
    for (const componentName of Object.keys(components)) {
      let componentOptions = options
      const componentsPath = this.strategy.components.path
      if (Object.keys(styleSetDefinitions).length > 0 && this.strategy.projectStyleSheet) {
        const relativePathForProjectStyleSheet =
          PathResolver.relative(
            /* When each page is created inside a another folder then we just need to 
          add one more element to the path resolver to maintian the hierarcy */
            this.strategy.components.options?.createFolderForEachComponent
              ? [...componentsPath, componentName].join('/')
              : componentsPath.join('/'),
            this.strategy.projectStyleSheet.path.join('/')
          ) || '.'

        /* If relative path resolver returns empty string, then both the files are in the same
        folder. */

        componentOptions = {
          ...options,
          projectStyleSet: {
            styleSetDefinitions,
            fileName: this.strategy.projectStyleSheet.fileName,
            path: relativePathForProjectStyleSheet,
            importFile: this.strategy.projectStyleSheet?.importFile ? true : false,
          },
        }
      }

      const componentUIDL = components[componentName]
      const { files, dependencies } = await createComponent(
        componentUIDL,
        this.strategy,
        componentOptions
      )

      // Components might be generated inside subfolders in the main components folder
      const relativePath = UIDLUtils.getComponentFolderPath(componentUIDL)
      const path = this.strategy.components.path.concat(relativePath)

      inMemoryFilesMap.set(componentName, {
        rootFolder,
        path,
        files,
      })

      collectedDependencies = { ...collectedDependencies, ...dependencies }
    }

    // Handling framework specific changes to the project
    const { framework } = this.strategy

    // Can be used for replacing a couple of strings
    if (framework?.replace) {
      const shouldAddChanges =
        Boolean(
          framework.replace?.isGlobalStylesDependent && Object.keys(styleSetDefinitions).length > 0
        ) || !framework.replace?.isGlobalStylesDependent
      if (shouldAddChanges) {
        const { fileName, fileType } = framework.replace
        const result = framework.replace.replaceFile(
          template,
          collectedDependencies,
          fileName,
          fileType
        )
        collectedDependencies = result.dependencies

        inMemoryFilesMap.set(fileName, {
          rootFolder,
          path: this.strategy.framework.replace.path,
          files: [result.file],
        })
      }
    }

    // If we want to generate a completly new file
    if (framework?.config) {
      const { fileName, fileType, configContentGenerator, generator } = framework.config

      if (configContentGenerator && generator) {
        const result: ConfigGeneratorResult = configContentGenerator({
          fileName,
          fileType,
          globalStyles: {
            path: PathResolver.relative(
              framework.config.path.join('/'),
              this.strategy.projectStyleSheet.path.join('/')
            ),
            sheetName: this.strategy.projectStyleSheet
              ? this.strategy.projectStyleSheet.fileName
              : '',
            isGlobalStylesDependent: Boolean(
              framework.config?.isGlobalStylesDependent &&
                Object.keys(styleSetDefinitions).length > 0
            ),
          },
          dependencies: collectedDependencies,
        })
        collectedDependencies = result.dependencies

        if (Object.keys(result?.chunks).length > 0) {
          const files = framework.config.generator.linkCodeChunks(
            result.chunks,
            framework.config.fileName
          )

          inMemoryFilesMap.set(fileName, {
            rootFolder,
            path: this.strategy.framework.config.path,
            files,
          })
        }
      }
    }

    // Global settings are transformed into the root html file and the manifest file for PWA support
    if (uidl.globals.manifest) {
      const manifestFile = createManifestJSONFile(uidl, assetsPrefix)

      inMemoryFilesMap.set(manifestFile.name, {
        rootFolder,
        path: this.strategy.static.path,
        files: [manifestFile],
      })
    }

    // TODO: Projects which don't need a router file will miss collecting
    // dependencies which are specified on them

    // Create the routing component in case the project generator has a strategy for that
    if (this.strategy.router) {
      const { routerFile, dependencies } = await createRouterFile(uidl.root, this.strategy)

      inMemoryFilesMap.set('router', {
        rootFolder,
        path: this.strategy.router.path,
        files: [routerFile],
      })

      collectedDependencies = { ...collectedDependencies, ...dependencies }
    }

    // Create the entry file of the project (ex: index.html, _document.js)
    if (this.strategy.entry) {
      const entryFile = await createEntryFile(uidl, this.strategy, { assetsPrefix })
      inMemoryFilesMap.set('entry', {
        rootFolder,
        path: this.strategy.entry.path,
        files: [entryFile],
      })
    }

    // If the framework needs all the external css dependencies to be placed in some other file
    if (framework?.externalStyles && this.strategy.pages.options?.useFileNameForNavigation) {
      const { fileName } = framework.externalStyles
      const folder = inMemoryFilesMap.get(fileName)

      if (!folder) {
        throw new Error(`Canno't find file - ${fileName} from the list of files generated`)
      }

      const [resultFile] = await generateExternalCSSImports(uidl.root)
      const files = fileFileAndReplaceContent(folder.files, fileName, resultFile.content)

      inMemoryFilesMap.set(fileName, {
        rootFolder,
        path: folder.path,
        files,
      })
    }

    inMemoryFilesMap.forEach((stage) => {
      injectFilesToPath(stage.rootFolder, stage.path, stage.files)
    })

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
