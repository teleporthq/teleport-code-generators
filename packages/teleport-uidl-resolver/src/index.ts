import Resolver from './resolver'
import HTMLMapping from './html-mapping.json'
import { Mapping, UIDLElement, GeneratorOptions } from '@teleporthq/teleport-types'
import { resolveStyleSetDefinitions } from './resolvers/style-set-definitions'

const htmlResolver = new Resolver(HTMLMapping as Mapping)

const resolveUIDLElement = (node: UIDLElement, options?: GeneratorOptions) => {
  return htmlResolver.resolveElement(node, options)
}

export { resolveUIDLElement, Resolver, HTMLMapping, resolveStyleSetDefinitions }
