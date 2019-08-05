import { UIDLDynamicReference } from '@teleporthq/teleport-types'

export const DEFAULT_VUE_DYNAMIC_STYLE = (rootStyles) => {
  return Object.keys(rootStyles).map((styleKey) => {
    return `${styleKey}: ${(rootStyles[styleKey] as UIDLDynamicReference).content.id}`
  })
}
