import { createVueGenerator, createHtmlEntryFile } from './component-generators'
import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { GeneratorOptions } from '@teleporthq/teleport-types'

export const createVueNuxtGenerator = (generatorOptions: GeneratorOptions = {}) => {
  const vueComponentGenerator = createVueGenerator(generatorOptions)

  const generator = createProjectGenerator({
    components: {
      generator: vueComponentGenerator,
      path: ['components'],
    },
    pages: {
      generator: vueComponentGenerator,
      path: ['pages'],
      metaOptions: {
        usePathAsFileName: true,
        convertDefaultToIndex: true,
      },
    },
    entry: {
      generator: createHtmlEntryFile,
      path: [],
    },
    static: {
      prefix: '/static',
      path: ['static'],
    },
  })

  return generator
}

export default createVueNuxtGenerator()
