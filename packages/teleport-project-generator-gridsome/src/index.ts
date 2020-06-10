import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import { createVueHeadConfigPlugin } from '@teleporthq/teleport-plugin-vue-head-config'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css'
import { Mapping, FileType } from '@teleporthq/teleport-types'
import { configContentGenerator } from './utils'
import GridsomeTemplate from './gridsome-project-template'
import GridsomeProjectMappng from './gridsome-project-mapping.json'

const createGridsomeProjectGenerator = () => {
  const vueComponentGenerator = createVueComponentGenerator()
  vueComponentGenerator.addMapping(GridsomeProjectMappng as Mapping)

  const vueHeadConfigPlugin = createVueHeadConfigPlugin({ metaObjectKey: 'metaInfo' })

  const vuePageGenerator = createVueComponentGenerator()
  vuePageGenerator.addMapping(GridsomeProjectMappng as Mapping)
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
      path: ['src', 'components'],
    },
    pages: {
      generator: vuePageGenerator,
      path: ['src', 'pages'],
      options: {
        useFileNameForNavigation: true,
      },
    },
    projectStyleSheet: {
      generator: styleSheetGenerator,
      fileName: 'style',
      path: ['src', 'assets'],
    },
    framework: {
      config: {
        generator: configGenerator,
        configContentGenerator,
        fileName: 'main',
        fileType: FileType.JS,
        path: ['src'],
        isGlobalStylesDependent: true,
      },
    },
    entry: {
      generator: htmlFileGenerator,
      path: ['src'],
    },
    static: {
      prefix: '',
      path: ['static'],
    },
  })

  return generator
}

export { createGridsomeProjectGenerator, GridsomeProjectMappng, GridsomeTemplate }
