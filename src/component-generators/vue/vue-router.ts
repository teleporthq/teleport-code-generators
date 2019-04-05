import { AssemblyLine, Builder, Resolver } from '../../core'
import { parseComponentJSON } from '../../core/parser/component'

import vueRoutingPlugin from '../../plugins/teleport-plugin-vue-app-routing'
import importStatementsPlugin from '../../plugins/teleport-plugin-import-statements'

import htmlMapping from '../../uidl-definitions/elements-mapping/html-mapping.json'
import vueMapping from './vue-mapping.json'
import { GeneratorOptions } from '../../typings/generators'
import { Mapping } from '../../typings/uidl-definitions'

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
