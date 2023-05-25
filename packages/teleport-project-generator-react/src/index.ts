import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import reactAppRoutingPlugin from '@teleporthq/teleport-plugin-react-app-routing'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import headConfigPlugin from '@teleporthq/teleport-plugin-jsx-head-config'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import pluginJSXInlineFetch from '@teleporthq/teleport-plugin-jsx-inline-fetch'
import { ReactStyleVariation } from '@teleporthq/teleport-types'
import { createStyleSheetPlugin, createCSSPlugin } from '@teleporthq/teleport-plugin-css'
import { createNextContextPlugin } from '@teleporthq/teleport-plugin-next-context'

import { ReactProjectMapping } from './react-project-mapping'
import ReactTemplate from './project-template'

const createReactProjectGenerator = () => {
  const contextPlugin = createNextContextPlugin()
  const generator = createProjectGenerator({
    id: 'teleport-project-react',
    style: ReactStyleVariation.CSS,
    components: {
      generator: createReactComponentGenerator,
      plugins: [contextPlugin, pluginJSXInlineFetch],
      mappings: [ReactProjectMapping],
      path: ['src', 'components'],
    },
    pages: {
      generator: createReactComponentGenerator,
      mappings: [ReactProjectMapping],
      plugins: [headConfigPlugin, contextPlugin, pluginJSXInlineFetch],
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
      plugins: [
        createCSSPlugin({
          templateChunkName: 'jsx-component',
          templateStyle: 'jsx',
          declareDependency: 'import',
          classAttributeName: 'className',
          forceScoping: true,
        }),
        reactAppRoutingPlugin,
        importStatementsPlugin,
      ],
      postprocessors: [prettierJS],
      fileName: 'index',
      path: ['src'],
    },
    entry: {
      postprocessors: [prettierHTML],
      fileName: 'index',
      path: ['public'],
    },
    static: {
      prefix: '',
      path: ['public'],
    },
    resources: {
      path: ['resources'],
    },
  })

  return generator
}

export { createReactProjectGenerator, ReactProjectMapping, ReactTemplate }
