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
  UIDLStaticValue,
  ReferenceType,
  UIDLDynamicReference,
  UIDLPropDefinition,
  UIDLStateDefinition,
  UIDLStateValueDetails,
  UIDLPageOptions,
  UIDLComponentOutputOptions,
  UIDLDependency,
  UIDLStyleDefinitions,
  UIDLStyleValue,
  UIDLAttributeValue,
  UIDLEventHandlerStatement,
} from '@teleporthq/teleport-types'
import { VUIDLElementNode, VComponentUIDL, VUIDLElement, VUIDLStyleSetDefnition } from './types'

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

const styleSetDefinitionDecoder: Decoder<VUIDLStyleSetDefnition> = object({
  id: string(),
  name: string(),
  type: constant('reusable-project-style-map'),
  content: union(dict(staticValueDecoder), dict(string())),
})

// TODO: Implement decoder for () => void
const stateOrPropDefinitionDecoder = union(
  string(),
  number(),
  boolean(),
  array(union(string(), number(), object())),
  object()
)

const pageOptionsDecoder: Decoder<UIDLPageOptions> = object({
  componentName: optional(string()),
  navLink: optional(string()),
  fileName: optional(string()),
})

const stateValueDetailsDecoder: Decoder<UIDLStateValueDetails> = object({
  value: union(string(), number(), boolean()),
  pageoptions: optional(pageOptionsDecoder),
})

const propDefinitionsDecoder: Decoder<UIDLPropDefinition> = object({
  type: union(
    constant('string'),
    constant('boolean'),
    constant('number'),
    constant('array'),
    constant('func'),
    constant('object'),
    constant('children')
  ),
  defaultValue: optional(stateOrPropDefinitionDecoder),
  isRequired: optional(boolean()),
})

const stateDefinitionsDecoder: Decoder<UIDLStateDefinition> = object({
  type: union(
    constant('string'),
    constant('boolean'),
    constant('number'),
    constant('array'),
    constant('func'),
    constant('object'),
    constant('children')
  ),
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

const styleValueDecoder: Decoder<UIDLStyleValue> = attributeValueDecoder

const styleDefinitionsDecoder: Decoder<UIDLStyleDefinitions> = dict(styleValueDecoder)

const eventHandlerStatementDecoder: Decoder<UIDLEventHandlerStatement> = object({
  type: string(),
  modifies: optional(string()),
  newState: optional(union(string(), number(), boolean())),
  calls: optional(string()),
  args: optional(array(union(string(), number(), boolean()))),
})

export const element: Decoder<VUIDLElement> = object({
  elementType: string(),
  name: optional(string()),
  key: optional(string()),
  dependency: optional(dependencyDecoder),
  style: optional(union(styleDefinitionsDecoder, dict(string()))),
  attrributes: optional(dict(attributeValueDecoder)),
  events: optional(dict(array(eventHandlerStatementDecoder))),
})

export const elementNodeDecoder: Decoder<VUIDLElementNode> = object({
  type: constant('element'),
  content: element,
})

const componentUIDLValudator: Decoder<VComponentUIDL> = object({
  id: optional(string()),
  name: withDefault('MyComponent', string()),
  node: elementNodeDecoder,
  styleSetDefinitions: optional(dict(styleSetDefinitionDecoder)),
  propDefinitionsDecoder: optional(dict(propDefinitionsDecoder)),
  stateDefinitionsDecoder: optional(dict(stateDefinitionsDecoder)),
  outputOptions: optional(outputOptionsDecoder),
})

export default componentUIDLValudator
