import { AssemblyLine, Builder, Resolver } from '../../core'

import vueRoutingPlugin from '../../plugins/vue/vue-router'
import importStatementsPlugin from '../../plugins/common/import-statements'

import { GeneratorOptions } from '../../shared/types'
import { ComponentUIDL } from '../../uidl-definitions/types'

import htmlMapping from '../../uidl-definitions/elements-mapping/html-mapping.json'
import vueMapping from './vue-mapping.json'

const createVuePipeline = ({ customMapping }: GeneratorOptions = {}) => {
  const resolver = new Resolver({ ...htmlMapping, ...vueMapping, ...customMapping })
  const assemblyLine = new AssemblyLine([vueRoutingPlugin, importStatementsPlugin])

  const chunksLinker = new Builder()

  const generateComponent = async (uidl: ComponentUIDL, options: GeneratorOptions = {}) => {
    const resolvedUIDL = resolver.resolveUIDL(uidl, options)
    const { chunks, externalDependencies } = await assemblyLine.run(resolvedUIDL)
    const code = chunksLinker.link(chunks.default)

    return {
      code,
      externalDependencies,
    }
  }

  return {
    generateComponent,
  }
}

export default createVuePipeline
