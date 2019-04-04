import importStatementsPlugin from '../../plugins/teleport-plugin-import-statements'
import reactAppRoutingPlugin from '../../plugins/teleport-plugin-react-app-routing'
import { AssemblyLine, Builder, Resolver } from '../../core'

import htmlMapping from '../../uidl-definitions/elements-mapping/html-mapping.json'
import reactMapping from './react-mapping.json'
import { ComponentUIDL } from '../../typings/uidl-definitions'

const createRouterComponentGenerator = () => {
  const resolver = new Resolver([htmlMapping, reactMapping])

  const assemblyLine = new AssemblyLine([reactAppRoutingPlugin, importStatementsPlugin])
  const chunksLinker = new Builder()

  const generateComponent = async (uidl: ComponentUIDL) => {
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
