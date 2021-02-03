import { createAngularModulePlugin } from '@teleporthq/teleport-plugin-angular-module'
import { createImportPlugin } from '@teleporthq/teleport-plugin-import-statements'
import {
  createAngularComponentGenerator,
  AngularMapping,
} from '@teleporthq/teleport-component-generator-angular'
import { createPrettierTSPostProcessor } from '@teleporthq/teleport-postprocessor-prettier-ts'
import { createPrettierHTMLPostProcessor } from '@teleporthq/teleport-postprocessor-prettier-html'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { Mapping, FileType } from '@teleporthq/teleport-types'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css'

import { CUSTOM_BODY_CONTENT } from './constants'
import AngularProjectMapping from './angular-mapping.json'
import AngularTemplate from './project-template'

const createAngularProjectGenerator = () => {
  const prettierTS = createPrettierTSPostProcessor({ fileType: FileType.TS })
  const importStatementsPlugin = createImportPlugin({ fileType: FileType.TS })

  const rootModuleGeneratorAngularPlugin = createAngularModulePlugin({ moduleType: 'root' })
  const componentModuleGeneratorAngularPlugin = createAngularModulePlugin({
    moduleType: 'component',
  })
  const pagesModuleGeneratorAngularPlugin = createAngularModulePlugin({ moduleType: 'page' })

  const generator = createProjectGenerator({
    id: 'teleport-project-angular',
    components: {
      generator: createAngularComponentGenerator,
      mappings: [AngularProjectMapping as Mapping],
      path: ['src', 'app', 'components'],
      module: {
        generator: createComponentGenerator,
        plugins: [componentModuleGeneratorAngularPlugin, importStatementsPlugin],
        postprocessors: [prettierTS],
      },
      options: {
        createFolderForEachComponent: true,
        customComponentFileName: (name: string) => `${name}.component`,
        customStyleFileName: (name: string) => `${name}.component`,
        customTemplateFileName: (name: string) => `${name}.component`,
      },
    },
    pages: {
      generator: createAngularComponentGenerator,
      mappings: [AngularMapping as Mapping],
      path: ['src', 'app', 'pages'],
      module: {
        generator: createComponentGenerator,
        plugins: [pagesModuleGeneratorAngularPlugin, importStatementsPlugin],
        postprocessors: [prettierTS],
      },
      options: {
        createFolderForEachComponent: true,
        customComponentFileName: (name: string) => `${name}.component`,
        customStyleFileName: (name: string) => `${name}.component`,
        customTemplateFileName: (name: string) => `${name}.component`,
      },
    },
    projectStyleSheet: {
      generator: createComponentGenerator,
      plugins: [createStyleSheetPlugin({ fileName: 'styles' })],
      fileName: 'styles',
      path: ['src'],
    },
    router: {
      generator: createComponentGenerator,
      plugins: [rootModuleGeneratorAngularPlugin, importStatementsPlugin],
      postprocessors: [prettierTS],
      path: ['src', 'app'],
      fileName: 'app.module',
    },
    entry: {
      generator: createComponentGenerator,
      postprocessors: [createPrettierHTMLPostProcessor()],
      path: ['src'],
      fileName: 'index',
      options: {
        appRootOverride: CUSTOM_BODY_CONTENT,
        customTags: [
          {
            tagName: 'base',
            targetTag: 'head',
            attributes: [{ attributeKey: 'href', attributeValue: '/' }],
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

export { createAngularProjectGenerator, AngularProjectMapping, AngularTemplate }
