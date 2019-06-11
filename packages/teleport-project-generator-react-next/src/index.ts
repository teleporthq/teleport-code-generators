import { createReactGenerator, createDocumentFile } from './component-generators'
import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { GeneratorOptions } from '@teleporthq/teleport-types'

export const createReactNextGenerator = (generatorOptions: GeneratorOptions = {}) => {
  const reactComponentGenerator = createReactGenerator(generatorOptions)

  const generator = createProjectGenerator({
    components: {
      generator: reactComponentGenerator,
      path: ['components'],
    },
    pages: {
      generator: reactComponentGenerator,
      path: ['pages'],
      metaOptions: {
        usePathAsFileName: true,
        convertDefaultToIndex: true,
      },
    },
    entry: {
      generator: createDocumentFile,
      path: ['pages'],
    },
    static: {
      prefix: '/static',
      path: ['static'],
    },
  })

  return generator
}

export default createReactNextGenerator()
