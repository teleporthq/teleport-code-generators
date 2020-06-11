import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createPreactComponentGenerator } from '@teleporthq/teleport-component-generator-preact'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import { createReactAppRoutingPlugin } from '@teleporthq/teleport-plugin-react-app-routing'
import headConfigPlugin from '@teleporthq/teleport-plugin-jsx-head-config'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import { Mapping, PreactStyleVariation } from '@teleporthq/teleport-types'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css-modules'

import PreactTemplate from './project-template'
import PreactCodesandBoxTemplate from './project-template-codesandbox'
import PreactProjectMapping from './preact-project-mapping.json'
import { CUSTOM_HEAD_CONTENT, CUSTOM_BODY_CONTENT, POLYFILLS_TAG, ENTRY_CHUNK } from './constants'

const createPreactProjectGenerator = () => {
  const preactComponentGenerator = createPreactComponentGenerator(PreactStyleVariation.CSSModules, {
    mappings: [PreactProjectMapping as Mapping],
  })

  const preactPageGenerator = createPreactComponentGenerator(PreactStyleVariation.CSSModules, {
    plugins: [headConfigPlugin],
    mappings: [PreactProjectMapping as Mapping],
  })

  const styleSheetGenerator = createComponentGenerator()
  styleSheetGenerator.addPlugin(
    createStyleSheetPlugin({
      fileName: 'style',
      omitModuleextension: true,
    })
  )

  const routerPlugin = createReactAppRoutingPlugin({ flavor: 'preact' })
  const routingComponentGenerator = createComponentGenerator()
  routingComponentGenerator.addPlugin(routerPlugin)
  routingComponentGenerator.addPlugin(importStatementsPlugin)
  routingComponentGenerator.addPostProcessor(prettierJS)

  const htmlFileGenerator = createComponentGenerator()

  const generator = createProjectGenerator({
    components: {
      generator: preactComponentGenerator,
      path: ['src', 'components'],
    },
    pages: {
      generator: preactPageGenerator,
      path: ['src', 'routes'],
      options: {
        createFolderForEachComponent: true,
      },
    },
    router: {
      generator: routingComponentGenerator,
      path: ['src', 'components'],
      fileName: 'app',
    },
    entry: {
      generator: htmlFileGenerator,
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
    projectStyleSheet: {
      generator: styleSheetGenerator,
      fileName: 'style',
      path: ['src', 'routes'],
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
