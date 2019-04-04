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
  content: UIDLRepeatContent
}

interface UIDLRepeatContent {
  node: UIDLNode
  dataSource: UIDLAttributeValue
  meta?: {
    useIndex?: boolean
    iteratorName?: string
    dataSourceIdentifier?: string
  }
}

interface UIDLConditionalNode {
  type: 'conditional'
  content: {
    node: UIDLNode
    reference: UIDLDynamicReference
    value?: string | number | boolean
    condition?: UIDLConditionalExpression
  }
}

interface UIDLConditionalExpression {
  conditions: Array<{
    operation: string
    operand?: string | boolean | number
  }>
  matchingCriteria?: string
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

type UIDLNode =
  | UIDLDynamicReference
  | UIDLStaticValue
  | UIDLRepeatNode
  | UIDLElementNode
  | UIDLConditionalNode

type UIDLAttributeValue = UIDLDynamicReference | UIDLStaticValue

type UIDLStyleValue = UIDLAttributeValue | UIDLNestedStyleDeclaration

type UIDLStyleDefinitions = Record<string, UIDLStyleValue>

type EventDefinitions = Record<string, EventHandlerStatement[]>

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
  files: Array<GeneratedFile>
  dependencies: Record<string, string>
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
  mapping?: Mapping
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

// TODO: Use this instead of StateIdentifier (hook setter can be added on a meta object)
interface ConditionalIdentifier {
  key: string
  type: string
  prefix?: string
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
  name: string
  fileType: string
  content: string
}

interface ComponentFactoryParams {
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

interface ComponentGeneratorOutput {
  files: GeneratedFile[]
  dependencies: Record<string, string>
}

interface ProjectGeneratorOptions {
  sourcePackageJson?: PackageJSON
  distPath?: string
  customMapping?: Mapping
  skipValidation?: boolean
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

/**
 * Function used to alter the generic generatedEntity by adding a attribute
 * named attributeKey with attributeValue data. This type of function is meant
 * to be used in generators that support attribute values on their presentation
 * nodes.
 *
 * For example, a <div/> in HAST could get a new attribute tab-index with value 0
 * with a function like this.
 */
type AttributeAssignCodeMod<T> = (
  generatedEntity: T,
  attributeKey: string,
  attributeValue: UIDLAttributeValue
) => void

/**
 * Function used to generate a presentation structure.
 */
type NodeSyntaxGenerator<Accumulators, ReturnValues> = (
  node: UIDLNode,
  accumulators: Accumulators
) => ReturnValues
