import {
  Decoder,
  object,
  optional,
  string,
  dict,
  array,
  union,
  constant,
  withDefault,
} from '@mojotech/json-type-validation'
import {
  VUIDLGlobalProjectValues,
  WebManifest,
  VProjectUIDL,
  ContextsUIDL,
  ContextUIDLItem,
  UIDLResources,
  UIDLResourceItem,
  UIDLENVValue,
} from '@teleporthq/teleport-types'
import { globalAssetsDecoder, staticValueDecoder } from './utils'
import { componentUIDLDecoder, rootComponentUIDLDecoder } from './component-decoder'

export const webManifestDecoder: Decoder<WebManifest> = object({
  short_name: optional(string()),
  name: optional(string()),
  icons: optional(array(object({ src: string(), type: string(), sizes: string() }))),
  start_url: optional(string()),
  background_color: optional(string()),
  display: optional(string()),
  orientation: optional(string()),
  scope: optional(string()),
  theme_color: optional(string()),
})

export const globalProjectValuesDecoder: Decoder<VUIDLGlobalProjectValues> = object({
  settings: object({
    title: string(),
    language: string(),
  }),
  customCode: optional(
    object({
      head: optional(string()),
      body: optional(string()),
    })
  ),
  env: optional(dict(string())),
  meta: array(dict(string())),
  assets: array(globalAssetsDecoder),
  manifest: optional(webManifestDecoder),
  variables: optional(dict(string())),
})

export const contextItemDecoder: Decoder<ContextUIDLItem> = object({
  name: string(),
  fileName: optional(string()),
})

export const contextsDecoder: Decoder<ContextsUIDL> = object({
  rootFolder: optional(string()),
  items: dict(optional(contextItemDecoder)),
})

export const envValueDecoder: Decoder<UIDLENVValue> = object({
  type: constant('env'),
  content: string(),
})

export const resourceItemDecoder: Decoder<UIDLResourceItem> = object({
  name: string(),
  headers: optional(dict(union(staticValueDecoder, envValueDecoder))),
  path: object({
    baseUrl: union(staticValueDecoder, envValueDecoder),
    route: staticValueDecoder,
  }),
  params: optional(dict(staticValueDecoder)),
  method: withDefault('GET', union(constant('GET'), constant('POST'))),
  body: optional(dict(staticValueDecoder)),
})

export const resourcesDecoder: Decoder<UIDLResources> = object({
  items: optional(dict(resourceItemDecoder)),
})

export const projectUIDLDecoder: Decoder<VProjectUIDL> = object({
  name: string(),
  globals: globalProjectValuesDecoder,
  root: rootComponentUIDLDecoder,
  components: optional(dict(componentUIDLDecoder)),
  contexts: optional(contextsDecoder),
  resources: optional(resourcesDecoder),
})
