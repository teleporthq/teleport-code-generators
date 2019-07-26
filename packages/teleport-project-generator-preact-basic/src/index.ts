import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createPreactComponentGenerator } from '@teleporthq/teleport-component-generator-preact'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import reactAppRoutingPlugin from '@teleporthq/teleport-plugin-react-app-routing'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'

import { Mapping } from '@teleporthq/teleport-types'

import preactProjectMapping from './preact-project-mapping.json'

export const createPreactBasicGenerator = () => {
  const preactComponentGenerator = createPreactComponentGenerator()
  preactComponentGenerator.addMapping(preactProjectMapping as Mapping)

  const routingComponentGenerator = createComponentGenerator()
  routingComponentGenerator.addPlugin(reactAppRoutingPlugin)
  routingComponentGenerator.addPlugin(importStatementsPlugin)
  routingComponentGenerator.addPostProcessor(prettierJS)

  const htmlFileGenerator = createPreactComponentGenerator()
  htmlFileGenerator.addPostProcessor(prettierHTML)

  const generator = createProjectGenerator({
    components: {
      generator: preactComponentGenerator,
      path: ['src', 'components'],
      metaDataOptions: {
        useFolderStructure: true,
      },
    },
    pages: {
      generator: preactComponentGenerator,
      path: ['src', 'routes'],
      metaDataOptions: {
        useFolderStructure: true,
      },
    },
    entry: {
      generator: htmlFileGenerator,
      path: ['src'],
      fileName: 'index',
    },
    router: {
      generator: routingComponentGenerator,
      path: ['src', 'components'],
      fileName: 'app',
      metaDataOptions: {
        useFolderStructure: true,
        disableDOMInjection: true,
      },
    },
    static: {
      prefix: '/assets',
      path: ['src', 'assets'],
    },
  })

  return generator
}

export default createPreactBasicGenerator()
