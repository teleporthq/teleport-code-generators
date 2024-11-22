import { GenericUtils, StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { Validator, Parser } from '@teleporthq/teleport-uidl-validator'
import {
  GeneratorOptions,
  GeneratedFolder,
  Mapping,
  ProjectStrategy,
  ProjectStrategyComponentOptions,
  ComponentGenerator,
  ProjectStrategyPageOptions,
  ConfigGeneratorResult,
  ProjectPlugin,
  InMemoryFileRecord,
  TeleportError,
  GeneratorFactoryParams,
  HTMLComponentGenerator,
  ProjectGenerator as ProjectGeneratorType,
  FileType,
  UIDLLocalFontAsset,
} from '@teleporthq/teleport-types'
import {
  injectFilesToPath,
  resolveLocalDependencies,
  createPageUIDLs,
  prepareComponentOutputOptions,
  generateExternalCSSImports,
  fileFileAndReplaceContent,
  bootstrapGenerator,
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
  createEnvFiles,
  createGitIgnoreFile,
} from './file-handlers'
import { DEFAULT_TEMPLATE } from './constants'
import ProjectAssemblyLine from './assembly-line'
import { join } from 'path'
import { resourceGenerator } from './resource'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

type UpdateGeneratorCallback = (generator: ComponentGenerator) => void

export class ProjectGenerator implements ProjectGeneratorType {
  public componentGenerator: ComponentGenerator | HTMLComponentGenerator
  public pageGenerator: ComponentGenerator | HTMLComponentGenerator
  public routerGenerator: ComponentGenerator
  public styleSheetGenerator: ComponentGenerator
  private strategy: ProjectStrategy
  private validator: Validator
  private assemblyLine: ProjectAssemblyLine

  private assetPrefix: string | null = null
  private assetsAndPathMapping: Record<string, string> = {}
  private assetIdentifier: string | null = null

  constructor(strategy: ProjectStrategy) {
    this.validator = new Validator()
    this.strategy = strategy
    this.assemblyLine = new ProjectAssemblyLine()
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
      callback(this.strategy.components.generator())
    }
  }

  public updatePagesGenerator(callback: UpdateGeneratorCallback) {
    if (typeof callback === 'function') {
      callback(this.strategy.pages.generator())
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
      this.strategy.components.generator = () => generator
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
      this.strategy.pages.generator = () => generator
    }

    if (path) {
      this.strategy.pages.path = path
    }

    if (options && Object.keys(options).length > 0) {
      this.strategy.pages.options = { ...this.strategy.pages.options, ...options }
    }
  }

  public setAssets(params: GeneratorOptions['assets']) {
    const { mappings, prefix, identifier } = params
    if (mappings) {
      this.assetsAndPathMapping = mappings
    }

    if (prefix) {
      this.assetPrefix = prefix
    }

    if (identifier) {
      this.assetIdentifier = identifier
    }
  }

  public async generateProject(
    input: Record<string, unknown>,
    template: GeneratedFolder = DEFAULT_TEMPLATE,
    mapping: Mapping = {},
    strictHtmlWhitespaceSensitivity: boolean = false
  ): Promise<GeneratedFolder> {
    let cleanedUIDL = input
    let collectedDependencies: Record<string, string> = {}
    let collectedDevDependencies: Record<string, string> = {}
    let inMemoryFilesMap = new Map<string, InMemoryFileRecord>()

    // Initialize output folder and other reusable structures
    const rootFolder = UIDLUtils.cloneObject(template || DEFAULT_TEMPLATE)
    const schemaValidationResult = this.validator.validateProjectSchema(input)
    const { valid, projectUIDL } = schemaValidationResult

    if (valid && projectUIDL) {
      cleanedUIDL = projectUIDL as unknown as Record<string, unknown>
    } else {
      throw new Error(schemaValidationResult.errorMsg)
    }

    const uidl = Parser.parseProjectJSON(cleanedUIDL)
    const contentValidationResult = this.validator.validateProjectContent(uidl)
    if (!contentValidationResult.valid) {
      throw new Error(contentValidationResult.errorMsg)
    }

    try {
      const runBeforeResult = await this.assemblyLine.runBefore({
        uidl,
        template,
        files: inMemoryFilesMap,
        strategy: this.strategy,
        dependencies: collectedDependencies,
        devDependencies: collectedDevDependencies,
        rootFolder,
      })

      collectedDependencies = { ...collectedDependencies, ...runBeforeResult.dependencies }
      collectedDevDependencies = { ...collectedDevDependencies, ...runBeforeResult.devDependencies }

      this.strategy = runBeforeResult.strategy
      inMemoryFilesMap = runBeforeResult.files

      if (this.strategy.components?.generator) {
        this.componentGenerator = bootstrapGenerator(
          this.strategy.components,
          this.strategy.style,
          strictHtmlWhitespaceSensitivity
        )
      }

      if (this.strategy.pages?.generator) {
        this.pageGenerator = bootstrapGenerator(
          this.strategy.pages,
          this.strategy.style,
          strictHtmlWhitespaceSensitivity
        )
      }

      if (this.strategy.projectStyleSheet?.generator) {
        this.styleSheetGenerator = bootstrapGenerator(
          this.strategy.projectStyleSheet,
          this.strategy.style,
          strictHtmlWhitespaceSensitivity
        )
      }

      if (this.strategy.router?.generator) {
        this.routerGenerator = bootstrapGenerator(
          this.strategy.router,
          this.strategy.style,
          strictHtmlWhitespaceSensitivity
        )
      }
    } catch (error) {
      console.trace(error)
      throw new TeleportError(`Error in Generating Project after runBefore`)
    }

    const { components = {} } = uidl
    const { styleSetDefinitions = {}, designLanguage: {} = {} } = uidl.root

    // Based on the routing roles, separate pages into distict UIDLs with their own file names and paths
    const pageUIDLs = createPageUIDLs(uidl, this.strategy)

    if (Object.keys(components).length > 0) {
      // Set the filename and folder path for each component based on the strategy
      prepareComponentOutputOptions(components, this.strategy)
      // Set the local dependency paths based on the relative paths between files
      resolveLocalDependencies(pageUIDLs, components, this.strategy)
    }

    // If static prefix is not specified, compute it from the path, but if the string is empty it should work
    const assetsPrefix = (
      this.assetPrefix ? this.assetPrefix : typeof this.strategy.static.prefix === 'string'
    )
      ? this.strategy.static.prefix
      : '/' + this.getAssetsPath().join('/')

    const options: GeneratorOptions = {
      assets: {
        prefix: assetsPrefix,
        mappings: this.assetsAndPathMapping,
        identifier: this.assetIdentifier,
        fontsFolder: join(
          ...(this.strategy?.static?.path || []),
          this.assetIdentifier ?? '',
          'fonts'
        ),
        localFonts: uidl.globals?.assets.filter(
          (asset) => asset.type === 'local-font'
        ) as UIDLLocalFontAsset[],
      },
      projectRouteDefinition: uidl.root.stateDefinitions.route,
      designLanguage: uidl.root?.designLanguage,
      mapping,
      extractedResources: {},
      skipValidation: true,
      ...(uidl.resources &&
        this.strategy?.resources?.path && {
          resources: {
            items: uidl?.resources?.items,
            cache: uidl?.resources.cache,
            path: this.strategy.resources.path,
          },
        }),
      ...(this.strategy.projectStyleSheet?.generator &&
        this.strategy.projectStyleSheet?.path && {
          projectStyleSet: {
            styleSetDefinitions,
            fileName: this.strategy.projectStyleSheet?.fileName,
            path: GenericUtils.generateLocalDependenciesPrefix(
              this.strategy.pages.path,
              this.strategy.pages.options?.createFolderForEachComponent
                ? ['..', ...this.strategy.projectStyleSheet.path]
                : this.strategy.projectStyleSheet?.path
            ),
            importFile: this.strategy.projectStyleSheet?.importFile || false,
          },
        }),
    }

    // Handling project style sheet
    if (this.strategy.projectStyleSheet?.generator) {
      const { files, dependencies } = await this.styleSheetGenerator.generateComponent(
        {
          ...uidl.root,
          outputOptions: {
            folderPath: this.strategy.projectStyleSheet.path,
          },
        },
        {
          isRootComponent: true,
          ...options,
        }
      )

      inMemoryFilesMap.set('projectStyleSheet', {
        path: this.strategy.projectStyleSheet.path,
        files,
      })
      collectedDependencies = { ...collectedDependencies, ...dependencies }
    }

    const resources = Object.values(uidl?.resources?.items || {})
    if (this.strategy?.resources && resources.length > 0) {
      const resourceCompGenerator = createComponentGenerator()
      resourceCompGenerator.addPostProcessor(prettierJS)

      for (const resource of resources) {
        const { chunks, dependencies } = resourceGenerator(
          resource,
          uidl.resources?.resourceMappers || {}
        )
        const { chunks: importChunks } = await importStatementsPlugin({
          uidl: uidl.root,
          dependencies,
          chunks: [],
          options: {
            extractedResources: {},
          },
        })
        const files = resourceCompGenerator.linkCodeChunks(
          { [FileType.JS]: [...importChunks, ...chunks] },
          StringUtils.camelCaseToDashCase(resource.name)
        )

        collectedDependencies = {
          ...collectedDependencies,
          ...Object.keys(dependencies).reduce((acc: Record<string, string>, item: string) => {
            const dep = dependencies[item]
            if (dep.type === 'package') {
              acc[dep.path] = dep.version
            }
            return acc
          }, {}),
        }

        inMemoryFilesMap.set(`resource-${resource.name}`, {
          files,
          path: this.strategy.resources.path,
        })
      }
    }

    // Handling pages
    for (const pageUIDL of pageUIDLs) {
      if (!this.strategy?.pages?.generator) {
        throw new TeleportError(
          `Pages Generator is missing from the strategy - ${JSON.stringify(this.strategy.pages)}`
        )
      }

      const pageOptions = options
      // Pages might be generated inside subfolders in the main pages folder
      const relativePath = UIDLUtils.getComponentFolderPath(pageUIDL)
      const path = this.strategy.pages.path.concat(relativePath)

      if ('addExternalComponents' in this.pageGenerator) {
        this.pageGenerator.addExternalComponents({
          externals: components,
          options,
        })
      }

      const { files, dependencies } = await createPage(pageUIDL, this.pageGenerator, pageOptions)

      /*
        Generating files from the extracted resources that needs a proxy end-point to access them.
      */
      Object.values(pageOptions.extractedResources).forEach((extractedResource) => {
        inMemoryFilesMap.set(`resource-${extractedResource.fileName}`, {
          path: extractedResource.path,
          files: [
            {
              name: extractedResource.fileName,
              fileType: extractedResource.fileType,
              content: extractedResource.content,
            },
          ],
        })
      })

      inMemoryFilesMap.set(`page-${pageUIDL.name}`, {
        path,
        files,
      })

      collectedDependencies = { ...collectedDependencies, ...dependencies }
      if (this.strategy.pages?.module) {
        const pageModuleGenerator = bootstrapGenerator(
          this.strategy.pages.module,
          this.strategy.style
        )
        const pageModule = await createPageModule(pageUIDL, pageModuleGenerator, options)

        inMemoryFilesMap.set(`${pageUIDL.name}Module`, {
          path,
          files: pageModule.files,
        })

        collectedDependencies = { ...collectedDependencies, ...pageModule.dependencies }
      }
    }

    // Handling module generation for components
    if (this.strategy?.components?.module) {
      const componentModuleGenerator = bootstrapGenerator(
        this.strategy.components.module,
        this.strategy.style
      )
      const componentsModule = await createComponentModule(
        uidl,
        this.strategy,
        componentModuleGenerator
      )

      inMemoryFilesMap.set(componentsModule.files[0].name, {
        path: this.strategy.components.path,
        files: componentsModule.files,
      })

      collectedDependencies = { ...collectedDependencies, ...componentsModule.dependencies }
    }

    // Handling components
    for (const componentName of Object.keys(components)) {
      if (!this.strategy?.components?.generator) {
        throw new TeleportError(
          `Component Generator is missing from the strategy - ${JSON.stringify(
            this.strategy.components
          )}`
        )
      }

      let componentOptions = options
      if (this.strategy.projectStyleSheet) {
        const globalStyleSheetPathForComponents = GenericUtils.generateLocalDependenciesPrefix(
          this.strategy.components.path,
          this.strategy.projectStyleSheet.path
        )
        componentOptions = {
          ...options,
          projectStyleSet: {
            styleSetDefinitions,
            fileName: this.strategy.projectStyleSheet.fileName,
            path: this.strategy.components?.options?.createFolderForEachComponent
              ? join('..', globalStyleSheetPathForComponents)
              : globalStyleSheetPathForComponents,
            importFile: this.strategy.projectStyleSheet?.importFile || false,
          },
          designLanguage: uidl.root?.designLanguage,
        }
      }

      if ('addExternalComponents' in this.componentGenerator) {
        ;(this.componentGenerator as unknown as HTMLComponentGenerator).addExternalComponents({
          externals: components,
          options: componentOptions,
        })
      }

      const componentUIDL = components[componentName]
      const { files, dependencies } = await createComponent(
        componentUIDL,
        this.componentGenerator,
        componentOptions
      )

      /*
        Generating files from the extracted resources that needs a proxy end-point to access them.
      */
      Object.values(componentOptions.extractedResources).forEach((extractedResource) => {
        inMemoryFilesMap.set(`resource-${extractedResource.fileName}`, {
          path: extractedResource.path,
          files: [
            {
              name: extractedResource.fileName,
              fileType: extractedResource.fileType,
              content: extractedResource.content,
            },
          ],
        })
      })

      // Components might be generated inside subfolders in the main components folder
      const relativePath = UIDLUtils.getComponentFolderPath(componentUIDL)
      const path = this.strategy.components.path.concat(relativePath)

      inMemoryFilesMap.set(`component-${componentName}.`, {
        path,
        files,
      })

      collectedDependencies = { ...collectedDependencies, ...dependencies }
    }

    // Handling framework specific changes to the project
    const { framework } = this.strategy

    // Can be used for replacing a couple of strings
    if (framework?.replace) {
      const shouldAddChanges = Boolean(
        framework.replace?.isGlobalStylesDependent &&
          (Object.keys(styleSetDefinitions).length > 0 ||
            Object.keys(uidl?.root?.designLanguage?.tokens || {}).length > 0)
      )

      if (shouldAddChanges) {
        const { fileName, fileType } = framework.replace
        const result = framework.replace.replaceFile(
          template,
          collectedDependencies,
          fileName,
          fileType
        )
        collectedDependencies = result.dependencies

        inMemoryFilesMap.set(`component-${fileName}`, {
          path: this.strategy.framework.replace.path,
          files: [result.file],
        })
      }
    }

    // If we want to generate a completly new file
    if (framework?.config) {
      const {
        fileName,
        fileType,
        configContentGenerator,
        generator,
        plugins: frameworkConfigPlugins,
        postprocessors: frameworkConfigPostprocessors,
      } = framework.config

      if (configContentGenerator && generator) {
        const result: ConfigGeneratorResult = configContentGenerator({
          fileName,
          fileType,
          globalStyles: {
            path: GenericUtils.generateLocalDependenciesPrefix(
              framework.config.path,
              this.strategy.projectStyleSheet.path
            ),
            sheetName: this.strategy.projectStyleSheet
              ? this.strategy.projectStyleSheet.fileName
              : '',
            isGlobalStylesDependent:
              framework.config?.isGlobalStylesDependent ??
              Boolean(
                Object.keys(styleSetDefinitions).length > 0 ||
                  Object.keys(uidl.root?.designLanguage?.tokens || {}).length > 0
              ),
          },
          dependencies: collectedDependencies,
        })

        collectedDependencies = result.dependencies

        if (Object.keys(result?.chunks).length > 0) {
          const configGenerator: (params: GeneratorFactoryParams) => ComponentGenerator =
            framework.config.generator
          const files = configGenerator({
            plugins: frameworkConfigPlugins,
            postprocessors: frameworkConfigPostprocessors,
          }).linkCodeChunks(result.chunks, framework.config.fileName)

          inMemoryFilesMap.set(fileName, {
            path: this.strategy.framework.config.path,
            files,
          })
        }
      }
    }

    // Global settings are transformed into the root html file and the manifest file for PWA support
    if (uidl.globals.manifest) {
      const manifestFile = createManifestJSONFile(uidl, options.assets)

      inMemoryFilesMap.set(manifestFile.name, {
        path: this.strategy.static.path,
        files: [manifestFile],
      })
    }

    if (uidl.globals.env) {
      const envFiles = createEnvFiles(uidl.globals.env)
      envFiles.forEach((file) => {
        inMemoryFilesMap.set(file.name, {
          path: [],
          files: [file],
        })
      })

      const gitIgnoreFile = createGitIgnoreFile()
      inMemoryFilesMap.set(gitIgnoreFile.name, {
        path: [],
        files: [gitIgnoreFile],
      })
    }

    // TODO: Projects which don't need a router file will miss collecting
    // dependencies which are specified on them

    // Create the routing component in case the project generator has a strategy for that
    if (this.strategy.router) {
      const { routerFile, dependencies } = await createRouterFile(
        uidl.root,
        this.strategy,
        this.routerGenerator
      )

      inMemoryFilesMap.set('router', {
        path: this.strategy.router.path,
        files: [routerFile],
      })

      collectedDependencies = { ...collectedDependencies, ...dependencies }
    }

    // Create the entry file of the project (ex: index.html, _document.js)
    if (this.strategy.entry) {
      const entryFile = await createEntryFile(uidl, this.strategy, options)
      inMemoryFilesMap.set('entry', {
        path: this.strategy.entry.path,
        files: entryFile,
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
        path: folder.path,
        files,
      })
    }

    try {
      const runAfterResult = await this.assemblyLine.runAfter({
        uidl,
        template,
        files: inMemoryFilesMap,
        strategy: this.strategy,
        dependencies: collectedDependencies,
        devDependencies: collectedDevDependencies,
        rootFolder,
      })

      collectedDependencies = { ...collectedDependencies, ...runAfterResult.dependencies }
      collectedDevDependencies = { ...collectedDevDependencies, ...runAfterResult.devDependencies }
      inMemoryFilesMap = runAfterResult.files
    } catch (error) {
      /* tslint:disable no-console */
      console.error(error)
      throw new TeleportError(`Error in generating project after runAfter - ${error}`)
    }

    inMemoryFilesMap.forEach((stage) => {
      injectFilesToPath(rootFolder, stage.path, stage.files)
    })

    // Inject all the collected dependencies in the package.json file
    handlePackageJSON(rootFolder, uidl, collectedDependencies, collectedDevDependencies)

    return rootFolder
  }

  public addMapping(mapping: Mapping) {
    this.strategy.components.mappings = [...this.strategy.components?.mappings, mapping]
    this.strategy.pages.mappings = [...this.strategy.pages?.mappings, mapping]

    if (this.strategy.router) {
      /* TODO: Add mapping later if we decide to reference a generator object
      instead of a generator function for routing */
    }
  }

  public addPlugin(plugin: ProjectPlugin) {
    this.assemblyLine.addPlugin(plugin)
  }

  public cleanPlugins() {
    this.assemblyLine.cleanPlugins()
  }

  public getAssetsPath() {
    return this.strategy.static.path
  }
}

export const createProjectGenerator = (strategy: ProjectStrategy): ProjectGenerator => {
  return new ProjectGenerator(strategy)
}

export default createProjectGenerator
