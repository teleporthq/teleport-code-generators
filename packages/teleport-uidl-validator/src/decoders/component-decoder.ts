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
} from './utils'

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
