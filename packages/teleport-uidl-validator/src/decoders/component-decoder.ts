import {
  object,
  string,
  dict,
  withDefault,
  Decoder,
  optional,
} from '@mojotech/json-type-validation'
import { VComponentUIDL } from './types'
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

const componentUIDLValudator: Decoder<VComponentUIDL> = object({
  $schema: optional(string()),
  id: optional(string()),
  name: withDefault('MyComponent', string()),
  node: elementNodeDecoder,
  stateDefinitions: optional(dict(stateDefinitionsDecoder)),
  styleSetDefinitions: optional(dict(styleSetDefinitionDecoder)),
  propDefinitions: optional(dict(propDefinitionsDecoder)),
  peerDefinitions: optional(dict(peerDependencyDecoder)),
  importDefinitions: optional(dict(externaldependencyDecoder)),
  outputOptions: optional(outputOptionsDecoder),
  seo: optional(componentSeoDecoder),
})

export default componentUIDLValudator
