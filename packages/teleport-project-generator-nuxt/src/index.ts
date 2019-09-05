import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import vueHeadConfigPlugin from '@teleporthq/teleport-plugin-vue-head-config'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'

import { Mapping } from '@teleporthq/teleport-types'

import NuxtMapping from './nuxt-mapping.json'
import NuxtTemplate from './project-template'

const createNuxtProjectGenerator = () => {
  const vueComponentGenerator = createVueComponentGenerator()
  vueComponentGenerator.addMapping(NuxtMapping as Mapping)
  const vuePageGenerator = createVueComponentGenerator()
  vuePageGenerator.addMapping(NuxtMapping as Mapping)
  vuePageGenerator.addPlugin(vueHeadConfigPlugin)

  const htmlFileGenerator = createComponentGenerator()
  htmlFileGenerator.addPostProcessor(prettierHTML)

  const generator = createProjectGenerator({
    components: {
      generator: vueComponentGenerator,
      path: ['components'],
    },
    pages: {
      generator: vuePageGenerator,
      path: ['pages'],
      options: {
        usePathAsFileName: true,
        convertDefaultToIndex: true,
      },
    },
    entry: {
      generator: htmlFileGenerator,
      fileName: 'app',
      path: [],
      options: {
        appRootOverride: '{{APP}}',
      },
    },
    static: {
      prefix: '',
      path: ['static'],
    },
  })

  return generator
}

export { createNuxtProjectGenerator, NuxtMapping, NuxtTemplate }

export default createNuxtProjectGenerator()
