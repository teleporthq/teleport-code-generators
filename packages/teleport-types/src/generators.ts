import {
  ComponentUIDL,
  ProjectUIDL,
  UIDLDependency,
  Mapping,
  UIDLElement,
  UIDLStyleSetDefinition,
  UIDLDesignTokens,
  UIDLRootComponent,
  UIDLRouteDefinitions,
  UIDLPageOptions,
  UIDLResources,
  UIDLLocalFontAsset,
  UIDLGlobalReference,
} from './uidl'
import type { JSXElement } from '@babel/types'

export enum FileType {
  CSS = 'css',
  HTML = 'html',
  JS = 'js',
  JSON = 'json',
  VUE = 'vue',
  TS = 'ts',
  TSX = 'tsx',
}

export enum ChunkType {
  AST = 'ast',
  HAST = 'hast',
  STRING = 'string',
}

export type ChunkContent = string | unknown

/**
 * React could have one or more JS chunks, nothing else.
 * Vue has a template chunk, of type XML/HTML, a javascript
 * chunk and a style chunk
 */
export interface ChunkDefinition {
  type: ChunkType
  name: string
  fileType: FileType
  meta?: {
    nodesLookup?: {
      container?: Record<string, unknown>
    } & Record<string, unknown>
    dynamicRefPrefix?: Record<string, unknown>
    localeReferences?: JSXElement[]
    globalReferences?: Array<UIDLGlobalReference['content']['id']>
  } & Record<string, unknown>
  content: ChunkContent
  linkAfter: string[]
}

/**
 * The structure of a component contains multiple chunks, and information
 * about how these chunks work together
 */
export interface ComponentStructure {
  chunks: ChunkDefinition[]
  uidl: ComponentUIDL | UIDLRootComponent
  options: GeneratorOptions
  dependencies: Record<string, UIDLDependency>
}

export type ComponentPlugin = (structure: ComponentStructure) => Promise<ComponentStructure>

export type InMemoryFileRecord = {
  path: string[]
  files: GeneratedFile[]
}

export interface ProjectPluginStructure {
  uidl: ProjectUIDL
  template: GeneratedFolder
  files: Map<string, InMemoryFileRecord>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  strategy: ProjectStrategy
  rootFolder: GeneratedFolder
}

export interface ProjectPlugin {
  runBefore: (structure: ProjectPluginStructure) => Promise<ProjectPluginStructure>
  runAfter: (structure: ProjectPluginStructure) => Promise<ProjectPluginStructure>
}

export interface ComponentDefaultPluginParams {
  fileType: FileType
}

export type ComponentPluginFactory<T> = (
  configuration?: Partial<T & ComponentDefaultPluginParams>
) => ComponentPlugin

export interface CompiledComponent {
  files: GeneratedFile[]
  dependencies: Record<string, string>
}

export type PostProcessor = (codeChunks: Record<string, string>) => Record<string, string>

export interface ComponentGenerator {
  generateComponent: (
    input: ComponentUIDL | Record<string, unknown>,
    options?: GeneratorOptions
  ) => Promise<CompiledComponent>
  linkCodeChunks: (chunks: Record<string, ChunkDefinition[]>, fileName: string) => GeneratedFile[]
  resolveElement: (node: UIDLElement, options?: GeneratorOptions) => UIDLElement
  addPlugin: (plugin: ComponentPlugin) => void
  addMapping: (mapping: Mapping) => void
  addPostProcessor: (fn: PostProcessor) => void
}

export interface GeneratorOptions {
  localDependenciesPrefix?: string
  assets?: {
    prefix?: string
    identifier?: string | null
    mappings?: Record<string, string>
    fontsFolder?: string
    localFonts?: UIDLLocalFontAsset[]
  }
  mapping?: Mapping
  skipValidation?: boolean
  isRootComponent?: boolean
  skipNavlinkResolver?: boolean
  projectRouteDefinition?: UIDLRouteDefinitions
  strategy?: ProjectStrategy
  moduleComponents?: Record<string, ComponentUIDL>
  projectStyleSet?: {
    styleSetDefinitions: Record<string, UIDLStyleSetDefinition>
    fileName: string
    path: string
    importFile?: boolean
  }
  extractedResources?: Record<
    string,
    {
      fileName: string
      fileType: FileType
      path: string[]
      content: string
    }
  >
  designLanguage?: {
    tokens?: UIDLDesignTokens
  }
  resources?: { items: UIDLResources['items']; cache: UIDLResources['cache']; path: string[] }
}

export type CodeGeneratorFunction<T> = (content: T) => string

export interface HastNode {
  type: string
  tagName: string
  properties: Record<string, string | boolean>
  children: Array<HastNode | HastText>
}

export interface HastText {
  type: string
  value: string
}

export interface ImportIdentifier {
  identifierName: string
  namedImport?: boolean
  originalName?: string
  importJustPath?: boolean
}

/* Project Types */

export interface ProjectGenerator {
  setAssets: (params: {
    mappings: Record<string, string>
    identifier?: string
    prefix?: string
  }) => void
  generateProject: (
    input: ProjectUIDL | Record<string, unknown>,
    template?: GeneratedFolder,
    mapping?: Mapping,
    strictHtmlWhitespaceSensitivity?: boolean
  ) => Promise<GeneratedFolder>
  addMapping: (mapping: Mapping) => void
  getAssetsPath: () => string[]
  cleanPlugins: () => void
  addPlugin: (plugin: ProjectPlugin) => void
  getStrategy: () => ProjectStrategy
  updateStrategy: (strategy: ProjectStrategy) => void
}

export interface GeneratorFactoryParams {
  mappings?: Mapping[]
  plugins?: ComponentPlugin[]
  postprocessors?: PostProcessor[]
  variation?: StyleVariation
  strictHtmlWhitespaceSensitivity?: boolean
}

export type ComponentGeneratorInstance = (params?: GeneratorFactoryParams) => ComponentGenerator

export interface HTMLComponentGenerator extends ComponentGenerator {
  addExternalComponents: (params: {
    externals: Record<string, ComponentUIDL>
    options: GeneratorOptions
  }) => void
}
export type HTMLComponentGeneratorInstance = (
  params?: GeneratorFactoryParams
) => HTMLComponentGenerator

export interface ProjectStrategy {
  id: string
  style?: StyleVariation
  components: {
    generator: ComponentGeneratorInstance
    plugins?: ComponentPlugin[]
    postprocessors?: PostProcessor[]
    mappings?: Mapping[]
    module?: {
      generator: ComponentGeneratorInstance
      plugins?: ComponentPlugin[]
      postprocessors?: PostProcessor[]
      mappings?: Mapping[]
    }
    path: string[]
    options?: ProjectStrategyComponentOptions
  }
  pages: {
    generator: ComponentGeneratorInstance
    plugins?: ComponentPlugin[]
    postprocessors?: PostProcessor[]
    mappings?: Mapping[]
    module?: {
      generator: ComponentGeneratorInstance
      plugins?: ComponentPlugin[]
      postprocessors?: PostProcessor[]
      mappings?: Mapping[]
    }
    path: string[]
    options?: ProjectStrategyPageOptions
  }
  projectStyleSheet?: {
    generator: ComponentGeneratorInstance
    plugins?: ComponentPlugin[]
    postprocessors?: PostProcessor[]
    mappings?: Mapping[]
    path: string[]
    fileName: string
    importFile?: boolean
  }
  router?: {
    generator: ComponentGeneratorInstance
    plugins?: ComponentPlugin[]
    postprocessors?: PostProcessor[]
    mappings?: Mapping[]
    path: string[]
    fileName?: string
  }
  entry?: {
    postprocessors?: PostProcessor[]
    mappings?: Mapping[]
    path: string[]
    fileName?: string
    chunkGenerationFunction?: (
      uidl: ProjectUIDL,
      options: EntryFileOptions
    ) => Record<string, ChunkDefinition[]>
    options?: {
      appRootOverride?: string
      customTags?: CustomTag[]
      customHeadContent?: string
    }
  }
  static: {
    prefix?: string
    path: string[]
  }
  framework?: {
    config?: {
      fileName: string
      fileType: string
      path: string[]
      generator?: ComponentGeneratorInstance
      plugins?: ComponentPlugin[]
      postprocessors?: PostProcessor[]
      configContentGenerator?: (options: FrameWorkConfigOptions) => ConfigGeneratorResult
      isGlobalStylesDependent?: boolean
    }
    externalStyles?: {
      // All the css imports from importDefinitions are moved to the file in this destination
      fileName: string
      fileType: string
    }
    replace?: {
      fileName: string
      fileType: string
      path: string[]
      isGlobalStylesDependent?: boolean
      replaceFile: (
        files: GeneratedFolder,
        dependencies: Record<string, string>,
        fileName: string,
        fileType: string
      ) => { file: GeneratedFile; dependencies: Record<string, string> }
    }
  }
  resources?: {
    path: string[]
  }
}

export interface ConfigGeneratorResult {
  chunks: Record<string, ChunkDefinition[]>
  dependencies: Record<string, string>
}

export interface FrameWorkConfigOptions {
  fileName: string
  fileType: string
  dependencies: Record<string, string>
  globalStyles?: {
    path: string
    sheetName: string
    isGlobalStylesDependent?: boolean
  }
}

export interface CustomTag {
  tagName: string
  targetTag: string
  content?: string
  attributes?: Attribute[]
}

export interface Attribute {
  attributeKey: string
  attributeValue?: string
}

export interface ProjectStrategyComponentOptions {
  createFolderForEachComponent?: boolean
  customComponentFileName?: (name?: string, options?: UIDLPageOptions) => string // only used when createFolderForEachComponent is true
  customStyleFileName?: (name?: string) => string
  customTemplateFileName?: (name?: string) => string
}

export type ProjectStrategyPageOptions = ProjectStrategyComponentOptions & {
  useFileNameForNavigation?: boolean
}

export interface EntryFileOptions {
  assets?: GeneratorOptions['assets']
  appRootOverride?: string
  customTags?: CustomTag[]
  customHeadContent: string
}

export interface GeneratedFolder {
  name: string
  files: GeneratedFile[]
  subFolders: GeneratedFolder[]
}

export type FileLocation = 'remote' | 'project'
export type FileEncoding = 'base64' | 'utf8' | 'binary'

export interface GeneratedFile {
  name: string
  content: string
  contentEncoding?: FileEncoding
  fileType?: string
  location?: FileLocation
  status?: string
  path?: string[]
}

/**
 * Interfaces used in the publishers
 */
export type PublisherFactory<T, U> = (configuration?: Partial<T>) => U

export interface Publisher<T, U> {
  publish: (options?: T) => Promise<PublisherResponse<U>>
  getProject: () => GeneratedFolder | void
  setProject: (project: GeneratedFolder) => void
}

export interface PublisherFactoryParams {
  project?: GeneratedFolder
}
export interface PublisherResponse<T> {
  success: boolean
  payload?: T
}

export interface VercelDeployResponse {
  id: string
  url: string
  alias: string[]
  readyState?: string
  passwordProtection?: string
}

export interface VercelDeleteProject {
  projectSlug: string
  accessToken: string
  teamId?: string
}

/**
 * Interfaces used in the packers
 */

export interface AssetsDefinition {
  assets: GeneratedFile[]
  path?: string[]
}

export interface RemoteTemplateDefinition {
  provider: 'github'
  owner: string
  repo: string
  auth?: ServiceAuth
}

export interface ServiceAuth {
  basic?: {
    username: string
    password: string
  }
  token?: string
}

export interface PrettierFormatOptions {
  printWidth?: number
  tabWidth?: number
  useTabs?: boolean
  semi?: boolean
  singleQuote?: boolean
  jsxSingleQuote?: boolean
  trailingComma?: 'none' | 'es5' | 'all'
  bracketSpacing?: boolean
  jsxBracketSameLine?: boolean
  arrowParens?: 'avoid' | 'always'
  rangeStart?: number
  rangeEnd?: number
}

// Generation and packing interfaces (previously in teleport-code-generator)

interface PublisherOptions {
  accessToken?: string
  outputPath?: string
  projectSlug?: string
  domainAlias?: string // used by the vercel publisher
  createProjectFolder?: boolean // used only by the disk publisher
}

interface GithubOptions {
  authMeta?: ServiceAuth
  repositoryOwner?: string
  repository?: string
  masterBranch?: string
  commitBranch?: string
  commitMessage?: string
}

interface VercelOptions {
  accessToken?: string
  projectSlug?: string
  domainAlias?: string // used by the Vercel publisher
  individualUpload?: boolean
  framework?: string
}

export interface PackerOptions {
  projectType: ProjectType
  publisher?: PublisherType
  publishOptions?: GithubOptions | VercelOptions | PublisherOptions
  assets?: GeneratedFile[]
  plugins?: ProjectPlugin[]
  assetsFolder?: string[]
  excludeGlobalsFromHTMLComponents?: boolean
  strictHtmlWhitespaceSensitivity?: boolean
}

export interface GenerateOptions {
  componentType?: ComponentType
  styleVariation?: StyleVariation
  plugins?: ComponentPlugin[]
}

export enum ReactStyleVariation {
  InlineStyles = 'Inline Styles',
  CSSModules = 'CSS Modules',
  CSS = 'CSS',
  StyledComponents = 'Styled Components',
  StyledJSX = 'Styled JSX',
  ReactJSS = 'React JSS',
}

export enum ReactNativeStyleVariation {
  InlineStyles = 'Inline Styles',
  StyledComponents = 'Styled Components',
}

export enum PublisherType {
  DISK = 'Disk',
  ZIP = 'Zip',
  VERCEL = 'Vercel',
  NETLIFY = 'Netlify',
  GITHUB = 'Github',
  CODESANDBOX = 'CodeSandbox',
}

export enum ProjectType {
  REACT = 'React',
  NEXT = 'Next',
  VUE = 'Vue',
  NUXT = 'Nuxt',
  ANGULAR = 'Angular',
  HTML = 'HTML',
}

export enum ComponentType {
  REACT = 'React',
  VUE = 'Vue',
  ANGULAR = 'Angular',
  HTML = 'HTML',
}

export const DefaultStyleVariation: Record<ComponentType, StyleVariation | null> = {
  [ComponentType.REACT]: ReactStyleVariation.CSSModules,
  [ComponentType.VUE]: null,
  [ComponentType.ANGULAR]: null,
  [ComponentType.HTML]: null,
}

export type StyleVariation = ReactStyleVariation | ReactNativeStyleVariation

// The last two types are used by the teleport-code-generator package

export type PackProjectFunction = (
  projectUIDL: ProjectUIDL,
  options: PackerOptions
) => Promise<PublisherResponse<unknown>>

export type GenerateComponentFunction = (
  componentUIDL: ComponentUIDL,
  options: GenerateOptions
) => Promise<CompiledComponent>

export type ElementsLookup = Record<string, { count: number; nextKey: string }>
