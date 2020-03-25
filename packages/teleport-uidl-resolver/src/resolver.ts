import * as utils from './utils'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import { ComponentUIDL, UIDLElement, Mapping, GeneratorOptions } from '@teleporthq/teleport-types'
import { resolveAbilities } from './resolvers/abilities'

/**
 * The resolver takes the input UIDL and converts all the abstract node types into
 * concrete node types, based on the mappings you provide
 */
export default class Resolver {
  private mapping: Mapping = {
    elements: {},
    events: {},
    attributes: {},
    illegalClassNames: [],
    illegalPropNames: [],
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

  public resolveUIDL(input: ComponentUIDL, options: GeneratorOptions = {}) {
    const mapping = utils.mergeMappings(this.mapping, options.mapping)
    const newOptions = {
      ...options,
      mapping,
    }

    const uidl = UIDLUtils.cloneObject(input)

    UIDLUtils.setFriendlyOutputOptions(uidl)

    utils.checkForIllegalNames(uidl, mapping)

    resolveAbilities(uidl, newOptions)

    // TODO: Rename into apply mappings
    utils.resolveNode(uidl.node, newOptions)

    utils.removeIgnoredNodes(uidl.node)

    const nodesLookup = {}
    utils.createNodesLookup(uidl.node, nodesLookup)
    utils.generateUniqueKeys(uidl.node, nodesLookup)

    utils.ensureDataSourceUniqueness(uidl.node)

    // There might be urls that need to be prefixed in the metaTags of the component
    utils.resolveMetaTags(uidl, newOptions)

    return uidl
  }

  public resolveElement(element: UIDLElement, options: GeneratorOptions = {}) {
    const mapping = utils.mergeMappings(this.mapping, options.mapping)

    const newOptions = {
      ...options,
      mapping,
    }
    const returnElement = UIDLUtils.cloneObject(element)
    utils.resolveElement(returnElement, newOptions)
    return returnElement
  }
}
