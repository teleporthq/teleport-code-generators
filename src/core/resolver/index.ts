import { ElementsMapping, ComponentUIDL, ContentNode } from '../../uidl-definitions/types'
import * as utils from './utils'
import { sanitizeVariableName } from '../../shared/utils/string-utils'
import { GeneratorOptions } from '../../shared/types'
import { cloneElement } from '../../shared/utils/uidl-utils'

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
    const { customMapping = {}, localDependenciesPrefix = './', assetsPrefix } = options
    const mapping = { ...this.elementsMapping, ...customMapping }

    const content = cloneElement(uidl.content)

    utils.resolveContentNode(content, mapping, localDependenciesPrefix, assetsPrefix)

    const nodesLookup = {}
    utils.createNodesLookup(content, nodesLookup)
    utils.generateUniqueKeys(content, nodesLookup)

    return {
      ...uidl,
      name: sanitizeVariableName(uidl.name),
      content,
    }
  }

  public resolveContentNode(node: ContentNode, options: GeneratorOptions = {}) {
    const { customMapping = {}, localDependenciesPrefix = './', assetsPrefix } = options
    const mapping = { ...this.elementsMapping, ...customMapping }
    const returnNode = cloneElement(node)

    utils.resolveContentNode(returnNode, mapping, localDependenciesPrefix, assetsPrefix)
  }
}
