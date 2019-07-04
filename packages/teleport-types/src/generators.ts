import {
  ComponentUIDL,
  ProjectUIDL,
  ComponentDependency,
  Mapping,
  UIDLElement,
  UIDLNode,
  UIDLAttributeValue,
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
  dependencies: Record<string, ComponentDependency>
}

export type ComponentPlugin = (structure: ComponentStructure) => Promise<ComponentStructure>

export interface ComponentDefaultPluginParams {
  fileId: string
}

export type ComponentPluginFactory<T> = (
  configuration?: Partial<T & ComponentDefaultPluginParams>
) => ComponentPlugin

/**
 * Function used to alter the generic generatedEntity by adding a attribute
 * named attributeKey with attributeValue data. This type of function is meant
 * to be used in generators that support attribute values on their presentation
 * nodes.
 *
 * For example, a <div/> in HAST could get a new attribute tab-index with value 0
 * with a function like this.
 */
export type AttributeAssignCodeMod<T> = (
  generatedEntity: T,
  attributeKey: string,
  attributeValue: UIDLAttributeValue
) => void

/**
 * Function used to generate a presentation structure.
 */
export type NodeSyntaxGenerator<Accumulators, ReturnValues> = (
  node: UIDLNode,
  accumulators: Accumulators
) => ReturnValues

export interface CompiledComponent {
  files: GeneratedFile[]
  dependencies: Record<string, string>
}

export type PostProcessingFunction = (codeChunks: Record<string, string>) => Record<string, string>

export interface ComponentGenerator {
  generateComponent: (
    input: ComponentUIDL | Record<string, unknown>,
    options?: GeneratorOptions
  ) => Promise<CompiledComponent>
  linkCodeChunks: (chunks: Record<string, ChunkDefinition[]>, fileName: string) => GeneratedFile[]
  resolveElement: (node: UIDLElement, options?: GeneratorOptions) => UIDLElement
  addPlugin: (plugin: ComponentPlugin) => void
  addMapping: (mapping: Mapping) => void
  addPostProcessor: (fn: PostProcessingFunction) => void
}

export interface GeneratorOptions {
  localDependenciesPrefix?: string
  assetsPrefix?: string
  mapping?: Mapping
  skipValidation?: boolean
  projectRouteDefinition?: UIDLStateDefinition
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
  namedImport: boolean
  originalName: string
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
