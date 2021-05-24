import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import {
  createPreactComponentGenerator,
  PreactMapping,
} from '@teleporthq/teleport-component-generator-preact'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { createReactAppRoutingPlugin } from '@teleporthq/teleport-plugin-react-app-routing'
import headConfigPlugin from '@teleporthq/teleport-plugin-jsx-head-config'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import { PreactStyleVariation } from '@teleporthq/teleport-types'
import {
  createStyleSheetPlugin,
  createCSSModulesPlugin,
} from '@teleporthq/teleport-plugin-css-modules'

import PreactTemplate from './project-template'
import PreactCodesandBoxTemplate from './project-template-codesandbox'
import { PreactProjectMapping } from './preact-project-mapping'
import { CUSTOM_HEAD_CONTENT, CUSTOM_BODY_CONTENT, POLYFILLS_TAG, ENTRY_CHUNK } from './constants'

const createPreactProjectGenerator = () => {
  const styleSheetPlugin = createStyleSheetPlugin({
    fileName: 'style',
    moduleExtension: false,
  })
  const routerPlugin = createReactAppRoutingPlugin({ flavor: 'preact' })

  const generator = createProjectGenerator({
    id: 'teleport-project-preact',
    style: PreactStyleVariation.CSSModules,
    components: {
      generator: createPreactComponentGenerator,
      mappings: [PreactMapping],
      path: ['src', 'components'],
    },
    pages: {
      generator: createPreactComponentGenerator,
      path: ['src', 'routes'],
      plugins: [headConfigPlugin],
      mappings: [PreactProjectMapping],
      options: {
        createFolderForEachComponent: true,
      },
    },
    router: {
      generator: createComponentGenerator,
      plugins: [routerPlugin, createCSSModulesPlugin(), importStatementsPlugin],
      postprocessors: [prettierJS],
      path: ['src', 'components'],
      fileName: 'app',
    },
    projectStyleSheet: {
      generator: createComponentGenerator,
      plugins: [styleSheetPlugin],
      fileName: 'style',
      path: ['src', 'routes'],
      importFile: true,
    },
    entry: {
      generator: createComponentGenerator,
      path: ['src'],
      fileName: 'index',
      options: {
        appRootOverride: CUSTOM_BODY_CONTENT,
        customHeadContent: CUSTOM_HEAD_CONTENT,
        customTags: [
          {
            tagName: 'script',
            targetTag: 'body',
            attributes: [
              { attributeKey: 'defer' },
              { attributeKey: 'src', attributeValue: ENTRY_CHUNK },
            ],
          },
          {
            tagName: 'script',
            targetTag: 'body',
            content: POLYFILLS_TAG,
          },
        ],
      },
    },
    static: {
      prefix: '/assets',
      path: ['src', 'assets'],
    },
  })

  return generator
}

export {
  createPreactProjectGenerator,
  PreactProjectMapping,
  PreactTemplate,
  PreactCodesandBoxTemplate,
}
