import {
  Decoder,
  object,
  optional,
  string,
  array,
  union,
  constant,
  number,
} from '@mojotech/json-type-validation'
import type { UIDLPopup, UIDLPopupConfig } from '@teleporthq/teleport-types'

const popupDecoder: Decoder<UIDLPopup> = object({
  id: string(),
  componentName: string(),
  purpose: union(
    constant('newsletter' as const),
    constant('discount' as const),
    constant('promote' as const),
    constant('announcement' as const),
    constant('custom' as const)
  ),
  layout: union(
    constant('center' as const),
    constant('corner' as const),
    constant('bottom' as const)
  ),
  trigger: object({
    desktop: union(
      constant('exit-intent' as const),
      constant('delay' as const),
      constant('scroll' as const),
      constant('load' as const)
    ),
    phone: union(
      constant('delay' as const),
      constant('scroll' as const),
      constant('load' as const)
    ),
    delaySeconds: number(),
    scrollPercent: number(),
  }),
  frequency: object({
    kind: union(constant('days' as const), constant('once' as const), constant('session' as const)),
    days: number(),
  }),
  pages: object({
    mode: union(constant('all' as const), constant('only' as const), constant('except' as const)),
    paths: array(string()),
  }),
  audience: union(
    constant('everyone' as const),
    constant('new' as const),
    constant('returning' as const)
  ),
  voucherCode: optional(string()),
})

export const popupConfigDecoder: Decoder<UIDLPopupConfig> = object({
  popups: array(popupDecoder),
  excludedPaths: array(string()),
})
