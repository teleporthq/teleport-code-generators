import AssemblyLine from '@teleporthq/teleport-assembly-line'
import Builder from '@teleporthq/teleport-builders'
import Resolver from '@teleporthq/teleport-resolver'

import { parseComponentJSON } from '@teleporthq/teleport-parser/lib/component'

import vueRoutingPlugin from '@teleporthq/teleport-vue-app-routing'
import importStatementsPlugin from '@teleporthq/teleport-react-import-statements'

import htmlMapping from '@teleporthq/teleport-uidl-definitions/src/elements-mapping/html-mapping.json'
import vueMapping from './vue-mapping.json'
import { GeneratorOptions } from '@teleporthq/teleport-types-generator'
import { Mapping } from '@teleporthq/teleport-types-uidl-definitions'

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
