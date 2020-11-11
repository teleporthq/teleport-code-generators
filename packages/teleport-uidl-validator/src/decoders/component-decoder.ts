import {
  object,
  string,
  dict,
  withDefault,
  Decoder,
  optional,
  lazy,
} from '@mojotech/json-type-validation'
import { VComponentUIDL, VRootComponentUIDL } from '@teleporthq/teleport-types'
import {
  propDefinitionsDecoder,
  stateDefinitionsDecoder,
  outputOptionsDecoder,
  elementNodeDecoder,
  componentSeoDecoder,
  externaldependencyDecoder,
  peerDependencyDecoder,
  designTokensDecoder,
} from './utils'
import { styleSetDefinitionDecoder } from './project-style-sheet-decoders'

export const componentUIDLDecoder: Decoder<VComponentUIDL> = object({
  name: withDefault('MyComponent', string()),
  node: elementNodeDecoder,
  stateDefinitions: optional(dict(stateDefinitionsDecoder)),
  propDefinitions: optional(dict(propDefinitionsDecoder)),
  importDefinitions: optional(dict(externaldependencyDecoder)),
  outputOptions: optional(outputOptionsDecoder),
  seo: optional(componentSeoDecoder),
})

export const rootComponentUIDLDecoder: Decoder<VRootComponentUIDL> = object({
  name: withDefault('App', string()),
  node: elementNodeDecoder,
  stateDefinitions: dict(stateDefinitionsDecoder),
  propDefinitions: optional(dict(propDefinitionsDecoder)),
  importDefinitions: optional(dict(externaldependencyDecoder)),
  peerDefinitions: optional(dict(peerDependencyDecoder)),
  styleSetDefinitions: optional(dict(lazy(() => styleSetDefinitionDecoder))),
  outputOptions: optional(outputOptionsDecoder),
  seo: optional(componentSeoDecoder),
  designLanguage: optional(
    object({
      tokens: optional(designTokensDecoder),
    })
  ),
})
