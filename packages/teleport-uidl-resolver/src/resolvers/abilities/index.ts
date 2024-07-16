import { ComponentUIDL, GeneratorOptions, UIDLElementNode } from '@teleporthq/teleport-types'
import { insertLinks } from './utils'

export const resolveAbilities = (uidl: ComponentUIDL, options: GeneratorOptions) => {
  if (uidl.propDefinitions) {
    for (const propKey of Object.keys(uidl.propDefinitions)) {
      const prop = uidl.propDefinitions[propKey]
      if (prop.type === 'element' && typeof prop.defaultValue === 'object') {
        uidl.propDefinitions[propKey].defaultValue = insertLinks(
          prop.defaultValue as UIDLElementNode,
          options
        )
      }
    }
  }
  uidl.node = insertLinks(uidl.node, options)
}
