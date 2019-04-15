import importStatementsPlugin from '@teleporthq/teleport-react-import-statements'
import reactAppRoutingPlugin from '@teleporthq/teleport-react-app-routing'
import AssemblyLine from '@teleporthq/teleport-assembly-line'
import Builder from '@teleporthq/teleport-builders'
import Resolver from '@teleporthq/teleport-resolver'

import htmlMapping from '@teleporthq/teleport-uidl-definitions/lib/elements-mapping/html-mapping.json'
import reactMapping from './react-mapping.json'
import { parseComponentJSON } from '@teleporthq/teleport-parser/lib/component'
import { Mapping } from '@teleporthq/teleport-types-uidl-definitions'

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
