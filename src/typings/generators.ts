import {
  ComponentUIDL,
  ContentNode,
  ProjectUIDL,
  ComponentDependency,
  RepeatDefinition,
} from './uidl-definitions'

export interface Mapping {
  elements?: Record<string, ElementMapping>
  events?: Record<string, string>
}

export interface ElementMapping {
  type: string
  dependency?: ComponentDependency
  attrs?: Record<string, any>
  children?: Array<ContentNode | string>
  repeat?: RepeatDefinition
}

export interface CompiledComponent {
  code: string
  externalCSS?: string
  externalDependencies: Record<string, string>
}

/**
 * The structure of a component contains multiple chunks, and information
 * about how these chunks work together
 */

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

export interface ComponentGenerator {
  generateComponent: (uidl: ComponentUIDL, options?: GeneratorOptions) => Promise<CompiledComponent>
  resolveContentNode: (node: ContentNode, options?: GeneratorOptions) => ContentNode
  addPlugin: (plugin: ComponentPlugin) => void
  addMapping: (mapping: Mapping) => void
}

export interface GeneratorOptions {
  localDependenciesPrefix?: string
  assetsPrefix?: string
  customMapping?: Mapping
  skipValidation?: boolean
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

/* Project Types */

export interface GeneratedFolder {
  name: string
  files: GeneratedFile[]
  subFolders: GeneratedFolder[]
}

export interface GeneratedFile {
  content: string
  name: string
  extension: string
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
  componentExtension?: string
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
