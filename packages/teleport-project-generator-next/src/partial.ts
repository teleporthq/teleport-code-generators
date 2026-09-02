import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import nextImagePlugin from '@teleporthq/teleport-plugin-jsx-next-image'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import {
  createReactComponentGenerator,
  ReactMapping,
} from '@teleporthq/teleport-component-generator-react'
import { createJSXHeadConfigPlugin } from '@teleporthq/teleport-plugin-jsx-head-config'
import { createStaticPropsPlugin } from '@teleporthq/teleport-plugin-next-static-props'
import { createStaticPathsPlugin } from '@teleporthq/teleport-plugin-next-static-paths'
import {
  createNextPagesInlineFetchPlugin,
  createNextComponentInlineFetchPlugin,
} from '@teleporthq/teleport-plugin-next-inline-fetch'
import {
  createNextPagesDataSourcePlugin,
  createNextComponentDataSourcePlugin,
} from '@teleporthq/teleport-plugin-next-data-source'
import { createStyleSheetPlugin, createCSSPlugin } from '@teleporthq/teleport-plugin-css'
import {
  ASTUtils,
  ASTBuilders,
  createJSXSyntax,
  JSXGenerationParams,
} from '@teleporthq/teleport-plugin-common'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import {
  ReactStyleVariation,
  FileType,
  ChunkType,
  ComponentUIDL,
  ProjectUIDL,
  GeneratorOptions,
  GeneratedFile,
  ComponentGenerator,
  ComponentStructure,
  ChunkDefinition,
  UIDLResourceItem,
  UIDLResources,
  UIDLDependency,
  UIDLElementNode,
  UIDLStyleSetDefinition,
  UIDLDataSource,
  WebManifest,
  TeleportError,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import { CodeGenerator } from '@babel/generator'
import { Resolver } from '@teleporthq/teleport-uidl-resolver'
import { createDocumentFileChunks, configContentGenerator } from './utils'
import { NextProjectMapping } from './next-project-mapping'
import { createNextInternationalizationPlugin } from './internationalization/locale-mapper-component'
import { createNextLocaleFetcherPlugin } from './internationalization/locale-fetcher-component'
import { createNextFormSubmissionPlugin } from './forms/form-submission-handler'
import { createEntityMutationSsrFinalizerPlugin } from './entity-mutation-ssr-finalize-plugin'

const DATA_SOURCE_DEPENDENCIES: Record<string, string> = {
  postgresql: 'pg@^8.11.0',
  mysql: 'mysql2@^3.6.0',
  mariadb: 'mariadb@^3.2.0',
  'amazon-redshift': 'pg@^8.11.0',
  mongodb: 'mongodb@^6.3.0',
  cockroachdb: 'pg@^8.11.0',
  tidb: 'mysql2@^3.6.0',
  redis: 'redis@^4.6.0',
  firestore: 'firebase-admin@^12.0.0',
  clickhouse: '@clickhouse/client@^1.13.0',
  airtable: 'node-fetch@^2.7.0',
  supabase: '@supabase/supabase-js@^2.38.0',
  turso: '@libsql/client@^0.4.0',
  'rest-api': 'node-fetch@^2.7.0',
  javascript: '',
  'csv-file': '',
  'static-collection': '',
  'google-sheets': 'node-fetch@^2.7.0',
}

export interface NextPartialGeneratorOptions {
  assets?: GeneratorOptions['assets']
  designLanguage?: GeneratorOptions['designLanguage']
  projectStyleSet?: GeneratorOptions['projectStyleSet']
  projectComponents?: Record<string, ComponentUIDL>
  projectRouteDefinition?: GeneratorOptions['projectRouteDefinition']
  pagesPath?: GeneratorOptions['pagesPath']
  internationalization?: GeneratorOptions['internationalization']
  dataSources?: GeneratorOptions['dataSources']
  forms?: GeneratorOptions['forms']
  resources?: GeneratorOptions['resources']
  pageLayoutMode?: GeneratorOptions['pageLayoutMode']
  workflows?: GeneratorOptions['workflows']
}

export interface PartialGenerationResult {
  files: GeneratedFile[]
  dependencies: Record<string, string>
  extractedResources?: Record<
    string,
    {
      fileName: string
      fileType: FileType
      path: string[]
      content: string
    }
  >
}

export interface FrameworkConfigInput {
  dependencies?: Record<string, string>
  globalStyles?: {
    path: string
    sheetName: string
    isGlobalStylesDependent: boolean
  }
}

class NextPartialGenerator {
  private componentGenerator: ComponentGenerator
  private pageGenerator: ComponentGenerator
  private styleSheetGenerator: ComponentGenerator
  private sharedOptions: NextPartialGeneratorOptions
  private resolver: InstanceType<typeof Resolver>

  constructor(options: NextPartialGeneratorOptions = {}) {
    this.sharedOptions = options
    this.resolver = new Resolver(ReactMapping) as InstanceType<typeof Resolver>

    // Component generator — same config as createNextProjectGenerator().components
    this.componentGenerator = createReactComponentGenerator({
      variation: ReactStyleVariation.StyledJSX,
      plugins: [
        nextImagePlugin,
        createNextComponentInlineFetchPlugin(),
        createNextComponentDataSourcePlugin(),
        createNextInternationalizationPlugin(),
        createNextFormSubmissionPlugin(),
      ],
      mappings: [NextProjectMapping],
    })

    // Page generator — same config as createNextProjectGenerator().pages
    this.pageGenerator = createReactComponentGenerator({
      variation: ReactStyleVariation.StyledJSX,
      plugins: [
        nextImagePlugin,
        createJSXHeadConfigPlugin({
          configTagIdentifier: 'Head',
          configTagDependencyPath: 'next/head',
          isExternalPackage: false,
          isDefaultImport: true,
        }),
        createStaticPropsPlugin(),
        createStaticPathsPlugin(),
        createNextInternationalizationPlugin(),
        createNextPagesInlineFetchPlugin(),
        createNextPagesDataSourcePlugin(),
        createNextLocaleFetcherPlugin(),
        createNextFormSubmissionPlugin(),
        createEntityMutationSsrFinalizerPlugin(),
        importStatementsPlugin,
      ],
      mappings: [NextProjectMapping],
    })

    // Stylesheet generator — same config as createNextProjectGenerator().projectStyleSheet
    this.styleSheetGenerator = createComponentGenerator({
      plugins: [createStyleSheetPlugin({ fileName: 'style' })],
    })
  }

  async generateComponent(
    componentUIDL: ComponentUIDL,
    options?: Partial<GeneratorOptions>
  ): Promise<PartialGenerationResult> {
    const mergedOptions = this.buildOptions(options)
    const { files, dependencies } = await this.componentGenerator.generateComponent(
      componentUIDL as unknown as Record<string, unknown>,
      mergedOptions
    )
    return {
      files,
      dependencies,
      extractedResources: mergedOptions.extractedResources,
    }
  }

  async generatePage(
    pageUIDL: ComponentUIDL,
    options?: Partial<GeneratorOptions>
  ): Promise<PartialGenerationResult> {
    const mergedOptions = this.buildOptions(options)
    const { files, dependencies } = await this.pageGenerator.generateComponent(
      pageUIDL as unknown as Record<string, unknown>,
      mergedOptions
    )
    return {
      files,
      dependencies,
      extractedResources: mergedOptions.extractedResources,
    }
  }

  async generateStyleSheet(
    rootUIDL: ComponentUIDL,
    options?: Partial<GeneratorOptions>
  ): Promise<PartialGenerationResult> {
    const mergedOptions = this.buildOptions({
      isRootComponent: true,
      ...options,
    })
    const { files, dependencies } = await this.styleSheetGenerator.generateComponent(
      rootUIDL as unknown as Record<string, unknown>,
      mergedOptions
    )
    return {
      files,
      dependencies,
    }
  }

  generateEntryFile(
    projectUIDL: ProjectUIDL,
    options?: { assets?: GeneratorOptions['assets'] }
  ): PartialGenerationResult {
    const entryGenerator = createComponentGenerator({
      postprocessors: [prettierJS],
    })

    const chunks = createDocumentFileChunks(projectUIDL, {
      assets: options?.assets || this.sharedOptions.assets,
      customHeadContent: null,
    })

    const files = entryGenerator.linkCodeChunks(chunks, '_document')
    return { files, dependencies: {} }
  }

  generateFrameworkConfig(configOptions?: FrameworkConfigInput): PartialGenerationResult {
    const frameworkGenerator = createComponentGenerator({
      plugins: [importStatementsPlugin],
      postprocessors: [prettierJS],
    })

    const result = configContentGenerator({
      fileName: '_app',
      fileType: FileType.JS,
      dependencies: configOptions?.dependencies || {},
      globalStyles: configOptions?.globalStyles,
    })

    if (!result.chunks || Object.keys(result.chunks).length === 0) {
      return { files: [], dependencies: result.dependencies }
    }

    const files = frameworkGenerator.linkCodeChunks(
      result.chunks as Record<string, ChunkDefinition[]>,
      '_app'
    )
    return { files, dependencies: result.dependencies }
  }

  async generateResource(
    resource: UIDLResourceItem,
    resourceMappers?: UIDLResources['resourceMappers']
  ): Promise<PartialGenerationResult> {
    const resourceCompGenerator = createComponentGenerator({
      postprocessors: [prettierJS],
    })

    const { chunks, dependencies } = buildResourceChunks(resource, resourceMappers || {})

    const { chunks: importChunks } = await importStatementsPlugin({
      uidl: null,
      dependencies,
      chunks: [],
      options: { extractedResources: {} },
    })

    const files = resourceCompGenerator.linkCodeChunks(
      { [FileType.JS]: [...importChunks, ...chunks] },
      StringUtils.camelCaseToDashCase(resource.name)
    )

    const packageDependencies = Object.keys(dependencies).reduce(
      (acc: Record<string, string>, item: string) => {
        const dep = dependencies[item]
        if (dep.type === 'package') {
          acc[dep.path] = dep.version
        }
        return acc
      },
      {}
    )

    return { files, dependencies: packageDependencies }
  }

  generateManifest(
    projectUIDL: ProjectUIDL,
    assets?: GeneratorOptions['assets']
  ): PartialGenerationResult {
    const manifest = projectUIDL.globals.manifest
    if (!manifest) {
      return { files: [], dependencies: {} }
    }

    const projectName = projectUIDL.name
    const assetOptions = assets || this.sharedOptions.assets

    const defaultManifest: WebManifest = {
      short_name: projectName,
      name: projectName,
      display: 'standalone',
      start_url: '/',
    }

    const icons = (manifest.icons || []).map((icon) => {
      const src = UIDLUtils.prefixAssetsPath(icon.src, assetOptions)
      return { ...icon, src }
    })

    const content = {
      ...defaultManifest,
      ...manifest,
      ...{ icons },
    }

    return {
      files: [
        {
          name: 'manifest',
          fileType: FileType.JSON,
          content: JSON.stringify(content, null, 2),
        },
      ],
      dependencies: {},
    }
  }

  generateEnvFiles(env: Record<string, string>): PartialGenerationResult {
    const envFileContent = Object.keys(env)
      .map((key) => `${key}=${env[key]}`)
      .join('\n')

    const envFileExampleContent = Object.keys(env)
      .map((key) => `${key}=`)
      .join('\n')

    return {
      files: [
        { name: '.env', fileType: '' as FileType, content: envFileContent },
        { name: '.env.example', fileType: '' as FileType, content: envFileExampleContent },
      ],
      dependencies: {},
    }
  }

  resolveDataSourceDependencies(
    dataSources: Record<string, UIDLDataSource>
  ): Record<string, string> {
    const dependencies: Record<string, string> = {}

    Object.values(dataSources).forEach((dataSource) => {
      const depString = DATA_SOURCE_DEPENDENCIES[dataSource.type]
      if (!depString) {
        return
      }

      const separatorIndex = depString.lastIndexOf('@')
      if (separatorIndex <= 0 || separatorIndex === depString.length - 1) {
        return
      }

      const packageName = depString.substring(0, separatorIndex)
      const version = depString.substring(separatorIndex + 1)
      dependencies[packageName] = version
    })

    return dependencies
  }

  generateExternalCSSImports(
    cssImportPaths: Record<string, { type: 'library' | 'package'; path: string; version: string }>
  ): string {
    return Object.values(cssImportPaths)
      .filter((dep) => dep.path.endsWith('.css'))
      .map((dep) => `import "${dep.path}"`)
      .join('\n')
  }

  /**
   * Generates the global-context.js file (GlobalProvider + useGlobalContext).
   * This is the React context that wraps the app and provides locale state
   * when internationalization is enabled.
   */
  generateGlobalContext(
    internationalization?: ProjectUIDL['internationalization']
  ): PartialGenerationResult {
    const i18n = internationalization || this.sharedOptions.internationalization
    const { languages = { en: 'English' }, main = { locale: 'en', name: 'English' } } = i18n || {}

    const localesArray = Object.keys(languages).map((key) => ({
      name: languages[key],
      short: key,
    }))
    const currentLocale = localesArray.find((locale) => locale.short === main.locale)

    const content = `
import { createContext, useMemo, useContext, useState, useEffect } from 'react'
import { useLocale } from "next-intl";

const GlobalContext = createContext(null)

export const GlobalProvider = ({ initialLocales, children }) => {
  const localeValue = useLocale()
  const [locales, setLocales] = useState(initialLocales ?? ${JSON.stringify(localesArray)})
  const [locale, setLocale] = useState(${JSON.stringify(currentLocale)})

  useEffect(() => {
    if (!locales) {
      return
    }

    const currentLangValue = locales.find((el) => el.short === localeValue)
    setLocale(currentLangValue)
  }, [locales, localeValue])

  const value = useMemo(() => {
    return {
      locales,
      locale,
      setLocales,
      setLocale
    }
  }, [locales, locale])

  return (
    <GlobalContext.Provider value={value}>
      {children}
    </GlobalContext.Provider>
  )
}

export const useGlobalContext = () => {
  const context = useContext(GlobalContext)
  if (!context) {
    throw new Error('useGlobalContext must be used within a GlobalProvider')
  }

  return {
    ...context
  }
}
`
    return {
      files: [
        {
          name: 'global-context',
          fileType: FileType.JS,
          content,
        },
      ],
      dependencies: {},
    }
  }

  /**
   * Generates locale JSON files for each language defined in the i18n config.
   * Static translations use content directly. Element-type translations are
   * rendered through the JSX/CSS pipeline (same as ProjectPlugini18nFiles).
   */
  async generateLocaleFiles(
    internationalization?: ProjectUIDL['internationalization'],
    projectStyleSet?: Record<string, UIDLStyleSetDefinition>
  ): Promise<PartialGenerationResult> {
    const i18n = internationalization || this.sharedOptions.internationalization
    if (!i18n || !i18n.translations) {
      return { files: [], dependencies: {} }
    }

    const styleSet =
      projectStyleSet || this.sharedOptions.projectStyleSet?.styleSetDefinitions || {}
    const files: GeneratedFile[] = []

    for (const locale of Object.keys(i18n.translations)) {
      const translation = i18n.translations[locale]
      const promises: Array<Promise<Record<string, string>>> = []

      for (const id of Object.keys(translation)) {
        const item = translation[id]

        if (item?.type === 'element') {
          promises.push(
            this.renderElementToHTML(item as UIDLElementNode, styleSet, id).then(
              ({ html, css }) => ({
                [id]: css ? `${html} \n <style>${css}</style>` : html,
              })
            )
          )
        }

        if (item?.type === 'static') {
          promises.push(Promise.resolve({ [id]: String(item.content) }))
        }
      }

      const results = await Promise.all(promises)
      const content = results.reduce((acc, item) => ({ ...acc, ...item }), {})

      files.push({
        name: locale,
        fileType: FileType.JSON,
        content: JSON.stringify(content, null, 2),
      })
    }

    return { files, dependencies: {} }
  }

  /**
   * Generates next.config.js and jsconfig.json for i18n-enabled projects.
   */
  generateNextConfig(
    internationalization?: ProjectUIDL['internationalization']
  ): PartialGenerationResult {
    const i18n = internationalization || this.sharedOptions.internationalization
    const files: GeneratedFile[] = []

    if (i18n && i18n.languages && Object.keys(i18n.languages).length > 0) {
      const { languages, main = { locale: 'en', name: 'English' } } = i18n
      const ignoreBrowserLanguage =
        (i18n as ProjectUIDL['internationalization'])?.ignoreBrowserLanguage ?? false

      const languageKeys = Object.keys(languages)
      const nextConfigContent = `module.exports = {
  i18n: {
    locales: [${languageKeys.map((key) => `'${key}'`).join(', ')}],
    defaultLocale: "${main.locale}",${ignoreBrowserLanguage ? '\n    localeDetection: false,' : ''}
  }
}`
      files.push({
        name: 'next.config',
        fileType: FileType.JS,
        content: nextConfigContent,
      })
    }

    // jsconfig.json is always generated for path aliases
    const jsconfigContent = `
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  }
}`
    files.push({
      name: 'jsconfig',
      fileType: FileType.JSON,
      content: jsconfigContent,
    })

    return { files, dependencies: {} }
  }

  updateOptions(options: Partial<NextPartialGeneratorOptions>): void {
    this.sharedOptions = { ...this.sharedOptions, ...options }
  }

  private buildOptions(overrides?: Partial<GeneratorOptions>): GeneratorOptions {
    return {
      skipValidation: true,
      extractedResources: {},
      ...(this.sharedOptions.assets && { assets: this.sharedOptions.assets }),
      ...(this.sharedOptions.designLanguage && {
        designLanguage: this.sharedOptions.designLanguage,
      }),
      ...(this.sharedOptions.projectStyleSet && {
        projectStyleSet: this.sharedOptions.projectStyleSet,
      }),
      ...(this.sharedOptions.projectComponents && {
        projectComponents: this.sharedOptions.projectComponents,
      }),
      ...(this.sharedOptions.projectRouteDefinition && {
        projectRouteDefinition: this.sharedOptions.projectRouteDefinition,
      }),
      ...(this.sharedOptions.pagesPath && { pagesPath: this.sharedOptions.pagesPath }),
      ...(this.sharedOptions.internationalization && {
        internationalization: this.sharedOptions.internationalization,
      }),
      ...(this.sharedOptions.dataSources && { dataSources: this.sharedOptions.dataSources }),
      ...(this.sharedOptions.forms && { forms: this.sharedOptions.forms }),
      ...(this.sharedOptions.resources && { resources: this.sharedOptions.resources }),
      ...(this.sharedOptions.pageLayoutMode && {
        pageLayoutMode: this.sharedOptions.pageLayoutMode,
      }),
      ...(this.sharedOptions.workflows && { workflows: this.sharedOptions.workflows }),
      ...overrides,
    }
  }

  private async renderElementToHTML(
    node: UIDLElementNode,
    projectStyleSet: Record<string, UIDLStyleSetDefinition>,
    id: string
  ): Promise<{ html: string; css?: string }> {
    const proxyUIDL: ComponentUIDL = { name: id, node }
    const resolvedUIDL = this.resolver.resolveUIDL(proxyUIDL)

    const jsxParams: JSXGenerationParams = {
      stateDefinitions: {},
      propDefinitions: {},
      globalStateDefinitions: {},
      windowImports: {},
      dependencies: {},
      nodesLookup: {},
      localeReferences: [],
      localeAttributeReferences: [],
      globalReferences: [],
      globalStateReferences: [],
      hoistedConstants: [],
    }

    const jsxNodeAst = createJSXSyntax(resolvedUIDL.node, jsxParams, {
      dynamicReferencePrefixMap: { prop: 'props', state: '', local: '' },
      dependencyHandling: 'import',
      stateHandling: 'hooks',
      slotHandling: 'props',
      domHTMLInjection: (content: string) => ASTBuilders.createDOMInjectionNode(content),
    })

    const initialStructure: ComponentStructure = {
      uidl: resolvedUIDL,
      chunks: [
        {
          type: ChunkType.AST,
          name: 'jsx-component',
          fileType: FileType.JS,
          meta: { nodesLookup: jsxParams.nodesLookup, dynamicRefPrefix: {} },
          content: jsxNodeAst,
          linkAfter: [],
        },
      ],
      dependencies: {},
      options: {
        projectStyleSet: { styleSetDefinitions: projectStyleSet, fileName: '', path: '' },
      },
    }

    const result = await createCSSPlugin({
      templateChunkName: 'jsx-component',
      templateStyle: 'jsx',
    })(initialStructure)

    const resultJSXChunk = result.chunks.find((chunk) => chunk.type === ChunkType.AST)
    const resultCSSChunk = result.chunks.find(
      (chunk) => chunk.type === ChunkType.STRING && chunk.fileType === FileType.CSS
    )

    const jsx = new CodeGenerator(resultJSXChunk.content as types.JSXElement, {
      jsescOption: { minimal: true },
    }).generate()

    return {
      html: jsx.code,
      css: typeof resultCSSChunk?.content === 'string' ? resultCSSChunk?.content : undefined,
    }
  }
}

/**
 * Generates AST chunks for a single resource endpoint.
 * Mirrors the logic from teleport-project-generator/src/resource.ts
 */
const buildResourceChunks = (
  resource: UIDLResourceItem,
  mappers: UIDLResources['resourceMappers']
): { chunks: ChunkDefinition[]; dependencies: Record<string, UIDLDependency> } => {
  const chunks: ChunkDefinition[] = []
  const dependencies: Record<string, UIDLDependency> = {}
  const ast = ASTUtils.generateRemoteResourceASTs(resource)
  let returnStatement: types.Identifier | types.CallExpression = types.identifier('response')

  ;(resource.mappers || []).forEach((mapper) => {
    returnStatement = types.callExpression(types.identifier(mapper), [returnStatement])

    if (!mappers[mapper]) {
      throw new TeleportError(
        `Resource mapper ${mapper} is not defined in the UIDL. Check "uidl.resources.mappers"`
      )
    }

    const params = mappers[mapper].params.map((param: string) => types.identifier(param))
    returnStatement = types.callExpression(types.identifier(mapper), [...params])

    dependencies[mapper] = mappers[mapper].dependency
  })

  const moduleBody = [...ast, types.returnStatement(returnStatement)]

  chunks.push({
    type: ChunkType.AST,
    fileType: FileType.JS,
    name: 'fetch-chunk',
    content: types.exportDefaultDeclaration(
      types.functionDeclaration(
        null,
        [types.assignmentPattern(types.identifier('params'), types.objectExpression([]))],
        types.blockStatement(moduleBody),
        false,
        true
      )
    ),
    linkAfter: [],
  })

  return { chunks, dependencies }
}

export const createNextPartialGenerator = (
  options?: NextPartialGeneratorOptions
): NextPartialGenerator => {
  return new NextPartialGenerator(options)
}
