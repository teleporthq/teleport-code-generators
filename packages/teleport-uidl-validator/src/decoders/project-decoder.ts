import {
  Decoder,
  object,
  optional,
  string,
  dict,
  array,
  constant,
  union,
  boolean,
} from '@mojotech/json-type-validation'
import { UIDLGlobalProjectValues, UIDLGlobalAsset, WebManifest } from '@teleporthq/teleport-types'
import componentUIDLValudator from './component-decoder'
import { VProjectUIDL } from './types'

const globalAssetsValidator: Decoder<UIDLGlobalAsset> = object({
  type: union(
    constant('script'),
    constant('style'),
    constant('font'),
    constant('canonical'),
    constant('icon')
  ),
  path: optional(string()),
  content: optional(string()),
  options: optional(
    object({
      async: optional(boolean()),
      defer: optional(boolean()),
      target: optional(string()),
      iconType: optional(string()),
      iconSizes: optional(string()),
    })
  ),
})

const webManifestDecoder: Decoder<WebManifest> = object({
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

const globalProjectValuesDecoder: Decoder<UIDLGlobalProjectValues> = object({
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
  meta: array(dict(string())),
  assets: array(globalAssetsValidator),
  manifest: optional(webManifestDecoder),
  variables: optional(dict(string())),
})

const projectUIDLValidator: Decoder<VProjectUIDL> = object({
  $schema: optional(string()),
  name: string(),
  globals: globalProjectValuesDecoder,
  root: componentUIDLValudator,
  components: optional(dict(componentUIDLValudator)),
})

export default projectUIDLValidator
