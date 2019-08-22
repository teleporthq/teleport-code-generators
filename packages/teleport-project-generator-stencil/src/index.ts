import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createStencilComponentGenerator } from '@teleporthq/teleport-component-generator-stencil'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { createPostProcessor } from '@teleporthq/teleport-postprocessor-prettier-js'
import { createPlugin as createImportPlugin } from '@teleporthq/teleport-plugin-import-statements'

import stencilAppRouting from '@teleporthq/teleport-plugin-stencil-app-routing'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'

import { Mapping } from '@teleporthq/teleport-types'

import stencilProjectMapping from './stencil-mapping.json'

export const createStencilProjectGenerator = () => {
  const prettierJS = createPostProcessor({ fileType: FILE_TYPE.TSX })
  const importStatementsPlugin = createImportPlugin({ fileType: FILE_TYPE.TSX })

  const stencilComponentGenerator = createStencilComponentGenerator()
  stencilComponentGenerator.addMapping(stencilProjectMapping as Mapping)

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
        customScriptTags: [
          { attributeKey: 'type', attributeValue: 'module', path: '/build/app.esm.js' },
          {
            attributeValue: 'nomodule',
            path: '/buid/app.js',
          },
        ],
        customLinkTags: [
          { attributeKey: 'rel', attributeValue: 'stylesheet', path: '/build/app.css' },
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

export default createStencilProjectGenerator()
