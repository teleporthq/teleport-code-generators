import importStatementsPlugin from '@teleporthq/teleport-react-import-statements'
import reactAppRoutingPlugin from '@teleporthq/teleport-react-app-routing'
import { AssemblyLine, Builder, Resolver } from '@teleporthq/teleport-generator-core'

import htmlMapping from '@teleporthq/teleport-generator-shared/src/uidl-definitions/elements-mapping/html-mapping.json'
import reactMapping from './react-mapping.json'

import { parseComponentJSON } from '@teleporthq/teleport-generator-core/lib/parser/component'
import { Mapping } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

const createRouterComponentGenerator = () => {
  const resolver = new Resolver([htmlMapping as Mapping, reactMapping as Mapping])

  const assemblyLine = new AssemblyLine([reactAppRoutingPlugin, importStatementsPlugin])
  const chunksLinker = new Builder()

  // TODO change to respect the same output as normal component?
  // TODO validate UIDL in here as well?
  const generateComponent = async (input: Record<string, unknown>) => {
    const uidl = parseComponentJSON(input)
    const resolvedUIDL = resolver.resolveUIDL(uidl)
    const { chunks, externalDependencies } = await assemblyLine.run(resolvedUIDL)

    return {
      code: chunksLinker.link(chunks.default),
      externalDependencies,
    }
  }

  return {
    generateComponent,
  }
}

export default createRouterComponentGenerator
