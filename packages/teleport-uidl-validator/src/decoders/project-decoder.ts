import { Decoder, object, optional, string, dict, array } from '@mojotech/json-type-validation'
import { UIDLGlobalProjectValues, WebManifest } from '@teleporthq/teleport-types'
import { globalAssetsValidator } from './utils'
import componentUIDLValudator, { rootComponentUIDLValidator } from './component-decoder'
import { VProjectUIDL } from './types'

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

export const globalProjectValuesDecoder: Decoder<UIDLGlobalProjectValues> = object({
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
  root: rootComponentUIDLValidator,
  components: optional(dict(componentUIDLValudator)),
})

export default projectUIDLValidator
