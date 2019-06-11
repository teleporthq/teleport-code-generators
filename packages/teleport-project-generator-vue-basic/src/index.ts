import { createHtmlEntryFile, createRouterFile, createVueGenerator } from './component-generators'
import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { GeneratorOptions } from '@teleporthq/teleport-types'

export const createVueBasicGenerator = (generatorOptions: GeneratorOptions = {}) => {
  const vueGenerator = createVueGenerator(generatorOptions)

  const generator = createProjectGenerator({
    components: {
      generator: vueGenerator,
      path: ['src', 'components'],
    },
    pages: {
      generator: vueGenerator,
      path: ['src', 'views'],
    },
    router: {
      generator: createRouterFile,
      path: ['src'],
    },
    entry: {
      generator: createHtmlEntryFile,
      path: ['public'],
    },
    static: {
      prefix: '/assets',
      path: ['src', 'assets'],
    },
  })

  return generator
}

export default createVueBasicGenerator()
