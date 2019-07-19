import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'

import { Mapping } from '@teleporthq/teleport-types'

import nuxtMapping from './nuxt-mapping.json'

export const createVueNuxtGenerator = () => {
  const vueComponentGenerator = createVueComponentGenerator(nuxtMapping as Mapping)

  const htmlFileGenerator = createComponentGenerator()
  htmlFileGenerator.addPostProcessor(prettierHTML)

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
      generator: htmlFileGenerator,
      appRootOverride: '{{APP}}',
      fileName: 'app',
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
