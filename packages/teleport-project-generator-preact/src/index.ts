import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createPreactComponentGenerator } from '@teleporthq/teleport-component-generator-preact'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import { createPlugin as createRouterPlugin } from '@teleporthq/teleport-plugin-react-app-routing'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'

import { Mapping } from '@teleporthq/teleport-types'

import preactProjectMapping from './preact-project-mapping.json'

export const createPreactProjectGenerator = () => {
  const preactComponentGenerator = createPreactComponentGenerator()
  preactComponentGenerator.addMapping(preactProjectMapping as Mapping)

  const routerPlugin = createRouterPlugin({ flavor: 'preact' })
  const routingComponentGenerator = createComponentGenerator()
  routingComponentGenerator.addPlugin(routerPlugin)
  routingComponentGenerator.addPlugin(importStatementsPlugin)
  routingComponentGenerator.addPostProcessor(prettierJS)

  const htmlFileGenerator = createComponentGenerator()
  htmlFileGenerator.addPostProcessor(prettierHTML)

  const generator = createProjectGenerator({
    components: {
      generator: preactComponentGenerator,
      path: ['src', 'components'],
    },
    pages: {
      generator: preactComponentGenerator,
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
    },
    static: {
      prefix: '/assets',
      path: ['src', 'assets'],
    },
  })

  return generator
}

export default createPreactProjectGenerator()
