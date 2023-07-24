import {
  Decoder,
  object,
  optional,
  string,
  dict,
  array,
  lazy,
  union,
  withDefault,
  number,
} from '@mojotech/json-type-validation'
import {
  VUIDLGlobalProjectValues,
  WebManifest,
  VProjectUIDL,
  UIDLResources,
} from '@teleporthq/teleport-types'
import { dependencyDecoder, globalAssetsDecoder, resourceItemDecoder } from './utils'
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

export const resourcesDecoder: Decoder<UIDLResources> = object({
  resourceMappers: optional(dict(lazy(() => dependencyDecoder))),
  items: optional(dict(lazy(() => resourceItemDecoder))),
  cache: withDefault(
    {
      revalidate: 1,
    },
    union(
      object({
        revalidate: number(),
      }),
      object({ dependency: lazy(() => dependencyDecoder) })
    )
  ),
})

export const projectUIDLDecoder: Decoder<VProjectUIDL> = object({
  name: string(),
  globals: globalProjectValuesDecoder,
  root: rootComponentUIDLDecoder,
  components: optional(dict(componentUIDLDecoder)),
  resources: optional(resourcesDecoder),
})
