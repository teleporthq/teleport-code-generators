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
import { GridsomeProjectMapping } from './gridsome-project-mapping'

const createGridsomeProjectGenerator = () => {
  const vueHeadConfigPlugin = createVueHeadConfigPlugin({ metaObjectKey: 'metaInfo' })
  const styleSheetPlugin = createStyleSheetPlugin({
    fileName: 'style',
  })

  const generator = createProjectGenerator({
    id: 'teleport-project-gridsome',
    components: {
      generator: createVueComponentGenerator,
      mappings: [GridsomeProjectMapping],
      path: ['src', 'components'],
    },
    pages: {
      generator: createVueComponentGenerator,
      plugins: [vueHeadConfigPlugin],
      mappings: [GridsomeProjectMapping as Mapping],
      path: ['src', 'pages'],
      options: {
        useFileNameForNavigation: true,
      },
    },
    projectStyleSheet: {
      generator: createComponentGenerator,
      plugins: [styleSheetPlugin],
      fileName: 'style',
      path: ['src', 'assets'],
    },
    framework: {
      config: {
        generator: createComponentGenerator,
        postprocessors: [prettierJS],
        configContentGenerator,
        fileName: 'main',
        fileType: FileType.JS,
        path: ['src'],
        isGlobalStylesDependent: true,
      },
    },
    entry: {
      postprocessors: [prettierHTML],
      path: ['src'],
    },
    static: {
      prefix: '',
      path: ['static'],
    },
  })

  return generator
}

export { createGridsomeProjectGenerator, GridsomeProjectMapping, GridsomeTemplate }
