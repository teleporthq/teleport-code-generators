import {
  ComponentUIDL,
  ProjectUIDL,
  UIDLDependency,
  Mapping,
  UIDLElement,
  UIDLStateDefinition,
  UIDLStyleSetDefinition,
} from './uidl'

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
  meta?: Record<string, unknown>
  content: ChunkContent
  linkAfter: string[]
}

/**
 * The structure of a component contains multiple chunks, and information
 * about how these chunks work together
 */
export interface ComponentStructure {
  chunks: ChunkDefinition[]
  uidl: ComponentUIDL
  options: GeneratorOptions
  dependencies: Record<string, UIDLDependency>
}

export type ComponentPlugin = (structure: ComponentStructure) => Promise<ComponentStructure>

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
  assetsPrefix?: string
  mapping?: Mapping
  skipValidation?: boolean
  skipNavlinkResolver?: boolean
  projectRouteDefinition?: UIDLStateDefinition
  strategy?: ProjectStrategy
  moduleComponents?: Record<string, ComponentUIDL>
  projectStyleSet?: {
    styleSetDefinitions: Record<string, UIDLStyleSetDefinition>
    fileName: string
    path: string
    importFile?: boolean
  }
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
  generateProject: (
    input: ProjectUIDL | Record<string, unknown>,
    template?: GeneratedFolder,
    mapping?: Mapping
  ) => Promise<GeneratedFolder>
  addMapping: (mapping: Mapping) => void
  getAssetsPath: () => string[]
}

export interface ProjectStrategy {
  components: {
    generator: ComponentGenerator
    moduleGenerator?: ComponentGenerator
    path: string[]
    options?: ProjectStrategyComponentOptions
  }
  pages: {
    generator: ComponentGenerator
    moduleGenerator?: ComponentGenerator
    path: string[]
    options?: ProjectStrategyPageOptions
  }
  projectStyleSheet?: {
    generator: ComponentGenerator
    path: string[]
    fileName: string
    importFile?: boolean
  }
  router?: {
    generator: ComponentGenerator
    path: string[]
    fileName?: string
  }
  entry?: {
    generator: ComponentGenerator
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
      generator?: ComponentGenerator
      configContentGenerator?: (options: FrameWorkConfigOptions) => ConfigGeneratorResult
      isGlobalStylesDependent?: boolean
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
  customComponentFileName?: (name?: string) => string // only used when createFolderForEachComponent is true
  customStyleFileName?: (name?: string) => string
  customTemplateFileName?: (name?: string) => string
}

export type ProjectStrategyPageOptions = ProjectStrategyComponentOptions & {
  useFileNameForNavigation?: boolean
}

export interface EntryFileOptions {
  assetsPrefix?: string
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

export interface NowDeployResponse {
  url: string
  alias: string[]
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
  username: string
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
  domainAlias?: string // used by the now publisher
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

interface NowOptions {
  accessToken?: string
  projectSlug?: string
  domainAlias?: string // used by the now publisher
  individualUpload?: boolean
}

export interface PackerOptions {
  projectType: ProjectType
  publisher?: PublisherType
  publishOptions?: GithubOptions | NowOptions | PublisherOptions
  assets?: GeneratedFile[]
}

export interface GenerateOptions {
  componentType?: ComponentType
  styleVariation?: StyleVariation
}

export enum PreactStyleVariation {
  InlineStyles = 'Inline Styles',
  CSSModules = 'CSS Modules',
  CSS = 'CSS',
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
  NOW = 'Now',
  NETLIFY = 'Netlify',
  GITHUB = 'Github',
  CODESANDBOX = 'CodeSandbox',
}

export enum ProjectType {
  REACT = 'React',
  NEXT = 'Next',
  VUE = 'Vue',
  NUXT = 'Nuxt',
  PREACT = 'Preact',
  STENCIL = 'Stencil',
  ANGULAR = 'Angular',
  GATSBY = 'Gatsby',
  GRIDSOME = 'Gridsome',
  REACTNATIVE = 'React-Native',
}

export enum ComponentType {
  REACT = 'React',
  VUE = 'Vue',
  PREACT = 'Preact',
  STENCIL = 'Stencil',
  ANGULAR = 'Angular',
  REACTNATIVE = 'React-Native',
}

export const DefaultStyleVariation: Record<ComponentType, StyleVariation> = {
  [ComponentType.REACT]: ReactStyleVariation.CSSModules,
  [ComponentType.PREACT]: PreactStyleVariation.CSSModules,
  [ComponentType.REACTNATIVE]: ReactNativeStyleVariation.StyledComponents,
  [ComponentType.VUE]: null,
  [ComponentType.STENCIL]: null,
  [ComponentType.ANGULAR]: null,
}

export type StyleVariation = ReactStyleVariation | PreactStyleVariation | ReactNativeStyleVariation

// The last two types are used by the teleport-code-generator package

export type PackProjectFunction = (
  projectUIDL: ProjectUIDL,
  options: PackerOptions
) => Promise<PublisherResponse<unknown>>

export type GenerateComponentFunction = (
  componentUIDL: ComponentUIDL,
  options: GenerateOptions
) => Promise<CompiledComponent>
