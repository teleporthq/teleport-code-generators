import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'
import { createGenerator } from '@teleporthq/teleport-component-generator'

import vueRoutingPlugin from '@teleporthq/teleport-plugin-vue-app-routing'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import { Mapping } from '@teleporthq/teleport-types'

import vueProjectMapping from './vue-project-mapping.json'

export const createVueBasicGenerator = () => {
  const vueComponentGenerator = createVueComponentGenerator(vueProjectMapping as Mapping)

  const vueRouterGenerator = createGenerator()
  vueRouterGenerator.addPlugin(vueRoutingPlugin)
  vueRouterGenerator.addPlugin(importStatementsPlugin)
  vueRouterGenerator.addPostProcessor(prettierJS)

  const htmlFileGenerator = createGenerator()
  htmlFileGenerator.addPostProcessor(prettierHTML)

  const generator = createProjectGenerator({
    components: {
      generator: vueComponentGenerator,
      path: ['src', 'components'],
    },
    pages: {
      generator: vueComponentGenerator,
      path: ['src', 'views'],
    },
    router: {
      generator: vueRouterGenerator,
      path: ['src'],
      fileName: 'router',
    },
    entry: {
      generator: htmlFileGenerator,
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
