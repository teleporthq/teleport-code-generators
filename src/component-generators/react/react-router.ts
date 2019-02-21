import { createPlugin as importStatements } from '../plugins/common/import-statements'
import { createPlugin as appRoutingPlugin } from '../plugins/react/react-app-routing'
import { ComponentAssemblyLine, Builder, Resolver } from '../pipeline'

import { ComponentUIDL } from '../../uidl-definitions/types'
import htmlMapping from '../../uidl-definitions/elements-mapping/html-mapping.json'
import reactMapping from './elements-mapping.json'

const createRouterComponentGenerator = () => {
  const resolver = new Resolver({
    ...htmlMapping,
    ...reactMapping,
  })

  const configureAppRouterComponent = appRoutingPlugin({
    componentChunkName: 'app-router-component',
    domRenderChunkName: 'app-router-export',
    importChunkName: 'import',
  })

  const configureImportStatements = importStatements({
    importLibsChunkName: 'import',
  })

  const assemblyLine = new ComponentAssemblyLine([
    configureAppRouterComponent,
    configureImportStatements,
  ])
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
