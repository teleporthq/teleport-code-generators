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
  node: UIDLNode
  meta?: Record<string, any>
  propDefinitions?: Record<string, UIDLPropDefinition>
  stateDefinitions?: Record<string, UIDLStateDefinition>
}

interface UIDLPropDefinition {
  type: string
  defaultValue?: string | number | boolean | any[] | object | (() => void)
  meta?: Record<string, any>
}

interface UIDLStateDefinition {
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

interface UIDLDynamicReference {
  type: 'dynamic'
  content: {
    referenceType: 'prop' | 'state' | 'local' | 'attr'
    id: string
  }
}

interface UIDLStaticValue {
  type: 'static'
  content: string | number | boolean | any[] // any[] for data sources
}

interface UIDLNestedStyleDeclaration {
  type: 'nested-style'
  content: UIDLStyleDefinitions
}

interface UIDLRepeatNode {
  type: 'repeat'
  content: {
    node: UIDLNode
    dataSource: UIDLAttributeValue
    meta?: {
      useIndex?: boolean
      iteratorName?: string
      dataSourceIdentifier?: string
    }
  }
}

interface UIDLElementNode {
  type: 'element'
  content: UIDLElement
}

interface UIDLElement {
  elementType: string
  name?: string
  key?: string // internal usage
  dependency?: ComponentDependency
  style?: UIDLStyleDefinitions
  attrs?: Record<string, UIDLAttributeValue>
  events?: EventDefinitions
  children?: UIDLNode[]
}

type UIDLNode = UIDLDynamicReference | UIDLStaticValue | UIDLRepeatNode | UIDLElementNode

type UIDLAttributeValue = UIDLDynamicReference | UIDLStaticValue

type UIDLStyleValue = UIDLAttributeValue | UIDLNestedStyleDeclaration

type UIDLStyleDefinitions = Record<string, UIDLStyleValue>

interface EventDefinitions {
  [k: string]: EventHandlerStatement[]
}

interface EventHandlerStatement {
  type: string
  modifies?: string
  newState?: string | number | boolean
  calls?: string
  args?: Array<string | number | boolean>
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

interface StateBranch {
  value: string | number | boolean | ConditionalExpression
  content: UIDLNode
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

interface Mapping {
  elements?: Record<string, UIDLElement> // maybe for convenience UIDLElements can be mapped directly?
  events?: Record<string, string>
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
  resolveElement: (node: UIDLElement, options?: GeneratorOptions) => UIDLElement
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

interface ComponentFactoryParams {
  componentGenerator: ComponentGenerator
  componentUIDL: ComponentUIDL
  componentOptions: {
    assetsPrefix: string
    localDependenciesPrefix?: string
  }
  metadataOptions?: {
    usePathAsFileName?: boolean
    convertDefaultToIndex?: boolean
  }
  componentExtension?: string
}

interface ComponentGeneratorOutput {
  files: GeneratedFile[]
  dependencies: Record<string, string>
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
