import {
  ComponentUIDL,
  ProjectUIDL,
  UIDLDependency,
  Mapping,
  UIDLElement,
  UIDLStateDefinition,
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

export type ChunkContent = string | any | any[]

/**
 * React could have one or more JS chunks, nothing else.
 * Vue has a template chunk, of type XML/HTML, a javascript
 * chunk and a style chunk
 */
export interface ChunkDefinition {
  type: ChunkType
  name: string
  fileType: FileType
  meta?: any
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
  projectRouteDefinition?: UIDLStateDefinition
  strategy?: ProjectStrategy
  moduleComponents?: Record<string, ComponentUIDL>
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

export interface GeneratedFile {
  name: string
  content: string
  fileType?: string
  contentEncoding?: string
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

/**
 * Interfaces used in the packers
 */

export interface AssetsDefinition {
  assets: AssetInfo[]
  path?: string[]
}

export interface AssetInfo {
  data: string
  name: string
  type?: string
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
  projectName?: string
  outputPath?: string
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

export interface PackerOptions {
  projectType?: ProjectType
  publisher?: PublisherType
  publishOptions?: GithubOptions | PublisherOptions
  assets?: AssetInfo[]
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
  REACTNATIVE = 'ReactNative',
  NEXT = 'Next',
  VUE = 'Vue',
  NUXT = 'Nuxt',
  PREACT = 'Preact',
  STENCIL = 'Stencil',
  ANGULAR = 'Angular',
  GATSBY = 'Gatsby',
  GRIDSOME = 'Gridsome',
}

export enum ComponentType {
  REACT = 'React',
  REACTNATIVE = 'ReactNative',
  VUE = 'Vue',
  PREACT = 'Preact',
  STENCIL = 'Stencil',
  ANGULAR = 'Angular',
}

export type StyleVariation = ReactStyleVariation | PreactStyleVariation | ReactNativeStyleVariation
