import { createHtmlEntryFile, createRouterFile, createVueGenerator } from './component-generators'
import { createProjectGenerator } from '@teleporthq/teleport-project-generator'

export const createVueBasicGenerator = () => {
  const vueGenerator = createVueGenerator()

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
      generatorFunction: createRouterFile,
      path: ['src'],
    },
    entry: {
      generatorFunction: createHtmlEntryFile,
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
