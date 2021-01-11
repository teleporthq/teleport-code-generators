import { createAngularModulePlugin } from '@teleporthq/teleport-plugin-angular-module'
import { createImportPlugin } from '@teleporthq/teleport-plugin-import-statements'
import { createAngularComponentGenerator } from '@teleporthq/teleport-component-generator-angular'
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

  const rootModuleGeneratorAngular = createAngularModulePlugin({ moduleType: 'root' })
  const componentModuleGeneratorAngular = createAngularModulePlugin({ moduleType: 'component' })
  const pagesModuleGeneratorAngular = createAngularModulePlugin({ moduleType: 'page' })

  const angularComponentGenerator = createAngularComponentGenerator()
  angularComponentGenerator.addMapping(AngularProjectMapping as Mapping)

  const angularPageGenerator = createAngularComponentGenerator()

  const angularRootModuleGenerator = createComponentGenerator()
  angularRootModuleGenerator.addPlugin(rootModuleGeneratorAngular)
  angularRootModuleGenerator.addPlugin(importStatementsPlugin)
  angularRootModuleGenerator.addPostProcessor(prettierTS)

  const angularComponentModuleGenerator = createComponentGenerator()
  angularComponentModuleGenerator.addPlugin(componentModuleGeneratorAngular)
  angularComponentModuleGenerator.addPlugin(importStatementsPlugin)
  angularComponentModuleGenerator.addPostProcessor(prettierTS)

  const anuglarPageModuleGenerator = createComponentGenerator()
  anuglarPageModuleGenerator.addPlugin(pagesModuleGeneratorAngular)
  anuglarPageModuleGenerator.addPlugin(importStatementsPlugin)
  anuglarPageModuleGenerator.addPostProcessor(prettierTS)

  const htmlFileGenerator = createComponentGenerator()
  htmlFileGenerator.addPostProcessor(createPrettierHTMLPostProcessor())

  const styleSheetGenerator = createComponentGenerator()
  styleSheetGenerator.addPlugin(createStyleSheetPlugin())

  const generator = createProjectGenerator({
    components: {
      generator: angularComponentGenerator,
      moduleGenerator: angularComponentModuleGenerator,
      path: ['src', 'app', 'components'],
      options: {
        createFolderForEachComponent: true,
        customComponentFileName: (name: string) => `${name}.component`,
        customStyleFileName: (name: string) => `${name}.component`,
        customTemplateFileName: (name: string) => `${name}.component`,
      },
    },
    pages: {
      generator: angularPageGenerator,
      moduleGenerator: anuglarPageModuleGenerator,
      path: ['src', 'app', 'pages'],
      options: {
        createFolderForEachComponent: true,
        customComponentFileName: (name: string) => `${name}.component`,
        customStyleFileName: (name: string) => `${name}.component`,
        customTemplateFileName: (name: string) => `${name}.component`,
      },
    },
    projectStyleSheet: {
      generator: styleSheetGenerator,
      fileName: 'styles',
      path: ['src'],
    },
    router: {
      generator: angularRootModuleGenerator,
      path: ['src', 'app'],
      fileName: 'app.module',
    },
    entry: {
      generator: htmlFileGenerator,
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
