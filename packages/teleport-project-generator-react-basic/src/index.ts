import {
  createRouterIndexFile,
  createHtmlEntryFile,
  createComponentGenerator,
} from './component-generators'

import { createProjectGenerator } from '@teleporthq/teleport-project-generator'

import { GeneratorOptions } from '@teleporthq/teleport-types'

export const createReactBasicGenerator = (generatorOptions: GeneratorOptions = {}) => {
  const reactComponentGenerator = createComponentGenerator(generatorOptions)

  const generator = createProjectGenerator({
    components: {
      generator: reactComponentGenerator,
      path: ['src', 'components'],
    },
    pages: {
      generator: reactComponentGenerator,
      path: ['src', 'views'],
    },
    router: {
      generator: createRouterIndexFile,
      path: ['src'],
    },
    entry: {
      generator: createHtmlEntryFile,
      path: ['src'],
    },
    static: {
      prefix: '/static',
      path: ['src', 'static'],
    },
  })

  return generator
}

export default createReactBasicGenerator()
