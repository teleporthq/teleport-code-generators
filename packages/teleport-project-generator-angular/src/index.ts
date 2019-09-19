import { createPlugin as createModuleGenerator } from '@teleporthq/teleport-plugin-angular-module'
import { createAngularComponentGenerator } from '@teleporthq/teleport-component-generator-angular'
import { createPostProcessor } from '@teleporthq/teleport-postprocessor-prettier-js'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { Mapping, FileType } from '@teleporthq/teleport-types'

import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import { createPlugin as createImportPlugin } from '@teleporthq/teleport-plugin-import-statements'

import { CUSTOM_BODY_CONTENT } from './constants'
import AngularProjectMapping from './angular-mapping.json'
import AngularTemplate from './project-template'

const createAngularProjectGenerator = () => {
  const prettierJS = createPostProcessor({ fileType: FileType.TS })
  const importStatementsPlugin = createImportPlugin({ fileType: FileType.TS })

  const rootModuleGeneratorAngular = createModuleGenerator({ moduleType: 'root' })
  const componentModuleGeneratorAngular = createModuleGenerator({ moduleType: 'component' })
  const pagesModuleGeneratorAngular = createModuleGenerator({ moduleType: 'page' })

  const angularComponentGenerator = createAngularComponentGenerator()
  angularComponentGenerator.addMapping(AngularProjectMapping as Mapping)

  const angularPageGenerator = createAngularComponentGenerator()

  const angularRootModuleGenerator = createComponentGenerator()
  angularRootModuleGenerator.addPlugin(rootModuleGeneratorAngular)
  angularRootModuleGenerator.addPlugin(importStatementsPlugin)
  angularRootModuleGenerator.addPostProcessor(prettierJS)

  const angularComponentModuleGenerator = createComponentGenerator()
  angularComponentModuleGenerator.addPlugin(componentModuleGeneratorAngular)
  angularComponentModuleGenerator.addPlugin(importStatementsPlugin)
  angularComponentModuleGenerator.addPostProcessor(prettierJS)

  const anuglarPageModuleGenerator = createComponentGenerator()
  anuglarPageModuleGenerator.addPlugin(pagesModuleGeneratorAngular)
  anuglarPageModuleGenerator.addPlugin(importStatementsPlugin)
  anuglarPageModuleGenerator.addPostProcessor(prettierJS)

  const htmlFileGenerator = createComponentGenerator()
  htmlFileGenerator.addPostProcessor(prettierHTML)

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

export default createAngularProjectGenerator()
