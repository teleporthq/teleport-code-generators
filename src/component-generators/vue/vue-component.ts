import { AssemblyLine, Builder, Resolver, Validator } from '../../core'

import vueComponentPlugin from '../../plugins/teleport-plugin-vue-base-component'
import vueStylePlugin from '../../plugins/teleport-plugin-vue-css'
import { createPlugin as createImportStatementsPlugin } from '../../plugins/teleport-plugin-import-statements'

import htmlMapping from '../../uidl-definitions/elements-mapping/html-mapping.json'

import { createFile } from '../../shared/utils/project-utils'
import { FILE_EXTENSIONS } from '../../shared/constants'
import {
  addSpacesToEachLine,
  removeLastEmptyLine,
  sanitizeVariableName,
} from '../../shared/utils/string-utils'

import vueMapping from './vue-mapping.json'
import { buildVueFile } from './utils'

const createVueGenerator = (
  { customMapping }: GeneratorOptions = { customMapping }
): ComponentGenerator => {
  const validator = new Validator()
  const resolver = new Resolver([htmlMapping, vueMapping, customMapping])
  const assemblyLine = new AssemblyLine([
    vueComponentPlugin,
    vueStylePlugin,
    createImportStatementsPlugin({ fileId: 'vuejs' }),
  ])

  const chunksLinker = new Builder()

  const generateComponent = async (
    uidl: ComponentUIDL,
    options: GeneratorOptions = {}
  ): Promise<CompiledComponent> => {
    if (!options.skipValidation) {
      const validationResult = validator.validateComponent(uidl)
      if (!validationResult.valid) {
        throw new Error(validationResult.errorMsg)
      }
    }
    const files: GeneratedFile[] = []
    const fileName = sanitizeVariableName(uidl.name)

    const resolvedUIDL = resolver.resolveUIDL(uidl, options)
    const { chunks, externalDependencies } = await assemblyLine.run(resolvedUIDL)

    const jsCode = removeLastEmptyLine(chunksLinker.link(chunks.vuejs))
    const cssCode = removeLastEmptyLine(chunksLinker.link(chunks.vuecss))
    const htmlCode = removeLastEmptyLine(chunksLinker.link(chunks.vuehtml))

    const formattedHTMLCode = addSpacesToEachLine(' '.repeat(2), htmlCode)
    const vueCode = buildVueFile(formattedHTMLCode, jsCode, cssCode)

    files.push(createFile(fileName, FILE_EXTENSIONS.VUE, vueCode))

    return {
      files,
      dependencies: externalDependencies,
    }
  }

  return {
    generateComponent,
    resolveContentNode: resolver.resolveContentNode.bind(resolver),
    addMapping: resolver.addMapping.bind(resolver),
    addPlugin: assemblyLine.addPlugin.bind(assemblyLine),
  }
}

export default createVueGenerator
