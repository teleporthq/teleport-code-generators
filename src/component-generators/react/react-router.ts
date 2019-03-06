import importStatementsPlugin from '../../plugins/common/import-statements'
import reactAppRoutingPlugin from '../../plugins/react/react-app-routing'
import { AssemblyLine, Builder, Resolver } from '../../core'

import { ComponentUIDL } from '../../uidl-definitions/types'
import htmlMapping from '../../uidl-definitions/elements-mapping/html-mapping.json'
import reactMapping from './react-mapping.json'

const createRouterComponentGenerator = () => {
  const resolver = new Resolver({
    ...htmlMapping,
    ...reactMapping,
  })

  const assemblyLine = new AssemblyLine([reactAppRoutingPlugin, importStatementsPlugin])
  const chunksLinker = new Builder()

  const generateComponent = async (uidl: ComponentUIDL) => {
    const resolvedUIDL = resolver.resolveUIDL(uidl)
    const result = await assemblyLine.run(resolvedUIDL)

    return {
      code: chunksLinker.link(result.chunks),
      dependencies: result.dependencies,
    }
  }

  return {
    generateComponent,
  }
}

export default createRouterComponentGenerator
