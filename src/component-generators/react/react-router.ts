import importStatementsPlugin from '../../plugins/teleport-plugin-import-statements'
import reactAppRoutingPlugin from '../../plugins/teleport-plugin-react-app-routing'
import { AssemblyLine, Builder, Resolver } from '../../core'

import htmlMapping from '../../uidl-definitions/elements-mapping/html-mapping.json'
import reactMapping from './react-mapping.json'
import { parseComponentJSON } from '../../core/parser/component'
import { Mapping } from '../../typings/uidl-definitions'

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
