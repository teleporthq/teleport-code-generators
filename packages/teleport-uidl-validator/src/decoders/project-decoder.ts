import {
  Decoder,
  object,
  optional,
  string,
  dict,
  array,
  intersection,
} from '@mojotech/json-type-validation'
import {
  VUIDLGlobalProjectValues,
  WebManifest,
  VProjectUIDL,
  ContextsUIDL,
  ContextUIDLItem,
  ResourcesUIDL,
  ResourceItemUIDL,
} from '@teleporthq/teleport-types'
import { globalAssetsDecoder, resourceDecoder } from './utils'
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

export const projectResourceItemDecoder: Decoder<ResourceItemUIDL> = intersection(
  resourceDecoder,
  object({
    id: string(),
    name: string(),
  })
)

export const resourcesDecoder: Decoder<ResourcesUIDL> = object({
  rootFolder: optional(string()),
  items: dict(optional(projectResourceItemDecoder)),
})

export const projectUIDLDecoder: Decoder<VProjectUIDL> = object({
  name: string(),
  globals: globalProjectValuesDecoder,
  root: rootComponentUIDLDecoder,
  components: optional(dict(componentUIDLDecoder)),
  contexts: optional(contextsDecoder),
  resources: optional(resourcesDecoder),
})
