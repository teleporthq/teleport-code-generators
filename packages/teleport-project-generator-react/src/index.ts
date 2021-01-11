import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import reactAppRoutingPlugin from '@teleporthq/teleport-plugin-react-app-routing'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import headConfigPlugin from '@teleporthq/teleport-plugin-jsx-head-config'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import { Mapping, ReactStyleVariation } from '@teleporthq/teleport-types'
import {
  createStyleSheetPlugin,
  createCSSModulesPlugin,
} from '@teleporthq/teleport-plugin-css-modules'

import ReactProjectMapping from './react-project-mapping.json'
import ReactTemplate from './project-template'

const createReactProjectGenerator = () => {
  const generator = createProjectGenerator({
    style: ReactStyleVariation.CSSModules,
    components: {
      generator: createReactComponentGenerator,
      mappings: [ReactProjectMapping as Mapping],
      path: ['src', 'components'],
    },
    pages: {
      generator: createReactComponentGenerator,
      mappings: [ReactProjectMapping as Mapping],
      plugins: [headConfigPlugin],
      path: ['src', 'views'],
    },
    projectStyleSheet: {
      generator: createComponentGenerator,
      plugins: [createStyleSheetPlugin({ moduleExtension: true })],
      fileName: 'style',
      path: ['src'],
      importFile: true,
    },
    router: {
      generator: createComponentGenerator,
      plugins: [
        reactAppRoutingPlugin,
        createCSSModulesPlugin({ moduleExtension: true }),
        importStatementsPlugin,
      ],
      postprocessors: [prettierJS],
      fileName: 'index',
      path: ['src'],
    },
    entry: {
      generator: createComponentGenerator,
      postprocessors: [prettierHTML],
      fileName: 'index',
      path: ['public'],
    },
    static: {
      prefix: '',
      path: ['public'],
    },
  })

  return generator
}

export { createReactProjectGenerator, ReactProjectMapping, ReactTemplate }
