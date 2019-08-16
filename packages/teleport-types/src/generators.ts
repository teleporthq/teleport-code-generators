import {
  ComponentUIDL,
  ProjectUIDL,
  UIDLDependency,
  Mapping,
  UIDLElement,
  UIDLStateDefinition,
} from './uidl'

export type ChunkContent = string | any | any[]

/**
 * React could have one or more JS chunks, nothing else.
 * Vue has a template chunk, of type XML/HTML, a javascript
 * chunk and a style chunk
 */
export interface ChunkDefinition {
  type: string
  name: string
  fileType: string
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
  fileType: string
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
  getAssetsPath: () => string
}

export interface ProjectStrategy {
  components: {
    generator: ComponentGenerator
    path: string[]
    options?: {
      createFolderForEachComponent?: boolean
      customComponentFileName?: string // only used when createFolderForEachComponent is true
      customStyleFileName?: string
      customTemplateFileName?: string
    }
  }
  pages: {
    generator: ComponentGenerator
    path: string[]
    options?: {
      usePathAsFileName?: boolean
      convertDefaultToIndex?: boolean
      createFolderForEachComponent?: boolean
      customComponentFileName?: string // only used when createFolderForEachComponent is true
      customStyleFileName?: string
      customTemplateFileName?: string
    }
  }
  router?: {
    generator: ComponentGenerator
    path: string[]
    fileName?: string
  }
  entry: {
    generator: ComponentGenerator
    path: string[]
    fileName?: string
    chunkGenerationFunction?: (
      uidl: ProjectUIDL,
      options: EntryFileOptions
    ) => Record<string, ChunkDefinition[]>
    appRootOverride?: string
  }
  static: {
    prefix?: string
    path: string[]
  }
}

export interface EntryFileOptions {
  assetsPrefix?: string
  appRootOverride?: string
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
  meta?: {
    prefix: string | string[]
  }
}

export interface AssetInfo {
  data: string
  name: string
  type: string
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
