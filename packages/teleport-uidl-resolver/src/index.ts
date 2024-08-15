import Resolver from './resolver'
import { HTMLMapping } from './html-mapping'
import { UIDLElement, GeneratorOptions } from '@teleporthq/teleport-types'
import { resolveStyleSetDefinitions } from './resolvers/style-set-definitions'
import { generateUniqueKeys, createNodesLookup } from './utils'

const htmlResolver = new Resolver(HTMLMapping)

const resolveUIDLElement = (node: UIDLElement, options?: GeneratorOptions) => {
  return htmlResolver.resolveElement(node, options)
}

export {
  resolveUIDLElement,
  Resolver,
  HTMLMapping,
  resolveStyleSetDefinitions,
  generateUniqueKeys,
  createNodesLookup,
}
