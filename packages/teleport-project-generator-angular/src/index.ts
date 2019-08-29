import angularModuleGeneratorAngular from '@teleporthq/teleport-plugin-module-generator-angular'
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

  const angularComponentGenerator = createAngularComponentGenerator()
  angularComponentGenerator.addMapping(anuglarProjectMapping as Mapping)

  const angularPageGenerator = createAngularComponentGenerator()

  const anuglarRoutingComponentGenerator = createComponentGenerator()
  anuglarRoutingComponentGenerator.addPlugin(angularModuleGeneratorAngular)
  anuglarRoutingComponentGenerator.addPlugin(importStatementsPlugin)
  anuglarRoutingComponentGenerator.addPostProcessor(prettierJS)

  const htmlFileGenerator = createComponentGenerator()
  htmlFileGenerator.addPostProcessor(prettierHTML)

  const generator = createProjectGenerator({
    components: {
      generator: angularComponentGenerator,
      path: ['src', 'components'],
      options: {
        createFolderForEachComponent: true,
      },
    },
    pages: {
      generator: angularPageGenerator,
      path: ['src', 'pages'],
      options: {
        createFolderForEachComponent: true,
      },
    },
    router: {
      generator: anuglarRoutingComponentGenerator,
      path: ['src'],
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
