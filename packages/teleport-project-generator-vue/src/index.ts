import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import vueRoutingPlugin from '@teleporthq/teleport-plugin-vue-app-routing'
import { createPlugin as createHeadConfigPlugin } from '@teleporthq/teleport-plugin-vue-head-config'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import { Mapping } from '@teleporthq/teleport-types'

import vueProjectMapping from './vue-project-mapping.json'

const vueHeadConfigPlugin = createHeadConfigPlugin({ metaObjectKey: 'metaInfo' })

export const createVueProjectGenerator = () => {
  const vueComponentGenerator = createVueComponentGenerator(vueProjectMapping as Mapping)
  const vuePagesGenerator = createVueComponentGenerator(vueProjectMapping as Mapping)
  vuePagesGenerator.addPlugin(vueHeadConfigPlugin)

  const vueRouterGenerator = createComponentGenerator()
  vueRouterGenerator.addPlugin(vueRoutingPlugin)
  vueRouterGenerator.addPlugin(importStatementsPlugin)
  vueRouterGenerator.addPostProcessor(prettierJS)

  const htmlFileGenerator = createComponentGenerator()
  htmlFileGenerator.addPostProcessor(prettierHTML)

  const generator = createProjectGenerator({
    components: {
      generator: vueComponentGenerator,
      path: ['src', 'components'],
    },
    pages: {
      generator: vuePagesGenerator,
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

export default createVueProjectGenerator()
