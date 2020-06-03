import {
  object,
  string,
  dict,
  constant,
  withDefault,
  number,
  Decoder,
  optional,
  union,
  boolean,
  array,
} from '@mojotech/json-type-validation'
import {
  UIDLStyleSetDefnition,
  UIDLStaticValue,
  ReferenceType,
  UIDLDynamicReference,
  UIDLPropDefinition,
  UIDLStateDefinition,
  UIDLStateValueDetails,
  UIDLPageOptions,
  UIDLComponentOutputOptions,
  UIDLElementNode,
  UIDLElement,
  UIDLDependency,
  UIDLStyleDefinitions,
  UIDLStyleValue,
  UIDLAttributeValue,
  ComponentUIDL,
} from '@teleporthq/teleport-types'

const referenceTypeDecoder: Decoder<ReferenceType> = union(
  constant('prop'),
  constant('state'),
  constant('local'),
  constant('attr'),
  constant('children')
)

const dynamicValueDecoder: Decoder<UIDLDynamicReference> = object({
  type: constant('dynamic'),
  content: object({
    referenceType: referenceTypeDecoder,
    id: string(),
  }),
})

const staticValueDecoder: Decoder<UIDLStaticValue> = object({
  type: constant('static'),
  content: union(string(), number(), boolean()),
})

const styleSetDefinitionDecoder: Decoder<UIDLStyleSetDefnition> = object({
  id: string(),
  name: string(),
  type: constant('reusable-project-style-map'),
  content: staticValueDecoder,
})

const stateOrPropDefinitionDecoder = union(
  string(),
  number(),
  boolean(),
  array(union(string(), number(), object())),
  object()
)

const propDefinitionsDecoder: Decoder<UIDLPropDefinition> = object({
  type: string(),
  defaultValue: optional(stateOrPropDefinitionDecoder),
  isRequired: optional(boolean()),
})

const pageOptionsDecoder: Decoder<UIDLPageOptions> = object({
  componentName: optional(string()),
  navLink: optional(string()),
  fileName: optional(string()),
})

const stateValueDetailsDecoder: Decoder<UIDLStateValueDetails> = object({
  value: union(string(), number(), boolean()),
  pageoptions: optional(pageOptionsDecoder),
})

const stateDefinitionsDecoder: Decoder<UIDLStateDefinition> = object({
  type: string(),
  defaultValue: optional(stateOrPropDefinitionDecoder),
  values: optional(array(stateValueDetailsDecoder)),
})

const outputOptionsDecoder: Decoder<UIDLComponentOutputOptions> = object({
  componentClassName: optional(string()),
  fileName: optional(string()),
  styleFileName: optional(string()),
  templateFileName: optional(string()),
  moduleName: optional(string()),
  folderPath: optional(array(string())),
})

const dependencyDecoder: Decoder<UIDLDependency> = object({
  type: union(constant('library'), constant('package'), constant('local')),
  path: optional(string()),
  version: optional(string()),
  meta: optional(
    object({
      namedImport: optional(boolean()),
      origialName: optional(string()),
      importJustPath: optional(boolean()),
    })
  ),
})

const attributeValueDecoder: Decoder<UIDLAttributeValue> = union(
  dynamicValueDecoder,
  staticValueDecoder
)
const styleValueDecoder: Decoder<UIDLStyleValue> = union(attributeValueDecoder, string())

const styleDefinitionsDecoder: Decoder<UIDLStyleDefinitions> = dict(styleValueDecoder)

export const element: Decoder<UIDLElement> = object({
  elementType: string(),
  name: optional(string()),
  key: optional(string()),
  dependency: optional(dependencyDecoder),
  style: optional(styleDefinitionsDecoder),
})

export const elementNodeDecoder: Decoder<UIDLElementNode> = object({
  type: constant('element'),
  content: element,
})

const componentUIDLValudator: Decoder<ComponentUIDL> = object({
  id: optional(string()),
  name: withDefault('MyComponent', string()),
  node: elementNodeDecoder,
  styleSetDefinitions: optional(dict(styleSetDefinitionDecoder)),
  propDefinitionsDecoder: optional(dict(propDefinitionsDecoder)),
  stateDefinitionsDecoder: optional(dict(stateDefinitionsDecoder)),
  outputOptions: optional(outputOptionsDecoder),
})

export default componentUIDLValudator
