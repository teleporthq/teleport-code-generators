import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import {
  createReactComponentGenerator,
  ReactStyleVariation,
} from '@teleporthq/teleport-component-generator-react'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import reactAppRoutingPlugin from '@teleporthq/teleport-plugin-react-app-routing'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import headConfigPlugin from '@teleporthq/teleport-plugin-jsx-head-config'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'

import { Mapping } from '@teleporthq/teleport-types'

import GatsbyProjectMapping from './gatsby-mapping.json'
import GatsbyTemplate from './project-template'

const createGatsbyProjectGenerator = () => {
  const reactComponentGenerator = createReactComponentGenerator(ReactStyleVariation.CSSModules)
  reactComponentGenerator.addMapping(GatsbyProjectMapping as Mapping)

  const reactPagesGenerator = createReactComponentGenerator(ReactStyleVariation.CSSModules, {
    plugins: [headConfigPlugin],
    mappings: [GatsbyProjectMapping as Mapping],
  })

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
      path: ['src', 'pages'],
      options: {
        useFileNameForNavigation: true,
      },
    },
    entry: {
      generator: htmlFileGenerator,
      path: ['public'],
      fileName: 'index',
    },
    static: {
      prefix: '',
      path: ['public'],
    },
  })

  return generator
}

export { createGatsbyProjectGenerator, GatsbyProjectMapping, GatsbyTemplate }
