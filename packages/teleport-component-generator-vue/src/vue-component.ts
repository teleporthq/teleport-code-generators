import { AssemblyLine, Builder, Resolver, Validator } from '@teleporthq/teleport-generator-core'

import vueComponentPlugin from '@teleporthq/teleport-plugin-vue-base-component'
import vueStylePlugin from '@teleporthq/teleport-plugin-vue-css'
import { createPlugin as createImportStatementsPlugin } from '@teleporthq/teleport-plugin-import-statements'

import htmlMapping from '@teleporthq/teleport-generator-shared/src/uidl-definitions/elements-mapping/html-mapping.json'

import { createFile } from '@teleporthq/teleport-generator-shared/lib/utils/project-utils'
import { FILE_TYPE } from '@teleporthq/teleport-generator-shared/lib/constants'
import {
  addSpacesToEachLine,
  removeLastEmptyLine,
  sanitizeVariableName,
} from '@teleporthq/teleport-generator-shared/lib/utils/string-utils'

import vueMapping from './vue-mapping.json'
import { buildVueFile } from './utils'
import { parseComponentJSON } from '@teleporthq/teleport-generator-core/lib/parser/component'

import {
  GeneratorOptions,
  ComponentGenerator,
  CompiledComponent,
  GenerateComponentFunction,
  GeneratedFile,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { Mapping } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

const createVueGenerator = ({ mapping }: GeneratorOptions = { mapping }): ComponentGenerator => {
  const validator = new Validator()
  const resolver = new Resolver([htmlMapping as Mapping, vueMapping as Mapping, mapping])
  const assemblyLine = new AssemblyLine([
    vueComponentPlugin,
    vueStylePlugin,
    createImportStatementsPlugin({ fileId: 'vuejs' }),
  ])

  const chunksLinker = new Builder()

  const generateComponent: GenerateComponentFunction = async (
    input,
    options = {}
  ): Promise<CompiledComponent> => {
    if (!options.skipValidation) {
      const validationResult = validator.validateComponent(input)
      if (!validationResult.valid) {
        throw new Error(validationResult.errorMsg)
      }
    }
    const uidl = parseComponentJSON(input)

    const files: GeneratedFile[] = []
    // For page components, for some frameworks the filename will be the one set in the meta property
    let fileName = uidl.meta && uidl.meta.fileName ? uidl.meta.fileName : uidl.name
    fileName = sanitizeVariableName(fileName)

    const resolvedUIDL = resolver.resolveUIDL(uidl, options)
    const { chunks, externalDependencies } = await assemblyLine.run(resolvedUIDL)

    const jsCode = removeLastEmptyLine(chunksLinker.link(chunks.vuejs))
    const cssCode = removeLastEmptyLine(chunksLinker.link(chunks.vuecss))
    const htmlCode = removeLastEmptyLine(chunksLinker.link(chunks.vuehtml))

    const formattedHTMLCode = addSpacesToEachLine(' '.repeat(2), htmlCode)
    const vueCode = buildVueFile(formattedHTMLCode, jsCode, cssCode)

    files.push(createFile(fileName, FILE_TYPE.VUE, vueCode))

    return {
      files,
      dependencies: externalDependencies,
    }
  }

  return {
    generateComponent,
    resolveElement: resolver.resolveElement.bind(resolver),
    addMapping: resolver.addMapping.bind(resolver),
    addPlugin: assemblyLine.addPlugin.bind(assemblyLine),
  }
}

export default createVueGenerator
