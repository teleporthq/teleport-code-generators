import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import vueRoutingPlugin from '@teleporthq/teleport-plugin-vue-app-routing'
import { createVueHeadConfigPlugin } from '@teleporthq/teleport-plugin-vue-head-config'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import { Mapping } from '@teleporthq/teleport-types'
import pluginCSS, { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css'

import VueTemplate from './project-template'
import VueProjectMapping from './vue-project-mapping.json'

const createVueProjectGenerator = () => {
  const vueHeadConfigPlugin = createVueHeadConfigPlugin({ metaObjectKey: 'metaInfo' })

  const generator = createProjectGenerator({
    id: 'teleport-project-vue',
    components: {
      generator: createVueComponentGenerator,
      mappings: [VueProjectMapping as Mapping],
      path: ['src', 'components'],
    },
    pages: {
      generator: createVueComponentGenerator,
      plugins: [vueHeadConfigPlugin],
      mappings: [VueProjectMapping as Mapping],
      path: ['src', 'views'],
    },
    projectStyleSheet: {
      generator: createComponentGenerator,
      plugins: [createStyleSheetPlugin()],
      fileName: 'style',
      path: ['src'],
      importFile: true,
    },
    router: {
      generator: createComponentGenerator,
      plugins: [vueRoutingPlugin, pluginCSS, importStatementsPlugin],
      postprocessors: [prettierJS],
      path: ['src'],
      fileName: 'router',
    },
    entry: {
      generator: createComponentGenerator,
      postprocessors: [prettierHTML],
      path: ['public'],
    },
    static: {
      prefix: '',
      path: ['public'],
    },
  })

  return generator
}

export { createVueProjectGenerator, VueProjectMapping, VueTemplate }
