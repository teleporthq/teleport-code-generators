import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createStencilComponentGenerator } from '@teleporthq/teleport-component-generator-stencil'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { createPostProcessor } from '@teleporthq/teleport-postprocessor-prettier-js'
import { createPlugin as createImportPlugin } from '@teleporthq/teleport-plugin-import-statements'

import stencilAppRouting from '@teleporthq/teleport-plugin-stencil-app-routing'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'

import { Mapping } from '@teleporthq/teleport-types'

import StencilProjectMapping from './stencil-mapping.json'
import StencilTemplate from './project-template'

const createStencilProjectGenerator = () => {
  const prettierJS = createPostProcessor({ fileType: FILE_TYPE.TSX })
  const importStatementsPlugin = createImportPlugin({ fileType: FILE_TYPE.TSX })

  const stencilComponentGenerator = createStencilComponentGenerator()
  stencilComponentGenerator.addMapping(StencilProjectMapping as Mapping)

  const routingComponentGenerator = createComponentGenerator()
  routingComponentGenerator.addPlugin(stencilAppRouting)
  routingComponentGenerator.addPlugin(importStatementsPlugin)
  routingComponentGenerator.addPostProcessor(prettierJS)

  const htmlFileGenerator = createComponentGenerator()
  htmlFileGenerator.addPostProcessor(prettierHTML)

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

export default createStencilProjectGenerator()
