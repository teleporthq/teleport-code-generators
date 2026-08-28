import * as utils from './utils'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import {
  ComponentUIDL,
  UIDLElement,
  Mapping,
  GeneratorOptions,
  ElementsLookup,
} from '@teleporthq/teleport-types'
import { resolveAbilities } from './resolvers/abilities'
import { resolveStyleSetDefinitions } from './resolvers/style-set-definitions'
import { resolveReferencedStyle } from './resolvers/referenced-styles'
import { resolveHtmlNode } from './resolvers/embed-node'
import { resolveUnboundExpressions } from './resolvers/unbound-expressions'
import { resolveHtmlNesting } from './resolvers/html-nesting'

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

  public resolveUIDL(input: ComponentUIDL, options: GeneratorOptions = { extractedResources: {} }) {
    const mapping = utils.mergeMappings(this.mapping, options.mapping)
    const newOptions = {
      ...options,
      mapping,
    }
    const lookup: ElementsLookup = {}

    const uidl = UIDLUtils.cloneObject(input)
    uidl.styleSetDefinitions = resolveStyleSetDefinitions(input.styleSetDefinitions, newOptions)

    UIDLUtils.setFriendlyOutputOptions(uidl)

    utils.checkForIllegalNames(uidl, mapping)

    utils.checkForDefaultPropsContainingAssets(uidl, newOptions)
    utils.checkForDefaultStateValueContainingAssets(uidl, newOptions)

    resolveAbilities(uidl, newOptions)

    resolveReferencedStyle(uidl, newOptions)
    resolveHtmlNode(uidl, newOptions)

    utils.resolveNode(uidl.node, newOptions)
    utils.resolveNodeInPropDefinitions(uidl, newOptions)

    // Element types are concrete HTML tags from here on, which is the earliest
    // point at which the markup can be checked against the HTML content model.
    // Nesting the parser refuses to keep (a `<div>` inside a `<p>`, a `<form>`
    // inside a `<form>`) makes the served HTML parse into a different tree than
    // the one that was rendered, and React then fails to hydrate the page.
    if (!newOptions.skipHtmlNestingResolver) {
      resolveHtmlNesting(uidl, newOptions)
    }

    // Guard against `expr` nodes that reference an out-of-scope identifier
    // (e.g. an orphaned `<option>{{ cat.name }}</option>` whose repeater was
    // never generated). Left untouched they compile to `ReferenceError`s that
    // fail the static export / `next build`.
    resolveUnboundExpressions(uidl)

    utils.createNodesLookup(uidl, lookup)
    utils.generateUniqueKeys(uidl, lookup)

    utils.ensureDataSourceUniqueness(uidl.node)
    utils.resolveMetaTags(uidl, newOptions)

    return uidl
  }

  public resolveElement(
    element: UIDLElement,
    options: GeneratorOptions = { extractedResources: {} }
  ) {
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
