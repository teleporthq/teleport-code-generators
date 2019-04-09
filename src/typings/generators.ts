import {
  ComponentUIDL,
  ProjectUIDL,
  ComponentDependency,
  Mapping,
  UIDLElement,
  UIDLNode,
  UIDLAttributeValue,
} from './uidl-definitions'

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
  dependencies: Record<string, ComponentDependency>
}

export type ComponentPlugin = (structure: ComponentStructure) => Promise<ComponentStructure>

export interface ComponentDefaultPluginParams {
  fileId: string
}

export type ComponentPluginFactory<T> = (
  configuration?: Partial<T & ComponentDefaultPluginParams>
) => ComponentPlugin

export interface CompiledComponent {
  files: GeneratedFile[]
  dependencies: Record<string, string>
}

export interface ComponentGenerator {
  generateComponent: GenerateComponentFunction
  resolveElement: (node: UIDLElement, options?: GeneratorOptions) => UIDLElement
  addPlugin: (plugin: ComponentPlugin) => void
  addMapping: (mapping: Mapping) => void
}

export interface GeneratorOptions {
  localDependenciesPrefix?: string
  assetsPrefix?: string
  mapping?: Mapping
  skipValidation?: boolean
}

export type CodeGeneratorFunction<T> = (content: T) => string

/**
 * This structure is used for keeping information about a single state key while creating a component
 */
export interface StateIdentifier {
  key: string
  type: string
  setter: string
  default: any
}

// TODO: Use this instead of StateIdentifier (hook setter can be added on a meta object)
export interface ConditionalIdentifier {
  key: string
  type: string
  prefix?: string
}

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

/* Project Types */

export interface GeneratedFolder {
  name: string
  files: GeneratedFile[]
  subFolders: GeneratedFolder[]
}

export interface GeneratedFile {
  name: string
  fileType: string
  content: string
}

export interface ComponentFactoryParams {
  componentGenerator: ComponentGenerator
  componentUIDL: ComponentUIDL
  componentOptions: {
    assetsPrefix: string
    localDependenciesPrefix?: string
    skipValidation?: boolean
  }
  metadataOptions?: {
    usePathAsFileName?: boolean
    convertDefaultToIndex?: boolean
  }
}

export interface ComponentGeneratorOutput {
  files: GeneratedFile[]
  dependencies: Record<string, string>
}

export interface ProjectGeneratorOptions {
  sourcePackageJson?: PackageJSON
  distPath?: string
  customMapping?: Mapping
  skipValidation?: boolean
}

export type ProjectGeneratorFunction = (
  uidl: ProjectUIDL,
  options?: ProjectGeneratorOptions
) => Promise<{
  outputFolder: GeneratedFolder
  assetsPath?: string
}>

export interface PackageJSON {
  name: string
  description: string
  version: string
  main: string
  author: string
  license: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  [key: string]: any
}

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

export interface ProjectGeneratorOutput {
  outputFolder: GeneratedFolder
  assetsPath: string
}

export type GenerateProjectFunction = (
  input: Record<string, unknown>,
  options: ProjectGeneratorOptions
) => Promise<ProjectGeneratorOutput>

export type GenerateComponentFunction = (
  // TODO rename to ComponentGeneratorOptions
  input: Record<string, unknown>,
  options?: GeneratorOptions
) => Promise<CompiledComponent>
