import { createVueGenerator, createHtmlEntryFile } from './component-generators'
import { createProjectGenerator } from '@teleporthq/teleport-project-generator'

export const createVueNuxtGenerator = () => {
  const vueComponentGenerator = createVueGenerator()

  const generator = createProjectGenerator({
    components: {
      generator: vueComponentGenerator,
      path: ['components'],
    },
    pages: {
      generator: vueComponentGenerator,
      path: ['pages'],
      metaDataOptions: {
        usePathAsFileName: true,
        convertDefaultToIndex: true,
      },
    },
    entry: {
      generatorFunction: createHtmlEntryFile,
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
