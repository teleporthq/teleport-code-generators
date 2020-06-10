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
  const vueComponentGenerator = createVueComponentGenerator()
  vueComponentGenerator.addMapping(NuxtMapping as Mapping)
  const vuePageGenerator = createVueComponentGenerator()
  vuePageGenerator.addMapping(NuxtMapping as Mapping)
  vuePageGenerator.addPlugin(vueHeadConfigPlugin)

  const htmlFileGenerator = createComponentGenerator()
  htmlFileGenerator.addPostProcessor(prettierHTML)

  const styleSheetGenerator = createComponentGenerator()
  styleSheetGenerator.addPlugin(
    createStyleSheetPlugin({
      fileName: 'style',
    })
  )

  const configGenerator = createComponentGenerator()
  configGenerator.addPostProcessor(prettierJS)

  const generator = createProjectGenerator({
    components: {
      generator: vueComponentGenerator,
      path: ['components'],
    },
    pages: {
      generator: vuePageGenerator,
      path: ['pages'],
      options: {
        useFileNameForNavigation: true,
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
    projectStyleSheet: {
      generator: styleSheetGenerator,
      fileName: 'style',
      path: [''],
    },
    framework: {
      config: {
        generator: configGenerator,
        configContentGenerator,
        fileName: 'nuxt.config',
        fileType: FileType.JS,
        path: [''],
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
