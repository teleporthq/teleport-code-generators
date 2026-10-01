import {
  Decoder,
  object,
  optional,
  string,
  array,
  union,
  boolean,
  constant,
  number,
} from '@mojotech/json-type-validation'
import {
  UIDLInstallableWebApp,
  UIDLProgressiveWebApp,
  UIDLRetiredWebApp,
  UIDLWebAppIcons,
  UIDLWebAppScreenshot,
  UIDLWebPush,
} from '@teleporthq/teleport-types'

const webAppIconsDecoder: Decoder<UIDLWebAppIcons> = object({
  any192: string(),
  any512: string(),
  maskable512: string(),
  appleTouch180: string(),
})

const webAppScreenshotDecoder: Decoder<UIDLWebAppScreenshot> = object({
  src: string(),
  width: number(),
  height: number(),
  type: string(),
  formFactor: union(constant('narrow' as const), constant('wide' as const)),
})

const installableWebAppDecoder: Decoder<UIDLInstallableWebApp> = object({
  installable: constant(true as const),
  name: string(),
  shortName: string(),
  description: optional(string()),
  themeColor: string(),
  backgroundColor: string(),
  installBanner: boolean(),
  cacheContent: boolean(),
  networkOnlyPaths: array(string()),
  icons: optional(webAppIconsDecoder),
  screenshots: optional(array(webAppScreenshotDecoder)),
})

const retiredWebAppDecoder: Decoder<UIDLRetiredWebApp> = object({
  installable: constant(false as const),
})

export const progressiveWebAppDecoder: Decoder<UIDLProgressiveWebApp> = union(
  installableWebAppDecoder,
  retiredWebAppDecoder
)

export const webPushDecoder: Decoder<UIDLWebPush> = object({
  vapidPublicKey: string(),
})
