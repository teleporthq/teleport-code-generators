import {
  createRouterIndexFile,
  createHtmlEntryFile,
  createComponentGenerator,
} from './component-generators'

import { createProjectGenerator } from '@teleporthq/teleport-project-generator'

export const createReactBasicGenerator = () => {
  const reactComponentGenerator = createComponentGenerator()

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
      generatorFunction: createRouterIndexFile,
      path: ['src'],
    },
    entry: {
      generatorFunction: createHtmlEntryFile,
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
