import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import reactAppRoutingPlugin from '@teleporthq/teleport-plugin-react-app-routing'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import headConfigPlugin from '@teleporthq/teleport-plugin-jsx-head-config'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'

import { Mapping } from '@teleporthq/teleport-types'

import reactProjectMapping from './react-project-mapping.json'

export const createReactProjectGenerator = () => {
  const reactComponentGenerator = createReactComponentGenerator('CSSModules')
  reactComponentGenerator.addMapping(reactProjectMapping as Mapping)

  const reactPagesGenerator = createReactComponentGenerator('CSSModules', [headConfigPlugin])
  reactPagesGenerator.addMapping(reactProjectMapping as Mapping)

  const routingComponentGenerator = createComponentGenerator()
  routingComponentGenerator.addPlugin(reactAppRoutingPlugin)
  routingComponentGenerator.addPlugin(importStatementsPlugin)
  routingComponentGenerator.addPostProcessor(prettierJS)

  const htmlFileGenerator = createComponentGenerator()
  htmlFileGenerator.addPostProcessor(prettierHTML)

  const generator = createProjectGenerator({
    components: {
      generator: reactComponentGenerator,
      path: ['src', 'components'],
    },
    pages: {
      generator: reactPagesGenerator,
      path: ['src', 'views'],
    },
    router: {
      generator: routingComponentGenerator,
      path: ['src'],
      fileName: 'index',
    },
    entry: {
      generator: htmlFileGenerator,
      path: ['public'],
      fileName: 'index',
    },
    static: {
      prefix: '/static',
      path: ['src', 'static'],
    },
  })

  return generator
}

export default createReactProjectGenerator()
