import { createPlugin as createAngularModuleGenerator } from '@teleporthq/teleport-plugin-module-generator-angular'
import { createAngularComponentGenerator } from '@teleporthq/teleport-component-generator-angular'
import { createPostProcessor } from '@teleporthq/teleport-postprocessor-prettier-js'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { Mapping } from '@teleporthq/teleport-types'

import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import { createPlugin as createImportPlugin } from '@teleporthq/teleport-plugin-import-statements'
import anuglarProjectMapping from './angular-mapping.json'

export const createPreactProjectGenerator = () => {
  const prettierJS = createPostProcessor({ fileType: FILE_TYPE.TS })
  const importStatementsPlugin = createImportPlugin({ fileType: FILE_TYPE.TS })

  const rootModuleGeneratorAngular = createAngularModuleGenerator({ moduleType: 'root' })
  const componentModuleGeneratorAngular = createAngularModuleGenerator({ moduleType: 'component' })
  const pagesModuleGeneratorAngular = createAngularModuleGenerator({ moduleType: 'pages' })

  const angularComponentGenerator = createAngularComponentGenerator()
  angularComponentGenerator.addMapping(anuglarProjectMapping as Mapping)

  const angularPageGenerator = createAngularComponentGenerator()

  const angulaRootModuleGenerator = createComponentGenerator()
  angulaRootModuleGenerator.addPlugin(rootModuleGeneratorAngular)
  angulaRootModuleGenerator.addPlugin(importStatementsPlugin)
  angulaRootModuleGenerator.addPostProcessor(prettierJS)

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
      path: ['src', 'app', 'components'],
      options: {
        createFolderForEachComponent: true,
        module: {
          generator: angularComponentModuleGenerator,
        },
      },
    },
    pages: {
      generator: angularPageGenerator,
      path: ['src', 'app', 'pages'],
      options: {
        createFolderForEachComponent: true,
      },
    },
    router: {
      generator: angulaRootModuleGenerator,
      path: ['src', 'app'],
      fileName: 'app.module',
    },
    entry: {
      generator: htmlFileGenerator,
      path: ['src'],
      fileName: 'index',
      options: {
        appRootOverride: `<app-root></app-root>`,
      },
    },
    static: {
      prefix: '/assets',
      path: ['src', 'assets'],
    },
  })

  return generator
}

export default createPreactProjectGenerator()
