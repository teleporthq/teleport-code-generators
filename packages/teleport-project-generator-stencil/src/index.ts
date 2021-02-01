import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createStencilComponentGenerator } from '@teleporthq/teleport-component-generator-stencil'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { createPrettierJSPostProcessor } from '@teleporthq/teleport-postprocessor-prettier-js'
import { createPrettierHTMLPostProcessor } from '@teleporthq/teleport-postprocessor-prettier-html'
import { createImportPlugin } from '@teleporthq/teleport-plugin-import-statements'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css'
import stencilAppRouting from '@teleporthq/teleport-plugin-stencil-app-routing'

import { Mapping, FileType } from '@teleporthq/teleport-types'
import { appendToConfigFile } from './utils'
import StencilProjectMapping from './stencil-mapping.json'
import StencilTemplate from './project-template'

const createStencilProjectGenerator = () => {
  const prettierTSX = createPrettierJSPostProcessor({ fileType: FileType.TSX })
  const importStatementsPlugin = createImportPlugin({ fileType: FileType.TSX })
  const prettierHTML = createPrettierHTMLPostProcessor()
  const styleSheetPlugin = createStyleSheetPlugin({
    fileName: 'style',
  })

  const generator = createProjectGenerator({
    components: {
      generator: createStencilComponentGenerator,
      mappings: [StencilProjectMapping as Mapping],
      path: ['src', 'components'],
      options: {
        createFolderForEachComponent: true,
      },
    },
    pages: {
      generator: createStencilComponentGenerator,
      mappings: [StencilProjectMapping as Mapping],
      path: ['src', 'components'],
      options: {
        createFolderForEachComponent: true,
      },
    },
    projectStyleSheet: {
      generator: createComponentGenerator,
      plugins: [styleSheetPlugin],
      fileName: 'style',
      path: ['src'],
    },
    router: {
      generator: createComponentGenerator,
      plugins: [stencilAppRouting, importStatementsPlugin],
      postprocessors: [prettierTSX],
      path: ['src', 'components'],
      fileName: 'app-root',
    },
    entry: {
      generator: createComponentGenerator,
      postprocessors: [prettierHTML],
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
    framework: {
      replace: {
        fileName: 'stencil.config',
        fileType: FileType.TS,
        path: [''],
        replaceFile: appendToConfigFile,
        isGlobalStylesDependent: true,
      },
    },
  })

  return generator
}

export { createStencilProjectGenerator, StencilProjectMapping, StencilTemplate }
