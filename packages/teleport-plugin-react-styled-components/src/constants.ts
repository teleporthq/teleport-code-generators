import { UIDLExternalDependency } from '@teleporthq/teleport-types'

export const VARIANT_DEPENDENCY: UIDLExternalDependency = {
  type: 'package',
  path: 'styled-system',
  version: '^5.1.5',
  meta: {
    namedImport: true,
  },
}

export const componentVariantPropPrefix = 'componentStyleVariants'
export const componentVariantPropKey = 'compVariant'

export const projectVariantPropPrefix = 'projectStyleVariants'
export const projectVariantPropKey = 'projVariant'
