import {
  object,
  string,
  dict,
  withDefault,
  Decoder,
  optional,
} from '@mojotech/json-type-validation'
import { VComponentUIDL, VRootComponentUIDL } from './types'
import {
  styleSetDefinitionDecoder,
  propDefinitionsDecoder,
  stateDefinitionsDecoder,
  outputOptionsDecoder,
  elementNodeDecoder,
  componentSeoDecoder,
  externaldependencyDecoder,
  peerDependencyDecoder,
} from './utils'

const componentUIDLValidator: Decoder<VComponentUIDL> = object({
  name: withDefault('MyComponent', string()),
  node: elementNodeDecoder,
  stateDefinitions: optional(dict(stateDefinitionsDecoder)),
  propDefinitions: optional(dict(propDefinitionsDecoder)),
  importDefinitions: optional(dict(externaldependencyDecoder)),
  outputOptions: optional(outputOptionsDecoder),
  seo: optional(componentSeoDecoder),
})

const rootComponentUIDLValidator: Decoder<VRootComponentUIDL> = object({
  name: withDefault('App', string()),
  node: elementNodeDecoder,
  stateDefinitions: dict(stateDefinitionsDecoder),
  propDefinitions: optional(dict(propDefinitionsDecoder)),
  importDefinitions: optional(dict(externaldependencyDecoder)),
  peerDefinitions: optional(dict(peerDependencyDecoder)),
  styleSetDefinitions: optional(dict(styleSetDefinitionDecoder)),
  outputOptions: optional(outputOptionsDecoder),
  seo: optional(componentSeoDecoder),
})

export { rootComponentUIDLValidator }

export default componentUIDLValidator
