import { AssemblyLine, Builder, Resolver } from '../../core'

import { createPlugin as createRouterPlugin } from '../../plugins/vue/vue-router'
import { createPlugin as createImportPlugin } from '../../plugins/common/import-statements'

import { GeneratorOptions } from '../../shared/types'
import { ComponentUIDL } from '../../uidl-definitions/types'

import htmlMapping from '../../uidl-definitions/elements-mapping/html-mapping.json'
import vueMapping from './vue-mapping.json'

const createVuePipeline = ({ customMapping }: GeneratorOptions = {}) => {
  const resolver = new Resolver({ ...htmlMapping, ...vueMapping, ...customMapping })
  const assemblyLine = new AssemblyLine([
    createRouterPlugin({
      codeChunkName: 'vue-router',
      importChunkName: 'import-local',
    }),
    createImportPlugin(),
  ])

  const chunksLinker = new Builder()

  const generateComponent = async (uidl: ComponentUIDL, options: GeneratorOptions = {}) => {
    const resolvedUIDL = resolver.resolveUIDL(uidl, options)
    const result = await assemblyLine.run(resolvedUIDL)
    const code = chunksLinker.link(result.chunks)

    return {
      code,
      dependencies: result.dependencies,
    }
  }

  return {
    generateComponent,
  }
}

export default createVuePipeline
