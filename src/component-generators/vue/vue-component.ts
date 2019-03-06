import { AssemblyLine, Builder, Resolver } from '../../core'

import vueComponentPlugin from '../../plugins/vue/vue-base-component'
import vueStylePlugin from '../../plugins/vue/vue-style-chunk'
import { createPlugin as createImportStatementsPlugin } from '../../plugins/common/import-statements'

import { GeneratorOptions, ComponentGenerator, CompiledComponent } from '../../shared/types'
import { ComponentUIDL } from '../../uidl-definitions/types'

// @ts-ignore
import htmlMapping from '../../uidl-definitions/elements-mapping/html-mapping.json'
// @ts-ignore
import vueMapping from './vue-mapping.json'

import { addSpacesToEachLine, removeLastEmptyLine } from '../../shared/utils/string-utils'

const createVueGenerator = (
  { customMapping }: GeneratorOptions = { customMapping: {} }
): ComponentGenerator => {
  const resolver = new Resolver({ ...htmlMapping, ...vueMapping, ...customMapping })
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
    const resolvedUIDL = resolver.resolveUIDL(uidl, options)
    const result = await assemblyLine.run(resolvedUIDL)

    const jsChunks = result.chunks.filter((chunk) => chunk.meta.fileId === 'vuejs')
    const cssChunks = result.chunks.filter((chunk) => chunk.meta.fileId === 'vuecss')
    const htmlChunks = result.chunks.filter((chunk) => chunk.meta.fileId === 'vuehtml')

    const jsCode = removeLastEmptyLine(chunksLinker.link(jsChunks))
    const cssCode = removeLastEmptyLine(chunksLinker.link(cssChunks))
    const htmlCode = removeLastEmptyLine(chunksLinker.link(htmlChunks))

    return {
      code: `<template>
${addSpacesToEachLine(' '.repeat(2), htmlCode)}
</template>

<script>
${jsCode}
</script>

<style>
${cssCode}
</style>
`,
      dependencies: result.dependencies,
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
