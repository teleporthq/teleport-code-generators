import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import vueHeadConfigPlugin from '@teleporthq/teleport-plugin-vue-head-config'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css'
import { FileType } from '@teleporthq/teleport-types'
import { configContentGenerator } from './utils'

import { NuxtProjectMapping } from './nuxt-project-mapping'
import NuxtTemplate from './project-template'
import { nuxtErrorPageMapper } from './error-page-mapping'

const createNuxtProjectGenerator = () => {
  const styleSheetPlugin = createStyleSheetPlugin({
    fileName: 'style',
  })

  const generator = createProjectGenerator({
    id: 'teleport-project-nuxt',
    components: {
      generator: createVueComponentGenerator,
      mappings: [NuxtProjectMapping],
      path: ['components'],
    },
    pages: {
      generator: createVueComponentGenerator,
      plugins: [vueHeadConfigPlugin],
      mappings: [NuxtProjectMapping],
      path: ['pages'],
      options: {
        useFileNameForNavigation: true,
      },
    },
    entry: {
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

export { createNuxtProjectGenerator, NuxtProjectMapping, NuxtTemplate, nuxtErrorPageMapper }
