import { ElementsMapping, ComponentUIDL, ContentNode } from '../../uidl-definitions/types'
import * as utils from './utils'
import { sanitizeVariableName } from '../../shared/utils/string-utils'
import { GeneratorOptions } from '../../shared/types'

/**
 * The resolver takes the input UIDL and converts all the abstract node types into
 * concrete node types, based on the mappings you provide
 */
export default class Resolver {
  private elementsMapping: ElementsMapping = {}

  constructor(elementsMapping: ElementsMapping = {}) {
    this.elementsMapping = elementsMapping
  }

  public addMapping(elementsMapping: ElementsMapping) {
    this.elementsMapping = { ...this.elementsMapping, ...elementsMapping }
  }

  public resolveUIDL(uidl: ComponentUIDL, options: GeneratorOptions = {}) {
    return {
      ...uidl,
      name: sanitizeVariableName(uidl.name),
      content: this.resolveContentNode(uidl.content, options),
    }
  }

  public resolveContentNode(node: ContentNode, options: GeneratorOptions = {}) {
    const customMapping = options.customMapping || {}
    const localDependenciesPrefix = options.localDependenciesPrefix || './'
    const assetsPrefix = options.assetsPrefix
    const mapping = { ...this.elementsMapping, ...customMapping }
    return utils.resolveContentNode(node, mapping, localDependenciesPrefix, assetsPrefix)
  }
}
