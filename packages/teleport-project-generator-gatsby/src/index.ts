import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import reactAppRoutingPlugin from '@teleporthq/teleport-plugin-react-app-routing'
import reactBasePlugin from '@teleporthq/teleport-plugin-react-base-component'
import {
  createCSSModulesPlugin,
  createStyleSheetPlugin,
} from '@teleporthq/teleport-plugin-css-modules'
import reactProptypes from '@teleporthq/teleport-plugin-jsx-proptypes'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import headConfigPlugin from '@teleporthq/teleport-plugin-jsx-head-config'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import prettierJSX from '@teleporthq/teleport-postprocessor-prettier-jsx'
import { Mapping, ComponentPlugin } from '@teleporthq/teleport-types'
import GatsbyProjectMapping from './gatsby-mapping.json'
import GatsbyTemplate from './project-template'
import { createCustomHTMLEntryFile } from './utils'

const cssModulesPlugin = createCSSModulesPlugin({
  moduleExtension: true,
  camelCaseClassNames: true,
})

const createGatsbyProjectGenerator = () => {
  const reactComponentGenerator = createCustomReactGatsbyComponentGenerator()
  const reactPagesGenerator = createCustomReactGatsbyComponentGenerator([headConfigPlugin])

  reactComponentGenerator.addPlugin(cssModulesPlugin)
  reactComponentGenerator.addPlugin(importStatementsPlugin)

  reactPagesGenerator.addPlugin(cssModulesPlugin)
  reactPagesGenerator.addPlugin(importStatementsPlugin)

  const routingComponentGenerator = createComponentGenerator()
  routingComponentGenerator.addPlugin(reactAppRoutingPlugin)
  routingComponentGenerator.addPlugin(importStatementsPlugin)
  routingComponentGenerator.addPostProcessor(prettierJS)

  const htmlFileGenerator = createComponentGenerator()
  htmlFileGenerator.addPostProcessor(prettierJS)

  const styleSheetGenerator = createComponentGenerator()
  styleSheetGenerator.addPlugin(
    createStyleSheetPlugin({
      fileName: 'style',
    })
  )

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
      path: ['src'],
      fileName: 'html',
      chunkGenerationFunction: createCustomHTMLEntryFile,
    },
    static: {
      prefix: '',
      path: ['static'],
    },
    projectStyleSheet: {
      generator: styleSheetGenerator,
      fileName: 'style',
      path: ['src'],
    },
  })

  return generator
}

const createCustomReactGatsbyComponentGenerator = (extraPlugins: ComponentPlugin[] = []) => {
  const reactComponentGenerator = createComponentGenerator()
  reactComponentGenerator.addPlugin(reactBasePlugin)
  extraPlugins.forEach((plugin) => reactComponentGenerator.addPlugin(plugin))
  reactComponentGenerator.addPlugin(reactProptypes)
  reactComponentGenerator.addMapping(GatsbyProjectMapping as Mapping)
  reactComponentGenerator.addPostProcessor(prettierJSX)
  return reactComponentGenerator
}

export {
  createGatsbyProjectGenerator,
  GatsbyProjectMapping,
  GatsbyTemplate,
  createCustomReactGatsbyComponentGenerator,
}
