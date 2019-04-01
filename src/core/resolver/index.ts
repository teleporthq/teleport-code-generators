import * as utils from './utils'
import { sanitizeVariableName } from '../../shared/utils/string-utils'
import { cloneElement } from '../../shared/utils/uidl-utils'

/**
 * The resolver takes the input UIDL and converts all the abstract node types into
 * concrete node types, based on the mappings you provide
 */
export default class Resolver {
  private mapping: Mapping = {
    elements: {},
    events: {},
  }

  constructor(mapping?: Mapping | Mapping[]) {
    if (Array.isArray(mapping)) {
      mapping.forEach((mp) => this.addMapping(mp))
    } else if (mapping) {
      this.addMapping(mapping)
    }
  }

  public addMapping(mapping: Mapping) {
    this.mapping = utils.mergeMappings(this.mapping, mapping)
  }

  public resolveUIDL(uidl: ComponentUIDL, options: GeneratorOptions = {}) {
    const { customMapping, localDependenciesPrefix = './', assetsPrefix } = options
    if (customMapping) {
      this.addMapping(customMapping)
    }

    const node = cloneElement(uidl.node)

    utils.resolveContentNode(node, this.mapping, localDependenciesPrefix, assetsPrefix)

    const nodesLookup = {}
    utils.createNodesLookup(node, nodesLookup)
    utils.generateUniqueKeys(node, nodesLookup)

    return {
      ...uidl,
      name: sanitizeVariableName(uidl.name),
      node,
    }
  }

  public resolveElement(element: UIDLElement, options: GeneratorOptions = {}) {
    const { customMapping, localDependenciesPrefix = './', assetsPrefix } = options
    const mapping = utils.mergeMappings(this.mapping, customMapping)
    const returnElement = cloneElement(element)

    utils.resolveContentNode(returnElement, mapping, localDependenciesPrefix, assetsPrefix)
    return returnElement
  }
}
