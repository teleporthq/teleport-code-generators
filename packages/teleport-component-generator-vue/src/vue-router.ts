import { AssemblyLine, Builder, Resolver } from '@teleporthq/teleport-generator-core'

import { parseComponentJSON } from '@teleporthq/teleport-generator-core/lib/parser/component'

import vueRoutingPlugin from '@teleporthq/teleport-plugin-vue-app-routing'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

import htmlMapping from './html-mapping.json'
import vueMapping from './vue-mapping.json'

import { GeneratorOptions } from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { Mapping } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

const createVuePipeline = ({ mapping }: GeneratorOptions = {}) => {
  const resolver = new Resolver([htmlMapping as Mapping, vueMapping as Mapping, mapping])
  const assemblyLine = new AssemblyLine([vueRoutingPlugin, importStatementsPlugin])

  const chunksLinker = new Builder()

  const generateComponent = async (
    input: Record<string, unknown>,
    options: GeneratorOptions = {}
  ) => {
    const uidl = parseComponentJSON(input)
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
