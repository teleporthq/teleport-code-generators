interface ProjectUIDL {
  $schema?: string
  name: string
  globals: {
    settings: {
      title: string
      language: string
    }
    meta: Array<Record<string, string>>
    assets: GlobalAsset[]
    manifest?: WebManifest
    variables?: Record<string, string>
  }
  root: ComponentUIDL
  components?: Record<string, ComponentUIDL>
}

interface GlobalAsset {
  type: string
  path?: string
  content?: string
  meta?: Record<string, any>
}

interface ComponentUIDL {
  $schema?: string
  name: string
  content: ContentNode
  meta?: Record<string, any>
  propDefinitions?: Record<string, PropDefinition>
  stateDefinitions?: Record<string, StateDefinition>
}

interface PropDefinition {
  type: string
  defaultValue?: string | number | boolean | any[] | object | (() => void)
  meta?: Record<string, any>
}

interface StateDefinition {
  type: string
  defaultValue: string | number | boolean | any[] | object | (() => void)
  values?: Array<{
    value: string | number | boolean
    meta?: {
      componentName?: string
      path?: string
      fileName?: string
    }
    transitions?: any
  }>
  actions?: string[]
}

interface ContentNode {
  type: string
  name?: string
  key?: string // internal usage
  states?: StateBranch[]
  repeat?: RepeatDefinition
  dependency?: ComponentDependency
  style?: UIDLStyleDefinitions
  attrs?: Record<string, UIDLNodeAttributeValue>
  events?: EventDefinitions
  children?: Array<ContentNode | string>
}

interface RepeatDefinition {
  content: ContentNode
  dataSource: UIDLNodeAttributeValue
  meta?: {
    useIndex?: boolean
    iteratorName?: string
    dataSourceIdentifier?: string
  }
}

interface StateBranch {
  value: string | number | boolean | ConditionalExpression
  content: ContentNode | string
}

interface EventHandlerStatement {
  type: string
  modifies?: string
  newState?: string | number | boolean
  calls?: string
  args?: Array<string | number | boolean>
}

// interface StyleDefinitions {
//   [k: string]: number | string | StyleDefinitions
// }

declare type UIDLNodeStyleValue = UIDLNodeAttributeValue | UIDLNestedStyleDeclaration

interface UIDLNestedStyleDeclaration {
  type: 'nested-style'
  content: UIDLStyleDefinitions
}

declare type UIDLStyleDefinitions = Record<string, UIDLNodeStyleValue>
interface EventDefinitions {
  [k: string]: EventHandlerStatement[]
}

interface ComponentDependency {
  type: string
  path?: string
  version?: string
  meta?: {
    namedImport?: boolean
    originalName?: string
  }
}

interface ConditionalExpression {
  conditions: Array<{
    operation: string
    operand?: string | boolean | number
  }>
  matchingCriteria: string
}

interface WebManifest {
  short_name?: string
  name?: string
  icons?: Array<{ src: string; type: string; sizes: string }>
  start_url?: string
  background_color?: string
  display?: string
  orientation?: string
  scope?: string
  theme_color?: string
}

/* mapping interfaces */

interface Mapping {
  elements?: Record<string, ElementMapping>
  events?: Record<string, string>
}

interface ElementMapping {
  type: string
  dependency?: ComponentDependency
  attrs?: Record<string, UIDLNodeAttributeValue>
  children?: Array<ContentNode | string>
  repeat?: RepeatDefinition
}

type ChunkContent = string | any | any[]

/**
 * React could have one or more JS chunks, nothing else.
 * Vue has a template chunk, of type XML/HTML, a javascript
 * chunk and a style chunk
 */
interface ChunkDefinition {
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
interface ComponentStructure {
  chunks: ChunkDefinition[]
  uidl: ComponentUIDL
  dependencies: Record<string, ComponentDependency>
}

type ComponentPlugin = (structure: ComponentStructure) => Promise<ComponentStructure>

interface ComponentDefaultPluginParams {
  fileId: string
}
type ComponentPluginFactory<T> = (
  configuration?: Partial<T & ComponentDefaultPluginParams>
) => ComponentPlugin

interface CompiledComponent {
  code: string
  externalCSS?: string
  externalDependencies: Record<string, string>
}

interface ComponentGenerator {
  generateComponent: (uidl: ComponentUIDL, options?: GeneratorOptions) => Promise<CompiledComponent>
  resolveContentNode: (node: ContentNode, options?: GeneratorOptions) => ContentNode
  addPlugin: (plugin: ComponentPlugin) => void
  addMapping: (mapping: Mapping) => void
}

interface GeneratorOptions {
  localDependenciesPrefix?: string
  assetsPrefix?: string
  customMapping?: Mapping
  skipValidation?: boolean
}

type CodeGeneratorFunction<T> = (content: T) => string

/**
 * This structure is used for keeping information about a single state key while creating a component
 */
interface StateIdentifier {
  key: string
  type: string
  setter: string
  default: any
}

interface HastNode {
  type: string
  tagName: string
  properties: Record<string, string | boolean>
  children: Array<HastNode | HastText>
}

interface HastText {
  type: string
  value: string
}

/* Project Types */

interface GeneratedFolder {
  name: string
  files: GeneratedFile[]
  subFolders: GeneratedFolder[]
}

interface GeneratedFile {
  content: string
  name: string
  extension: string
}

interface ProjectGeneratorOptions {
  sourcePackageJson?: PackageJSON
  distPath?: string
  customMapping?: Mapping
}

type ProjectGeneratorFunction = (
  uidl: ProjectUIDL,
  options?: ProjectGeneratorOptions
) => Promise<{
  outputFolder: GeneratedFolder
  assetsPath?: string
}>

interface PackageJSON {
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

interface UIDLDynamicReference {
  type: 'dynamic'
  content: {
    referenceType: 'prop' | 'state' | 'local' | 'attr'
    id: string
  }
}

interface UIDLStaticReference {
  type: 'static'
  content: string | number | boolean | any[] // array<any> for data sources
}

type UIDLNodeAttributeValue = UIDLDynamicReference | UIDLStaticReference
