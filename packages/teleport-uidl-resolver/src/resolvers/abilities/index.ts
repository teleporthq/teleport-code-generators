import { ComponentUIDL, GeneratorOptions } from '@teleporthq/teleport-types'
import { insertLinks } from './utils'

export const resolveAbilities = (uidl: ComponentUIDL, options: GeneratorOptions) => {
  uidl.node = insertLinks(uidl.node, options)
}
