import {
  ComponentDependency,
  ElementsMapping,
  ComponentUIDL,
  ContentNode,
  ProjectUIDL,
} from '../uidl-definitions/types'
import * as types from '@babel/types'

export type ChunkContent = string | CheerioStatic | types.Node | types.Node[]

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

interface ComponentDefaultPluginParams {
  fileId: string
}
export type ComponentPluginFactory<T> = (
  configuration?: Partial<T & ComponentDefaultPluginParams>
) => ComponentPlugin

export interface CompiledComponent {
  code: string
  externalCSS?: string
  externalDependencies: Record<string, string>
}

export interface ComponentGenerator {
  generateComponent: (uidl: ComponentUIDL, options?: GeneratorOptions) => Promise<CompiledComponent>
  resolveContentNode: (node: ContentNode, options?: GeneratorOptions) => ContentNode
  addPlugin: (plugin: ComponentPlugin) => void
  addMapping: (mapping: ElementsMapping) => void
}

export interface GeneratorOptions {
  localDependenciesPrefix?: string
  assetsPrefix?: string
  customMapping?: ElementsMapping
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

export enum ReactComponentStylingFlavors {
  InlineStyles = 'InlineStyles',
  StyledJSX = 'StyledJSX',
  JSS = 'JSS',
  CSSModules = 'CSSModules',
}

/* Project Types */

export interface Folder {
  name: string
  files: File[]
  subFolders: Folder[]
}

export interface File {
  content: string
  name: string
  extension: string
}

export interface ProjectGeneratorOptions {
  sourcePackageJson?: PackageJSON
  distPath?: string
  customMapping?: ElementsMapping
}

export type ProjectGeneratorFunction = (
  uidl: ProjectUIDL,
  options?: ProjectGeneratorOptions
) => Promise<{
  outputFolder: Folder
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
}
