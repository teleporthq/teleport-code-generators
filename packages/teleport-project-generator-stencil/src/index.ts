import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createStencilComponentGenerator } from '@teleporthq/teleport-component-generator-stencil'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { createPrettierJSPostProcessor } from '@teleporthq/teleport-postprocessor-prettier-js'
import { createPrettierHTMLPostProcessor } from '@teleporthq/teleport-postprocessor-prettier-html'
import { createImportPlugin } from '@teleporthq/teleport-plugin-import-statements'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css'
import stencilAppRouting from '@teleporthq/teleport-plugin-stencil-app-routing'

import { Mapping, FileType } from '@teleporthq/teleport-types'

import StencilProjectMapping from './stencil-mapping.json'
import StencilTemplate from './project-template'

const createStencilProjectGenerator = () => {
  const prettierJS = createPrettierJSPostProcessor({ fileType: FileType.TSX })
  const importStatementsPlugin = createImportPlugin({ fileType: FileType.TSX })

  const stencilComponentGenerator = createStencilComponentGenerator()
  stencilComponentGenerator.addMapping(StencilProjectMapping as Mapping)

  const routingComponentGenerator = createComponentGenerator()
  routingComponentGenerator.addPlugin(stencilAppRouting)
  routingComponentGenerator.addPlugin(importStatementsPlugin)
  routingComponentGenerator.addPostProcessor(prettierJS)

  const htmlFileGenerator = createComponentGenerator()
  const prettierHTML = createPrettierHTMLPostProcessor()
  htmlFileGenerator.addPostProcessor(prettierHTML)

  const styleSheetGenerator = createComponentGenerator()
  styleSheetGenerator.addPlugin(
    createStyleSheetPlugin({
      fileName: 'style',
    })
  )

  const generator = createProjectGenerator({
    components: {
      generator: stencilComponentGenerator,
      path: ['src', 'components'],
      options: {
        createFolderForEachComponent: true,
      },
    },
    pages: {
      generator: stencilComponentGenerator,
      path: ['src', 'components'],
      options: {
        createFolderForEachComponent: true,
      },
    },
    projectStyleSheet: {
      generator: styleSheetGenerator,
      fileName: 'style',
      path: ['src'],
    },
    router: {
      generator: routingComponentGenerator,
      path: ['src', 'components'],
      fileName: 'app-root',
    },
    entry: {
      generator: htmlFileGenerator,
      path: ['src'],
      fileName: 'index',
      options: {
        appRootOverride: `<app-root></app-root>`,
        customTags: [
          {
            tagName: 'script',
            targetTag: 'head',
            attributes: [
              { attributeKey: 'type', attributeValue: 'module' },
              { attributeKey: 'src', attributeValue: '/build/app.esm.js' },
            ],
          },
          {
            tagName: 'script',
            targetTag: 'head',
            attributes: [
              { attributeKey: 'nomodule' },
              { attributeKey: 'src', attributeValue: '/buid/app.js' },
            ],
          },
          {
            tagName: 'link',
            targetTag: 'head',
            attributes: [
              { attributeKey: 'rel', attributeValue: 'stylesheet' },
              { attributeKey: 'href', attributeValue: '/build/app.css' },
            ],
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

export { createStencilProjectGenerator, StencilProjectMapping, StencilTemplate }
