import * as utils from './utils'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { ComponentUIDL, UIDLElement, Mapping, GeneratorOptions } from '@teleporthq/teleport-types'

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
    const mapping = utils.mergeMappings(this.mapping, options.mapping)
    const newOptions = {
      ...options,
      mapping,
    }

    const node = UIDLUtils.cloneObject(uidl.node)

    if (options.projectRouteDefinition) {
      utils.resolveNavlinks(node, options.projectRouteDefinition)
    }

    utils.resolveNode(node, newOptions)

    const nodesLookup = {}
    utils.createNodesLookup(node, nodesLookup)
    utils.generateUniqueKeys(node, nodesLookup)

    utils.ensureDataSourceUniqueness(node)

    const name = StringUtils.sanitizeVariableName(uidl.name)

    // There might be urls that need to be prefixed in the metaTags of the component
    utils.resolveMetaTags(uidl, options)

    return {
      ...uidl,
      name,
      node,
    }
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
