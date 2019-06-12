import { createReactGenerator, createDocumentFile } from './component-generators'
import { createProjectGenerator } from '@teleporthq/teleport-project-generator'

export const createReactNextGenerator = () => {
  const reactComponentGenerator = createReactGenerator()

  const generator = createProjectGenerator({
    components: {
      generator: reactComponentGenerator,
      path: ['components'],
    },
    pages: {
      generator: reactComponentGenerator,
      path: ['pages'],
      metaDataOptions: {
        usePathAsFileName: true,
        convertDefaultToIndex: true,
      },
    },
    entry: {
      generatorFunction: createDocumentFile,
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
