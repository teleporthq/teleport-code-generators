import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import vueHeadConfigPlugin from '@teleporthq/teleport-plugin-vue-head-config'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css'
import { Mapping, FileType } from '@teleporthq/teleport-types'
import { configContentGenerator } from './utils'

import NuxtMapping from './nuxt-mapping.json'
import NuxtTemplate from './project-template'

const createNuxtProjectGenerator = () => {
  const styleSheetPlugin = createStyleSheetPlugin({
    fileName: 'style',
  })

  const generator = createProjectGenerator({
    components: {
      generator: createVueComponentGenerator,
      mappings: [NuxtMapping as Mapping],
      path: ['components'],
    },
    pages: {
      generator: createVueComponentGenerator,
      plugins: [vueHeadConfigPlugin],
      mappings: [NuxtMapping as Mapping],
      path: ['pages'],
      options: {
        useFileNameForNavigation: true,
      },
    },
    entry: {
      generator: createComponentGenerator,
      postprocessors: [prettierHTML],
      fileName: 'app',
      path: [],
      options: {
        appRootOverride: '{{APP}}',
      },
    },
    projectStyleSheet: {
      generator: createComponentGenerator,
      plugins: [styleSheetPlugin],
      fileName: 'style',
      path: [''],
    },
    framework: {
      config: {
        fileName: 'nuxt.config',
        fileType: FileType.JS,
        path: [''],
        generator: createComponentGenerator,
        postprocessors: [prettierJS],
        configContentGenerator,
        isGlobalStylesDependent: true,
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
